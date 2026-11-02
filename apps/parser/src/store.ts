import { ParsedMessage, Segment, SenderPatterns, Trip, paths } from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { changeClaimable, claimable, reclaimable, retryable, type TripStore } from "./importer";
import { Examples, addExample, emptyExamples } from "./similarity";

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
    claimChange(uid, messageId, processedAt, expected) {
      const ref = db.doc(paths.parsedMessage(uid, messageId));
      return db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const existing = snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
        if (!changeClaimable(existing, expected, processedAt)) return false;
        t.set(ref, { ...existing!, outcome: "processing", processedAt } satisfies ParsedMessage);
        return true;
      });
    },
    replaceIfUnchanged(uid, expected, next, now) {
      const ref = db.doc(paths.parsedMessage(uid, expected.messageId));
      return db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const existing = snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
        if (!changeClaimable(existing, expected, now)) return false;
        t.set(ref, next);
        return true;
      });
    },
    async getParsed(uid, messageId) {
      const snap = await db.doc(paths.parsedMessage(uid, messageId)).get();
      return snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
    },
    retryMessage(uid, messageId, processedAt) {
      return claimWhen(uid, messageId, processedAt, (existing) => retryable(existing, processedAt));
    },
    async setParsed(record) {
      await db.doc(paths.parsedMessage(record.uid, record.messageId)).set(record);
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
          async getSegment(tripId, segmentId) {
            const snap = await t.get(db.doc(paths.segment(tripId, segmentId)));
            return snap.exists ? Segment.parse(snap.data()) : undefined;
          },
          putParsed(record) {
            t.set(db.doc(paths.parsedMessage(record.uid, record.messageId)), record);
          },
          deleteSegment(tripId, segmentId) {
            t.delete(db.doc(paths.segment(tripId, segmentId)));
          },
          touchTrip(tripId, updatedAt) {
            t.update(db.doc(paths.trip(tripId)), { updatedAt });
          },
          addSource(tripId, segmentId, source) {
            t.update(db.doc(paths.segment(tripId, segmentId)), { sources: FieldValue.arrayUnion(source) });
            // The trip's revision moves with any change to its bookings, so a
            // merge that read them before this retries rather than copying
            // a stale booking over this one.
            t.update(db.doc(paths.trip(tripId)), { updatedAt: source.at });
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
