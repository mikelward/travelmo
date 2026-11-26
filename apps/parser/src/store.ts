import { ParsedMessage, PendingCancellation, PersonDoc, Segment, SenderPatterns, TravelProfile, Trip, paths, withFoundLoyalties } from "@travelmo/core";
import { FieldPath, FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { AccountDeletedError, wasDeleted } from "./deleted";
import { log } from "./log";
import { changeClaimable, claimRecord, claimable, reclaimable, retryable, type TripStore } from "./importer";
import { Examples, addExample, emptyExamples } from "./similarity";

// The import records "Refresh from email" picks from (refreshRecords).
const refreshOutcomes = ["imported", "not_booking", "failed", "processing"] satisfies ParsedMessage["outcome"][];
// And those Refresh everything also reads: emails the pre-filter passed over.
const everythingOutcomes = [...refreshOutcomes, "filtered"] satisfies ParsedMessage["outcome"][];

// How many times the user's trips were reset (tripsReset.ts), kept on the
// import lock every import reads.
// Every `private/gmail-<key>` document of the user, one per connected Gmail
// mailbox (connections.ts), and none of its other private documents
// (`gmail` sorts before these, `gmailIds` after).
export function mailboxesQuery(db: Firestore, uid: string) {
  return db
    .collection(`${paths.user(uid)}/private`)
    .where(FieldPath.documentId(), ">=", "gmail-")
    .where(FieldPath.documentId(), "<", "gmail.");
}

// Every `private/imap-<key>` document of the user, one per mailbox
// connected over IMAP (imapConnection.ts).
export function imapMailboxesQuery(db: Firestore, uid: string) {
  return db
    .collection(`${paths.user(uid)}/private`)
    .where(FieldPath.documentId(), ">=", "imap-")
    .where(FieldPath.documentId(), "<", "imap.");
}

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
      t.set(ref, claimRecord(existing, uid, messageId, processedAt));
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
    async refreshRecords(uid, after, limit, everything = false) {
      // One of two outcomes and the id order: served by single-field indexes.
      // A record that no longer parses is passed over, never fatal, and
      // never shortens the page: a short page is the callers' sign of the
      // end, so reading goes on until `limit` parse or none are left.
      const records: ParsedMessage[] = [];
      let cursor = after;
      for (;;) {
        let query = db.collection(paths.parsedMessages(uid)).where("outcome", "in", everything ? everythingOutcomes : refreshOutcomes).orderBy(FieldPath.documentId());
        if (cursor !== undefined) query = query.startAfter(cursor);
        const want = limit - records.length;
        const snap = await query.limit(want).get();
        for (const d of snap.docs) {
          const parsed = ParsedMessage.safeParse(d.data());
          if (parsed.success) records.push(parsed.data);
        }
        if (snap.size < want || records.length >= limit) return records;
        cursor = snap.docs.at(-1)!.id;
      }
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
        // What connectedMailboxes found, for clearBackfill.
        let mailboxes: { ref: DocumentReference; field: FieldPath }[] = [];
        const result = await fn({
          generation,
          bumpGeneration() {
            next = generation + 1;
          },
          async connectedMailboxes() {
            const [snap, legacy, fastmail, imaps] = await Promise.all([
              t.get(mailboxesQuery(db, uid)),
              t.get(db.doc(paths.gmailState(uid))),
              t.get(db.doc(paths.fastmailState(uid))),
              t.get(imapMailboxesQuery(db, uid)),
            ]);
            mailboxes = snap.docs.map((d) => ({ ref: d.ref, field: new FieldPath("gmails", String(d.get("emailAddress")).trim().toLowerCase(), "backfill") }));
            // One connected before there could be several, not moved yet.
            if (legacy.exists) mailboxes.push({ ref: legacy.ref, field: new FieldPath("gmail", "backfill") });
            if (fastmail.exists) mailboxes.push({ ref: fastmail.ref, field: new FieldPath("fastmail", "backfill") });
            for (const d of imaps.docs) {
              mailboxes.push({ ref: d.ref, field: new FieldPath("imaps", String(d.get("emailAddress")).trim().toLowerCase(), "backfill") });
            }
            return mailboxes.length;
          },
          clearBackfill() {
            for (const { ref, field } of mailboxes) {
              t.update(ref, { backfill: FieldValue.delete() });
              t.update(db.doc(paths.user(uid)), field, FieldValue.delete());
            }
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
          touchTrip(tripId, updatedAt, title) {
            t.update(db.doc(paths.trip(tripId)), title === undefined ? { updatedAt } : { title, updatedAt });
          },
          updateTrip(tripId, fields) {
            t.update(db.doc(paths.trip(tripId)), fields);
          },
          setTripFlags(tripId, flags) {
            t.update(db.doc(paths.trip(tripId)), flags);
          },
          setLiveBounds(tripId, bounds) {
            t.update(
              db.doc(paths.trip(tripId)),
              bounds ? { liveStart: bounds.start, liveEnd: bounds.end } : { liveStart: FieldValue.delete(), liveEnd: FieldValue.delete() },
            );
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
          async listPendingCancellations(owner) {
            const snap = await t.get(db.collection(paths.pendingCancellations(owner)));
            return snap.docs.map((d) => PendingCancellation.parse(d.data()));
          },
          putPendingCancellation(pending) {
            t.set(db.doc(paths.pendingCancellation(pending.uid, pending.messageId)), pending);
          },
          deletePendingCancellation(owner, messageId) {
            t.delete(db.doc(paths.pendingCancellation(owner, messageId)));
          },
          async listPeople(owner) {
            const snap = await t.get(db.collection(paths.people(owner)));
            // One that doesn't parse is left out rather than failing the import.
            return snap.docs.flatMap((d) => {
              const parsed = PersonDoc.safeParse(d.data());
              if (!parsed.success) log("WARNING", "person_unreadable", { uid: owner, personId: d.id });
              return parsed.success ? [parsed.data] : [];
            });
          },
          putPerson(owner, person) {
            t.set(db.doc(paths.person(owner, person.id)), person);
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
    async ownerName(uid) {
      const name = (await db.doc(paths.user(uid)).get()).data()?.displayName;
      return typeof name === "string" && name.trim() ? name : undefined;
    },
    async addFoundLoyalty(uid, found, generation) {
      // Read-modify-write in a transaction, so an import and the owner's
      // Remove, or two imports, keep each other's changes.
      const ref = db.doc(paths.travelProfile(uid));
      return db.runTransaction(async (t) => {
        if (await deleted(t, uid)) throw new AccountDeletedError(uid);
        if (await resetSince(t, uid, generation)) return { refused: 0, superseded: true };
        const snap = await t.get(ref);
        const current = snap.exists ? (TravelProfile.safeParse(snap.data()).data?.foundLoyalty ?? []) : [];
        const { found: next, refused } = withFoundLoyalties(current, found);
        const now = new Date().toISOString();
        t.set(ref, snap.exists ? { foundLoyalty: next, updatedAt: now } : { ownerUid: uid, trustedEmails: [], foundLoyalty: next, updatedAt: now }, { merge: true });
        return { refused };
      });
    },
    async dropUnseenFoundLoyalty(uid, messageId, since, generation) {
      const ref = db.doc(paths.travelProfile(uid));
      return db.runTransaction(async (t) => {
        if (await resetSince(t, uid, generation)) return 0;
        const snap = await t.get(ref);
        if (!snap.exists) return 0;
        const current = TravelProfile.safeParse(snap.data()).data?.foundLoyalty ?? [];
        const kept = current.filter((f) => !(f.messageId === messageId && f.at < since));
        if (kept.length === current.length) return 0;
        t.update(ref, { foundLoyalty: kept, updatedAt: new Date().toISOString() });
        return current.length - kept.length;
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
    async countSender(domain, counts) {
      const increments = Object.fromEntries(Object.entries(counts).map(([field, n]) => [field, FieldValue.increment(n)]));
      await db.doc(paths.senderStats(domain)).set({ ...increments, updatedAt: new Date().toISOString() }, { merge: true });
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
