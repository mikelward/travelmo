import { ParsedMessage, Segment, SenderPatterns, Trip, paths } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { claimable, reclaimable, type TripStore } from "./importer";
import { Examples, addExample, emptyExamples } from "./similarity";

// getAll takes at most this many references per call.
const getAllBatch = 300;

export function firestoreStore(db: Firestore): TripStore {
  function claimWhen(
    uid: string,
    messageId: string,
    processedAt: string,
    allowed: (existing: ParsedMessage | undefined) => boolean,
  ): Promise<boolean> {
    const ref = db.doc(paths.parsedMessage(uid, messageId));
    return db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const existing = snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
      if (!allowed(existing)) return false;
      t.set(ref, { messageId, uid, outcome: "processing", segmentIds: [], processedAt } satisfies ParsedMessage);
      return true;
    });
  }
  return {
    claimMessage(uid, messageId, processedAt) {
      return claimWhen(uid, messageId, processedAt, (existing) => claimable(existing, processedAt));
    },
    reclaimMessage(uid, messageId, processedAt) {
      return claimWhen(uid, messageId, processedAt, (existing) => reclaimable(existing, processedAt));
    },
    async setParsed(record) {
      await db.doc(paths.parsedMessage(record.uid, record.messageId)).set(record);
    },
    async parsedRecords(uid, ids) {
      const found = new Map<string, ParsedMessage>();
      for (let i = 0; i < ids.length; i += getAllBatch) {
        const refs = ids.slice(i, i + getAllBatch).map((id) => db.doc(paths.parsedMessage(uid, id)));
        if (refs.length === 0) continue;
        for (const snap of await db.getAll(...refs)) {
          if (snap.exists) {
            const record = ParsedMessage.parse(snap.data());
            found.set(record.messageId, record);
          }
        }
      }
      return found;
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
          async listSegments(tripId) {
            const snap = await t.get(db.collection(paths.segments(tripId)));
            return snap.docs.map((d) => Segment.parse(d.data()));
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
    async userTrips(uid) {
      const snap = await db.collection(paths.trips()).where("ownerUid", "==", uid).get();
      return snap.docs.map((d) => Trip.parse(d.data()));
    },
    async tripSegments(tripId) {
      const snap = await db.collection(paths.segments(tripId)).get();
      return snap.docs.map((d) => Segment.parse(d.data()));
    },
    async senderPatterns(uid) {
      const snap = await db.doc(paths.senderPatterns(uid)).get();
      return snap.exists ? SenderPatterns.parse(snap.data()) : { allow: [], deny: [] };
    },
    async examples(uid) {
      const snap = await db.doc(paths.examples(uid)).get();
      return snap.exists ? Examples.parse(snap.data()) : emptyExamples();
    },
    async saveExample(uid, label, example) {
      // Read-modify-write in a transaction: two imports finishing together
      // both keep their example.
      const ref = db.doc(paths.examples(uid));
      await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const current = snap.exists ? Examples.parse(snap.data()) : emptyExamples();
        t.set(ref, addExample(current, label, example));
      });
    },
    newId() {
      return db.collection(paths.trips()).doc().id;
    },
  };
}
