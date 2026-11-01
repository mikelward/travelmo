"use client";

import { ParsedMessage, Segment, SenderPatterns, Trip, UserProfile, paths } from "@travelmo/core";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
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
  const email = user.email?.toLowerCase();

  useEffect(() => {
    return onSnapshot(
      query(collection(firestore(), paths.trips()), where("ownerUid", "==", user.uid)),
      (s) => setOwn(parseDocs(Trip, s)),
      (error) => console.error("Trips subscription failed", error),
    );
  }, [user.uid]);

  useEffect(() => {
    if (!email) return;
    return onSnapshot(
      query(collection(firestore(), paths.trips()), where("sharedWith", "array-contains", email)),
      (s) => setSharedWithMe(parseDocs(Trip, s)),
      (error) => console.error("Shared trips subscription failed", error),
    );
  }, [email]);

  return useMemo(() => {
    const shared = email ? sharedWithMe : [];
    if (!own || !shared) return undefined;
    const byId = new Map<string, Trip>();
    for (const trip of [...own, ...shared]) byId.set(trip.id, trip);
    return [...byId.values()];
  }, [own, sharedWithMe, email]);
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
// listener per trip, so callers keep the set small.
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
  return byTrip;
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
export function useParsedMessages(uid: string, max = 100): ParsedMessage[] | undefined {
  const [records, setRecords] = useState<ParsedMessage[]>();
  useEffect(() => {
    return onSnapshot(
      query(collection(firestore(), `${paths.user(uid)}/parsedMessages`), orderBy("processedAt", "desc"), limit(max)),
      (s) => setRecords(parseDocs(ParsedMessage, s)),
      (error) => console.error("Parsed messages subscription failed", error),
    );
  }, [uid, max]);
  return records;
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
