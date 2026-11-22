import { ParsedMessage, Segment, SenderPatterns, Trip, paths } from "@travelmo/core";
import { FieldValue, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { AccountDeletedError, wasDeleted } from "./deleted";
import { changeClaimable, claimable, reclaimable, retryable, type TripStore } from "./importer";
import { Examples, addExample, emptyExamples } from "./similarity";

// How many times the user's trips were reset (tripsReset.ts), kept on the
// import lock every import reads.
export function generationOf(snap: DocumentSnapshot): number {
  const value: unknown = snap.get("generation");
  return typeof value === "number" ? value : 0;
}

export function firestoreStore(db: Firestore): TripStore {
  // Every write of an import runs in a transaction that reads the deletion
  // marker first, so once account deletion has written it no import can add
  // a trip, booking or record behind it (apps/parser/src/account.ts).
  async function deleted(t: Transaction, uid: string): Promise<boolean> {
    return wasDeleted(db, t, uid);
  }
  // Whether the user's trips were reset since `generation` was read; never
  // when no generation was given.
  async function resetSince(t: Transaction, uid: string, generation: number | undefined): Promise<boolean> {
    return generation !== undefined && generationOf(await t.get(db.doc(paths.importLock(uid)))) !== generation;
  }
  function claimWhen(
    uid: string,
    messageId: string,
    processedAt: string,
    allowed: (existing: ParsedMessage | undefined) => boolean,
    generation?: number,
  ): Promise<boolean> {
    const ref = db.doc(paths.parsedMessage(uid, messageId));
    return db.runTransaction(async (t) => {
      if (await deleted(t, uid)) return false;
      if (await resetSince(t, uid, generation)) return false;
      const snap = await t.get(ref);
      const existing = snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
      if (!allowed(existing)) return false;
      t.set(ref, { messageId, uid, outcome: "processing", segmentIds: [], processedAt } satisfies ParsedMessage);
      return true;
    });
  }
  return {
    claimMessage(uid, messageId, processedAt, generation) {
      return claimWhen(uid, messageId, processedAt, (existing) => claimable(existing, processedAt), generation);
    },
    reclaimMessage(uid, messageId, processedAt, generation) {
      return claimWhen(uid, messageId, processedAt, (existing) => reclaimable(existing, processedAt), generation);
    },
    claimChange(uid, messageId, processedAt, expected, generation) {
      const ref = db.doc(paths.parsedMessage(uid, messageId));
      return db.runTransaction(async (t) => {
        if (await deleted(t, uid)) return false;
        if (await resetSince(t, uid, generation)) return false;
        const snap = await t.get(ref);
        const existing = snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
        if (!changeClaimable(existing, expected, processedAt)) return false;
        t.set(ref, { ...existing!, outcome: "processing", processedAt } satisfies ParsedMessage);
        return true;
      });
    },
    replaceIfUnchanged(uid, expected, next, now, generation) {
      const ref = db.doc(paths.parsedMessage(uid, expected.messageId));
      return db.runTransaction(async (t) => {
        if (await deleted(t, uid)) return false;
        if (await resetSince(t, uid, generation)) return false;
        const snap = await t.get(ref);
        const existing = snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
        if (!changeClaimable(existing, expected, now)) return false;
        t.set(ref, next);
        return true;
      });
    },
    async listUserSegments(uid) {
      const trips = await db.collection(paths.trips()).where("ownerUid", "==", uid).get();
      const live = trips.docs.map((d) => Trip.parse(d.data())).filter((trip) => !trip.deleting);
      const lists = await Promise.all(live.map((trip) => db.collection(paths.segments(trip.id)).get()));
      return lists.flatMap((snap) => snap.docs.map((d) => Segment.parse(d.data())));
    },
    async readSegment(tripId, segmentId) {
      const snap = await db.doc(paths.segment(tripId, segmentId)).get();
      return snap.exists ? Segment.parse(snap.data()) : undefined;
    },
    async getParsed(uid, messageId) {
      const snap = await db.doc(paths.parsedMessage(uid, messageId)).get();
      return snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
    },
    retryMessage(uid, messageId, processedAt, generation) {
      return claimWhen(uid, messageId, processedAt, (existing) => retryable(existing, processedAt), generation);
    },
    async resetGeneration(uid) {
      return generationOf(await db.doc(paths.importLock(uid)).get());
    },
    setParsedIfCurrent(record, generation) {
      const lock = db.doc(paths.importLock(record.uid));
      return db.runTransaction(async (t) => {
        // As setParsed: nothing is written for a deleted account, whose
        // lock (and so its generation) went with it.
        if (await deleted(t, record.uid)) throw new AccountDeletedError(record.uid);
        if (generationOf(await t.get(lock)) !== generation) return false;
        t.set(db.doc(paths.parsedMessage(record.uid, record.messageId)), record);
        return true;
      });
    },
    async setParsed(record) {
      await db.runTransaction(async (t) => {
        if (await deleted(t, record.uid)) throw new AccountDeletedError(record.uid);
        t.set(db.doc(paths.parsedMessage(record.uid, record.messageId)), record);
      });
    },
    async withUserLock(uid, fn) {
      // Every import reads and writes this document, so two transactions
      // for one user conflict and the later one retries against fresh trips.
      const lock = db.doc(paths.importLock(uid));
      return db.runTransaction(async (t) => {
        if (await deleted(t, uid)) throw new AccountDeletedError(uid);
        const generation = generationOf(await t.get(lock));
        let next = generation;
        const result = await fn({
          generation,
          bumpGeneration() {
            next = generation + 1;
          },
          async hasGmail() {
            return (await t.get(db.doc(paths.gmailState(uid)))).exists;
          },
          clearBackfill() {
            t.update(db.doc(paths.gmailState(uid)), { backfill: FieldValue.delete() });
            t.update(db.doc(paths.user(uid)), { "gmail.backfill": FieldValue.delete() });
          },
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
          updateTrip(tripId, fields) {
            t.update(db.doc(paths.trip(tripId)), fields);
          },
          deleteTrip(tripId) {
            t.delete(db.doc(paths.trip(tripId)));
          },
          async listParsedIds(limit) {
            const snap = await t.get(db.collection(paths.parsedMessages(uid)).limit(limit));
            return snap.docs.map((d) => d.id);
          },
          deleteParsed(messageId) {
            t.delete(db.doc(paths.parsedMessage(uid, messageId)));
          },
          addSource(tripId, segmentId, source) {
            t.update(db.doc(paths.segment(tripId, segmentId)), { sources: FieldValue.arrayUnion(source) });
            // The trip's revision moves with any change to its bookings, so a
            // merge that read them before this retries rather than copying
            // a stale booking over this one.
            t.update(db.doc(paths.trip(tripId)), { updatedAt: source.at });
          },
        });
        // Merged, so the reset generation survives every other import.
        t.set(lock, { lastImportAt: new Date().toISOString(), ...(next !== generation ? { generation: next } : {}) }, { merge: true });
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
        if (await deleted(t, uid)) throw new AccountDeletedError(uid);
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
