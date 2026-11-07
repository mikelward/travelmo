import { Segment, Trip, paths, segmentDateRange, type ExtractedSegment } from "@travelmo/core";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
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
    ...(existing?.sender ? { sender: existing.sender } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const range = segmentDateRange([segment]);
  if (!range) throw new Error("Segment has no dates");
  const tripRef = doc(db, paths.trip(tripId));
  const segmentRef = doc(db, paths.segment(tripId, id));
  let saved = segment;
  await runTransaction(db, async (t) => {
    const snap = await t.get(tripRef);
    if (!snap.exists()) throw new Error("Trip no longer exists");
    const trip = Trip.parse(snap.data());
    if (trip.deleting) throw new Error("This trip is being deleted");
    // Sources are the importer's, not the form's, and the rating and the
    // favorite mark are the row's: any of them may have changed while the
    // form was open, so they are taken from the stored booking, afresh on
    // every attempt, since Firestore reruns this on a conflict.
    const stored = existing ? await t.get(segmentRef) : undefined;
    const current = stored?.exists() ? Segment.safeParse(stored.data()) : undefined;
    saved = { ...segment };
    if (current?.success) {
      saved.gmailMessageIds = current.data.gmailMessageIds;
      if (current.data.sources) saved.sources = current.data.sources;
      if (current.data.rating !== undefined) saved.rating = current.data.rating;
      if (current.data.favorite !== undefined) saved.favorite = current.data.favorite;
    }
    t.set(segmentRef, saved);
    t.update(tripRef, { start: min(trip.start, range.start), end: max(trip.end, range.end), updatedAt: timestamp });
  });
  return saved;
}

// The traveler's verdict on a booking: stars (null clears them) or a
// favorite mark. An edit like any other: the booking's revision moves, so
// a calendar change no longer replaces it and the rating survives.
export async function rateSegment(db: Firestore, tripId: string, segmentId: string, rating: number | null): Promise<void> {
  const timestamp = now();
  const batch = writeBatch(db);
  batch.update(doc(db, paths.segment(tripId, segmentId)), { rating: rating === null ? deleteField() : rating, updatedAt: timestamp });
  batch.update(doc(db, paths.trip(tripId)), { updatedAt: timestamp });
  await batch.commit();
}

export async function favoriteSegment(db: Firestore, tripId: string, segmentId: string, favorite: boolean): Promise<void> {
  const timestamp = now();
  const batch = writeBatch(db);
  batch.update(doc(db, paths.segment(tripId, segmentId)), { favorite, updatedAt: timestamp });
  batch.update(doc(db, paths.trip(tripId)), { updatedAt: timestamp });
  await batch.commit();
}

export async function deleteSegment(db: Firestore, tripId: string, segmentId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, paths.segment(tripId, segmentId)));
  batch.update(doc(db, paths.trip(tripId)), { updatedAt: now() });
  await batch.commit();
}

// Bounds only ever widen on save, so after deletions a trip can outgrow its
// bookings; this snaps them back. Owner only: the rules let a sharee widen
// but never narrow. Returns false when there is nothing to fit to.
//
// A client transaction cannot read the segment collection, so the segments
// are read outside it and the trip's `updatedAt`, which every segment write
// bumps, stands in as a revision: if it moved between the read and the
// write, the bounds are stale and the read is repeated.
export async function fitTripDates(
  db: Firestore,
  tripId: string,
  hooks: { afterRead?: () => Promise<void> } = {},
): Promise<boolean> {
  const tripRef = doc(db, paths.trip(tripId));
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await getDoc(tripRef);
    if (!before.exists()) throw new Error("Trip no longer exists");
    const seen = Trip.parse(before.data());
    if (seen.deleting) throw new Error("This trip is being deleted");
    const segments = await getDocs(collection(db, paths.segments(tripId)));
    const range = segmentDateRange(segments.docs.map((d) => Segment.parse(d.data())));
    await hooks.afterRead?.();
    if (!range) return false;
    const applied = await runTransaction(db, async (t) => {
      const snap = await t.get(tripRef);
      if (!snap.exists()) throw new Error("Trip no longer exists");
      const trip = Trip.parse(snap.data());
      if (trip.deleting) throw new Error("This trip is being deleted");
      if (trip.updatedAt !== seen.updatedAt) return false;
      t.update(tripRef, { start: range.start, end: range.end, updatedAt: now() });
      return true;
    });
    if (applied) return true;
  }
  throw new Error("The trip kept changing; try again");
}

// A booking keeps its id under the new trip, so an import of the same email
// still finds it. The booking is read inside the transaction, so an edit or
// deletion made meanwhile is honored rather than overwritten. Both trips must
// exist and neither may be mid-deletion; the target widens to hold it, the
// source's dates stay (fit them afterwards).
export async function moveSegment(db: Firestore, fromTripId: string, segmentId: string, toTripId: string): Promise<void> {
  if (fromTripId === toTripId) return;
  const timestamp = now();
  const fromRef = doc(db, paths.trip(fromTripId));
  const toRef = doc(db, paths.trip(toTripId));
  const segmentRef = doc(db, paths.segment(fromTripId, segmentId));
  await runTransaction(db, async (t) => {
    const [from, to, current] = await Promise.all([t.get(fromRef), t.get(toRef), t.get(segmentRef)]);
    if (!from.exists() || !to.exists()) throw new Error("Trip no longer exists");
    if (!current.exists()) throw new Error("That booking is no longer in this trip");
    const target = Trip.parse(to.data());
    if (Trip.parse(from.data()).deleting || target.deleting) throw new Error("This trip is being deleted");
    const segment = Segment.parse(current.data());
    const range = segmentDateRange([segment]);
    if (!range) throw new Error("Segment has no dates");
    t.set(doc(db, paths.segment(toTripId, segmentId)), { ...segment, tripId: toTripId, updatedAt: timestamp });
    t.delete(segmentRef);
    t.update(toRef, { start: min(target.start, range.start), end: max(target.end, range.end), updatedAt: timestamp });
    t.update(fromRef, { updatedAt: timestamp });
  });
}

// Moves every booking of `sourceId` into `targetId` and deletes the source
// (owner only: the rules reserve trip deletion for the owner). Sharing is
// not merged; the target keeps its own list. The source's segments are read
// outside the transaction, so its `updatedAt` stands in as a revision, as
// in fitTripDates. Returns how many bookings moved.
export async function mergeTrips(
  db: Firestore,
  sourceId: string,
  targetId: string,
  hooks: { afterRead?: () => Promise<void> } = {},
): Promise<number> {
  if (sourceId === targetId) throw new Error("Pick a different trip");
  const sourceRef = doc(db, paths.trip(sourceId));
  const targetRef = doc(db, paths.trip(targetId));
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await getDoc(sourceRef);
    if (!before.exists()) throw new Error("Trip no longer exists");
    const seen = Trip.parse(before.data());
    if (seen.deleting) throw new Error("This trip is being deleted");
    const segments = (await getDocs(collection(db, paths.segments(sourceId)))).docs.map((d) => Segment.parse(d.data()));
    await hooks.afterRead?.();
    const range = segmentDateRange(segments);
    const timestamp = now();
    const applied = await runTransaction(db, async (t) => {
      const [s, g] = await Promise.all([t.get(sourceRef), t.get(targetRef)]);
      if (!s.exists() || !g.exists()) throw new Error("Trip no longer exists");
      const source = Trip.parse(s.data());
      const target = Trip.parse(g.data());
      if (source.deleting || target.deleting) throw new Error("This trip is being deleted");
      if (source.updatedAt !== seen.updatedAt) return false;
      for (const segment of segments) {
        t.set(doc(db, paths.segment(targetId, segment.id)), { ...segment, tripId: targetId, updatedAt: timestamp });
        t.delete(doc(db, paths.segment(sourceId, segment.id)));
      }
      t.update(targetRef, {
        ...(range ? { start: min(target.start, range.start), end: max(target.end, range.end) } : {}),
        updatedAt: timestamp,
      });
      t.delete(sourceRef);
      return true;
    });
    if (applied) return segments.length;
  }
  throw new Error("The trip kept changing; try again");
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
