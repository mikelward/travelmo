import { Segment, Trip, bookedDateRange, displayBounds, fittingTrip, inTrip, isCancelled, liveBounds, newTripTitle, paths, segmentDateRange, type ExtractedSegment } from "@travelmo/core";
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

const now = () => new Date().toISOString();

// Every write here that changes a trip's bookings takes the trip's list
// flags off (listFilters.ts): unknown again, they are recomputed from the
// bookings the next time an app reads them (useKeepTripFlags), rather than
// stand wrong for a trip whose page isn't open.
const flagsUnknown = () => ({ allCancelled: deleteField(), localOnly: deleteField() });

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

type Range = { start: string; end: string };

// A trip's dates once bookings are in it: its own widen to cover every one,
// cancelled ones too (`booked`), so an import finds each again by date; the
// dates it is shown with (displayBounds) widen only for those still booked
// (`live`), and are kept apart (liveStart, liveEnd) only while they differ.
// Nothing narrows here; the parser settles the rest.
function widened(trip: Trip, booked: Range | undefined, live: Range | undefined): Record<string, unknown> {
  if (!booked) return {};
  const start = min(trip.start, booked.start);
  const end = max(trip.end, booked.end);
  const shown = displayBounds(trip);
  const liveStart = live ? min(shown.start, live.start) : shown.start;
  const liveEnd = live ? max(shown.end, live.end) : shown.end;
  if (liveStart === start && liveEnd === end) return trip.liveStart ? { start, end, liveStart: deleteField(), liveEnd: deleteField() } : { start, end };
  return { start, end, liveStart, liveEnd };
}

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
    // A hand edit, which "Refresh from email" leaves as it is; a rating, a
    // favorite mark or a move moves only updatedAt.
    editedAt: timestamp,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  if (!segmentDateRange([segment])) throw new Error("Segment has no dates");
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
      // An edit doesn't undo a cancellation; Restore does.
      if (current.data.cancelledAt) saved.cancelledAt = current.data.cancelledAt;
      if (current.data.cancelledBy) saved.cancelledBy = current.data.cancelledBy;
      if (current.data.cancelledSentAt) saved.cancelledSentAt = current.data.cancelledSentAt;
      if (current.data.restoredFrom) saved.restoredFrom = current.data.restoredFrom;
      if (current.data.restoredAt) saved.restoredAt = current.data.restoredAt;
      if (current.data.userCancelled) saved.userCancelled = current.data.userCancelled;
    } else {
      // A booking added to a cancelled trip is cancelled with it.
      saved = inTrip(saved, trip, timestamp);
    }
    t.set(segmentRef, saved);
    // A cancelled booking widens only the trip's own dates.
    t.update(tripRef, { ...widened(trip, bookedDateRange([saved]), segmentDateRange([saved])), ...flagsUnknown(), updatedAt: timestamp });
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

// Takes back a cancellation an email set: the booking counts again, so the
// trip widens to include it, as a save does (Fit dates may have narrowed
// the trip while the booking was cancelled).
export async function restoreSegment(db: Firestore, tripId: string, segmentId: string): Promise<void> {
  const timestamp = now();
  const tripRef = doc(db, paths.trip(tripId));
  const segmentRef = doc(db, paths.segment(tripId, segmentId));
  await runTransaction(db, async (t) => {
    const [tripSnap, segmentSnap] = [await t.get(tripRef), await t.get(segmentRef)];
    if (!tripSnap.exists()) throw new Error("Trip no longer exists");
    if (!segmentSnap.exists()) throw new Error("Booking no longer exists");
    const trip = Trip.parse(tripSnap.data());
    if (trip.deleting) throw new Error("This trip is being deleted");
    // The booking's span as it will be once restored.
    const stored = Segment.parse(segmentSnap.data());
    if (trip.cancelledAt && stored.userCancelled === "trip") throw new Error("Restore the trip first");
    const restored: Segment = { ...stored, cancelledAt: undefined };
    const range = bookedDateRange([restored]);
    // The person's own cancellation is simply taken off: no email was
    // overruled, so none sent before now is kept from cancelling it later.
    if (stored.userCancelled) {
      t.update(segmentRef, { cancelledAt: deleteField(), userCancelled: deleteField(), updatedAt: timestamp });
      t.update(tripRef, { ...widened(trip, range, range), ...flagsUnknown(), updatedAt: timestamp });
      return;
    }
    // The cancellation is remembered as taken back, and when: reading the
    // booking's confirmation again, or any cancellation sent before now,
    // doesn't cancel it again.
    t.update(segmentRef, {
      cancelledAt: deleteField(),
      cancelledBy: deleteField(),
      cancelledSentAt: deleteField(),
      ...(stored.cancelledBy ? { restoredFrom: arrayUnion(stored.cancelledBy) } : {}),
      restoredAt: timestamp,
      updatedAt: timestamp,
    });
    t.update(tripRef, { ...widened(trip, range, range), ...flagsUnknown(), updatedAt: timestamp });
  });
}

export async function deleteSegment(db: Firestore, tripId: string, segmentId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, paths.segment(tripId, segmentId)));
  batch.update(doc(db, paths.trip(tripId)), { ...flagsUnknown(), updatedAt: now() });
  await batch.commit();
}

// Deletes a trip whole only if its bookings are still just `expected` (as
// read for "Never import this sender"): it is first marked `deleting`, which
// stops every other writer, then read. If anything else arrived, the mark
// comes off and false says so; nothing is deleted. A failed read takes off
// a mark this call made, so the trip isn't left locked unchecked.
export async function deleteTripIfOnly(db: Firestore, tripId: string, expected: readonly string[]): Promise<boolean> {
  const tripRef = doc(db, paths.trip(tripId));
  const mark = await runTransaction(db, async (t) => {
    const snap = await t.get(tripRef);
    if (!snap.exists()) return "gone";
    if (Trip.parse(snap.data()).deleting) return "already";
    t.update(tripRef, { deleting: true, updatedAt: now() });
    return "marked";
  });
  if (mark === "gone") return true;
  const release = () => updateDoc(tripRef, { deleting: false, updatedAt: now() });
  let ids: string[];
  try {
    ids = (await getDocs(collection(db, paths.segments(tripId)))).docs.map((d) => d.id);
  } catch (e) {
    console.error("Reading a trip's bookings before deleting it failed", e);
    if (mark === "marked") await release();
    throw e;
  }
  if (ids.some((id) => !expected.includes(id))) {
    await release();
    return false;
  }
  await deleteTrip(db, tripId);
  return true;
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
    const bookings = (await getDocs(collection(db, paths.segments(tripId)))).docs.map((d) => Segment.parse(d.data()));
    // Every booking's dates, cancelled ones too, as the trip's own dates
    // must cover; shown with what is still booked (liveBounds).
    const range = bookedDateRange(bookings);
    await hooks.afterRead?.();
    if (!range) return false;
    const applied = await runTransaction(db, async (t) => {
      const snap = await t.get(tripRef);
      if (!snap.exists()) throw new Error("Trip no longer exists");
      const trip = Trip.parse(snap.data());
      if (trip.deleting) throw new Error("This trip is being deleted");
      if (trip.updatedAt !== seen.updatedAt) return false;
      const live = liveBounds(range, bookings);
      t.update(tripRef, {
        start: range.start,
        end: range.end,
        liveStart: live ? live.start : deleteField(),
        liveEnd: live ? live.end : deleteField(),
        updatedAt: now(),
      });
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
    // A cancelled booking moves as it is, still cancelled (unless only its
    // trip was), and has no dates that count, so the target widens only for
    // a live one.
    const range = bookedDateRange([segment]);
    const live = segmentDateRange([inTrip(segment, target, timestamp)]);
    // Cancelled with a cancelled trip it joins, live again leaving one.
    const moved = inTrip({ ...segment, tripId: toTripId, updatedAt: timestamp }, target, timestamp);
    t.set(doc(db, paths.segment(toTripId, segmentId)), moved);
    t.delete(segmentRef);
    t.update(toRef, { ...widened(target, range, live), ...flagsUnknown(), updatedAt: timestamp });
    t.update(fromRef, { ...flagsUnknown(), updatedAt: timestamp });
  });
}

// Moves a booking into a trip of its own, made for it: owned by the viewer,
// named after where the booking goes (newTripTitle), over its dates, and
// shared as the trip it leaves when the viewer owns that one (a sharee's
// new trip is their own). The rules check a booking against its trip as it
// already is, so the trip is made first and then the booking moved; a move
// that fails takes the empty trip away again. Returns the new trip's id.
export async function moveSegmentToNewTrip(db: Firestore, fromTripId: string, segmentId: string, uid: string): Promise<string> {
  const [from, current] = await Promise.all([getDoc(doc(db, paths.trip(fromTripId))), getDoc(doc(db, paths.segment(fromTripId, segmentId)))]);
  if (!from.exists()) throw new Error("Trip no longer exists");
  if (!current.exists()) throw new Error("That booking is no longer in this trip");
  const source = Trip.parse(from.data());
  const segment = Segment.parse(current.data());
  const range = bookedDateRange([segment]);
  if (!range) throw new Error("That booking has no dates");
  const ref = doc(collection(db, paths.trips()));
  const timestamp = now();
  const created: Trip = {
    id: ref.id,
    title: newTripTitle(segment),
    start: range.start,
    end: range.end,
    ownerUid: uid,
    sharedWith: source.ownerUid === uid ? source.sharedWith : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  try {
    await setDoc(ref, created);
    await moveSegment(db, fromTripId, segmentId, ref.id);
  } catch (error) {
    // A transaction can commit and still report a failure (its answer lost
    // on the way back), so the trip goes only once the booking is known not
    // to be in it; when that can't be told, it stays rather than orphan it.
    try {
      if ((await getDocFromServer(doc(db, paths.segment(ref.id, segmentId)))).exists()) {
        console.error("Moving a booking to a new trip reported a failure, but the booking is there; keeping the trip", error);
      } else {
        console.error("Moving a booking to a new trip failed; removing the empty trip", error);
        await deleteDoc(ref);
      }
    } catch (cleanup) {
      console.error("Checking or removing the new trip failed; it stays", cleanup);
    }
    throw error;
  }
  return ref.id;
}

// Adds a booking with no trip in view (one an email couldn't be read for):
// into the user's trip that takes in its first day (fittingTrip), else a
// trip of its own, owned by the user, named for where it goes, over its
// dates. As in moveSegmentToNewTrip, the trip is made first; a save that
// fails takes the empty trip away again. Returns the trip it went into.
export async function addSegmentToFittingTrip(
  db: Firestore,
  uid: string,
  trips: readonly Trip[],
  extracted: ExtractedSegment,
): Promise<{ tripId: string; title: string }> {
  const fitting = fittingTrip(trips, uid, extracted.start);
  if (fitting) {
    await saveSegment(db, fitting.id, extracted);
    return { tripId: fitting.id, title: fitting.title };
  }
  const start = extracted.start.slice(0, 10);
  const end = max(start, (extracted.end ?? extracted.start).slice(0, 10));
  const ref = doc(collection(db, paths.trips()));
  const timestamp = now();
  const created: Trip = { id: ref.id, title: newTripTitle(extracted), start, end, ownerUid: uid, sharedWith: [], createdAt: timestamp, updatedAt: timestamp };
  await setDoc(ref, created);
  try {
    await saveSegment(db, ref.id, extracted);
  } catch (error) {
    console.error("Adding a booking to a new trip failed; removing the empty trip", error);
    try {
      await deleteDoc(ref);
    } catch (cleanup) {
      console.error("Removing the empty trip failed; it stays", cleanup);
    }
    throw error;
  }
  return { tripId: ref.id, title: created.title };
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
    const range = bookedDateRange(segments);
    const timestamp = now();
    const applied = await runTransaction(db, async (t) => {
      const [s, g] = await Promise.all([t.get(sourceRef), t.get(targetRef)]);
      if (!s.exists() || !g.exists()) throw new Error("Trip no longer exists");
      const source = Trip.parse(s.data());
      const target = Trip.parse(g.data());
      if (source.deleting || target.deleting) throw new Error("This trip is being deleted");
      if (source.updatedAt !== seen.updatedAt) return false;
      // As they stand in the target: cancelled with it, or live again.
      const moved = segments.map((segment) => inTrip({ ...segment, tripId: targetId, updatedAt: timestamp }, target, timestamp));
      const live = segmentDateRange(moved);
      for (const segment of moved) {
        t.set(doc(db, paths.segment(targetId, segment.id)), segment);
        t.delete(doc(db, paths.segment(sourceId, segment.id)));
      }
      t.update(targetRef, { ...widened(target, range, live), ...flagsUnknown(), updatedAt: timestamp });
      t.delete(sourceRef);
      return true;
    });
    if (applied) return segments.length;
  }
  throw new Error("The trip kept changing; try again");
}

// Rewrites some of a trip's bookings (`change` returns those it changed,
// and any fields for the trip) and settles when the person now travels from
// all of them (liveBounds); the trip's own dates only widen. A client
// transaction cannot read the segment collection, so the bookings are read
// outside it and the trip's `updatedAt` stands in as their revision, as in
// fitTripDates.
async function rewriteBookings(
  db: Firestore,
  tripId: string,
  change: (trip: Trip, segments: readonly Segment[], timestamp: string) => { segments: Segment[]; trip?: Record<string, unknown> },
): Promise<void> {
  const tripRef = doc(db, paths.trip(tripId));
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await getDoc(tripRef);
    if (!before.exists()) throw new Error("Trip no longer exists");
    const seen = Trip.parse(before.data());
    if (seen.deleting) throw new Error("This trip is being deleted");
    const bookings = (await getDocs(collection(db, paths.segments(tripId)))).docs.map((d) => Segment.parse(d.data()));
    const timestamp = now();
    const applied = await runTransaction(db, async (t) => {
      const snap = await t.get(tripRef);
      if (!snap.exists()) throw new Error("Trip no longer exists");
      const trip = Trip.parse(snap.data());
      if (trip.deleting) throw new Error("This trip is being deleted");
      if (trip.updatedAt !== seen.updatedAt) return false;
      const changed = change(trip, bookings, timestamp);
      const after = bookings.map((s) => changed.segments.find((c) => c.id === s.id) ?? s);
      const booked = bookedDateRange(after);
      const own = booked ? { start: min(trip.start, booked.start), end: max(trip.end, booked.end) } : { start: trip.start, end: trip.end };
      const live = liveBounds(own, after);
      for (const segment of changed.segments) {
        // Written whole, so a field taken off (a restore) is gone.
        t.set(doc(db, paths.segment(tripId, segment.id)), { ...segment, updatedAt: timestamp });
      }
      t.update(tripRef, {
        ...own,
        liveStart: live ? live.start : deleteField(),
        liveEnd: live ? live.end : deleteField(),
        ...flagsUnknown(),
        ...changed.trip,
        updatedAt: timestamp,
      });
      return true;
    });
    if (applied) return;
  }
  throw new Error("The trip kept changing; try again");
}

// The person's word that a booking didn't happen: it stays on the trip,
// struck through, until Restore. When the trip is shown moves in if this
// booking was at its end.
export async function cancelSegment(db: Firestore, tripId: string, segmentId: string): Promise<void> {
  await rewriteBookings(db, tripId, (_trip, segments, timestamp) => {
    const segment = segments.find((s) => s.id === segmentId);
    if (!segment) throw new Error("Booking no longer exists");
    if (isCancelled(segment)) return { segments: [] };
    return { segments: [{ ...segment, cancelledAt: timestamp, userCancelled: "booking" }] };
  });
}

// The owner's word that the whole trip didn't happen: every booking still
// booked is cancelled with it, and those added later are too, until
// restoreTrip. Bookings already cancelled stay as they were.
export async function cancelTrip(db: Firestore, tripId: string): Promise<void> {
  await rewriteBookings(db, tripId, (_trip, segments, timestamp) => ({
    segments: segments.filter((s) => !isCancelled(s)).map((s) => ({ ...s, cancelledAt: timestamp, userCancelled: "trip" as const })),
    trip: { cancelledAt: timestamp },
  }));
}

// Takes a trip's cancellation back: the bookings cancelled with it are
// booked again; those cancelled on their own, by the person or an email,
// stay cancelled.
export async function restoreTrip(db: Firestore, tripId: string): Promise<void> {
  await rewriteBookings(db, tripId, (trip, segments, timestamp) => ({
    segments: segments.map((s) => inTrip(s, { ...trip, cancelledAt: undefined }, timestamp)).filter((s, i) => s !== segments[i]),
    trip: { cancelledAt: deleteField() },
  }));
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
