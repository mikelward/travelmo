import { ParsedMessage, SenderPatterns, Trip, paths } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { claimable, type TripStore } from "./importer";

export function firestoreStore(db: Firestore): TripStore {
  return {
    claimMessage(uid, messageId, processedAt) {
      const ref = db.doc(paths.parsedMessage(uid, messageId));
      return db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const existing = snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
        if (!claimable(existing, processedAt)) return false;
        t.set(ref, { messageId, uid, outcome: "processing", segmentIds: [], processedAt } satisfies ParsedMessage);
        return true;
      });
    },
    async setParsed(record) {
      await db.doc(paths.parsedMessage(record.uid, record.messageId)).set(record);
    },
    async forgetMessage(uid, messageId) {
      await db.doc(paths.parsedMessage(uid, messageId)).delete();
    },
    async withUserLock(uid, fn) {
      // Every import reads and writes this document, so two transactions
      // for one user conflict and the later one retries against fresh trips.
      const lock = db.doc(paths.importLock(uid));
      return db.runTransaction(async (t) => {
        await t.get(lock);
        const result = await fn({
          async listTrips() {
            const snap = await t.get(db.collection(paths.trips()).where("ownerUid", "==", uid));
            return snap.docs.map((d) => Trip.parse(d.data()));
          },
          createTrip(trip) {
            t.create(db.doc(paths.trip(trip.id)), trip);
          },
          extendTrip(tripId, bounds) {
            t.update(db.doc(paths.trip(tripId)), bounds);
          },
          putSegment(segment) {
            t.set(db.doc(paths.segment(segment.tripId, segment.id)), segment);
          },
        });
        t.set(lock, { lastImportAt: new Date().toISOString() });
        return result;
      });
    },
    async senderPatterns(uid) {
      const snap = await db.doc(paths.senderPatterns(uid)).get();
      return snap.exists ? SenderPatterns.parse(snap.data()) : { allow: [], deny: [] };
    },
    newId() {
      return db.collection(paths.trips()).doc().id;
    },
  };
}
