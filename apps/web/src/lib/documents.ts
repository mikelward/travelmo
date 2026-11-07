"use client";

import {
  peopleDocuments,
  tripWarnings,
  type ExtractedSegment,
  type PersonDocuments,
  type PersonWarning,
  type PlaceLookup,
  type Trip,
} from "@travelmo/core";
import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { useSharedProfiles, useTravelProfile } from "./travelProfile";

export { warningText } from "@travelmo/core";


export function usePeopleDocuments(user: User): readonly PersonDocuments[] | undefined {
  const own = useTravelProfile(user.uid);
  const shared = useSharedProfiles(user);
  return useMemo(() => (own === undefined || !shared ? undefined : peopleDocuments(own, shared, user.uid)), [own, shared, user.uid]);
}

// Warnings for each trip, by id. The airport table, needed to tell whether a
// flight crosses a border, loads only once some trip has a document worth
// checking; until it has, nothing shows, so a warning never flashes up and
// vanishes. If it can't load, the warnings show regardless: a needless one
// is better than a missed one.
export function useTripWarnings(
  people: readonly PersonDocuments[] | undefined,
  trips: readonly Trip[],
  segmentsByTrip: Readonly<Record<string, readonly ExtractedSegment[]>>,
  today: string,
): Record<string, PersonWarning[]> {
  const candidates = useMemo(
    () => (people ? trips.filter((t) => segmentsByTrip[t.id] && tripWarnings(people, t, undefined, today).length) : []),
    [people, trips, segmentsByTrip, today],
  );
  const [lookup, setLookup] = useState<{ airportPlace?: PlaceLookup }>();
  const wanted = candidates.length > 0;
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    import("@travelmo/core/airportPlaces")
      .then((m) => current && setLookup({ airportPlace: m.airportPlace }))
      .catch((error) => {
        console.error("Loading the airport table failed; warning of every document", error);
        if (current) setLookup({});
      });
    return () => {
      current = false;
    };
  }, [wanted]);
  return useMemo(() => {
    if (!people || !lookup) return {};
    return Object.fromEntries(
      candidates.flatMap((t) => {
        const warnings = tripWarnings(people, t, segmentsByTrip[t.id], today, lookup.airportPlace);
        return warnings.length ? [[t.id, warnings]] : [];
      }),
    );
  }, [people, lookup, candidates, segmentsByTrip, today]);
}
