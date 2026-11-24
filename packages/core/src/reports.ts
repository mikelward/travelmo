import { hasLocation } from "./geocode";
import { compareInstants } from "./instant";
import type { ExtractedSegment, Place, SegmentType, Trip } from "./schema";
import { isCancelled, liveSegments, localDate, segmentDateRange } from "./trips";

// Where the user has been, worked out from their trips' bookings alone: no
// lookups here, so a place is known by the country its booking names, or
// for a flight by its airport code, and sits on the map where its booking
// says it is.

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
// transit or not known); `transit` marks setting off on a journey, after
// which they are in no country until it arrives. `moves` marks a journey or
// a stay, which puts the traveler where it says even when that is not known;
// an outing that names no country (a show, a class) leaves them where they
// were.
type Moment = { at: string; country?: string; then?: string; transit?: true; moves?: true };

// A flight's ends that are a connection: it lands where the next flight
// leaves from (the same airport code) within a day, with no stay booked in
// between. The traveler changes planes there rather than visiting, so the
// landing and the takeoff place them in no country (a day changing planes
// in Dubai is not a day in the UAE), though they are still away.
const connectionHours = 24;

function connections(live: readonly ExtractedSegment[], lookup?: PlaceLookup): { lands: Set<ExtractedSegment>; leaves: Set<ExtractedSegment> } {
  const flights = live.filter((s) => s.type === "flight").sort((a, b) => compareInstants(a.start, b.start));
  const stays = live.filter((s) => s.type === "lodging");
  const lands = new Set<ExtractedSegment>();
  const leaves = new Set<ExtractedSegment>();
  for (let i = 0; i + 1 < flights.length; i++) {
    const [a, b] = [flights[i]!, flights[i + 1]!];
    const at = a.destination?.code?.trim().toUpperCase();
    if (!at || at !== b.origin?.code?.trim().toUpperCase()) continue;
    const landed = Date.parse(a.end ?? a.start);
    const left = Date.parse(b.start);
    if (!(left >= landed && left - landed <= connectionHours * 3_600_000)) continue;
    // Only a stay in the connection's country makes it a stopover: a hotel
    // booked where the trip goes next can overlap the change of planes.
    const country = placeCountry(a.destination, "flight", lookup);
    const stayed = stays.some((s) => {
      const where = placeCountry(s.destination ?? s.origin, "lodging", lookup);
      return (!where || !country || where === country) && Date.parse(s.start) < left && Date.parse(s.end ?? s.start) > landed;
    });
    if (stayed) continue;
    lands.add(a);
    leaves.add(b);
  }
  return { lands, leaves };
}

function moments(segment: ExtractedSegment, lookup?: PlaceLookup, connecting: { lands?: boolean; leaves?: boolean } = {}): Moment[] {
  if (transport.has(segment.type)) {
    const from = connecting.leaves ? undefined : placeCountry(segment.origin, segment.type, lookup);
    const to = connecting.lands ? undefined : placeCountry(segment.destination, segment.type, lookup);
    // Only a flight is in no country on the way. A drive, a train, a bus or
    // a ferry that starts and ends in one country stays in it throughout (a
    // two-night train across the US never leaves it); between two countries,
    // where it is on the days between is not known, which is not the same as
    // nowhere.
    const flight = segment.type === "flight";
    const during = !flight && from && from === to ? from : undefined;
    return [
      { at: segment.start, moves: true, ...(from ? { country: from } : {}), ...(during ? { then: during } : flight ? { transit: true as const } : {}) },
      { at: segment.end ?? segment.start, moves: true, ...(to ? { country: to, then: to } : connecting.lands ? { transit: true as const } : {}) },
    ];
  }
  const here = placeCountry(segment.destination ?? segment.origin, segment.type, lookup);
  const at = { ...(here ? { country: here, then: here } : {}), ...(segment.type === "lodging" ? { moves: true as const } : {}) };
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
// A trip's dates as reports count them: what its bookings still span once a
// cancellation has taken some (a cancelled stay that stretched the trip, or
// started it, counts for none of its dates), none when every booking is
// cancelled, and its own dates when none is (as planned, bookings or not).
export function reportBounds(
  trip: Pick<Trip, "start" | "end">,
  segments: readonly ExtractedSegment[],
): { start: string; end: string } | undefined {
  return segments.some(isCancelled) ? segmentDateRange(segments) : { start: trip.start, end: trip.end };
}

// What a trip says about one of its days: the countries the traveler was
// in, whether they spent all of it between countries (a flight across the
// date line can skip a calendar day), and whether any booking has started
// to place them yet (a trip dated before its first booking says nothing
// about those days), and whether, with no country, nothing has yet taken
// them anywhere: only outings that name no place so far, no journey or stay
// (a trip that is a class or a show near home), so they are at home.
export type TripDay = { countries: Set<string>; inTransit: boolean; started: boolean; local: boolean };

export function tripDayPlaces(
  trip: Pick<Trip, "start" | "end">,
  segments: readonly ExtractedSegment[],
  today: string,
  lookup?: PlaceLookup,
): Map<string, TripDay> {
  // In the order they happened, which across the date line is not the
  // order of their local dates: a flight can land the day before it left.
  const live = liveSegments(segments);
  const changes = connections(live, lookup);
  const timeline = live
    .flatMap((s) => moments(s, lookup, { lands: changes.lands.has(s), leaves: changes.leaves.has(s) }))
    .sort((a, b) => compareInstants(a.at, b.at));
  const days = new Map<string, TripDay>();
  const bounds = reportBounds(trip, segments);
  if (!bounds) return days;
  const last = bounds.end < today ? bounds.end : today;
  for (let day = bounds.start; day <= last; day = nextDay(day)) {
    // Where the traveler was as the day began: left by the latest moment
    // dated before it.
    let where: string | undefined;
    let transit = false;
    let started = false;
    let travelled = false;
    const countries = new Set<string>();
    for (const m of timeline) {
      const date = localDate(m.at);
      if (date <= day) {
        started = true;
        if (m.moves || m.country) travelled = true;
      }
      // An outing that names no country leaves the traveler where they were.
      if (date < day && (m.moves || m.then)) {
        where = m.then;
        transit = Boolean(m.transit);
      } else if (date === day && m.country) countries.add(m.country);
    }
    if (where) countries.add(where);
    const inTransit = !countries.size && transit;
    days.set(day, { countries, inTransit, started, local: !countries.size && !inTransit && !travelled });
  }
  return days;
}

export function tripDays(
  trip: Pick<Trip, "start" | "end">,
  segments: readonly ExtractedSegment[],
  today: string,
  lookup?: PlaceLookup,
): Map<string, Set<string>> {
  return new Map([...tripDayPlaces(trip, segments, today, lookup)].map(([day, { countries }]) => [day, countries]));
}

// `tripIds`: the trips with days there, latest first, for listing them.
export type CountryReport = { country: string; days: number; trips: number; tripIds: string[] };
export type YearReport = { year: string; trips: number; days: number; countries: number };
export type AirportVisit = { code: string; country: string; lat: number; lon: number };
// A place other than an airport whose booking says where it is.
export type PlaceVisit = { name: string; city?: string; country?: string; lat: number; lon: number };

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
  // Stays, stations and the rest with coordinates, for the map, one per spot.
  places: PlaceVisit[];
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
  // Days between countries all day (changing planes), which are known.
  const transitDays = new Set<string>();
  const countryTrips = new Map<string, Set<string>>();
  const yearDays = new Map<string, Map<string, Set<string>>>();
  const yearTrips = new Map<string, number>();
  const airports = new Map<string, AirportVisit>();
  const places = new Map<string, PlaceVisit>();
  const tripStart = new Map<string, string>();
  let trips = 0;
  let unplaced = 0;
  let upcoming = 0;

  for (const { trip, segments } of distinct(all)) {
    // Ahead, done, and in which year, by what it still books; not
    // happening at all when nothing is.
    const bounds = reportBounds(trip, segments);
    if (!bounds) continue;
    if (bounds.start > today) {
      upcoming += 1;
      continue;
    }
    tripStart.set(trip.id, bounds.start);
    const startYear = bounds.start.slice(0, 4);
    yearTrips.set(startYear, (yearTrips.get(startYear) ?? 0) + 1);
    if (inYear(bounds.start)) trips += 1;

    for (const [day, { countries, inTransit }] of tripDayPlaces(trip, segments, today, lookup)) {
      if (inTransit && inYear(day)) transitDays.add(day);
      const y = day.slice(0, 4);
      const ofYear = yearDays.get(y) ?? new Map<string, Set<string>>();
      yearDays.set(y, ofYear);
      ofYear.set(day, new Set([...(ofYear.get(day) ?? []), ...countries]));
      if (!inYear(day)) continue;
      dayCountries.set(day, new Set([...(dayCountries.get(day) ?? []), ...countries]));
      for (const c of countries) countryTrips.set(c, new Set([...(countryTrips.get(c) ?? []), trip.id]));
    }

    for (const s of liveSegments(segments)) {
      const counted = (date: string) => date <= today && inYear(date);
      if (counted(localDate(s.start))) {
        const ends = [s.origin, s.destination].filter((p): p is Place => Boolean(p));
        if (ends.every((p) => !placeCountry(p, s.type, lookup))) unplaced += 1;
      }
      // Each place on the dates the traveler was there: a journey's ends on
      // the dates it left and arrived (a flight over New Year lands in the
      // next year's map), a stay's place on every day of the stay.
      const occupied = (from: string, to: string) => from <= today && (!year || (from.slice(0, 4) <= year && year <= (to < today ? to : today).slice(0, 4)));
      const ends: [Place | undefined, boolean][] = transport.has(s.type)
        ? [
            [s.origin, counted(localDate(s.start))],
            [s.destination, counted(localDate(s.end ?? s.start))],
          ]
        : [[s.destination ?? s.origin, occupied(localDate(s.start), localDate(s.end ?? s.start))]];
      for (const [p, there] of ends) {
        if (!p || !there) continue;
        const found = s.type === "flight" && p.code ? lookup?.(p.code) : undefined;
        if (found && p.code) airports.set(p.code.toUpperCase(), { code: p.code.toUpperCase(), ...found });
        else if (hasLocation(p) && !places.has(spot(p))) places.set(spot(p), placeVisit(p));
      }
    }
  }

  const daysIn = new Map<string, number>();
  let unknownDays = 0;
  for (const [day, countries] of dayCountries) {
    if (!countries.size && !transitDays.has(day)) unknownDays += 1;
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
      .map(([country, days]) => {
        const ids = [...(countryTrips.get(country) ?? [])].sort((a, b) => (tripStart.get(b) ?? "").localeCompare(tripStart.get(a) ?? "") || a.localeCompare(b));
        return { country, days, trips: ids.length, tripIds: ids };
      })
      .sort((a, b) => b.days - a.days || a.country.localeCompare(b.country)),
    years,
    airports: [...airports.values()].sort((a, b) => a.code.localeCompare(b.code)),
    places: [...places.values()].sort((a, b) => a.name.localeCompare(b.name) || a.lat - b.lat || a.lon - b.lon),
    unknownDays,
    unplaced,
    upcoming,
  };
}

// Two bookings within about a hundred meters are one spot on the map: the
// same hotel named two ways is one dot, under the first name.
const spot = (p: Place & { lat: number; lon: number }) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

const placeVisit = (p: Place & { lat: number; lon: number }): PlaceVisit => ({
  name: p.name,
  ...(p.city ? { city: p.city } : {}),
  ...(p.country ? { country: p.country.toUpperCase() } : {}),
  lat: p.lat,
  lon: p.lon,
});

// The same trip listed twice (owned and shared) counts once.
function distinct(trips: readonly TripWithSegments[]): TripWithSegments[] {
  const byId = new Map(trips.map((t) => [t.trip.id, t]));
  return [...byId.values()];
}

// The countries a trip's bookings are in, and whether every place with a
// booking has one, for deciding whether the trip crosses a border.
export function tripPlaces(segments: readonly ExtractedSegment[], lookup?: PlaceLookup): { countries: Set<string>; complete: boolean } {
  const countries = new Set<string>();
  const live = liveSegments(segments);
  let complete = live.length > 0;
  for (const s of live) {
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
