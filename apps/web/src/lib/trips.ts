"use client";

import { CalendarFeed, ParsedMessage, Segment, SenderPatterns, Trip, UserProfile, myAddresses, paths, queryAddresses } from "@travelmo/core";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { firestore } from "./firebase";

function parseDocs<T extends z.ZodType>(schema: T, snapshot: QuerySnapshot<DocumentData>): z.infer<T>[] {
  const out: z.infer<T>[] = [];
  for (const d of snapshot.docs) {
    const result = schema.safeParse(d.data());
    if (result.success) out.push(result.data);
    else console.error(`Skipping malformed document ${d.ref.path}`, result.error);
  }
  return out;
}

export function useTrips(user: User): Trip[] | undefined {
  const [own, setOwn] = useState<Trip[]>();
  const [sharedWithMe, setSharedWithMe] = useState<Trip[]>();
  // Shared with any of the user's addresses (SPEC "Linked email addresses"),
  // in one query; keyed by the list, so a newly linked address re-queries.
  const addresses = queryAddresses(useAddresses(user)).join("\n");

  useEffect(() => {
    return onSnapshot(
      query(collection(firestore(), paths.trips()), where("ownerUid", "==", user.uid)),
      (s) => setOwn(parseDocs(Trip, s)),
      (error) => console.error("Trips subscription failed", error),
    );
  }, [user.uid]);

  useEffect(() => {
    if (!addresses) return;
    return onSnapshot(
      query(collection(firestore(), paths.trips()), where("sharedWith", "array-contains-any", addresses.split("\n"))),
      (s) => setSharedWithMe(parseDocs(Trip, s)),
      (error) => console.error("Shared trips subscription failed", error),
    );
  }, [addresses]);

  return useMemo(() => {
    const shared = addresses ? sharedWithMe : [];
    if (!own || !shared) return undefined;
    const byId = new Map<string, Trip>();
    for (const trip of [...own, ...shared]) byId.set(trip.id, trip);
    return [...byId.values()];
  }, [own, sharedWithMe, addresses]);
}

export function useTrip(tripId: string): Trip | null | undefined {
  const [trip, setTrip] = useState<Trip | null>();
  useEffect(() => {
    return onSnapshot(
      doc(firestore(), paths.trip(tripId)),
      (s) => {
        if (!s.exists()) return setTrip(null);
        const result = Trip.safeParse(s.data());
        if (result.success) setTrip(result.data);
        else console.error(`Malformed trip ${s.ref.path}`, result.error);
      },
      (error) => {
        console.error("Trip subscription failed", error);
        setTrip(null);
      },
    );
  }, [tripId]);
  return trip;
}

export function useSegments(tripId: string): Segment[] | undefined {
  const [segments, setSegments] = useState<Segment[]>();
  useEffect(() => {
    return onSnapshot(
      query(collection(firestore(), paths.segments(tripId)), orderBy("start")),
      (s) => setSegments(parseDocs(Segment, s)),
      (error) => console.error("Segments subscription failed", error),
    );
  }, [tripId]);
  return segments;
}

// Segments of a few trips at once, for the list's "next up" line. One
// listener per trip, so callers keep the set small. Only trips still asked
// for are returned: a trip that dropped out of the set has no listener, so
// its cached segments could go stale.
export function useSegmentsOf(tripIds: readonly string[]): Record<string, Segment[]> {
  const [byTrip, setByTrip] = useState<Record<string, Segment[]>>({});
  const key = tripIds.join("\n");
  useEffect(() => {
    const ids = key ? key.split("\n") : [];
    const unsubscribes = ids.map((tripId) =>
      onSnapshot(
        query(collection(firestore(), paths.segments(tripId)), orderBy("start")),
        (s) => setByTrip((current) => ({ ...current, [tripId]: parseDocs(Segment, s) })),
        (error) => console.error(`Segments subscription failed for ${tripId}`, error),
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [key]);
  return useMemo(() => {
    const ids = key ? key.split("\n") : [];
    return Object.fromEntries(ids.flatMap((id) => (byTrip[id] ? [[id, byTrip[id]]] : [])));
  }, [byTrip, key]);
}

export type AllSegments = { byTrip: Record<string, Segment[]>; failed: string[] };

// Every trip's segments, read once rather than listened to: the reports
// page reads all of them, too many for a listener each. Undefined until
// every read has finished; a read that failed is named, not left out.
export function useAllSegments(tripIds: readonly string[] | undefined): AllSegments | undefined {
  const [result, setResult] = useState<{ key: string; value: AllSegments }>();
  const key = tripIds?.join("\n");
  useEffect(() => {
    if (key === undefined) return;
    let current = true;
    const ids = key ? key.split("\n") : [];
    Promise.all(
      ids.map((tripId) =>
        getDocs(query(collection(firestore(), paths.segments(tripId)), orderBy("start"))).then(
          (s) => ({ tripId, segments: parseDocs(Segment, s) }),
          (error: unknown) => {
            console.error(`Reading segments failed for ${tripId}`, error);
            return { tripId, segments: undefined };
          },
        ),
      ),
    ).then((reads) => {
      if (!current) return;
      const byTrip: Record<string, Segment[]> = {};
      const failed: string[] = [];
      for (const { tripId, segments } of reads) {
        if (segments) byTrip[tripId] = segments;
        else failed.push(tripId);
      }
      setResult({ key, value: { byTrip, failed } });
    });
    return () => {
      current = false;
    };
  }, [key]);
  // A result for another set of trips is not shown for this one.
  return result && result.key === key ? result.value : undefined;
}

// The current instant, refreshed on an interval so "next up" lines move on
// as events pass without anything else changing.
export function useNow(intervalMs = 60_000): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
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
  const [profile, setProfile] = useState<UserProfile>();
  useEffect(() => {
    return onSnapshot(
      doc(firestore(), paths.user(uid)),
      (s) => {
        const result = UserProfile.safeParse(s.data() ?? {});
        if (result.success) setProfile(result.data);
        else console.error(`Malformed profile ${s.ref.path}`, result.error);
      },
      (error) => console.error("Profile subscription failed", error),
    );
  }, [uid]);
  return profile;
}

// The most recent import decisions, newest first; the caller filters by
// outcome so no composite index is needed.
// The newest records first, optionally only those processed in [start, end).
export function useParsedMessages(uid: string, max = 100, range: { start?: string; end?: string } = {}): ParsedMessage[] | undefined {
  const { start, end } = range;
  // Tagged with the query they answer, so a new range shows as loading
  // rather than the old range's records.
  const key = `${uid}|${max}|${start ?? ""}|${end ?? ""}`;
  const [loaded, setLoaded] = useState<{ key: string; records: ParsedMessage[] }>();
  useEffect(() => {
    const bounds = [...(start ? [where("processedAt", ">=", start)] : []), ...(end ? [where("processedAt", "<", end)] : [])];
    return onSnapshot(
      query(collection(firestore(), `${paths.user(uid)}/parsedMessages`), ...bounds, orderBy("processedAt", "desc"), limit(max)),
      (s) => setLoaded({ key, records: parseDocs(ParsedMessage, s) }),
      (error) => console.error("Parsed messages subscription failed", error),
    );
  }, [key, uid, max, start, end]);
  return loaded?.key === key ? loaded.records : undefined;
}

export function useFeeds(uid: string): CalendarFeed[] | undefined {
  const [feeds, setFeeds] = useState<CalendarFeed[]>();
  useEffect(() => {
    return onSnapshot(
      query(collection(firestore(), paths.feeds(uid)), orderBy("addedAt")),
      (s) => setFeeds(parseDocs(CalendarFeed, s)),
      (error) => console.error("Feeds subscription failed", error),
    );
  }, [uid]);
  return feeds;
}

export function useSenderPatterns(uid: string): SenderPatterns | undefined {
  const [patterns, setPatterns] = useState<SenderPatterns>();
  useEffect(() => {
    return onSnapshot(
      doc(firestore(), paths.senderPatterns(uid)),
      (s) => {
        const result = SenderPatterns.safeParse(s.data() ?? {});
        if (result.success) setPatterns(result.data);
        else console.error(`Malformed patterns ${s.ref.path}`, result.error);
      },
      (error) => console.error("Patterns subscription failed", error),
    );
  }, [uid]);
  return patterns;
}
