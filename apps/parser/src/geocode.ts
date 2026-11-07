import { GeocodeError, geocodeKey, parseGeocodeResponse, paths, type GeocodeLookup, type GeocodeNeed, type GeocodeResult } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";

// Google's Geocoding API behind a shared cache and a daily budget: an import
// asks about a place name once ever, and a runaway import (a backfill of a
// whole mailbox) cannot run up a bill. Without a key the step is off.

export type Geocoder = (query: string) => Promise<GeocodeResult | "none">;

const endpoint = "https://maps.googleapis.com/maps/api/geocode/json";
export const geocodeTimeoutMs = 5000;

// The key never reaches a log line: errors are reported by status.
const scrub = (text: string) => text.replace(/key=[^&\s]+/g, "key=…");

export function googleGeocoder(key: string, fetchFn: typeof fetch = fetch): Geocoder {
  return async (query) => {
    const url = `${endpoint}?${new URLSearchParams({ address: query, key })}`;
    let response: Response;
    try {
      response = await fetchFn(url, { signal: AbortSignal.timeout(geocodeTimeoutMs) });
    } catch (error) {
      throw new GeocodeError("UNREACHABLE", scrub((error as Error).message));
    }
    if (!response.ok) throw new GeocodeError(`HTTP_${response.status}`);
    return parseGeocodeResponse(await response.json());
  };
}

export type GeocodeEntry = { query: string; status: "ok" | "none"; country?: string; city?: string; lat?: number; lon?: number; at: string };

export type GeocodeStore = {
  get(key: string): Promise<GeocodeEntry | undefined>;
  put(key: string, entry: GeocodeEntry): Promise<void>;
  // Takes one of the day's calls; false when the day's budget is spent.
  reserve(day: string, limit: number): Promise<boolean>;
};

export function firestoreGeocodeStore(db: Firestore): GeocodeStore {
  return {
    async get(key) {
      const snap = await db.doc(paths.geocode(key)).get();
      return snap.exists ? (snap.data() as GeocodeEntry) : undefined;
    },
    async put(key, entry) {
      await db.doc(paths.geocode(key)).set(entry);
    },
    reserve(day, limit) {
      const ref = db.doc(paths.geocodeBudget(day));
      return db.runTransaction(async (t) => {
        const calls = ((await t.get(ref)).data()?.calls as number | undefined) ?? 0;
        if (calls >= limit) return false;
        t.set(ref, { calls: calls + 1 }, { merge: true });
        return true;
      });
    },
  };
}

export type CachedGeocoderOptions = {
  store: GeocodeStore;
  geocoder: Geocoder;
  // Calls a day across every user; the free allowance is monthly. A place
  // that has its country and wants only coordinates may use half of it.
  limit: number;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export const defaultDailyLimit = 300;

// What a place lacking only coordinates may spend of the day's calls, so
// the countries the reports need are never crowded out by dots on the map.
export const locationShare = (limit: number) => Math.ceil(limit / 2);

const fromEntry = (cached: GeocodeEntry): GeocodeResult | "none" =>
  cached.status === "ok" && cached.country
    ? {
        country: cached.country,
        ...(cached.city ? { city: cached.city } : {}),
        ...(cached.lat !== undefined && cached.lon !== undefined ? { lat: cached.lat, lon: cached.lon } : {}),
      }
    : "none";

// Cache first (a "none" is an answer too), then one of the day's calls, then
// Google. A spent budget answers "none" without caching, so tomorrow's import
// asks again; a failure is thrown for the caller to log and move past.
export function cachedGeocoder({ store, geocoder, limit, now, log }: CachedGeocoderOptions): GeocodeLookup {
  const exhausted = new Map<GeocodeNeed, string>();
  return async (query, need) => {
    const key = geocodeKey(query);
    const cached = await store.get(key);
    if (cached) return fromEntry(cached);
    const day = now().slice(0, 10);
    const allowed = need === "location" ? locationShare(limit) : limit;
    if (!(await store.reserve(day, allowed))) {
      if (exhausted.get(need) !== day) {
        exhausted.set(need, day);
        log("geocode_budget_exhausted", { day, need, limit: allowed });
      }
      return "none";
    }
    try {
      const result = await geocoder(query);
      await store.put(key, result === "none" ? { query, status: "none", at: now() } : { query, status: "ok", ...result, at: now() });
      return result;
    } catch (error) {
      const status = error instanceof GeocodeError ? error.status : "ERROR";
      log("geocode_failed", { status, reason: scrub((error as Error).message) });
      throw error;
    }
  };
}

// For tests and the in-memory path.
export function memoryGeocodeStore(): GeocodeStore & { entries: Map<string, GeocodeEntry>; calls: Map<string, number> } {
  const entries = new Map<string, GeocodeEntry>();
  const calls = new Map<string, number>();
  return {
    entries,
    calls,
    async get(key) {
      return entries.get(key);
    },
    async put(key, entry) {
      entries.set(key, entry);
    },
    async reserve(day, limit) {
      const used = calls.get(day) ?? 0;
      if (used >= limit) return false;
      calls.set(day, used + 1);
      return true;
    },
  };
}
