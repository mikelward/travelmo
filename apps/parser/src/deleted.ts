import { paths } from "@travelmo/core";
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
