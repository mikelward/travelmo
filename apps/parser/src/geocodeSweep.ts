import { enrichSegments, fillAirports, needsGeocoding, paths, type Segment, type Trip } from "@travelmo/core";
import { airportPlace } from "@travelmo/core/airportPlaces";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { refuseIfDeleted } from "./deleted";
import type { ImportDeps } from "./importer";
import { generationOf } from "./store";

// A second chance for the places a spent daily budget left without a
// country or a spot. An import that was put off records the booking here;
// the daily sweep asks again, writes what it learns under the user's lock
// (and only if nobody edited the booking meanwhile), and drops the entry
// once every place is answered, the booking is gone, or it is too old.

// `generation` is the reset generation the booking was filed under, so a
// reset's cleanup can tell an entry from before it from one a later import
// queued (tripsReset.ts).
export type GeocodeRetry = { uid: string; tripId: string; segmentId: string; at: string; generation?: number };

export type RetryStore = {
  // With `generation`, only while the user's trips have not been reset
  // since it was read (tripsReset.ts): the booking may be gone.
  put(entry: GeocodeRetry, generation?: number): Promise<void>;
  // Oldest first.
  list(limit: number): Promise<GeocodeRetry[]>;
  delete(entry: Pick<GeocodeRetry, "tripId" | "segmentId">): Promise<void>;
};

export function firestoreRetryStore(db: Firestore): RetryStore {
  return {
    async put(entry, generation) {
      await db.runTransaction(async (t) => {
        await refuseIfDeleted(db, t, entry.uid);
        if (generation !== undefined && generationOf(await t.get(db.doc(paths.importLock(entry.uid)))) !== generation) return;
        t.set(db.doc(paths.geocodeRetry(entry.tripId, entry.segmentId)), generation === undefined ? entry : { ...entry, generation });
      });
    },
    async list(limit) {
      const snap = await db.collection(paths.geocodeRetries()).orderBy("at").limit(limit).get();
      return snap.docs.map((d) => d.data() as GeocodeRetry);
    },
    async delete({ tripId, segmentId }) {
      await db.doc(paths.geocodeRetry(tripId, segmentId)).delete();
    },
  };
}

export function memoryRetryStore(): RetryStore & { entries: Map<string, GeocodeRetry> } {
  const entries = new Map<string, GeocodeRetry>();
  const key = (e: Pick<GeocodeRetry, "tripId" | "segmentId">) => `${e.tripId}/${e.segmentId}`;
  return {
    entries,
    async put(entry) {
      entries.set(key(entry), entry);
    },
    async list(limit) {
      return [...entries.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit);
    },
    async delete(entry) {
      entries.delete(key(entry));
    },
  };
}

export const defaultSweepLimit = 200;
// An entry this old is dropped unasked: the budget has had its chances.
export const maxRetryAgeDays = 30;

export type SweepResult = { seen: number; placed: number; dropped: number; deferred: number; failed: number };

// Asks again for each queued booking, oldest first, until the budget is
// spent again. A booking edited since (by its revision) is left alone and
// kept for another day. What the sweep writes does not move the booking's
// revision: an unedited booking (updatedAt still its createdAt) stays one,
// so a calendar cancellation or change can still replace it.
export async function sweepGeocodeRetries(deps: ImportDeps, limit = defaultSweepLimit): Promise<SweepResult> {
  const result: SweepResult = { seen: 0, placed: 0, dropped: 0, deferred: 0, failed: 0 };
  const { store, geocode, geocodeRetries } = deps;
  if (!geocode || !geocodeRetries) return result;
  const now = deps.now();
  const tooOld = Date.parse(now) - maxRetryAgeDays * 86_400_000;
  // A booking moved to another trip, or carried along by a merge, keeps its
  // id under a new path: when it is not where the entry says, it is looked
  // for among the user's bookings, read once per user per sweep.
  const usersSegments = new Map<string, Promise<Segment[]>>();
  const find = async (entry: GeocodeRetry): Promise<Segment | undefined> => {
    const direct = await store.readSegment(entry.tripId, entry.segmentId);
    if (direct) return direct;
    let all = usersSegments.get(entry.uid);
    if (!all) {
      all = store.listUserSegments(entry.uid);
      usersSegments.set(entry.uid, all);
    }
    return (await all).find((s) => s.id === entry.segmentId);
  };
  for (const entry of await geocodeRetries.list(limit)) {
    result.seen += 1;
    const drop = async () => {
      await geocodeRetries.delete(entry);
      result.dropped += 1;
    };
    if (Date.parse(entry.at) < tooOld) {
      await drop();
      continue;
    }
    const segment = await find(entry);
    if (!segment || !needsGeocoding(segment)) {
      await drop();
      continue;
    }
    const { tripId } = segment;
    const { segments, deferred, countryDeferred, failed, filled } = await enrichSegments([fillAirports(segment, airportPlace)], geocode);
    const enriched = segments[0]!;
    if (deferred) {
      result.deferred += 1;
      // A country lookup refused means the whole budget is spent for today,
      // and the rest of the queue waits with it; a spot-only refusal means
      // only the spots' share is, and bookings lacking a country still get
      // their turn.
      if (countryDeferred) break;
      if (!filled) continue;
    }
    if (failed) {
      result.failed += 1;
      continue;
    }
    if (filled) {
      const written = await store.withUserLock(entry.uid, async (tx) => {
        const current = await tx.getSegment(tripId, entry.segmentId);
        if (!current || current.updatedAt !== segment.updatedAt) return false;
        tx.putSegment({
          ...current,
          ...(enriched.origin ? { origin: enriched.origin } : {}),
          ...(enriched.destination ? { destination: enriched.destination } : {}),
        });
        // A fresh revision per write: a client editing the trip between two
        // writes to it must see it move twice.
        tx.touchTrip(tripId, deps.now());
        return true;
      });
      if (!written) continue;
      result.placed += 1;
      deps.log("geocode_swept", { uid: entry.uid, tripId, segmentId: entry.segmentId, filled });
    }
    // A booking still waiting for its spot keeps its place in the queue.
    if (deferred) continue;
    // Answered, whether or not anything was filled ("none" is an answer).
    await drop();
  }
  return result;
}

// Bookings imported before geocoding began never asked about their places:
// a walk through every trip, a page a day in id order, queues the ones
// still missing a country or a spot, and the sweep asks about them within
// the day's budget like any put-off import. It stops for good at the end.
// A hand-entered booking is left as its author wrote it, as at import.

export type BackfillTrip = { trip: Pick<Trip, "id" | "ownerUid">; segments: Segment[] };

export type BackfillScan = {
  // Where the walk got to: the last trip id read, "done", or nothing yet.
  cursor(): Promise<string | undefined>;
  save(cursor: string): Promise<void>;
  // Up to `limit` trips after `after`, in id order, with their bookings.
  page(after: string | undefined, limit: number): Promise<BackfillTrip[]>;
};

export const backfillDone = "done";
export const defaultBackfillTrips = 100;

export type BackfillResult = { trips: number; queued: number; done: boolean };

// Queues no more than the sweep can take in a day: a trip's bookings go in
// only while the queue has room for them (a trip larger than all the room
// goes in alone), and the walk resumes after the last trip queued, so no
// booking waits long enough in the queue to expire unasked.
export async function queueGeocodeBackfill(scan: BackfillScan, retries: RetryStore, now: string, limit = defaultBackfillTrips, room = defaultSweepLimit): Promise<BackfillResult> {
  const result: BackfillResult = { trips: 0, queued: 0, done: false };
  const cursor = await scan.cursor();
  if (cursor === backfillDone) return { ...result, done: true };
  const free = room - (await retries.list(room)).length;
  if (free <= 0) return result;
  const trips = await scan.page(cursor, limit);
  let last: string | undefined;
  let stopped = false;
  for (const { trip, segments } of trips) {
    const due = segments.filter((s) => s.source !== "manual" && needsGeocoding(fillAirports(s, airportPlace)));
    if (result.queued > 0 && result.queued + due.length > free) {
      stopped = true;
      break;
    }
    for (const segment of due) await retries.put({ uid: trip.ownerUid, tripId: trip.id, segmentId: segment.id, at: now });
    result.queued += due.length;
    result.trips += 1;
    last = trip.id;
    if (result.queued >= free) {
      stopped = result.trips < trips.length;
      break;
    }
  }
  result.done = !stopped && trips.length < limit;
  if (result.done) await scan.save(backfillDone);
  else if (last) await scan.save(last);
  return result;
}

export function firestoreBackfillScan(db: Firestore): BackfillScan {
  const state = db.doc(paths.geocodeBackfill());
  return {
    async cursor() {
      const snap = await state.get();
      const value = snap.get("cursor");
      return typeof value === "string" ? value : undefined;
    },
    async save(cursor) {
      await state.set({ cursor });
    },
    async page(after, limit) {
      let query = db.collection(paths.trips()).orderBy(FieldPath.documentId()).limit(limit);
      if (after) query = query.startAfter(after);
      const snap = await query.get();
      return Promise.all(
        snap.docs.map(async (d) => {
          const segments = await db.collection(paths.segments(d.id)).get();
          return {
            trip: { id: d.id, ownerUid: d.get("ownerUid") as string },
            segments: segments.docs.map((s) => ({ ...(s.data() as Segment), id: s.id })),
          };
        }),
      );
    },
  };
}

export function memoryBackfillScan(trips: BackfillTrip[]): BackfillScan & { state: { cursor?: string } } {
  const state: { cursor?: string } = {};
  const sorted = [...trips].sort((a, b) => a.trip.id.localeCompare(b.trip.id));
  return {
    state,
    async cursor() {
      return state.cursor;
    },
    async save(cursor) {
      state.cursor = cursor;
    },
    async page(after, limit) {
      return sorted.filter((t) => after === undefined || t.trip.id > after).slice(0, limit);
    },
  };
}
