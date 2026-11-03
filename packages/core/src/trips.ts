import { compareInstants } from "./instant";
import type { ExtractedSegment, Place, SegmentType, Trip } from "./schema";

export type TripGroups = {
  current: Trip[];
  upcoming: Trip[];
  past: Trip[];
};

export function groupTrips(trips: readonly Trip[], today: string): TripGroups {
  const current: Trip[] = [];
  const upcoming: Trip[] = [];
  const past: Trip[] = [];
  for (const trip of trips) {
    if (trip.end < today) past.push(trip);
    else if (trip.start > today) upcoming.push(trip);
    else current.push(trip);
  }
  const byStart = (a: Trip, b: Trip) => a.start.localeCompare(b.start);
  current.sort(byStart);
  upcoming.sort(byStart);
  past.sort((a, b) => b.end.localeCompare(a.end));
  return { current, upcoming, past };
}

export function localDate(instant: string): string {
  return instant.slice(0, 10);
}

export function segmentDateRange(
  segments: readonly ExtractedSegment[],
): { start: string; end: string } | undefined {
  // Both endpoints feed both bounds: across the date line a flight can land
  // on an earlier local date than it departed.
  let start: string | undefined;
  let end: string | undefined;
  for (const segment of segments) {
    for (const date of [localDate(segment.start), localDate(segment.end ?? segment.start)]) {
      if (start === undefined || date < start) start = date;
      if (end === undefined || date > end) end = date;
    }
  }
  return start !== undefined && end !== undefined ? { start, end } : undefined;
}

export type UpcomingEvent<S extends ExtractedSegment = ExtractedSegment> = {
  segment: S;
  kind: "start" | "end";
  at: string;
};

// The soonest thing still ahead: a booking's start, or the end of one that
// is under way (a stay's check-out, a flight's arrival).
export function nextEvent<S extends ExtractedSegment>(segments: readonly S[], now: string): UpcomingEvent<S> | undefined {
  let best: UpcomingEvent<S> | undefined;
  for (const segment of segments) {
    let candidate: UpcomingEvent<S> | undefined;
    if (compareInstants(segment.start, now) >= 0) candidate = { segment, kind: "start", at: segment.start };
    else if (segment.end && compareInstants(segment.end, now) >= 0) candidate = { segment, kind: "end", at: segment.end };
    if (candidate && (!best || compareInstants(candidate.at, best.at) < 0)) best = candidate;
  }
  return best;
}

const eventVerbs: Record<SegmentType, { start: string; end: string }> = {
  flight: { start: "Departs", end: "Arrives" },
  train: { start: "Departs", end: "Arrives" },
  bus: { start: "Departs", end: "Arrives" },
  ferry: { start: "Departs", end: "Arrives" },
  lodging: { start: "Check-in", end: "Check-out" },
  car_rental: { start: "Pick up", end: "Return" },
  activity: { start: "Starts", end: "Ends" },
  other: { start: "Starts", end: "Ends" },
};

export function eventVerb(event: UpcomingEvent): string {
  return eventVerbs[event.segment.type][event.kind];
}

// A form edits a place's name and code, and its country where it shows one
// (passing a country, "" to clear it); whatever else an import recorded
// about it (city, and a country the form leaves alone) survives until the
// name is cleared.
export function mergePlace(existing: Place | undefined, name: string, code: string, country?: string): Place | undefined {
  const trimmedName = name.trim();
  if (!trimmedName) return undefined;
  const trimmedCode = code.trim().toUpperCase();
  const { code: _oldCode, ...rest } = existing ?? { name: trimmedName };
  const place: Place = { ...rest, name: trimmedName, ...(trimmedCode ? { code: trimmedCode } : {}) };
  if (country === undefined) return place;
  const { country: _oldCountry, ...withoutCountry } = place;
  const trimmedCountry = country.trim().toUpperCase();
  return trimmedCountry ? { ...withoutCountry, country: trimmedCountry } : withoutCountry;
}

export function daysBetween(start: string, end: string): number {
  const ms = Date.UTC(
    Number(end.slice(0, 4)),
    Number(end.slice(5, 7)) - 1,
    Number(end.slice(8, 10)),
  ) -
    Date.UTC(
      Number(start.slice(0, 4)),
      Number(start.slice(5, 7)) - 1,
      Number(start.slice(8, 10)),
    );
  return Math.round(ms / 86_400_000);
}

// A booking belongs to an existing trip when its dates fall within, or within
// `gapDays` of, that trip. Flights home after a long gap start a new trip.
export function findTripForRange(
  trips: readonly Trip[],
  range: { start: string; end: string },
  gapDays = 2,
): Trip | undefined {
  return trips.find(
    (trip) =>
      daysBetween(trip.end, range.start) <= gapDays &&
      daysBetween(range.end, trip.start) <= gapDays,
  );
}

const timedTypes: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry", "activity", "other"]);

// Words too common in booking titles to say two bookings are one.
const genericWords = new Set([
  "hotel", "hostel", "apartment", "apartments", "suite", "suites", "room", "rooms", "stay", "resort", "house", "lodge",
  "inn", "airport", "station", "terminal", "flight", "train", "rail", "ferry", "coach", "rental", "hire", "car", "cars",
  "booking", "reservation", "confirmation", "trip", "tour", "ticket", "tickets", "from", "with", "the", "and",
]);

function words(...texts: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const word of (text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/)) {
      // Names of four letters or more, and numbers such as a flight's.
      if ((word.length >= 4 || (/\d/.test(word) && word.length >= 2)) && !genericWords.has(word)) out.add(word);
    }
  }
  return out;
}

const normalizeReference = (ref: string) => ref.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Whether two bookings from different sources are the same reservation, for
// imports that carry no shared reference (a TripIt export has no
// confirmation numbers on its trips). Dropping a real booking as a
// duplicate loses it, so beyond matching times this asks for evidence of
// identity, and a duplicate left standing is the price of doubt.
//
// Times: wall clocks are compared, not instants, because the model can
// misjudge an offset by an hour of DST. Journeys and activities must start
// at the same local minute; stays and rentals, whose times are often
// guessed, on the same dates. Identity, given matching times: confirmation
// numbers decide when both have one; codes, and cities and countries, where
// both have them, must agree, and a journey whose both ends have agreeing
// codes on both sides is the same; otherwise the two must share a
// distinctive word of their titles or place names, leaving out cities and
// providers (two hotels of one chain, or in one city, on the same nights
// are two stays).
export function sameBooking(a: ExtractedSegment, b: ExtractedSegment): boolean {
  if (a.type !== b.type) return false;
  const wall = (instant: string) => instant.slice(0, 16);
  if (timedTypes.has(a.type)) {
    if (wall(a.start) !== wall(b.start)) return false;
  } else {
    if (localDate(a.start) !== localDate(b.start)) return false;
    if (a.end && b.end && localDate(a.end) !== localDate(b.end)) return false;
  }
  if (a.confirmation && b.confirmation) return normalizeReference(a.confirmation) === normalizeReference(b.confirmation);
  const codesDiffer = (x?: Place, y?: Place) =>
    x?.code !== undefined && y?.code !== undefined && x.code.toUpperCase() !== y.code.toUpperCase();
  if (codesDiffer(a.origin, b.origin) || codesDiffer(a.destination, b.destination)) return false;
  // Places both sides know must agree: two stays on the same nights in
  // London and Manchester are two, whatever the chain.
  const known = (x?: string, y?: string) => x !== undefined && y !== undefined && x.trim().toLowerCase() !== y.trim().toLowerCase();
  for (const [x, y] of [[a.origin, b.origin], [a.destination, b.destination]] as const) {
    if (known(x?.city, y?.city) || known(x?.country, y?.country)) return false;
  }
  if (a.origin?.code && b.origin?.code && a.destination?.code && b.destination?.code) return true;
  // A city or a chain is shared by many bookings; what is left of the
  // names (the property, the route) says which one this is. When the
  // provider is the property itself (an independent hotel), nothing is left
  // without it, and its name is the evidence.
  const cities = words(a.origin?.city, a.destination?.city, b.origin?.city, b.destination?.city);
  const brand = words(a.provider, b.provider);
  const names = (s: ExtractedSegment, without: Set<string>) => {
    const found = words(s.title, s.origin?.name, s.destination?.name);
    for (const word of without) found.delete(word);
    return found;
  };
  const withoutBrand = new Set([...cities, ...brand]);
  let ours = names(a, withoutBrand);
  let theirs = names(b, withoutBrand);
  if (ours.size === 0 || theirs.size === 0) {
    ours = names(a, cities);
    theirs = names(b, cities);
  }
  for (const word of ours) if (theirs.has(word)) return true;
  return false;
}

// Trips whose dates touch the range at all (no gap allowed), the candidates
// a booking could be a duplicate in.
export function overlappingTrips(trips: readonly Trip[], range: { start: string; end: string }): Trip[] {
  return trips.filter((trip) => trip.start <= range.end && trip.end >= range.start);
}
