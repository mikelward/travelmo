import { Trip, paths, segmentDateRange, type ExtractedSegment, type Segment } from "@travelmo/core";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

const now = () => new Date().toISOString();

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

// A segment write widens the trip's bounds to include it, in a transaction
// that reads the trip, so two tabs saving at once both land. Bounds never
// shrink here: that would need every segment, which a client transaction
// cannot read; the parser follows the same rule.
export async function saveSegment(db: Firestore, tripId: string, extracted: ExtractedSegment, existing?: Segment): Promise<Segment> {
  const timestamp = now();
  const id = existing?.id ?? doc(collection(db, paths.segments(tripId))).id;
  const segment: Segment = {
    ...extracted,
    id,
    tripId,
    source: existing?.source ?? "manual",
    gmailMessageIds: existing?.gmailMessageIds ?? [],
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const range = segmentDateRange([segment]);
  if (!range) throw new Error("Segment has no dates");
  const tripRef = doc(db, paths.trip(tripId));
  await runTransaction(db, async (t) => {
    const snap = await t.get(tripRef);
    if (!snap.exists()) throw new Error("Trip no longer exists");
    const trip = Trip.parse(snap.data());
    if (trip.deleting) throw new Error("This trip is being deleted");
    t.set(doc(db, paths.segment(tripId, id)), segment);
    t.update(tripRef, { start: min(trip.start, range.start), end: max(trip.end, range.end), updatedAt: timestamp });
  });
  return segment;
}

export async function deleteSegment(db: Firestore, tripId: string, segmentId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, paths.segment(tripId, segmentId)));
  batch.update(doc(db, paths.trip(tripId)), { updatedAt: now() });
  await batch.commit();
}

export async function renameTrip(db: Firestore, tripId: string, title: string): Promise<void> {
  await updateDoc(doc(db, paths.trip(tripId)), { title: title.trim(), updatedAt: now() });
}

// Firestore does not cascade, so the trip is first marked `deleting`, which
// every segment writer (this file, the parser, the rules) refuses; then the
// segments go, and the trip document last. Each step is idempotent, so a
// deletion the browser interrupted is finished by calling this again.
export async function deleteTrip(db: Firestore, tripId: string): Promise<void> {
  const tripRef = doc(db, paths.trip(tripId));
  const exists = await runTransaction(db, async (t) => {
    const snap = await t.get(tripRef);
    if (!snap.exists()) return false;
    if (!Trip.parse(snap.data()).deleting) t.update(tripRef, { deleting: true, updatedAt: now() });
    return true;
  });
  if (!exists) return;
  const segments = await getDocs(collection(db, paths.segments(tripId)));
  for (let i = 0; i < segments.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of segments.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  await deleteDoc(tripRef);
}
