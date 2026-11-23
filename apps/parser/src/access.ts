import {
  AccessConfig,
  AccessRecord,
  Device,
  PushSubscription,
  accessRequestMessage,
  accessStatus,
  grandfatheredAccess,
  linkedEmails,
  needsGrandfathering,
  normalizeEmail,
  paths,
  type AccountAccess,
  type ReminderNotification,
} from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { readLinks, trustedHolder } from "./emails";
import type { DeviceSender } from "./fcm";
import type { Mailer } from "./mail";
import type { PushSender } from "./push";

// Who may use the app, on the server (SPEC "Access"; packages/core/src/
// access.ts decides, as firestore.rules does). `gateUser` is the choke
// point every user endpoint passes through (server.ts's requireUser);
// `approvedUid` is what the background imports ask before reading mail for
// someone; `settleAccess` is the one endpoint an account that may not yet
// use the app can call.

type Severity = "INFO" | "WARNING" | "ERROR";
export type AccessLog = (severity: Severity, event: string, fields: Record<string, unknown>) => void;

// What a verified ID token says about its account.
export type TokenFacts = { uid: string; email?: string | undefined; email_verified?: boolean | undefined };

// The address the rules key on: the token's, lowercased, when Google
// verified it.
export const verifiedEmailOf = (token: TokenFacts): string | undefined =>
  token.email_verified === true && token.email ? token.email.toLowerCase() : undefined;

export type AccessState = { status: AccountAccess; record?: AccessRecord; config?: AccessConfig };

function parseRecord(data: unknown, log?: AccessLog): AccessRecord | undefined {
  if (data === undefined) return undefined;
  const parsed = AccessRecord.safeParse(data);
  if (!parsed.success) log?.("WARNING", "access_record_malformed", { issues: parsed.error.issues.length });
  return parsed.success ? parsed.data : undefined;
}

function parseConfig(data: unknown, log?: AccessLog): AccessConfig | undefined {
  if (data === undefined) return undefined;
  const parsed = AccessConfig.safeParse(data);
  if (!parsed.success) log?.("ERROR", "access_config_malformed", { issues: parsed.error.issues.length });
  return parsed.success ? parsed.data : undefined;
}

export async function loadAccessConfig(db: Firestore, log?: AccessLog): Promise<AccessConfig | undefined> {
  return parseConfig((await db.doc(paths.accessConfig()).get()).data(), log);
}

export async function loadAccess(db: Firestore, uid: string, email: string | undefined, log?: AccessLog): Promise<AccessState> {
  const [user, links, record, config] = await Promise.all([
    db.doc(paths.user(uid)).get(),
    db.doc(paths.emailLinks(uid)).get(),
    email ? db.doc(paths.access(email)).get() : Promise.resolve(undefined),
    loadAccessConfig(db, log),
  ]);
  const parsed = record ? parseRecord(record.data(), log) : undefined;
  // The addresses it linked count too (SPEC "Linked email addresses"). Their
  // records are read only when nothing else lets the account in, which in
  // practice is never: the list lives on the user document, whose existence
  // already does.
  // Only what the parser confirmed counts, never the profile's copy.
  const linked = linkedEmails(trustedHolder(user.data(), readLinks(links.data()))).filter((address) => address !== email);
  const inputs = { email, hasProfile: user.exists, record: parsed, config, linked };
  let status = accessStatus(inputs);
  if ((status === "none" || status === "requested") && linked.length) {
    const records = await Promise.all(linked.map(async (address) => parseRecord((await db.doc(paths.access(address)).get()).data(), log)));
    status = accessStatus({ ...inputs, linkedRecords: records.filter((r): r is AccessRecord => !!r) });
  }
  return { status, ...(parsed ? { record: parsed } : {}), ...(config ? { config } : {}) };
}

export type Gate = "ok" | "deleted" | "unapproved";

// For requireUser: a deleted account first (410), then one not approved (403).
export async function gateUser(db: Firestore, token: TokenFacts, log?: AccessLog): Promise<Gate> {
  if ((await db.doc(paths.deletedAccount(token.uid)).get()).exists) return "deleted";
  const { status } = await loadAccess(db, token.uid, verifiedEmailOf(token), log);
  return status === "approved" ? "ok" : "unapproved";
}

// For the routes that link an address (SPEC "Linked email addresses"),
// which take an account not approved yet ("waiting") so the invite-only
// page can link the address it was invited at; requestLink and confirmLink
// then hold it to addresses that let it in. An account whose sign-in an
// admin declined or revoked is refused as requireUser refuses it.
export async function gateLinking(db: Firestore, token: TokenFacts, log?: AccessLog): Promise<"ok" | "waiting" | "declined" | "deleted"> {
  if ((await db.doc(paths.deletedAccount(token.uid)).get()).exists) return "deleted";
  const { status } = await loadAccess(db, token.uid, verifiedEmailOf(token), log);
  return status === "approved" ? "ok" : status === "declined" ? "declined" : "waiting";
}

// For work done for a user with no token at hand (a Gmail notification, a
// mailbox reading's batch, a forwarded email): the address comes from Auth.
export async function approvedUid(
  db: Firestore,
  uid: string,
  verifiedEmail: (uid: string) => Promise<string | undefined>,
  log?: AccessLog,
): Promise<boolean> {
  const email = await verifiedEmail(uid);
  return (await loadAccess(db, uid, email, log)).status === "approved";
}

// Background work (feeds, calendars, reminders) keeps only the people who
// may use the app, asking once per person. Someone whose approval cannot be
// looked up is left out, as unapproved, and logged.
export async function onlyApproved<T extends { uid: string }>(
  items: readonly T[],
  isApproved: (uid: string) => Promise<boolean>,
  log?: AccessLog,
): Promise<T[]> {
  const verdicts = new Map<string, boolean>();
  const kept: T[] = [];
  for (const item of items) {
    let verdict = verdicts.get(item.uid);
    if (verdict === undefined) {
      try {
        verdict = await isApproved(item.uid);
        if (!verdict) log?.("INFO", "skipped_unapproved_user", { uid: item.uid });
      } catch (error) {
        // One person whose approval cannot be told (no sign-in any more,
        // Auth unreachable) is left out this run; the rest carry on.
        verdict = false;
        log?.("ERROR", "approval_check_failed", { uid: item.uid, error: (error as Error).message });
      }
      verdicts.set(item.uid, verdict);
    }
    if (verdict) kept.push(item);
  }
  return kept;
}

export type NotifyChannels = { mail?: Mailer; push?: PushSender; fcm?: DeviceSender };

export type SettleDeps = {
  db: Firestore;
  now: () => string;
  origin: string;
  log: AccessLog;
  channels: NotifyChannels;
  verifiedEmail: (uid: string) => Promise<string | undefined>;
  // The account signed in with an admin's address, if any.
  uidForEmail: (email: string) => Promise<string | undefined>;
};

// Why an account that predates approvals, or that someone shared with
// before invites existed, is let in without asking.
type Evidence = { kind: "owner" } | { kind: "shared"; by: string };

async function evidenceFor(deps: SettleDeps, uid: string, email: string): Promise<Evidence | undefined> {
  const { db } = deps;
  const owned = await db.collection(paths.trips()).where("ownerUid", "==", uid).limit(1).get();
  // New accounts cannot make trips, so one that owns a trip made it before
  // approvals (an Android-only account never wrote a user document).
  if (!owned.empty) return { kind: "owner" };
  const [trips, profiles] = await Promise.all([
    db.collection(paths.trips()).where("sharedWith", "array-contains", email).limit(5).get(),
    db.collectionGroup("travelProfile").where("trustedEmails", "array-contains", email).limit(5).get(),
  ]);
  const sharers = new Set<string>();
  for (const d of trips.docs) {
    const owner = d.get("ownerUid");
    if (typeof owner === "string") sharers.add(owner);
  }
  for (const d of profiles.docs) {
    const owner = d.get("ownerUid");
    if (typeof owner === "string") sharers.add(owner);
  }
  // Shared by someone who may use the app themselves, as an invite is.
  for (const by of sharers) {
    if (by !== uid && (await approvedUid(db, by, deps.verifiedEmail, deps.log))) return { kind: "shared", by };
  }
  return undefined;
}

// Settles the caller's access and says where it stands: lets in an account
// from before approvals, or one someone shared with (an old app's share
// writes no invite), and tells the admins of a request they have not heard
// of, once per address.
export async function settleAccess(deps: SettleDeps, token: TokenFacts): Promise<AccountAccess> {
  const { db, log } = deps;
  const email = verifiedEmailOf(token);
  const state = await loadAccess(db, token.uid, email, log);
  if (state.status === "approved" || state.status === "declined" || !email) return state.status;

  const evidence = await evidenceFor(deps, token.uid, email);
  if (evidence) {
    const ref = db.doc(paths.access(email));
    const now = deps.now();
    const approved = await db.runTransaction(async (t) => {
      const current = parseRecord((await t.get(ref)).data(), log);
      if (current?.status === "declined") return false;
      t.set(
        ref,
        evidence.kind === "owner"
          ? { email, status: "approved", uid: token.uid, approvedBy: token.uid, approvedAt: now }
          : { email, invitedBy: evidence.by, invitedAt: now },
        { merge: true },
      );
      return true;
    });
    log("INFO", approved ? "access_approved_from_before" : "access_declined_meanwhile", { uid: token.uid, reason: evidence.kind });
    return approved ? "approved" : "declined";
  }

  if (state.status === "requested" && !state.record?.notifiedAt) await notifyOnce(deps, token.uid, email);
  return state.status;
}

// Claims the request's notification before sending, so two calls tell the
// admins once; gives the claim back when nothing reached anyone (a failure,
// or no admin or channel to reach), so a later call tries again.
async function notifyOnce(deps: SettleDeps, uid: string, email: string): Promise<void> {
  const { db, log } = deps;
  const ref = db.doc(paths.access(email));
  const now = deps.now();
  const claimed = await db.runTransaction(async (t) => {
    const current = parseRecord((await t.get(ref)).data(), log);
    if (current?.status !== "requested" || current.notifiedAt) return false;
    t.update(ref, { notifiedAt: now });
    return true;
  });
  if (!claimed) return;
  let result: NotifyResult;
  try {
    result = await notifyAdmins(deps, email);
  } catch (error) {
    result = { admins: 0, delivered: 0, failed: 1 };
    log("ERROR", "access_notify_failed", { uid, error: (error as Error).message });
  }
  log("INFO", "access_request_notified", { uid, ...result });
  // Nothing reached anyone (a channel failed, or there is no admin or no
  // channel yet): the request is announced by a later call instead.
  if (result.delivered === 0) {
    await ref.update({ notifiedAt: FieldValue.delete() });
  }
}

export type NotifyResult = { admins: number; delivered: number; failed: number };

// One plain email to each admin and a notification to each of their
// browsers and phones, as reminders go. Each failure is logged and the rest
// carry on.
export async function notifyAdmins(deps: SettleDeps, requester: string): Promise<NotifyResult> {
  const { db, log, channels } = deps;
  const config = await loadAccessConfig(db, log);
  const admins = config?.admins ?? [];
  const result: NotifyResult = { admins: admins.length, delivered: 0, failed: 0 };
  if (!admins.length) {
    log("WARNING", "access_request_no_admins", {});
    return result;
  }
  const message = accessRequestMessage(requester, deps.origin);
  const notification: ReminderNotification = {
    title: "Access request",
    body: `${requester} asked to use Travelmo.`,
    url: message.url,
    tag: `access-${requester}`,
  };
  for (const [index, admin] of admins.entries()) {
    if (channels.mail) {
      try {
        await channels.mail({ to: admin, subject: message.subject, text: message.text });
        result.delivered += 1;
      } catch (error) {
        result.failed += 1;
        log("ERROR", "access_notify_mail_failed", { admin: index, error: (error as Error).message });
      }
    }
    if (!channels.push && !channels.fcm) continue;
    let adminUid: string | undefined;
    try {
      adminUid = await deps.uidForEmail(admin);
    } catch (error) {
      result.failed += 1;
      log("ERROR", "access_notify_lookup_failed", { admin: index, error: (error as Error).message });
      continue;
    }
    if (!adminUid) continue;
    if (channels.push) {
      for (const d of (await db.collection(paths.pushSubscriptions(adminUid)).get()).docs) {
        const parsed = PushSubscription.safeParse(d.data());
        if (!parsed.success) continue;
        try {
          if ((await channels.push(parsed.data, notification)) === "gone") {
            await d.ref.delete();
            log("INFO", "push_subscription_gone", { uid: adminUid, id: d.id });
          } else result.delivered += 1;
        } catch (error) {
          result.failed += 1;
          log("ERROR", "access_notify_push_failed", { uid: adminUid, id: d.id, error: (error as Error).message });
        }
      }
    }
    if (channels.fcm) {
      for (const d of (await db.collection(paths.devices(adminUid)).get()).docs) {
        const parsed = Device.safeParse(d.data());
        if (!parsed.success) continue;
        try {
          if ((await channels.fcm(parsed.data, notification)) === "gone") {
            await d.ref.delete();
            log("INFO", "push_device_gone", { uid: adminUid, id: d.id });
          } else result.delivered += 1;
        } catch (error) {
          result.failed += 1;
          log("ERROR", "access_notify_device_failed", { uid: adminUid, id: d.id, error: (error as Error).message });
        }
      }
    }
  }
  return result;
}

export type GrandfatherDeps = {
  db: Firestore;
  now: () => string;
  log: AccessLog;
  verifiedEmail: (uid: string) => Promise<string | undefined>;
};

export type GrandfatherResult = { owners: number; sharees: number; recorded: number; failed: number };

const isAuthUserGone = (error: unknown) => (error as { code?: unknown }).code === "auth/user-not-found";

// Records `access/{email}` as approved (`grandfatheredAccess`) unless the
// address is already let in or was declined; in a transaction, so a
// decline written meanwhile stands. Says whether the address is approved.
async function grandfather(deps: GrandfatherDeps, config: AccessConfig | undefined, email: string, uid?: string): Promise<{ approved: boolean; recorded: boolean }> {
  const { db, log } = deps;
  const ref = db.doc(paths.access(email));
  return db.runTransaction(async (t) => {
    const record = parseRecord((await t.get(ref)).data(), log);
    const status = accessStatus({ email, hasProfile: false, record, config });
    if (!needsGrandfathering(status)) return { approved: status === "approved", recorded: false };
    t.set(ref, grandfatheredAccess(email, deps.now(), uid), { merge: true });
    return { approved: true, recorded: true };
  });
}

// Lets in, without anyone asking, every account that used Travelmo before
// approvals and that nothing else lets in (SPEC "Access"): each owner of a
// trip or a travel profile (an Android-only account never wrote a user
// document), and each address an approved owner shared one with. Safe to
// run again: an account already let in, or declined, is left alone, so a
// revocation stands. A failure for one account is logged and counted, and
// the rest carry on.
export async function grandfatherAccounts(deps: GrandfatherDeps): Promise<GrandfatherResult> {
  const { db, log } = deps;
  const config = await loadAccessConfig(db, log);
  const [trips, profiles] = await Promise.all([
    db.collection(paths.trips()).select("ownerUid", "sharedWith").get(),
    db.collectionGroup("travelProfile").select("ownerUid", "trustedEmails").get(),
  ]);
  // Each owner, with the addresses they shared something with.
  const shares = new Map<string, Set<string>>();
  const add = (owner: unknown, emails: unknown) => {
    if (typeof owner !== "string" || !owner) return;
    const set = shares.get(owner) ?? new Set<string>();
    shares.set(owner, set);
    if (!Array.isArray(emails)) return;
    for (const value of emails) {
      const email = typeof value === "string" ? normalizeEmail(value) : undefined;
      if (email) set.add(email);
    }
  };
  for (const d of trips.docs) add(d.get("ownerUid"), d.get("sharedWith"));
  for (const d of profiles.docs) add(d.get("ownerUid") ?? d.ref.parent.parent?.id, d.get("trustedEmails"));

  const result: GrandfatherResult = { owners: shares.size, sharees: 0, recorded: 0, failed: 0 };
  const sharees = new Set<string>();
  for (const [uid, emails] of shares) {
    try {
      // An account being deleted is not let back in.
      if ((await db.doc(paths.deletedAccount(uid)).get()).exists) continue;
      const email = await deps.verifiedEmail(uid);
      const state = await loadAccess(db, uid, email, log);
      let approved = state.status === "approved";
      if (needsGrandfathering(state.status)) {
        if (!email) {
          // The rules key records on a verified address; Google sign-ins
          // always have one.
          log("WARNING", "access_grandfather_unverified_owner", { uid });
          continue;
        }
        const outcome = await grandfather(deps, config, email, uid);
        approved = outcome.approved;
        if (outcome.recorded) {
          result.recorded += 1;
          log("INFO", "access_grandfathered_owner", { uid });
        }
      }
      // Only someone who may use the app invites by sharing.
      if (approved) for (const email of emails) sharees.add(email);
    } catch (error) {
      if (isAuthUserGone(error)) {
        log("INFO", "access_grandfather_owner_gone", { uid });
        continue;
      }
      result.failed += 1;
      log("ERROR", "access_grandfather_owner_failed", { uid, error: (error as Error).message });
    }
  }
  result.sharees = sharees.size;
  for (const email of sharees) {
    try {
      if ((await grandfather(deps, config, email)).recorded) result.recorded += 1;
    } catch (error) {
      // No address in the log: the count says how many.
      result.failed += 1;
      log("ERROR", "access_grandfather_sharee_failed", { error: (error as Error).message });
    }
  }
  log(result.failed ? "ERROR" : "INFO", "access_grandfathered", result);
  return result;
}

// Run as the parser starts, before it listens (server.ts). The first run
// must finish, every account recorded, before the revision serves: CI
// deploys the parser before the rules, so the rules never enforce
// approvals before the accounts from before them are let in, and a failed
// first run fails the deploy, which then deploys no rules. Once it has
// succeeded (`config/accessGrandfathered`), each start runs it again in the
// background to catch anyone a straggling old client added meanwhile; a
// failure then is logged and the parser serves on.
export async function grandfatherOnStart(
  deps: GrandfatherDeps,
  run: (deps: GrandfatherDeps) => Promise<GrandfatherResult> = grandfatherAccounts,
): Promise<{ run: "first" } | { run: "again"; settled: Promise<void> }> {
  const { db, log } = deps;
  const marker = db.doc(paths.accessGrandfathered());
  const once = async () => {
    const result = await run(deps);
    if (result.failed > 0) throw new Error(`${result.failed} accounts could not be recorded`);
    await marker.set({ ranAt: deps.now(), ...result });
  };
  if (!(await marker.get()).exists) {
    log("INFO", "access_grandfather_first_run", {});
    await once();
    return { run: "first" };
  }
  const settled = once().catch((error: unknown) => log("ERROR", "access_grandfather_failed", { error: (error as Error).message }));
  return { run: "again", settled };
}
