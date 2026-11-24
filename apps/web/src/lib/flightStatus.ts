"use client";

import { FlightStatus, flightRefreshDue, flightStatusKey, flightStatusLines, flightStatusShown, paths, type Segment } from "@travelmo/core";
import type { User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { firestore } from "./firebase";

// The keys of the trip's flights whose status a page shows now.
export function shownFlightKeys(segments: readonly Segment[] | undefined, now: string): string[] {
  const keys = new Set<string>();
  for (const segment of segments ?? []) {
    const key = flightStatusShown(segment, now) ? flightStatusKey(segment) : undefined;
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

// What a flight's row says of its delays, gates and carousel, if anything.
export function flightLinesFor(segment: Segment, statuses: Record<string, FlightStatus>, now: string): string[] | undefined {
  const key = flightStatusShown(segment, now) ? flightStatusKey(segment) : undefined;
  const lines = key ? flightStatusLines(statuses[key], segment) : [];
  return lines.length ? lines : undefined;
}

// The live status of the trip's flights near departure, by flight key: one
// listener per flight, and only for the few flights within a day or so.
export function useFlightStatuses(segments: readonly Segment[] | undefined, now: string): Record<string, FlightStatus> {
  const keys = shownFlightKeys(segments, now).join("\n");
  const [statuses, setStatuses] = useState<Record<string, FlightStatus>>({});
  useEffect(() => {
    if (!keys) return;
    const unsubscribes = keys.split("\n").map((key) =>
      onSnapshot(
        doc(firestore(), paths.flightStatus(key)),
        (s) => {
          const result = FlightStatus.safeParse(s.data());
          setStatuses((before) => {
            if (result.success) return { ...before, [key]: result.data };
            if (s.exists()) console.error(`Malformed flight status ${s.ref.path}`, result.error);
            const { [key]: _gone, ...rest } = before;
            return rest;
          });
        },
        (error) => console.error(`Flight status subscription failed for ${key}`, error),
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [keys]);
  return useMemo(() => {
    const wanted = new Set(keys.split("\n"));
    return Object.fromEntries(Object.entries(statuses).filter(([key]) => wanted.has(key)));
  }, [statuses, keys]);
}

// While the trip page is open and visible, has its flights looked at as
// often as the parser allows (once a minute), so what is on screen at the
// airport is fresh between the scheduled looks.
export function useFlightRefresh(
  user: User,
  tripId: string,
  segments: readonly Segment[] | undefined,
  statuses: Record<string, FlightStatus>,
  now: string,
): void {
  const busy = useRef(false);
  const due = (segments ?? []).some((segment) => {
    const key = flightStatusKey(segment);
    return key !== undefined && flightStatusShown(segment, now) && flightRefreshDue(segment, statuses[key], now);
  });
  useEffect(() => {
    if (!due || busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    api
      .refreshFlights(user, tripId)
      .catch((error) => console.error("Refreshing the trip's flights failed", error))
      .finally(() => {
        busy.current = false;
      });
  }, [due, now, user, tripId]);
}
