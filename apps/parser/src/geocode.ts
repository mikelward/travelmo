import { GeocodeError, geocodeKey, parseGeocodeResponse, paths, type GeocodeLookup, type GeocodeResult } from "@travelmo/core";
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

export type GeocodeEntry = { query: string; status: "ok" | "none"; country?: string; city?: string; at: string };

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
  // Calls a day across every user; the free allowance is monthly.
  limit: number;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export const defaultDailyLimit = 300;

// Cache first (a "none" is an answer too), then one of the day's calls, then
// Google. A spent budget answers "none" without caching, so tomorrow's import
// asks again; a failure is thrown for the caller to log and move past.
export function cachedGeocoder({ store, geocoder, limit, now, log }: CachedGeocoderOptions): GeocodeLookup {
  let exhaustedDay: string | undefined;
  return async (query) => {
    const key = geocodeKey(query);
    const cached = await store.get(key);
    if (cached) return cached.status === "ok" && cached.country ? { country: cached.country, ...(cached.city ? { city: cached.city } : {}) } : "none";
    const day = now().slice(0, 10);
    if (!(await store.reserve(day, limit))) {
      if (exhaustedDay !== day) {
        exhaustedDay = day;
        log("geocode_budget_exhausted", { day, limit });
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
