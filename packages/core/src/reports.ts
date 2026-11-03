import { compareInstants } from "./instant";
import type { ExtractedSegment, Place, SegmentType, Trip } from "./schema";
import { localDate } from "./trips";

// Where the user has been, worked out from their trips' bookings alone: no
// geocoding, so a place is known by the country its booking names, or for a
// flight by its airport code.

export type PlaceLookup = (code: string) => { country: string; lat: number; lon: number } | undefined;

// The country a place is in, if its booking or its airport says.
export function placeCountry(place: Place | undefined, type: SegmentType, lookup?: PlaceLookup): string | undefined {
  if (!place) return undefined;
  if (place.country) return place.country.toUpperCase();
  // Station and ferry codes are not airport codes, even when they look like one.
  return type === "flight" && place.code ? lookup?.(place.code)?.country : undefined;
}

const transport: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry", "car_rental"]);

// A moment the traveler is known to be somewhere: the country counts for
// that day, and `then` is where they are afterwards (undefined while in
// transit or not known).
type Moment = { at: string; country?: string; then?: string };

function moments(segment: ExtractedSegment, lookup?: PlaceLookup): Moment[] {
  if (transport.has(segment.type)) {
    const from = placeCountry(segment.origin, segment.type, lookup);
    const to = placeCountry(segment.destination, segment.type, lookup);
    // A car is driven from place to place in between; a flight is in the air.
    const during = segment.type === "car_rental" && from === to ? from : undefined;
    return [
      { at: segment.start, ...(from ? { country: from } : {}), ...(during ? { then: during } : {}) },
      { at: segment.end ?? segment.start, ...(to ? { country: to, then: to } : {}) },
    ];
  }
  const here = placeCountry(segment.destination ?? segment.origin, segment.type, lookup);
  const at = here ? { country: here, then: here } : {};
  return [{ at: segment.start, ...at }, ...(segment.end ? [{ at: segment.end, ...at }] : [])];
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// The countries of each day of a trip, up to `today`: a day counts for every
// country the traveler was in, so a travel day counts for both ends of the
// journey, and a day in the air for neither. A day before anything says
// where the traveler is has no country.
export function tripDays(
  trip: Pick<Trip, "start" | "end">,
  segments: readonly ExtractedSegment[],
  today: string,
  lookup?: PlaceLookup,
): Map<string, Set<string>> {
  // In the order they happened, which across the date line is not the
  // order of their local dates: a flight can land the day before it left.
  const timeline = segments.flatMap((s) => moments(s, lookup)).sort((a, b) => compareInstants(a.at, b.at));
  const days = new Map<string, Set<string>>();
  const last = trip.end < today ? trip.end : today;
  for (let day = trip.start; day <= last; day = nextDay(day)) {
    // Where the traveler was as the day began: left by the latest moment
    // dated before it.
    let where: string | undefined;
    const countries = new Set<string>();
    for (const m of timeline) {
      const date = localDate(m.at);
      if (date < day) where = m.then;
      else if (date === day && m.country) countries.add(m.country);
    }
    if (where) countries.add(where);
    days.set(day, countries);
  }
  return days;
}

export type CountryReport = { country: string; days: number; trips: number };
export type YearReport = { year: string; trips: number; days: number; countries: number };
export type AirportVisit = { code: string; country: string; lat: number; lon: number };

export type TravelReport = {
  // Trips begun by today, in the year asked for (or ever).
  trips: number;
  // Days away: days with any trip, each counted once however many overlap.
  days: number;
  // Most days first.
  countries: CountryReport[];
  // Every year with a trip, latest first; not narrowed to the year asked for.
  years: YearReport[];
  // Airports flown from or to, for the map.
  airports: AirportVisit[];
  // Trip days whose country no booking says.
  unknownDays: number;
  // Bookings whose places no country could be found for.
  unplaced: number;
  // Trips still ahead, not counted in anything else.
  upcoming: number;
};

export type TripWithSegments = { trip: Pick<Trip, "id" | "start" | "end">; segments: readonly ExtractedSegment[] };

export function travelReport(
  all: readonly TripWithSegments[],
  today: string,
  options: { year?: string; lookup?: PlaceLookup } = {},
): TravelReport {
  const { year, lookup } = options;
  const inYear = (date: string) => !year || date.startsWith(year);
  const dayCountries = new Map<string, Set<string>>();
  const countryTrips = new Map<string, Set<string>>();
  const yearDays = new Map<string, Map<string, Set<string>>>();
  const yearTrips = new Map<string, number>();
  const airports = new Map<string, AirportVisit>();
  let trips = 0;
  let unplaced = 0;
  let upcoming = 0;

  for (const { trip, segments } of distinct(all)) {
    if (trip.start > today) {
      upcoming += 1;
      continue;
    }
    const startYear = trip.start.slice(0, 4);
    yearTrips.set(startYear, (yearTrips.get(startYear) ?? 0) + 1);
    if (inYear(trip.start)) trips += 1;

    for (const [day, countries] of tripDays(trip, segments, today, lookup)) {
      const y = day.slice(0, 4);
      const ofYear = yearDays.get(y) ?? new Map<string, Set<string>>();
      yearDays.set(y, ofYear);
      ofYear.set(day, new Set([...(ofYear.get(day) ?? []), ...countries]));
      if (!inYear(day)) continue;
      dayCountries.set(day, new Set([...(dayCountries.get(day) ?? []), ...countries]));
      for (const c of countries) countryTrips.set(c, new Set([...(countryTrips.get(c) ?? []), trip.id]));
    }

    for (const s of segments) {
      const counted = (date: string) => date <= today && inYear(date);
      if (counted(localDate(s.start))) {
        const places = [s.origin, s.destination].filter((p): p is Place => Boolean(p));
        if (places.every((p) => !placeCountry(p, s.type, lookup))) unplaced += 1;
      }
      if (s.type !== "flight") continue;
      // Each airport on the date the traveler was there: a flight over New
      // Year lands in the next year's map.
      const ends: [Place | undefined, string][] = [
        [s.origin, s.start],
        [s.destination, s.end ?? s.start],
      ];
      for (const [p, at] of ends) {
        const found = p?.code && counted(localDate(at)) ? lookup?.(p.code) : undefined;
        if (found && p?.code) airports.set(p.code.toUpperCase(), { code: p.code.toUpperCase(), ...found });
      }
    }
  }

  const daysIn = new Map<string, number>();
  let unknownDays = 0;
  for (const countries of dayCountries.values()) {
    if (!countries.size) unknownDays += 1;
    for (const c of countries) daysIn.set(c, (daysIn.get(c) ?? 0) + 1);
  }

  const years = [...new Set([...yearTrips.keys(), ...yearDays.keys()])]
    .sort((a, b) => b.localeCompare(a))
    .map((y) => {
      const days = yearDays.get(y) ?? new Map<string, Set<string>>();
      return {
        year: y,
        trips: yearTrips.get(y) ?? 0,
        days: days.size,
        countries: new Set([...days.values()].flatMap((c) => [...c])).size,
      };
    });

  return {
    trips,
    days: dayCountries.size,
    countries: [...daysIn]
      .map(([country, days]) => ({ country, days, trips: countryTrips.get(country)?.size ?? 0 }))
      .sort((a, b) => b.days - a.days || a.country.localeCompare(b.country)),
    years,
    airports: [...airports.values()].sort((a, b) => a.code.localeCompare(b.code)),
    unknownDays,
    unplaced,
    upcoming,
  };
}

// The same trip listed twice (owned and shared) counts once.
function distinct(trips: readonly TripWithSegments[]): TripWithSegments[] {
  const byId = new Map(trips.map((t) => [t.trip.id, t]));
  return [...byId.values()];
}

// The countries a trip's bookings are in, and whether every place with a
// booking has one, for deciding whether the trip crosses a border.
export function tripPlaces(segments: readonly ExtractedSegment[], lookup?: PlaceLookup): { countries: Set<string>; complete: boolean } {
  const countries = new Set<string>();
  let complete = segments.length > 0;
  for (const s of segments) {
    const places = [s.origin, s.destination].filter((p): p is Place => Boolean(p));
    // A journey with an end missing went somewhere unknown; a stay or
    // activity has one place.
    if (!places.length || (transport.has(s.type) && places.length < 2)) complete = false;
    for (const p of places) {
      const c = placeCountry(p, s.type, lookup);
      if (c) countries.add(c);
      else complete = false;
    }
  }
  return { countries, complete };
}
