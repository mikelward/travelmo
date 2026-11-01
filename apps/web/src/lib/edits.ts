"use client";

import { paths, segmentDateRange, type ExtractedSegment, type Segment, type Trip } from "@travelmo/core";
import { collection, deleteDoc, doc, getDocs, writeBatch } from "firebase/firestore";
import { firestore } from "./firebase";

const now = () => new Date().toISOString();

// Trip bounds follow the segments: wide enough to hold them all, and left
// alone when the last one goes so an empty trip keeps its dates.
function boundsFor(trip: Trip, segments: readonly Segment[]): Pick<Trip, "start" | "end"> {
  const range = segmentDateRange(segments);
  return range ?? { start: trip.start, end: trip.end };
}

export async function saveSegment(
  trip: Trip,
  segments: readonly Segment[],
  extracted: ExtractedSegment,
  existing?: Segment,
): Promise<void> {
  const db = firestore();
  const timestamp = now();
  const id = existing?.id ?? doc(collection(db, paths.segments(trip.id))).id;
  const segment: Segment = {
    ...extracted,
    id,
    tripId: trip.id,
    source: existing?.source ?? "manual",
    gmailMessageIds: existing?.gmailMessageIds ?? [],
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const batch = writeBatch(db);
  batch.set(doc(db, paths.segment(trip.id, id)), segment);
  batch.update(doc(db, paths.trip(trip.id)), {
    ...boundsFor(trip, [...segments.filter((s) => s.id !== id), segment]),
    updatedAt: timestamp,
  });
  await batch.commit();
}

export async function deleteSegment(trip: Trip, segments: readonly Segment[], segment: Segment): Promise<void> {
  const db = firestore();
  const batch = writeBatch(db);
  batch.delete(doc(db, paths.segment(trip.id, segment.id)));
  batch.update(doc(db, paths.trip(trip.id)), {
    ...boundsFor(trip, segments.filter((s) => s.id !== segment.id)),
    updatedAt: now(),
  });
  await batch.commit();
}

export async function renameTrip(trip: Trip, title: string): Promise<void> {
  const db = firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, paths.trip(trip.id)), { title: title.trim(), updatedAt: now() });
  await batch.commit();
}

// Firestore does not cascade, so the segments go first; the trip document
// last, so a failure part-way leaves a trip that still lists its remaining
// segments rather than orphans nobody can reach.
export async function deleteTrip(trip: Trip): Promise<void> {
  const db = firestore();
  const segments = await getDocs(collection(db, paths.segments(trip.id)));
  for (let i = 0; i < segments.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of segments.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  await deleteDoc(doc(db, paths.trip(trip.id)));
}
