import { SenderPatterns, Trip, paths, senderCleanup, withLearned, type SenderCleanup } from "@travelmo/core";
import { collection, doc, getDocsFromServer, query, runTransaction, where, type Firestore } from "firebase/firestore";
import { deleteSegment, deleteTripIfOnly } from "./edits";

export { covers, domainOf, effectiveDecision, isListed } from "@travelmo/core";

// Teaches the parser a sender (withLearned), on the rules as stored now.
export async function learnSender(db: Firestore, uid: string, domain: string, list: "allow" | "deny"): Promise<void> {
  const ref = doc(db, paths.senderPatterns(uid));
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref);
    t.set(ref, withLearned(SenderPatterns.parse(snap.data() ?? {}), domain, list));
  });
}

// What "Never import this sender" would remove (senderCleanup), from the
// owner's trips and each one's bookings read once from the server, never the
// cache: a trip or booking not yet loaded would otherwise go unoffered. A
// rare action, so a read of every trip is fine.
export async function senderBookings(db: Firestore, uid: string, domain: string): Promise<SenderCleanup> {
  const trips = (await getDocsFromServer(query(collection(db, paths.trips()), where("ownerUid", "==", uid)))).docs.flatMap((d) => {
    const parsed = Trip.safeParse(d.data());
    if (!parsed.success) console.warn("Skipping a malformed trip", d.id);
    return parsed.success && !parsed.data.deleting ? [parsed.data] : [];
  });
  const read: Array<{ trip: Trip; segments: Array<{ id: string; sender?: string }> }> = new Array(trips.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(16, trips.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < trips.length) {
        const index = cursor++;
        const trip = trips[index]!;
        const snap = await getDocsFromServer(collection(db, paths.segments(trip.id)));
        read[index] = {
          trip,
          segments: snap.docs.map((d) => {
            const sender = (d.data() as { sender?: string }).sender;
            return sender !== undefined ? { id: d.id, sender } : { id: d.id };
          }),
        };
      }
    }),
  );
  return senderCleanup(read, uid, domain);
}

// Removes them: the trips whole, unless a booking arrived there since they
// were read (then only the sender's go), then the bookings in trips that
// keep others. Returns the trips deleted.
export async function removeSenderBookings(db: Firestore, cleanup: SenderCleanup): Promise<string[]> {
  const segments = [...cleanup.segments];
  const deleted: string[] = [];
  for (const trip of cleanup.trips) {
    if (await deleteTripIfOnly(db, trip.id, trip.segments)) deleted.push(trip.id);
    else segments.push(...trip.segments.map((segmentId) => ({ tripId: trip.id, segmentId })));
  }
  for (const { tripId, segmentId } of segments) await deleteSegment(db, tripId, segmentId);
  return deleted;
}
