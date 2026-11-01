import { ParsedMessage, SenderPatterns, Trip, paths, type Segment } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import type { TripStore } from "./importer";

export function firestoreStore(db: Firestore): TripStore {
  return {
    async getParsed(uid, messageId) {
      const snap = await db.doc(paths.parsedMessage(uid, messageId)).get();
      return snap.exists ? ParsedMessage.parse(snap.data()) : undefined;
    },
    async setParsed(record) {
      await db.doc(paths.parsedMessage(record.uid, record.messageId)).set(record);
    },
    async listTrips(uid) {
      const snap = await db.collection(paths.trips()).where("ownerUid", "==", uid).get();
      return snap.docs.map((d) => Trip.parse(d.data()));
    },
    async putTrip(trip) {
      await db.doc(paths.trip(trip.id)).set(trip);
    },
    async putSegment(segment: Segment) {
      await db.doc(paths.segment(segment.tripId, segment.id)).set(segment);
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
