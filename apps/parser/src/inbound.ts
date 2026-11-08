import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import PostalMime from "postal-mime";
import {
  forwardAddress,
  forwardTokenAlphabet,
  forwardTokenLength,
  forwardTokenOf,
  paths,
  unwrapForwarded,
  type ForwardAddress,
} from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { hashToken } from "./calendarExport";
import type { EmailMessage } from "./gmail";
import { importMessage, type ImportDeps, type ImportOutcome } from "./importer";
import { htmlToText, maxEmailChars, tidy } from "./text";

// Forward-to-import: the Email Worker (apps/inbound) relays each message
// sent to a user's forwarding address here as it arrived, and the import
// runs as for an email read from Gmail, the forwarder's own request standing
// in for the pre-filter.

// Big enough for a confirmation with its HTML part; attachments are not
// read, and a PDF-laden message is refused rather than parsed.
export const inboundMaxBytes = 2 * 1024 * 1024;

// Forwarded emails the model reads per user per day: the forwarder's
// requests are deliberate, so the cap is for a leaked address, not a quota.
export const defaultForwardDailyLimit = 50;

export function newForwardToken(): string {
  let token = "";
  for (let i = 0; i < forwardTokenLength; i++) token += forwardTokenAlphabet[randomInt(forwardTokenAlphabet.length)];
  return token;
}

// Whether the relay's bearer secret is ours, in constant time whatever its
// length.
export function secretMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type ForwardStore = {
  uidForToken(tokenHash: string): Promise<string | undefined>;
  // Records the user's new address, retiring the old one.
  issue(uid: string, record: ForwardAddress, tokenHash: string, now: string): Promise<void>;
  stop(uid: string): Promise<void>;
  // Counts one more forwarded email for the user on `day`; false once the
  // day's limit is reached.
  reserve(uid: string, day: string, limit: number): Promise<boolean>;
};

export type InboundMail = {
  messageId?: string;
  from: string;
  subject: string;
  date: string;
  listUnsubscribe: boolean;
  text: string;
};

function nameAndAddress(sender: { name?: string | undefined; address?: string | undefined } | undefined): string {
  if (!sender?.address) return sender?.name ?? "";
  return sender.name ? `${sender.name} <${sender.address}>` : sender.address;
}

// The parts of a raw message the import reads, in the shape Gmail's are
// reduced to (text.ts): plain text when present, else the HTML flattened.
export async function parseInbound(raw: Uint8Array): Promise<InboundMail> {
  const mail = await PostalMime.parse(raw);
  const text = mail.text?.trim() ? mail.text : mail.html ? htmlToText(mail.html) : "";
  return {
    ...(mail.messageId ? { messageId: mail.messageId } : {}),
    from: nameAndAddress(mail.from),
    subject: mail.subject ?? "",
    date: mail.date ?? "",
    listUnsubscribe: mail.headers.some((h) => h.key === "list-unsubscribe"),
    text: tidy(text).slice(0, maxEmailChars),
  };
}

// The import record's id: the message's own id when it has one, else the
// bytes, so a relay retry of one message is one import.
export function inboundMessageId(mail: InboundMail, raw: Uint8Array): string {
  const hash = createHash("sha256");
  if (mail.messageId) hash.update(mail.messageId);
  else hash.update(raw);
  return `fwd-${hash.digest("hex").slice(0, 40)}`;
}

export type ReceiveIo = {
  store: ForwardStore;
  domain: string;
  limit: number;
  deps: ImportDeps;
};

export type Received =
  | { status: "accepted"; uid: string; messageId: string; outcome: Exclude<ImportOutcome, "failed"> }
  // The model could not read it this time (unavailable, rate-limited, an
  // answer that failed validation): not delivered, so the sending server
  // tries again later, and the retry is claimed afresh.
  | { status: "failed"; uid: string; messageId: string }
  // Another delivery of it is being imported this minute (a live claim):
  // not acknowledged either, and the retry finds the outcome.
  | { status: "pending"; uid: string; messageId: string }
  | { status: "unknown_address" }
  | { status: "limit"; uid: string };

// One relayed message: whose address it was sent to, whether they have room
// for it today, then the import. A message seen before is not counted
// again, so a retry costs nothing; a retry of one whose import failed is
// read again, as a re-uploaded file is.
export async function receiveForwarded(input: { to: string; raw: Uint8Array }, io: ReceiveIo): Promise<Received> {
  const token = forwardTokenOf(input.to, io.domain);
  if (!token) return { status: "unknown_address" };
  const uid = await io.store.uidForToken(hashToken(token));
  if (!uid) return { status: "unknown_address" };
  const mail = await parseInbound(input.raw);
  const messageId = inboundMessageId(mail, input.raw);
  const now = io.deps.now();
  const existing = await io.deps.store.getParsed(uid, messageId);
  if (!existing && !(await io.store.reserve(uid, now.slice(0, 10), io.limit))) return { status: "limit", uid };
  const original = unwrapForwarded(mail);
  const message: EmailMessage = {
    id: messageId,
    threadId: messageId,
    from: original.from,
    subject: original.subject,
    date: mail.date,
    listUnsubscribe: mail.listUnsubscribe,
    text: mail.text,
  };
  const outcome = await importMessage(uid, message, io.deps, { source: "forward", force: true, retryFailed: true });
  if (outcome === "failed") return { status: "failed", uid, messageId };
  // Skipped over a record still being processed (claimed within the lease,
  // by a worker that may yet finish or may have died): the retry decides.
  // Skipped over a finished record is the duplicate delivery it looks like.
  // The record is read again here: two deliveries can both find none and
  // race for the claim, and the loser's earlier read says nothing about
  // the winner's claim that refused it.
  if (outcome === "skipped" && (await io.deps.store.getParsed(uid, messageId))?.outcome === "processing") {
    return { status: "pending", uid, messageId };
  }
  return { status: "accepted", uid, messageId, outcome };
}

export const forwardRecord = (token: string, domain: string, now: string): ForwardAddress => ({
  address: forwardAddress(token, domain),
  createdAt: now,
});

// The token of the address a user document records, for retiring its hash.
const recordedToken = (data: FirebaseFirestore.DocumentData | undefined, domain: string): string | undefined => {
  const address = (data?.forward as { address?: unknown } | undefined)?.address;
  return typeof address === "string" ? forwardTokenOf(address, domain) : undefined;
};

export function firestoreForwardStore(db: Firestore, domain: string): ForwardStore {
  return {
    uidForToken: async (tokenHash) => {
      const uid = (await db.doc(paths.forwardAddress(tokenHash)).get()).get("uid");
      return typeof uid === "string" ? uid : undefined;
    },
    issue: async (uid, record, tokenHash, now) => {
      await db.runTransaction(async (tx) => {
        const ref = db.doc(paths.user(uid));
        const old = recordedToken((await tx.get(ref)).data(), domain);
        if (old) tx.delete(db.doc(paths.forwardAddress(hashToken(old))));
        tx.set(db.doc(paths.forwardAddress(tokenHash)), { uid, createdAt: now });
        tx.set(ref, { forward: record }, { merge: true });
      });
    },
    stop: async (uid) => {
      await db.runTransaction(async (tx) => {
        const ref = db.doc(paths.user(uid));
        const snap = await tx.get(ref);
        const old = recordedToken(snap.data(), domain);
        if (old) tx.delete(db.doc(paths.forwardAddress(hashToken(old))));
        if (snap.exists) tx.update(ref, { forward: FieldValue.delete() });
      });
    },
    reserve: async (uid, day, limit) => {
      const ref = db.doc(paths.forwardBudget(uid));
      return db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data() as { day?: string; count?: number } | undefined;
        const count = data?.day === day ? (data.count ?? 0) : 0;
        if (count >= limit) return false;
        tx.set(ref, { day, count: count + 1 });
        return true;
      });
    },
  };
}
