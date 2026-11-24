import { deletionUnfinishedText, paths } from "@travelmo/core";
import type { Firestore, Transaction } from "firebase-admin/firestore";

// Account deletion writes `deletedAccounts/{uid}` before anything else
// (apps/parser/src/account.ts). Every server write that could recreate a
// user's data reads it in its own transaction and refuses, so nothing lands
// behind the cleanup: imports (store.ts), new connections (connections.ts),
// a forwarding address (inbound.ts), a calendar link (calendarExport.ts),
// a TripIt profile (travelProfile.ts), calendar feeds (feeds.ts), upload
// leases (leases.ts), a sign-in's OAuth state (connections.ts), and
// background bookkeeping: calendar event aliases (connections.ts), reminder
// logs (reminders.ts), reminder markers (checklist.ts), geocode retries (geocodeSweep.ts) and the forwarding
// budget (inbound.ts). Disconnecting updates the user document only while it
// exists, so it cannot bring it back. Writes that only change a document that must already
// exist (a feed's result, a connection's watch) need no check: deletion
// removed the document, so they find nothing to change.
// Beyond these, server.ts's requireUser refuses every user endpoint for a
// deleted account outright.

// Thrown by a write for a user whose account is being or has been deleted.
export class AccountDeletedError extends Error {
  constructor(uid: string) {
    super(`account ${uid} was deleted`);
    this.name = "AccountDeletedError";
  }
}

export async function wasDeleted(db: Firestore, t: Transaction, uid: string): Promise<boolean> {
  return (await t.get(db.doc(paths.deletedAccount(uid)))).exists;
}

export async function refuseIfDeleted(db: Firestore, t: Transaction, uid: string): Promise<void> {
  if (await wasDeleted(db, t, uid)) throw new AccountDeletedError(uid);
}

export const deletedText = "This account was deleted";

// Deletion runs in one request, which Cloud Run ends within its timeout
// (the default 5 minutes); a sign-in still there well after that means it
// stopped part way. Within it, a deletion may still be running.
export const deletionStalledAfterMs = 15 * 60_000;

export type DeletedLog = (severity: "INFO" | "WARNING", event: string, fields: Record<string, unknown>) => void;

// What a deleted account's 410 says: that deleting it did not finish when
// its sign-in, which goes last (account.ts), outlived the deletion, so the
// apps offer to finish it; otherwise that it was deleted.
export async function deletedAccountText(
  db: Firestore,
  uid: string,
  now: string,
  signInExists: (uid: string) => Promise<boolean>,
  log: DeletedLog,
): Promise<string> {
  const at: unknown = (await db.doc(paths.deletedAccount(uid)).get()).get("at");
  const started = typeof at === "string" ? Date.parse(at) : NaN;
  if (!(Date.parse(now) - started > deletionStalledAfterMs)) return deletedText;
  let exists: boolean;
  try {
    exists = await signInExists(uid);
  } catch (error) {
    // Unknown: the account is refused as deleted either way.
    log("WARNING", "deleted_sign_in_lookup_failed", { uid, error: (error as Error).name });
    return deletedText;
  }
  if (!exists) return deletedText;
  log("WARNING", "account_deletion_unfinished", { uid, startedAt: at });
  return deletionUnfinishedText;
}
