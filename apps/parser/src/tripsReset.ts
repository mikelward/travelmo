import { paths } from "@travelmo/core";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import type { TripStore } from "./importer";
import { errorFields } from "./log";
import { dropStaleRefresh } from "./refreshStore";
import { firestoreStore } from "./store";

// Deleting all of a user's trips so they can import again from scratch:
// every trip they own, with its bookings (ratings and favorites are on the
// bookings, so they go too), every import record, so the same emails,
// files and events are read again, and every cancellation still waiting for
// its booking. Trips others share with them, their
// travel profile, home corrections, connections and feeds all stay.

// Most writes one transaction makes: Firestore allows 500.
const writeBudget = 400;

export type TripsDeleted = { trips: number };

// Removes the trips and records in passes, each in the import's per-user
// transaction so no import interleaves with it, and each reading before it
// writes, as Firestore transactions require. A trip with more bookings than
// one pass can delete loses them over several and goes in the last. It
// keeps going until nothing is left, so a trip an import made meanwhile
// goes as well.
export async function deleteOwnTrips(uid: string, store: TripStore, budget = writeBudget): Promise<TripsDeleted> {
  let trips = 0;
  for (let pass = 0; pass < 10_000; pass++) {
    const done = await store.withUserLock(uid, async (tx) => {
      // Every pass moves the generation on, the last included, so an import
      // that began before or during the reset files and records nothing.
      tx.bumpGeneration();
      // The reading positions go in the same transaction, every pass: a
      // mailbox reading never sees the new generation with the old place.
      const mailboxes = await tx.connectedMailboxes();
      const owned = (await tx.listTrips()).filter((trip) => trip.ownerUid === uid);
      // Reads first.
      const plan: { tripId: string; segmentIds: string[]; whole: boolean }[] = [];
      // Two writes a mailbox stay free for the reading positions.
      const kept = 2 * mailboxes;
      let room = budget - kept;
      for (const trip of owned) {
        if (room <= 0) break;
        const segments = await tx.listSegments(trip.id);
        const take = segments.slice(0, room);
        const whole = take.length === segments.length && take.length + 1 <= room;
        plan.push({ tripId: trip.id, segmentIds: take.map((s) => s.id), whole });
        room -= take.length + (whole ? 1 : 0);
      }
      const records = room > 0 ? await tx.listParsedIds(room) : [];
      room -= records.length;
      // Cancellations still waiting for their bookings go too, so the next
      // import starts from nothing.
      const pending = room > 0 ? (await tx.listPendingCancellations(uid)).slice(0, room) : [];
      room -= pending.length;
      // Then writes.
      let deleted = 0;
      for (const { tripId, segmentIds, whole } of plan) {
        for (const id of segmentIds) tx.deleteSegment(tripId, id);
        if (whole) {
          tx.deleteTrip(tripId);
          deleted += 1;
        }
      }
      for (const id of records) tx.deleteParsed(id);
      for (const p of pending) tx.deletePendingCancellation(uid, p.messageId);
      if (mailboxes) tx.clearBackfill();
      return { deleted, writes: budget - kept - room };
    });
    trips += done.deleted;
    if (done.writes === 0) return { trips };
  }
  throw new Error("deleting all trips did not finish in 10000 passes");
}

// Places queued for another look on bookings the reset deleted: those filed
// under an older generation than the reset's last, or before entries
// carried one. An import that began after the reset queues under the new
// generation, and its entries stay. Each entry's generation is read again
// in the transaction that deletes it, so one that import rewrote under the
// same ID after the query stays too. `afterQuery` lets a test land that
// write in between.
export async function deleteOldRetries(
  db: Firestore,
  uid: string,
  generation: number,
  afterQuery: () => Promise<void> = async () => {},
): Promise<number> {
  const isOld = (doc: DocumentSnapshot) => {
    const filed: unknown = doc.get("generation");
    return doc.exists && (typeof filed !== "number" || filed < generation);
  };
  const snap = await db.collection(paths.geocodeRetries()).where("uid", "==", uid).get();
  const refs = snap.docs.filter(isOld).map((d) => d.ref);
  await afterQuery();
  let deleted = 0;
  for (let i = 0; i < refs.length; i += 400) {
    deleted += await db.runTransaction(async (t) => {
      const old = (await t.getAll(...refs.slice(i, i + 400))).filter(isOld);
      for (const doc of old) t.delete(doc.ref);
      return old.length;
    });
  }
  return deleted;
}

// The whole reset for one user: their trips and import records, then the
// places still waiting for a geocode on bookings now gone, and how far the
// last reading of their mailbox got, so "Import past bookings" starts over,
// and how far the last "Refresh from email" got.
export async function resetTrips(
  db: Firestore,
  uid: string,
  log: (severity: "INFO" | "ERROR", event: string, fields: Record<string, unknown>) => void,
): Promise<TripsDeleted> {
  let step = "trips";
  log("INFO", "trips_delete_started", { uid });
  try {
    const store = firestoreStore(db);
    const result = await deleteOwnTrips(uid, store);
    step = "geocode_retries";
    await deleteOldRetries(db, uid, await store.resetGeneration(uid));
    // A refresh under way already stopped with the generation (refreshStore.ts);
    // this only takes its progress off Settings.
    step = "refresh";
    await dropStaleRefresh(db, uid);
    log("INFO", "trips_deleted", { uid, ...result });
    return result;
  } catch (error) {
    log("ERROR", "trips_delete_failed", { uid, step, ...errorFields(error) });
    throw error;
  }
}
