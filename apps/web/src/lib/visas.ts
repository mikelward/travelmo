"use client";

import { onTrip, travelerEntry, tripPlaces, type PersonDocuments, type ExtractedSegment, type PlaceLookup, type TravelerEntry, type Trip, type VisaTable } from "@travelmo/core";
import { useEffect, useMemo, useState } from "react";

export type PersonEntry = { person: PersonDocuments; entry: TravelerEntry };
export type EntryRequirementsOf = { entries: PersonEntry[]; fetched: string };

// What each person on a trip still ahead needs to enter its countries. The
// visa and airport tables load only once a trip has someone with a passport
// and bookings to place; without a known country, or with every country
// home, there is nothing to show.
export function useEntryRequirements(
  people: readonly PersonDocuments[] | undefined,
  trip: Trip | null | undefined,
  segments: readonly ExtractedSegment[] | undefined,
  today: string,
): EntryRequirementsOf | undefined {
  const travelers = useMemo(
    () => (people && trip && trip.end >= today ? people.filter((p) => onTrip(p, trip) && p.documents.some((d) => d.kind === "passport" && d.country)) : []),
    [people, trip, today],
  );
  const wanted = travelers.length > 0 && !!segments?.length;
  const [tables, setTables] = useState<{ visa: VisaTable; airportPlace: PlaceLookup } | Error>();
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    Promise.all([import("@travelmo/core/visaRules"), import("@travelmo/core/airportPlaces")])
      .then(([v, a]) => current && setTables({ visa: v.visaTable, airportPlace: a.airportPlace }))
      .catch((error: Error) => {
        console.error("Loading the entry rules failed", error);
        if (current) setTables(error);
      });
    return () => {
      current = false;
    };
  }, [wanted]);
  return useMemo(() => {
    if (!wanted || !trip || !segments || !tables || tables instanceof Error) return undefined;
    const { countries } = tripPlaces(segments, tables.airportPlace);
    const entries = countries.size
      ? travelers.map((person) => ({ person, entry: travelerEntry(tables.visa, person.documents, countries, trip) })).filter((p) => p.entry.needs.length)
      : [];
    return { entries, fetched: tables.visa.fetched };
  }, [wanted, trip, segments, tables, travelers]);
}
