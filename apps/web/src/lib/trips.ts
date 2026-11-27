"use client";

import { CalendarFeed, ParsedMessage, Segment, SenderPatterns, Trip, UserProfile, myAddresses, paths, queryAddresses, flagsUnknown, reviewCacheCoversLatest, tripFlagsToWrite } from "@travelmo/core";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDocsFromCache,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QuerySnapshot,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { z } from "zod";
import { localToday, msUntilNextLocalDay } from "./dates";
import { firestore } from "./firebase";
import { onClearCache, peekLive, peekLivePrefix, subscribeLive, useLiveSubscription } from "./liveCache";
import { loadAllSegments, peekAllSegments, peekTripSegments, type AllSegments } from "./segmentCache";

let parsedMessagesGeneration = 0;
let parsedMessagesCache: { uid: string; cap: number; records: ParsedMessage[]; done: boolean } | undefined;
const repairedTripVersions = new Set<string>();
const pendingRepairs: Array<{ key: string; id: string; kept: KeptFlags }> = [];
const failedRepairJobs = new Map<string, { key: string; id: string; kept: KeptFlags }>();
let activeRepairs = 0;
let onlineRepairListenerAttached = false;
const REPAIR_CONCURRENCY = 4;

onClearCache(() => {
  parsedMessagesGeneration += 1;
  parsedMessagesCache = undefined;
  repairedTripVersions.clear();
  pendingRepairs.length = 0;
  failedRepairJobs.clear();
});

function parseDocs<T extends z.ZodType>(schema: T, snapshot: QuerySnapshot<DocumentData>): z.infer<T>[] {
  const out: z.infer<T>[] = [];
  for (const d of snapshot.docs) {
    const result = schema.safeParse(d.data());
    if (result.success) out.push(result.data);
    else console.error(`Skipping malformed document ${d.ref.path}`, result.error);
  }
  return out;
}

export function useTrips(user: User, enabled = true): Trip[] | undefined {
  // Shared with any of the user's addresses (SPEC "Linked email addresses"),
  // in one query; keyed by the list, so a newly linked address re-queries.
  const addresses = queryAddresses(useAddresses(user)).join("\n");

  const own = useLiveSubscription<Trip[]>(
    enabled ? `trips:own:${user.uid}` : undefined,
    (emit, fail) =>
      onSnapshot(
        query(collection(firestore(), paths.trips()), where("ownerUid", "==", user.uid)),
        (s) => emit(parseDocs(Trip, s)),
        (error) => {
          console.error("Trips subscription failed", error);
          fail();
        },
      ),
  );

  const sharedWithMe = useLiveSubscription<Trip[]>(
    enabled && addresses ? `trips:shared:${user.uid}:${addresses}` : undefined,
    (emit, fail) =>
      onSnapshot(
        query(collection(firestore(), paths.trips()), where("sharedWith", "array-contains-any", addresses.split("\n"))),
        (s) => emit(parseDocs(Trip, s)),
        (error) => {
          console.error("Shared trips subscription failed", error);
          fail();
        },
      ),
  );

  return useMemo(() => {
    if (!enabled) return undefined;
    const shared = addresses ? sharedWithMe : [];
    if (!own || !shared) return undefined;
    const byId = new Map<string, Trip>();
    for (const trip of [...own, ...shared]) byId.set(trip.id, trip);
    return [...byId.values()];
  }, [enabled, own, sharedWithMe, addresses]);
}

export function useTrip(tripId: string, uid?: string): Trip | null | undefined {
  const live = useLiveSubscription<Trip | null>(
    `trip:${tripId}`,
    (emit, fail) =>
      onSnapshot(
        doc(firestore(), paths.trip(tripId)),
        (s) => {
          if (!s.exists()) return emit(null);
          const result = Trip.safeParse(s.data());
          if (result.success) emit(result.data);
          else console.error(`Malformed trip ${s.ref.path}`, result.error);
        },
        (error) => {
          console.error("Trip subscription failed", error);
          fail({ value: null });
        },
      ),
  );
  if (live !== undefined) return live;
  if (!uid) return undefined;
  const cachedOwn = peekLive<Trip[]>(`trips:own:${uid}`);
  const fromOwn = cachedOwn?.find((t) => t.id === tripId);
  if (fromOwn) return fromOwn;
  for (const shared of peekLivePrefix<Trip[]>(`trips:shared:${uid}:`)) {
    const match = shared.find((t) => t.id === tripId);
    if (match) return match;
  }
  return undefined;
}

export function useSegments(tripId: string, uid?: string, updatedAt?: string): Segment[] | undefined {
  const live = useLiveSubscription<Segment[]>(
    `segments:${tripId}`,
    (emit, fail) =>
      onSnapshot(
        query(collection(firestore(), paths.segments(tripId)), orderBy("start")),
        (s) => emit(parseDocs(Segment, s)),
        (error) => {
          console.error("Segments subscription failed", error);
          fail();
        },
      ),
  );
  if (live !== undefined) return live;
  return uid ? peekTripSegments(uid, tripId, updatedAt) : undefined;
}

const emptyByTrip: Record<string, Segment[]> = {};
const emptyByTripServerSnapshot = () => emptyByTrip;

// Segments of a few trips at once, for the list's "next up" line. Shares the
// same liveCache streams as `useSegments`, so opening a detailed trip from the
// list renders immediately without attaching a duplicate Firestore listener.
export function useSegmentsOf(tripIds: readonly string[]): Record<string, Segment[]> {
  const key = [...new Set(tripIds)].join("\n");
  const snapshotRef = useRef<{ key: string; value: Record<string, Segment[]> }>({ key: "", value: emptyByTrip });
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const ids = key ? key.split("\n") : [];
      const unsubscribes = ids.map((tripId) =>
        subscribeLive<Segment[]>(
          `segments:${tripId}`,
          (emit, fail) =>
            onSnapshot(
              query(collection(firestore(), paths.segments(tripId)), orderBy("start")),
              (s) => emit(parseDocs(Segment, s)),
              (error) => {
                console.error(`Segments subscription failed for ${tripId}`, error);
                fail();
              },
            ),
          onStoreChange,
        ),
      );
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
    [key],
  );
  const getSnapshot = useCallback(() => {
    const ids = key ? key.split("\n") : [];
    const prev = snapshotRef.current;
    if (prev.key === key) {
      let count = 0;
      let same = true;
      for (const id of ids) {
        const live = peekLive<Segment[]>(`segments:${id}`);
        if (live !== undefined) count += 1;
        if (prev.value[id] !== live) {
          same = false;
          break;
        }
      }
      if (same && Object.keys(prev.value).length === count) return prev.value;
    }
    const next: Record<string, Segment[]> = {};
    for (const id of ids) {
      const live = peekLive<Segment[]>(`segments:${id}`);
      if (live !== undefined) next[id] = live;
    }
    const value = Object.keys(next).length === 0 ? emptyByTrip : next;
    snapshotRef.current = { key, value };
    return value;
  }, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, emptyByTripServerSnapshot);
}

// These trips' bookings, each read once per version of the trip (its
// `updatedAt`, which every booking change moves) with bounded concurrency and
// shared version caching: one already read isn't read again while it stays as
// it was.
export function useSegmentsOnce(
  trips: readonly Pick<Trip, "id" | "updatedAt">[] | undefined,
  uid = "",
): Record<string, Segment[]> {
  const all = useAllSegments(trips && trips.length > 0 ? trips : undefined, uid);
  return all?.byTrip ?? emptyByTrip;
}

export type { AllSegments } from "./segmentCache";

// Every trip's segments, read once per trip version with bounded concurrency
// rather than listened to: unchanged trips are reused from memory or
// Firestore's local cache when the manifest count matches. Undefined until
// every read has finished; a read that failed is named, not left out.
export function useAllSegments(trips: readonly Pick<Trip, "id" | "updatedAt">[] | undefined, uid: string): AllSegments | undefined {
  const [result, setResult] = useState<{ key: string; value: AllSegments; incomplete: boolean }>();
  const [retry, setRetry] = useState(0);
  const key = trips
    ? `${uid}\n${trips
        .map((t) => `${t.id}@${t.updatedAt}`)
        .sort()
        .join("\n")}`
    : undefined;
  const versions = useMemo(() => {
    if (key === undefined) return undefined;
    const lines = key.split("\n").slice(1);
    return lines.filter(Boolean).map((line) => {
      const at = line.lastIndexOf("@");
      return { id: line.slice(0, at), updatedAt: line.slice(at + 1) };
    });
  }, [key]);
  const cached = useMemo(() => (versions ? peekAllSegments(uid, versions) : undefined), [uid, versions]);

  useEffect(() => {
    if (key === undefined || !versions || cached) return;
    let current = true;
    let unconfirmed = false;
    const reader = {
      fromCache: async (tripId: string) => {
        try {
          const s = await getDocsFromCache(query(collection(firestore(), paths.segments(tripId)), orderBy("start")));
          return parseDocs(Segment, s);
        } catch (error) {
          // Cache miss or eviction; caller falls back to a normal read.
          console.debug(`Cached segments read missed for ${tripId}`, error);
          return undefined;
        }
      },
      fromStore: async (tripId: string) => {
        const s = await getDocs(query(collection(firestore(), paths.segments(tripId)), orderBy("start")));
        const confirmed = !s.metadata.fromCache;
        if (!confirmed) unconfirmed = true;
        return { segments: parseDocs(Segment, s), confirmed };
      },
    };
    void loadAllSegments(uid, versions, reader).then((value) => {
      if (current) setResult({ key, value, incomplete: unconfirmed || value.failed.length > 0 });
    });
    return () => {
      current = false;
    };
  }, [key, uid, versions, cached, retry]);

  // Any trip read unconfirmed from offline cache or that failed stays out of the
  // version cache; retry automatically when the browser reconnects.
  const needsRefresh = Boolean(result && result.key === key && result.incomplete);
  useEffect(() => {
    if (!needsRefresh) return;
    const onOnline = () => setRetry((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [needsRefresh]);

  if (cached) return cached;
  // A result for another set of trips is not shown for this one.
  return result && result.key === key ? result.value : undefined;
}

// The current instant, refreshed on an interval so "next up" lines move on
// as events pass without anything else changing.
export function useNow(intervalMs = 60_000, enabled = true): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(new Date().toISOString());
    const immediate = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, enabled]);
  return now;
}

// Today's local YYYY-MM-DD date, updating at local midnight (and when the tab
// becomes visible again) so trips roll into "Now" overnight even when no
// minute-by-minute timer is active.
export function useLocalToday(): string {
  const [today, setToday] = useState(() => localToday());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        setToday(localToday());
        schedule();
      }, msUntilNextLocalDay());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setToday(localToday());
        schedule();
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}

// Every address that is the user's: the sign-in, then those confirmed and
// the connected Gmail, from the user document as it arrives.
export function useAddresses(user: User): string[] {
  const profile = useProfile(user.uid);
  const signIn = user.emailVerified ? user.email : undefined;
  const key = myAddresses(signIn, profile).join("\n");
  return useMemo(() => (key ? key.split("\n") : []), [key]);
}

export function useProfile(uid: string): UserProfile | undefined {
  return useLiveSubscription<UserProfile>(
    `profile:${uid}`,
    (emit, fail) =>
      onSnapshot(
        doc(firestore(), paths.user(uid)),
        (s) => {
          const result = UserProfile.safeParse(s.data() ?? {});
          if (result.success) emit(result.data);
          else console.error(`Malformed profile ${s.ref.path}`, result.error);
        },
        (error) => {
          console.error("Profile subscription failed", error);
          fail();
        },
      ),
  );
}

// The most recent import decisions, newest first; the caller filters by
// outcome so no composite index is needed.
// The newest records first, optionally only those processed in [start, end).
// Every import record, newest first, read in pages while `enabled` (a
// search), up to `cap`: one import can read thousands of emails, more than
// the review list shows. `done` once all are read; a failed read stops it
// with what was read so far. Server-confirmed completed reads stay in memory
// for the session until new imports advance past the live `latest` window,
// so clearing and re-typing a search does not re-read up to 20,000 docs.
export function useAllParsedMessages(
  uid: string,
  enabled: boolean,
  latest?: readonly ParsedMessage[],
  latestWindow = 100,
  cap = 20_000,
): { records: ParsedMessage[]; done: boolean } | undefined {
  const cacheMatches = parsedMessagesCache && parsedMessagesCache.uid === uid && parsedMessagesCache.cap === cap && parsedMessagesCache.done;
  const cacheStale = Boolean(cacheMatches && !reviewCacheCoversLatest(parsedMessagesCache!.records, latest, latestWindow));
  const cached = cacheMatches && !cacheStale ? parsedMessagesCache : undefined;
  const [state, setState] = useState<{ uid: string; records: ParsedMessage[]; done: boolean; confirmed: boolean } | undefined>(
    cached ? { ...cached, confirmed: true } : undefined,
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (cacheStale && parsedMessagesCache?.uid === uid && parsedMessagesCache.cap === cap) {
      parsedMessagesCache = undefined;
    }
  }, [cacheStale, uid, cap]);
  useEffect(() => {
    if (!enabled || cached) return;
    let cancelled = false;
    const generation = parsedMessagesGeneration;
    const page = 1000;
    void (async () => {
      const records: ParsedMessage[] = [];
      let last: QuerySnapshot<DocumentData>["docs"][number] | undefined;
      let confirmed = true;
      try {
        for (;;) {
          const base = collection(firestore(), `${paths.user(uid)}/parsedMessages`);
          const snapshot = await getDocs(query(base, orderBy("processedAt", "desc"), ...(last ? [startAfter(last)] : []), limit(page)));
          if (cancelled || generation !== parsedMessagesGeneration) return;
          if (snapshot.metadata.fromCache) confirmed = false;
          records.push(...parseDocs(ParsedMessage, snapshot));
          last = snapshot.docs.at(-1);
          const done = snapshot.size < page || records.length >= cap;
          const next = { uid, records: [...records], done, confirmed: done && confirmed };
          if (done && confirmed && generation === parsedMessagesGeneration) parsedMessagesCache = { uid, records: next.records, done, cap };
          setState(next);
          if (done) return;
        }
      } catch (error) {
        console.error("Reading import records for a search failed", error);
        if (!cancelled && generation === parsedMessagesGeneration) setState({ uid, records: [...records], done: true, confirmed: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, enabled, cap, cached, retry]);
  const needsRetry = Boolean(enabled && !cached && state?.uid === uid && state.done && !state.confirmed);
  useEffect(() => {
    if (!needsRetry) return;
    const onOnline = () => setRetry((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [needsRetry]);
  if (!enabled) return undefined;
  if (cached) return cached;
  return state?.uid === uid ? state : undefined;
}

// The `max` most recently read import records, newest first.
export function useParsedMessages(uid: string, max = 100): ParsedMessage[] | undefined {
  return useLiveSubscription<ParsedMessage[]>(
    `parsedMessages:${uid}:${max}`,
    (emit, fail) =>
      onSnapshot(
        query(collection(firestore(), `${paths.user(uid)}/parsedMessages`), orderBy("processedAt", "desc"), limit(max)),
        (s) => emit(parseDocs(ParsedMessage, s)),
        (error) => {
          console.error("Parsed messages subscription failed", error);
          fail();
        },
      ),
  );
}

export function useFeeds(uid: string): CalendarFeed[] | undefined {
  return useLiveSubscription<CalendarFeed[]>(
    `feeds:${uid}`,
    (emit, fail) =>
      onSnapshot(
        query(collection(firestore(), paths.feeds(uid)), orderBy("addedAt")),
        (s) => emit(parseDocs(CalendarFeed, s)),
        (error) => {
          console.error("Feeds subscription failed", error);
          fail();
        },
      ),
  );
}

export function useSenderPatterns(uid: string, enabled = true): SenderPatterns | undefined {
  return useLiveSubscription<SenderPatterns>(
    enabled ? `senderPatterns:${uid}` : undefined,
    (emit, fail) =>
      onSnapshot(
        doc(firestore(), paths.senderPatterns(uid)),
        (s) => {
          const result = SenderPatterns.safeParse(s.data() ?? {});
          if (result.success) emit(result.data);
          else console.error(`Malformed patterns ${s.ref.path}`, result.error);
        },
        (error) => {
          console.error("Patterns subscription failed", error);
          fail();
        },
      ),
  );
}

function ensureOnlineRepairListener(): void {
  if (onlineRepairListenerAttached || typeof window === "undefined") return;
  onlineRepairListenerAttached = true;
  window.addEventListener("online", () => {
    if (failedRepairJobs.size === 0) return;
    for (const job of failedRepairJobs.values()) pendingRepairs.push(job);
    failedRepairJobs.clear();
    drainRepairQueue();
  });
}

function drainRepairQueue(): void {
  ensureOnlineRepairListener();
  while (activeRepairs < REPAIR_CONCURRENCY && pendingRepairs.length > 0) {
    const job = pendingRepairs.shift()!;
    const generation = parsedMessagesGeneration;
    activeRepairs += 1;
    void repairTripFlags(job.id, job.kept)
      .then(() => {
        if (generation === parsedMessagesGeneration) failedRepairJobs.delete(job.id);
      })
      .catch((error: unknown) => {
        if (generation === parsedMessagesGeneration) failedRepairJobs.set(job.id, job);
        console.warn(`Keeping trip ${job.id}'s list flags failed`, error);
      })
      .finally(() => {
        activeRepairs -= 1;
        drainRepairQueue();
      });
  }
}

// Keeps the flags the trip list filters by (`allCancelled`, `localOnly`,
// `travelers`, listFilters.ts) and its picture's `setting` true to the bookings just read: after an edit, and for a
// trip from before they were kept. Only a trip the viewer may write (theirs
// or shared with them) and not being deleted; a refusal is logged, and the
// list reads the bookings instead. Bookings read once (`once`, a search's
// or a filter's) may be older than flags the parser wrote since, so they
// only fill flags in where a trip has none.
export function useKeepTripFlags(
  trips: readonly Trip[] | null | undefined,
  segmentsOf: (tripId: string) => readonly Segment[] | undefined,
  once = false,
): void {
  // Each (tripId, updatedAt, currentFlags) is attempted at most once per
  // session with bounded concurrency, preventing O(N^2) repair storms as
  // trips load or finish repairing.
  const due = (trips ?? []).flatMap((trip) => {
    const segments = trip.deleting || (once && !flagsUnknown(trip)) ? undefined : segmentsOf(trip.id);
    if (!segments || !tripFlagsToWrite(trip, segments)) return [];
    const repairKey = `${trip.id}@${trip.updatedAt}`;
    if (repairedTripVersions.has(repairKey)) return [];
    return [{ key: repairKey, id: trip.id, allCancelled: trip.allCancelled, localOnly: trip.localOnly, travelers: trip.travelers, setting: trip.setting }];
  });
  const key = due.length > 0 ? JSON.stringify(due) : "";
  useEffect(() => {
    if (!key) return;
    for (const { key: repairKey, id, ...kept } of JSON.parse(key) as ({ key: string; id: string } & KeptFlags)[]) {
      if (repairedTripVersions.has(repairKey)) continue;
      repairedTripVersions.add(repairKey);
      failedRepairJobs.delete(id);
      pendingRepairs.push({ key: repairKey, id, kept });
    }
    drainRepairQueue();
  }, [key]);
}

// What a listener gave may be the offline cache's part: the flags are
// written only from the server's whole answer, not while offline, and only
// if no booking changed meanwhile (the trip's `updatedAt` moved); a change
// then is left to be read again.
// What a trip says of its bookings, as useKeepTripFlags reads it.
type KeptFlags = Pick<Trip, "allCancelled" | "localOnly" | "travelers" | "setting">;

async function repairTripFlags(id: string, kept: KeptFlags): Promise<void> {
  const db = firestore();
  const tripRef = doc(db, paths.trip(id));
  const revision = (await getDocFromServer(tripRef)).get("updatedAt") as unknown;
  if (typeof revision !== "string") return;
  const flags = tripFlagsToWrite(kept, parseDocs(Segment, await getDocsFromServer(query(collection(db, paths.segments(id))))));
  if (!flags) return;
  const written = await runTransaction(db, async (t) => {
    const now = await t.get(tripRef);
    if (now.get("updatedAt") !== revision || now.get("deleting") === true) return false;
    t.update(tripRef, flags);
    return true;
  });
  if (!written) console.info(`Trip ${id}'s bookings changed while its list flags were read; left for the next read`);
}
