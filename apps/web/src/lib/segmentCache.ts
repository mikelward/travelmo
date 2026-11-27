import type { Segment, Trip } from "@travelmo/core";

// Each trip's bookings as read; those that couldn't be read (failed) and those
// read only from the local cache, which can hold some or none of them
// (unconfirmed), are named: nothing is all of a trip's bookings until both are empty.
export type AllSegments = { byTrip: Record<string, Segment[]>; failed: string[]; unconfirmed: string[] };

// Whether every trip's bookings were read and confirmed by the server.
export const allRead = (all: AllSegments) => all.failed.length === 0 && all.unconfirmed.length === 0;

export type SegmentVersion = { updatedAt: string; count: number };

type Manifest = { uid: string; trips: Record<string, SegmentVersion> };

export type SegmentRead = { segments: Segment[]; confirmed: boolean };

export type SegmentReader = {
  fromCache(tripId: string): Promise<Segment[] | undefined>;
  fromStore(tripId: string): Promise<SegmentRead>;
};

const manifestKey = "travelmo.segmentVersions";
const defaultConcurrency = 16;

// In-memory bookings keyed by trip id and updatedAt for the active account so returning
// to Reports, Profile, or search reuses them without re-reading Firestore.
let cacheUid: string | undefined;
let cacheGeneration = 0;
const memoryCache = new Map<string, { updatedAt: string; segments: Segment[] }>();

function readManifest(uid: string): Record<string, SegmentVersion> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(manifestKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Manifest> | null;
    if (!parsed || parsed.uid !== uid || !parsed.trips || typeof parsed.trips !== "object") return {};
    const out: Record<string, SegmentVersion> = {};
    for (const [id, entry] of Object.entries(parsed.trips)) {
      if (entry && typeof entry.updatedAt === "string" && typeof entry.count === "number") {
        out[id] = { updatedAt: entry.updatedAt, count: entry.count };
      }
    }
    return out;
  } catch (error) {
    // Blocked storage or corrupt manifest: fall back to reading from Firestore.
    console.debug("Reading cached trip versions failed", error);
    return {};
  }
}

function writeManifest(uid: string, trips: Record<string, SegmentVersion>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(manifestKey, JSON.stringify({ uid, trips } satisfies Manifest));
  } catch (error) {
    // Blocked or full storage: in-memory cache still works for this tab.
    console.debug("Saving cached trip versions failed", error);
  }
}

export function clearSegmentCache(): void {
  cacheGeneration += 1;
  cacheUid = undefined;
  memoryCache.clear();
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(manifestKey);
  } catch (error) {
    console.debug("Clearing cached trip versions failed", error);
  }
}

// Returns a single trip's cached bookings immediately when it is already in memory
// for this account (at its current `updatedAt` when known), avoiding a loading flash.
export function peekTripSegments(uid: string, tripId: string, updatedAt?: string): Segment[] | undefined {
  if (cacheUid !== uid) return undefined;
  const hit = memoryCache.get(tripId);
  if (!hit) return undefined;
  if (updatedAt && hit.updatedAt !== updatedAt) return undefined;
  return hit.segments;
}

// Returns every requested trip's bookings immediately when all of them are already in memory
// at their current `updatedAt`, avoiding an extra loading flash on navigation.
export function peekAllSegments(uid: string, trips: readonly Pick<Trip, "id" | "updatedAt">[]): AllSegments | undefined {
  if (trips.length === 0) return { byTrip: {}, failed: [], unconfirmed: [] };
  if (cacheUid !== uid) return undefined;
  const byTrip: Record<string, Segment[]> = {};
  for (const trip of trips) {
    const hit = trip.updatedAt ? memoryCache.get(trip.id) : undefined;
    if (!hit || hit.updatedAt !== trip.updatedAt) return undefined;
    byTrip[trip.id] = hit.segments;
  }
  return { byTrip, failed: [], unconfirmed: [] };
}

// Loads every trip's bookings once per `updatedAt` with bounded concurrency, reading unchanged
// trips from Firestore's local cache when the manifest count matches (catching cache eviction).
export async function loadAllSegments(
  uid: string,
  trips: readonly Pick<Trip, "id" | "updatedAt">[],
  reader: SegmentReader,
  concurrency = defaultConcurrency,
): Promise<AllSegments> {
  if (cacheUid !== uid) {
    cacheGeneration += 1;
    cacheUid = uid;
    memoryCache.clear();
  }
  const generation = cacheGeneration;
  if (trips.length === 0) return { byTrip: {}, failed: [], unconfirmed: [] };

  const manifest = readManifest(uid);
  const byTrip: Record<string, Segment[]> = {};
  const failed: string[] = [];
  const unconfirmed: string[] = [];
  const toFetch: Pick<Trip, "id" | "updatedAt">[] = [];

  for (const trip of trips) {
    const hit = trip.updatedAt ? memoryCache.get(trip.id) : undefined;
    if (hit && hit.updatedAt === trip.updatedAt) {
      byTrip[trip.id] = hit.segments;
    } else {
      toFetch.push(trip);
    }
  }

  let manifestChanged = false;
  if (toFetch.length > 0) {
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(concurrency, toFetch.length));
    const worker = async () => {
      while (cursor < toFetch.length) {
        if (generation !== cacheGeneration) return;
        const trip = toFetch[cursor++]!;
        const known = trip.updatedAt ? manifest[trip.id] : undefined;
        let segments: Segment[] | undefined;
        let confirmed = false;
        if (known && known.updatedAt === trip.updatedAt) {
          const cached = await reader.fromCache(trip.id);
          if (cached && cached.length === known.count) {
            segments = cached;
            confirmed = true;
          }
        }
        if (!segments) {
          try {
            const read = await reader.fromStore(trip.id);
            segments = read.segments;
            confirmed = read.confirmed;
          } catch (error) {
            console.error(`Reading segments failed for ${trip.id}`, error);
            failed.push(trip.id);
            continue;
          }
        }
        if (generation !== cacheGeneration) return;
        byTrip[trip.id] = segments;
        if (!confirmed) unconfirmed.push(trip.id);
        if (confirmed && trip.updatedAt) {
          memoryCache.set(trip.id, { updatedAt: trip.updatedAt, segments });
          const next = { updatedAt: trip.updatedAt, count: segments.length };
          const prev = manifest[trip.id];
          if (!prev || prev.updatedAt !== next.updatedAt || prev.count !== next.count) {
            manifest[trip.id] = next;
            manifestChanged = true;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  if (manifestChanged && generation === cacheGeneration && cacheUid === uid) {
    writeManifest(uid, manifest);
  }
  return { byTrip, failed, unconfirmed };
}
