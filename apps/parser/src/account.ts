import { paths } from "@travelmo/core";
import { FieldValue, type DocumentReference, type Firestore, type Query } from "firebase-admin/firestore";
import { loadCalendarState, loadMailboxes, pendingTokens, removeCalendarState, removeConnection } from "./connections";
import { errorFields, errorKind } from "./log";

// Deleting an account: everything the user owns goes, and the trips other
// people shared with them stop naming them. Every step is idempotent and
// works from what is still stored, so a run that was interrupted (a crash,
// a timeout, a failed write) is finished by calling it again. The sign-in
// goes last: while it exists the user can retry.

export type AccountDeps = {
  db: Firestore;
  // Stops Gmail's notifications for the mailbox this token reads.
  stopWatch: (refreshToken: string) => Promise<void>;
  // Withdraws a Google grant.
  revoke: (refreshToken: string) => Promise<void>;
  // Deletes the Firebase Auth user; a user already gone counts as done.
  deleteAuthUser: (uid: string) => Promise<void>;
  now: () => string;
  log: (severity: "INFO" | "WARNING" | "ERROR", event: string, fields: Record<string, unknown>) => void;
};

export type DeletedAccount = {
  revoked: number;
  revokeFailures: number;
  ownedTrips: number;
  sharedTrips: number;
  trustedProfiles: number;
};

// Well under Firestore's 500 writes per batch.
const pageSize = 200;

// Deletes every document a query matches, a page at a time; for top-level
// records with no subcollections.
async function deleteMatching(db: Firestore, query: Query): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await query.limit(pageSize).get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;
  }
}

// Takes `email` out of an array field on every document a query matches.
// Each update drops the document from the query, so the loop ends.
async function removeFromArray(db: Firestore, query: Query, field: string, email: string): Promise<number> {
  let changed = 0;
  for (;;) {
    const snap = await query.limit(pageSize).get();
    if (snap.empty) return changed;
    const batch = db.batch();
    for (const doc of snap.docs) batch.update(doc.ref, { [field]: FieldValue.arrayRemove(email) });
    await batch.commit();
    changed += snap.size;
  }
}

// Marks the trip as being deleted first, as the web app does, so no edit can
// add a booking to it while its bookings are removed; then its bookings (and
// any other subcollection), and the trip itself only once they are all gone.
// `recursiveDelete` on the trip would delete the trip even when a booking's
// delete failed, leaving bookings a retry could no longer find.
async function deleteTrip(db: Firestore, ref: DocumentReference, now: string): Promise<void> {
  await ref.update({ deleting: true, updatedAt: now });
  for (const collection of await ref.listCollections()) await db.recursiveDelete(collection);
  await ref.delete();
}

// Google withdraws a token's whole grant, so revoking one connection's can
// make revoking another's fail; each failure is logged and deletion goes on.
async function revokeAll(uid: string, tokens: readonly string[], deps: AccountDeps): Promise<{ revoked: number; failures: number }> {
  const unique = new Set(tokens);
  let failures = 0;
  for (const token of unique) {
    try {
      await deps.revoke(token);
    } catch (error) {
      failures += 1;
      deps.log("WARNING", "account_delete_revoke_failed", { uid, ...errorFields(error) });
    }
  }
  return { revoked: unique.size - failures, failures };
}

// `email` is the caller's verified email, the key sharing uses; without one,
// no one else's trip can name them.
export async function deleteAccount(uid: string, email: string | undefined, deps: AccountDeps): Promise<DeletedAccount> {
  const { db } = deps;
  let step = "marker";
  deps.log("INFO", "account_delete_started", { uid });
  try {
    // The marker first: from here on every import write refuses this user
    // (apps/parser/src/store.ts), so nothing is recreated behind the steps
    // below. An import that committed before it is found by them.
    await db.doc(paths.deletedAccount(uid)).set({ uid, at: deps.now() });

    step = "connections";
    // Connections next, while their tokens are still stored: each mailbox's
    // watch is stopped with its token, then every token is revoked,
    // including any consent still parked for completion.
    const mailboxes = await loadMailboxes(db, uid);
    const calendar = await loadCalendarState(db, uid);
    const pending = await pendingTokens(db, uid);
    for (const mailbox of mailboxes) {
      try {
        await deps.stopWatch(mailbox.refreshToken);
      } catch (error) {
        // Google may already have withdrawn the grant; the token goes below.
        deps.log("WARNING", "account_delete_stop_watch_failed", { uid, ...errorKind(error) });
      }
    }
    const tokens = [
      ...mailboxes.map((m) => m.refreshToken),
      ...(calendar ? [calendar.refreshToken] : []),
      ...pending,
    ];
    const revoked = await revokeAll(uid, tokens, deps);
    for (const mailbox of mailboxes) await removeConnection(db, uid, mailbox.emailAddress);
    if (calendar) await removeCalendarState(db, uid, calendar.calendars.map((c) => c.id));

    // Records outside the user's own documents that name them: a mailbox's
    // owner, the addresses they linked (free to link again), the forwarding
    // address and calendar link lookups (so both stop working at once),
    // consents in flight, places awaiting a geocode, and whether their own
    // reminders before a trip went to them. Links still waiting
    // for confirmation live under the user document, deleted below.
    step = "lookups";
    for (const collection of ["gmailAccounts", "linkedEmails", "forwardAddresses", "calendarExports", "pendingConnections", "oauthStates", "geocodeRetries", paths.checklistReminders()]) {
      await deleteMatching(db, db.collection(collection).where("uid", "==", uid));
    }
    // Check-in reminders that reached them keep the booking, not the uid.
    await removeFromArray(db, db.collection(paths.checkInReminders()).where("sent", "array-contains", uid), "sent", uid);

    // Their trips, each with its segments. Looked for again until none is
    // left, in case an import that was already running made one meanwhile.
    step = "owned_trips";
    let ownedTrips = 0;
    for (;;) {
      const snap = await db.collection(paths.trips()).where("ownerUid", "==", uid).limit(pageSize).get();
      if (snap.empty) break;
      for (const doc of snap.docs) await deleteTrip(db, doc.ref, deps.now());
      ownedTrips += snap.size;
    }

    // Trips and travel profiles others shared with them stay with their
    // owners; only the address goes. Bookings they added to such a trip
    // stay: they belong to that trip.
    step = "shared";
    let sharedTrips = 0;
    let trustedProfiles = 0;
    if (email) {
      sharedTrips = await removeFromArray(db, db.collection(paths.trips()).where("sharedWith", "array-contains", email), "sharedWith", email);
      trustedProfiles = await removeFromArray(
        db,
        db.collectionGroup("travelProfile").where("trustedEmails", "array-contains", email),
        "trustedEmails",
        email,
      );
      // Their access record (SPEC "Access"): the address, any request and
      // the admins' decision on it.
      await db.doc(paths.access(email)).delete();
    }

    // The user document and everything under it, whatever subcollections
    // it has: devices, push subscriptions, settings, feeds, the travel
    // profile, the import log, reminder logs, their reminders before trips
    // and what they ticked off, the calendar link and private.
    step = "user";
    await db.recursiveDelete(db.doc(paths.user(uid)));

    step = "auth";
    await deps.deleteAuthUser(uid);

    const result = { revoked: revoked.revoked, revokeFailures: revoked.failures, ownedTrips, sharedTrips, trustedProfiles };
    deps.log("INFO", "account_deleted", { uid, ...result });
    return result;
  } catch (error) {
    deps.log("ERROR", "account_delete_failed", { uid, step, ...errorFields(error) });
    throw error;
  }
}
