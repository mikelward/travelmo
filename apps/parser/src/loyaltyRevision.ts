import {
  ExtractedSegment,
  ParsedMessage,
  TravelProfile,
  foundLoyaltyFrom,
  foundLoyaltyRevision,
  needsReread,
  paths,
  rereadFoundLoyalty,
  revisedFoundLoyalty,
  type BookedSegments,
  type FoundLoyalty,
} from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { wasDeleted } from "./deleted";
import type { Extractor } from "./extract";
import type { EmailMessage } from "./gmail";
import { originalSentAt } from "./importer";
import { errorKind } from "./log";
import type { MailSource } from "./mailSource";

// A one-off pass over the loyalty numbers already kept from emails
// (SPEC "Loyalty from emails"), so each ends as if its email were read now.
// First, for free (Firestore reads only), every entry is filed again from
// what is stored (revisedFoundLoyalty): its program by namedProgram with the
// bookings its email made, whose it is by its holder's name. Then, for an
// entry still with no holder or a program any could have, its email is read
// from the mailbox again, once per email, and the model's memberships
// replace the email's entries (rereadFoundLoyalty): one model call per such
// email. Trips, bookings and import records are never touched, nor what the
// owner said about whose each number is (`loyaltyPeople`). Runs once per
// foundLoyaltyRevision, marked in `config/foundLoyaltyRevision`; a user that
// fails is logged and skipped. Nothing is logged but counts and kinds of
// error: never a number or a name.

type Severity = "INFO" | "WARNING" | "ERROR";

export type RevisionDeps = {
  db: Firestore;
  extract: Extractor;
  // The connected mailbox an email is in, by its import record's id, and
  // the id it is fetched by; undefined when that mailbox isn't connected.
  mailbox: (uid: string, messageId: string) => Promise<{ source: MailSource; id: string } | undefined>;
  now: () => string;
  log: (severity: Severity, event: string, fields: Record<string, unknown>) => void;
};

export type RevisionResult = {
  users: number;
  // Entries the free step changed or merged.
  fixed: number;
  // Emails read again and their entries replaced.
  reread: number;
  // Emails no longer in their mailbox, or in one no longer connected, or
  // read from no mailbox (forwarded).
  skipped: number;
  // Users and emails that failed.
  failed: number;
};

// How long one parser's claim on the pass holds off another starting at
// the same time; one that dies mid-pass leaves it to a later start.
export const revisionLeaseMs = 60 * 60 * 1000;

// Runs the pass if this revision has not run, nor is running elsewhere;
// undefined when it was not this parser's to run.
export async function reviseFoundLoyaltyOnce(deps: RevisionDeps, revision: number = foundLoyaltyRevision): Promise<RevisionResult | undefined> {
  const { db, now } = deps;
  const marker = db.doc(paths.foundLoyaltyRevision());
  const claimed = await db.runTransaction(async (t) => {
    const data = (await t.get(marker)).data() ?? {};
    if (typeof data.revision === "number" && data.revision >= revision) return false;
    const running = data.running as { revision?: unknown; at?: unknown } | undefined;
    if (running?.revision === revision && typeof running.at === "string" && Date.parse(now()) - Date.parse(running.at) < revisionLeaseMs) return false;
    t.set(marker, { running: { revision, at: now() } }, { merge: true });
    return true;
  });
  if (!claimed) return undefined;
  let result: RevisionResult;
  try {
    result = await reviseAll(deps);
  } catch (error) {
    // Let the next start try again rather than wait out the lease.
    try {
      await marker.update({ running: null });
    } catch (releaseError) {
      deps.log("ERROR", "found_loyalty_revision_release_failed", errorKind(releaseError));
    }
    throw error;
  }
  await marker.set({ revision, ranAt: now(), ...result });
  return result;
}

async function reviseAll(deps: RevisionDeps): Promise<RevisionResult> {
  const total: RevisionResult = { users: 0, fixed: 0, reread: 0, skipped: 0, failed: 0 };
  const profiles = await deps.db.collectionGroup("travelProfile").get();
  for (const doc of profiles.docs) {
    const user = doc.ref.parent.parent;
    if (doc.id !== "main" || !user || user.parent.id !== "users") continue;
    if (!TravelProfile.safeParse(doc.data()).data?.foundLoyalty?.length) continue;
    const uid = user.id;
    try {
      const done = await reviseUser(deps, uid);
      if (!done) continue;
      total.users += 1;
      total.fixed += done.fixed;
      total.reread += done.reread;
      total.skipped += done.skipped;
      total.failed += done.failed;
    } catch (error) {
      total.failed += 1;
      deps.log("ERROR", "found_loyalty_user_failed", { uid, ...errorKind(error) });
    }
  }
  return total;
}

const bookedSegment = ExtractedSegment.pick({ type: true, title: true });
const foundOf = (data: unknown): FoundLoyalty[] => TravelProfile.safeParse(data).data?.foundLoyalty ?? [];
const sameList = (a: readonly FoundLoyalty[], b: readonly FoundLoyalty[]) => JSON.stringify(a) === JSON.stringify(b);

// Changes the user's found list in a transaction (as an import does), so
// an import or the owner's Remove meanwhile is kept; nothing once the
// account is deleted. The number of entries changed or merged away.
async function change(deps: RevisionDeps, uid: string, revise: (found: FoundLoyalty[]) => FoundLoyalty[]): Promise<number | undefined> {
  const { db } = deps;
  const ref = db.doc(paths.travelProfile(uid));
  return db.runTransaction(async (t) => {
    if (await wasDeleted(db, t, uid)) return undefined;
    const snap = await t.get(ref);
    if (!snap.exists) return 0;
    const current = foundOf(snap.data());
    const next = revise(current);
    if (sameList(current, next)) return 0;
    t.update(ref, { foundLoyalty: next, updatedAt: deps.now() });
    const kept = new Set(next.map((f) => JSON.stringify(f)));
    return current.filter((f) => !kept.has(JSON.stringify(f))).length;
  });
}

// One user's numbers; undefined for a deleted account.
async function reviseUser(deps: RevisionDeps, uid: string): Promise<Omit<RevisionResult, "users"> | undefined> {
  const { db } = deps;
  if ((await db.doc(paths.deletedAccount(uid)).get()).exists) return undefined;
  const displayName: unknown = (await db.doc(paths.user(uid)).get()).data()?.displayName;
  const owner = typeof displayName === "string" && displayName.trim() ? displayName : undefined;
  const found = foundOf((await db.doc(paths.travelProfile(uid)).get()).data());

  // The bookings each email made, by its import record.
  const records = new Map<string, ParsedMessage>();
  const segments = new Map<string, BookedSegments>();
  for (const messageId of new Set(found.map((f) => f.messageId))) {
    const record = ParsedMessage.safeParse((await db.doc(paths.parsedMessage(uid, messageId)).get()).data()).data;
    if (!record) continue;
    records.set(messageId, record);
    const { tripId } = record;
    if (!tripId || !record.segmentIds.length) continue;
    const snaps = await db.getAll(...record.segmentIds.map((id) => db.doc(paths.segment(tripId, id))));
    segments.set(
      messageId,
      snaps.flatMap((s) => {
        // Only what filing a number reads, whatever else the booking holds.
        const segment = bookedSegment.safeParse(s.data()).data;
        return segment ? [segment] : [];
      }),
    );
  }

  const fixed = await change(deps, uid, (current) => revisedFoundLoyalty(current, owner, (id) => segments.get(id) ?? []));
  if (fixed === undefined) return undefined;
  const result = { fixed, reread: 0, skipped: 0, failed: 0 };

  // What only reading the email again could improve, once per email.
  const after = foundOf((await db.doc(paths.travelProfile(uid)).get()).data());
  const emails = new Set(after.filter(needsReread).map((f) => f.messageId));
  for (const messageId of emails) {
    const outcome = await reread(deps, uid, messageId, records.get(messageId), owner, after);
    result[outcome] += 1;
  }
  return result;
}

async function reread(
  deps: RevisionDeps,
  uid: string,
  messageId: string,
  record: ParsedMessage | undefined,
  owner: string | undefined,
  found: readonly FoundLoyalty[],
): Promise<"reread" | "skipped" | "failed"> {
  const skip = (reason: string) => {
    deps.log("INFO", "found_loyalty_reread_skipped", { uid, messageId, reason });
    return "skipped" as const;
  };
  const fail = (stage: string, error: unknown) => {
    deps.log("WARNING", "found_loyalty_reread_failed", { uid, messageId, stage, ...errorKind(error) });
    return "failed" as const;
  };
  // A forwarded email is in no mailbox the parser can read again.
  const source = record?.source ?? "gmail";
  if (source !== "gmail" && source !== "fastmail" && source !== "imap") return skip("not_mailbox");
  let mailbox;
  try {
    mailbox = await deps.mailbox(uid, messageId);
  } catch (error) {
    return fail("mailbox", error);
  }
  if (!mailbox) return skip("not_connected");
  let message: EmailMessage;
  try {
    message = await mailbox.source.fetch(mailbox.id);
  } catch (error) {
    if (mailbox.source.isNotFound(error)) return skip("gone");
    return fail("fetch", error);
  } finally {
    try {
      await mailbox.source.close?.();
    } catch (error) {
      // The message is read (or not) either way.
      deps.log("WARNING", "found_loyalty_reread_close_failed", { uid, ...errorKind(error) });
    }
  }
  let booking;
  try {
    booking = await deps.extract(message);
  } catch (error) {
    return fail("extract", error);
  }
  // Read when it was before: the entries keep their place in time.
  const at = found
    .filter((f) => f.messageId === messageId)
    .map((f) => f.at)
    .sort()
    .at(-1)!;
  const sent = originalSentAt(message, source);
  const fresh = foundLoyaltyFrom(booking.memberships ?? [], booking.segments, owner, { messageId, label: message.subject, at, ...(sent ? { sent } : {}) });
  try {
    await change(deps, uid, (current) => rereadFoundLoyalty(current, messageId, fresh, found));
  } catch (error) {
    return fail("save", error);
  }
  deps.log("INFO", "found_loyalty_reread", { uid, messageId, found: booking.memberships?.length ?? 0, kept: fresh.length });
  return "reread";
}
