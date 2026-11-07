import { enrichSegments, fillAirports, needsGeocoding, paths, type Segment } from "@travelmo/core";
import { airportPlace } from "@travelmo/core/airportPlaces";
import type { Firestore } from "firebase-admin/firestore";
import type { ImportDeps } from "./importer";

// A second chance for the places a spent daily budget left without a
// country or a spot. An import that was put off records the booking here;
// the daily sweep asks again, writes what it learns under the user's lock
// (and only if nobody edited the booking meanwhile), and drops the entry
// once every place is answered, the booking is gone, or it is too old.

export type GeocodeRetry = { uid: string; tripId: string; segmentId: string; at: string };

export type RetryStore = {
  put(entry: GeocodeRetry): Promise<void>;
  // Oldest first.
  list(limit: number): Promise<GeocodeRetry[]>;
  delete(entry: Pick<GeocodeRetry, "tripId" | "segmentId">): Promise<void>;
};

export function firestoreRetryStore(db: Firestore): RetryStore {
  return {
    async put(entry) {
      await db.doc(paths.geocodeRetry(entry.tripId, entry.segmentId)).set(entry);
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
