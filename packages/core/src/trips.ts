import type { Location } from "./geocode";
import { compareInstants } from "./instant";
import type { ExtractedCancellation, ExtractedSegment, Place, SegmentType, Trip } from "./schema";

export type TripGroups = {
  current: Trip[];
  upcoming: Trip[];
  past: Trip[];
};

export function groupTrips(trips: readonly Trip[], today: string): TripGroups {
  const current: Trip[] = [];
  const upcoming: Trip[] = [];
  const past: Trip[] = [];
  // When the person travels (displayBounds), not the trip's full span.
  for (const trip of trips) {
    const { start, end } = displayBounds(trip);
    if (end < today) past.push(trip);
    else if (start > today) upcoming.push(trip);
    else current.push(trip);
  }
  const byStart = (a: Trip, b: Trip) => displayBounds(a).start.localeCompare(displayBounds(b).start);
  current.sort(byStart);
  upcoming.sort(byStart);
  past.sort((a, b) => displayBounds(b).end.localeCompare(displayBounds(a).end));
  return { current, upcoming, past };
}

export function localDate(instant: string): string {
  return instant.slice(0, 10);
}

const journeyTypes: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry"]);
// The longest a journey is believed to take, in days: a week on the
// Trans-Siberian, with a day to spare.
const maxJourneyDays = 8;

// A booking a cancellation email was matched to. It stays on the trip,
// shown struck through, but nothing else counts it.
export function isCancelled(segment: object): boolean {
  return typeof (segment as { cancelledAt?: unknown }).cancelledAt === "string";
}

export function liveSegments<S extends object>(segments: readonly S[]): S[] {
  return segments.filter((s) => !isCancelled(s));
}

// A trip whose every booking was cancelled isn't happening: no document
// warnings, reminders, calendar event or report counts for it. A trip with
// no bookings yet (planned by hand, or not imported) is still a trip.
export function allCancelled(segments: readonly object[]): boolean {
  return segments.length > 0 && segments.every(isCancelled);
}

// A trip that isn't happening: its owner cancelled it, or every booking in
// it was cancelled. One with no bookings yet still is, unless cancelled.
export function tripCancelled(trip: Pick<Trip, "cancelledAt">, segments?: readonly object[]): boolean {
  return trip.cancelledAt !== undefined || (segments !== undefined && allCancelled(segments));
}

type Cancellable = { cancelledAt?: string | undefined; userCancelled?: "booking" | "trip" | undefined };

// A booking as it stands in `trip`, for a write that puts it there (a new
// one, a move, a merge, an import): a live booking in a cancelled trip is
// cancelled with it; one cancelled only with its trip is live again in a
// trip that isn't. Anything else is as it was.
export function inTrip<S extends object>(segment: S, trip: Pick<Trip, "cancelledAt">, timestamp: string): S {
  const marked = segment as S & Cancellable;
  if (trip.cancelledAt !== undefined && !isCancelled(segment)) return { ...segment, cancelledAt: timestamp, userCancelled: "trip" };
  if (trip.cancelledAt === undefined && marked.userCancelled === "trip") {
    const { cancelledAt: _at, userCancelled: _user, ...live } = marked;
    return live as S;
  }
  return segment;
}

// Every booking's dates, cancelled ones too: what a trip's own dates must
// always cover, so an import finds each of its bookings again by date.
export function bookedDateRange(segments: readonly ExtractedSegment[]): { start: string; end: string } | undefined {
  return segmentDateRange(segments.map((s) => (isCancelled(s) ? ({ ...s, cancelledAt: undefined } as ExtractedSegment) : s)));
}

export function segmentDateRange(
  segments: readonly ExtractedSegment[],
): { start: string; end: string } | undefined {
  // Both endpoints feed both bounds: across the date line a flight can land
  // on an earlier local date than it departed.
  // A journey's end more than a week after it leaves is not when it
  // arrives (a ticket's expiry, read as its arrival) and never stretches a
  // trip: its start stands for both.
  let start: string | undefined;
  let end: string | undefined;
  for (const segment of liveSegments(segments)) {
    const tooLong = !!segment.end && journeyTypes.has(segment.type) && daysBetween(localDate(segment.start), localDate(segment.end)) > maxJourneyDays;
    const last = segment.end && !tooLong ? segment.end : segment.start;
    for (const date of [localDate(segment.start), localDate(last)]) {
      if (start === undefined || date < start) start = date;
      if (end === undefined || date > end) end = date;
    }
  }
  return start !== undefined && end !== undefined ? { start, end } : undefined;
}

// When the person now travels, once cancellations have taken some of a
// trip's bookings: an end only a cancelled booking reached moves in to what
// is still booked; an end set beyond the bookings (planned by hand) stays.
// None when nothing is cancelled, nothing is left booked, or it is the
// trip's own dates. Kept on the trip as liveStart and liveEnd, so screens
// that read only the trip show it (displayBounds); the trip's own dates
// stay, so its bookings are still found by date.
export function liveBounds(
  trip: { start: string; end: string },
  segments: readonly ExtractedSegment[],
): { start: string; end: string } | undefined {
  if (!segments.some(isCancelled)) return undefined;
  const live = segmentDateRange(segments);
  if (!live) return undefined;
  const booked = segments.filter(isCancelled).flatMap((s) => bookedDateRange([s]) ?? []);
  const start = trip.start < live.start && booked.some((r) => r.start === trip.start) ? live.start : live.start < trip.start ? live.start : trip.start;
  const end = trip.end > live.end && booked.some((r) => r.end === trip.end) ? live.end : live.end > trip.end ? live.end : trip.end;
  return start === trip.start && end === trip.end ? undefined : { start, end };
}

// The dates a trip is shown with: when the person now travels (liveBounds),
// else its own.
export function displayBounds(trip: { start: string; end: string; liveStart?: string | undefined; liveEnd?: string | undefined }): { start: string; end: string } {
  return trip.liveStart && trip.liveEnd ? { start: trip.liveStart, end: trip.liveEnd } : { start: trip.start, end: trip.end };
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
  for (const segment of liveSegments(segments)) {
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

// What an address pick sets besides the name: a value sets it, "" (or null
// for the location) clears it, undefined (the form did not touch it) keeps
// what the place had.
export type PlaceDetails = { city?: string; address?: string; location?: Location | null };

// A form edits a place's name and code, and its country where it shows one
// (passing a country, "" to clear it); whatever else an import recorded
// about it (city, address, and a country the form leaves alone) survives
// until the name is cleared or an address pick replaces it.
export function mergePlace(existing: Place | undefined, name: string, code: string, country?: string, details?: PlaceDetails): Place | undefined {
  const trimmedName = name.trim();
  if (!trimmedName) return undefined;
  const trimmedCode = code.trim().toUpperCase();
  const { code: _oldCode, ...rest } = existing ?? { name: trimmedName };
  let place: Place = { ...rest, name: trimmedName, ...(trimmedCode ? { code: trimmedCode } : {}) };
  if (country !== undefined) {
    const { country: _oldCountry, ...withoutCountry } = place;
    const trimmedCountry = country.trim().toUpperCase();
    place = trimmedCountry ? { ...withoutCountry, country: trimmedCountry } : withoutCountry;
  }
  for (const key of ["city", "address"] as const) {
    const value = details?.[key];
    if (value === undefined) continue;
    const { [key]: _old, ...without } = place;
    place = value.trim() ? { ...without, [key]: value.trim() } : without;
  }
  if (details?.location !== undefined) {
    const { lat: _lat, lon: _lon, ...without } = place;
    place = details.location ? { ...without, lat: details.location.lat, lon: details.location.lon } : without;
  }
  return place;
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
// A trip is grouped by when the person travels (displayBounds): a cancelled
// stay at its end draws nothing else in.
export function findTripForRange(
  trips: readonly Trip[],
  range: { start: string; end: string },
  gapDays = 2,
): Trip | undefined {
  return trips.find((trip) => {
    const shown = displayBounds(trip);
    return daysBetween(shown.end, range.start) <= gapDays && daysBetween(range.end, shown.start) <= gapDays;
  });
}

// How far, in days, a trip may be from a booking and still be offered first
// when moving it: trips around the same dates, the rest behind "More".
export const nearbyTripDays = 14;

// The trips a booking moving out of its own is first offered: those within
// `days` of its dates (any of them, cancelled too), by when the person
// travels (displayBounds).
export function nearbyTrips<T extends Pick<Trip, "start" | "end" | "liveStart" | "liveEnd">>(
  trips: readonly T[],
  segment: ExtractedSegment,
  days = nearbyTripDays,
): T[] {
  const range = bookedDateRange([segment]);
  if (!range) return [...trips];
  return trips.filter((trip) => {
    const shown = displayBounds(trip);
    return daysBetween(shown.end, range.start) <= days && daysBetween(range.end, shown.start) <= days;
  });
}

// What a trip made for one booking is called, until more bookings join and
// an import renames it: where the booking goes (its town, else the place's
// own name), else the booking's title, as the parser names a trip of one.
export function newTripTitle(segment: Pick<ExtractedSegment, "title" | "destination" | "origin">): string {
  const place = segment.destination ?? segment.origin;
  return (place?.city || place?.name || segment.title).trim() || "Trip";
}

// The trip a booking added by hand with no trip in view goes into: one of
// the user's own whose dates take in its first day, the shortest if several
// do; undefined when none does, and a trip of its own is made
// (newTripTitle, its dates). Trips being deleted or cancelled are passed by.
export function fittingTrip<T extends Pick<Trip, "ownerUid" | "start" | "end" | "deleting" | "cancelledAt">>(trips: readonly T[], uid: string, start: string): T | undefined {
  const day = start.slice(0, 10);
  const span = (t: T) => Date.parse(t.end) - Date.parse(t.start);
  return trips
    .filter((t) => t.ownerUid === uid && !t.deleting && !t.cancelledAt && t.start <= day && day <= t.end)
    .sort((a, b) => span(a) - span(b) || a.start.localeCompare(b.start))[0];
}

// An activity with no time of its own: the extractor's convention for a
// dated thing with no stated time is local midnight and no end. It is shown
// without a time.
export function isUntimed(segment: Pick<ExtractedSegment, "type" | "start" | "end">): boolean {
  return (segment.type === "activity" || segment.type === "other") && !segment.end && segment.start.slice(11, 16) === "00:00";
}

const notBookingTitle = /\b(memberships?|annual pass(es)?|season (ticket|pass)(es|s)?|subscriptions?|gift (card|voucher)s?|vouchers?|donations?)\b/i;

// Things bought, not booked: a membership, pass, subscription, voucher or
// donation has no visit of its own, so it is no trip. Only untimed ones: a
// members' event at a set time is a booking.
export function notBookings<S extends ExtractedSegment>(segments: readonly S[]): S[] {
  return segments.filter((segment) => isUntimed(segment) && notBookingTitle.test(segment.title));
}

// A journey's end is its arrival. One that ends at 23:59 on a later day, or
// more than maxJourneyDays on, is a ticket's validity read as an arrival (an open
// airport train ticket valid for three months), so it is dropped.
export function withoutValidityEnds<S extends ExtractedSegment>(segments: readonly S[]): S[] {
  return segments.map((segment) => {
    if (!segment.end || !journeyTypes.has(segment.type)) return segment;
    const days = daysBetween(localDate(segment.start), localDate(segment.end));
    if (days <= maxJourneyDays && !(days >= 1 && segment.end.slice(11, 16) === "23:59")) return segment;
    const { end: _validity, ...rest } = segment;
    return rest as S;
  });
}

// How far apart a payment receipt with no time of its own and the booking it
// pays for may be dated, in days.
export const untimedMatchDays = 31;

const timedTypes: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry", "activity", "other"]);

// Words too common in booking titles to say two bookings are one.
const genericWords = new Set([
  "hotel", "hostel", "apartment", "apartments", "suite", "suites", "room", "rooms", "stay", "resort", "house", "lodge",
  "inn", "airport", "station", "terminal", "flight", "train", "rail", "ferry", "coach", "rental", "hire", "car", "cars",
  "booking", "reservation", "confirmation", "trip", "tour", "ticket", "tickets", "from", "with", "the", "and",
]);

// A text's words, for every comparison of names here (words, eventWords,
// and through them sameBooking, sameEvent, receipts and cancels): letters
// and digits of any script (東京旅館 and となりのトトロ are names too), in
// lower case, accents aside.
function tokens(text: string | undefined): string[] {
  return (text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// The cities a text names, of those the time-zone names know ("Europe/
// Paris", "America/New_York"): a few hundred of the world's larger cities,
// with no table of our own to keep.
let knownCities: Set<string> | undefined;
function citiesNamed(text: string | undefined): Set<string> {
  knownCities ??= new Set(
    Intl.supportedValuesOf("timeZone")
      .map((zone) => tokens(zone.split("/").pop()!.replace(/_/g, " ")).join(" "))
      .filter(Boolean),
  );
  const found = new Set<string>();
  const t = tokens(text);
  for (let i = 0; i < t.length; i++) {
    for (let n = 1; n <= 3 && i + n <= t.length; n++) {
      const phrase = t.slice(i, i + n).join(" ");
      if (knownCities.has(phrase)) found.add(phrase);
    }
  }
  return found;
}

// Whether what an email names is somewhere else than the booking it might
// be: one rule for stays, events and journeys' ends. A city the email gives
// as such (`namedCity`) decides when the booking has one too. Otherwise a
// city named in the text counts only if it isn't in the booking's own name:
// "ibis Paris City" is not in London, but "Chicago at Phoenix Theatre" is a
// show in London and "Hotel Berlin" may be in Munich.
export function localityConflict(
  named: string | undefined,
  city: string | undefined,
  own: readonly (string | undefined)[] = [],
  namedCity?: string,
): boolean {
  if (!city) return false;
  const theirs = tokens(city).join(" ");
  if (namedCity) return tokens(namedCity).join(" ") !== theirs;
  if (!named) return false;
  const inOwnName = new Set(own.flatMap((text) => [...citiesNamed(text)]));
  const cities = [...citiesNamed(named)].filter((c) => !inOwnName.has(c));
  return cities.length > 0 && !cities.includes(theirs);
}

function words(...texts: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const word of tokens(text)) {
      // Names of four letters or more, and numbers such as a flight's.
      if ((word.length >= 4 || (/\d/.test(word) && word.length >= 2)) && !genericWords.has(word)) out.add(word);
    }
  }
  return out;
}

// The flight or train numbers a text names: an airline's or operator's
// designator in capitals, then the number ("BA 117", "BA117", "U2 8001",
// "ICE 578"), as "BA117"; and, for a journey (`named`), the number after an
// operator's full name ("Eurostar 9014", "Flight 117"), as "#9014", which
// is the same service as any designator with that number ("ES 9014").
// Words that number a place rather than a service (Terminal 5, Platform 9,
// Coach 12) aren't operators.
export function serviceNumbers(text: string | undefined, named = false): Set<string> {
  const out = new Set<string>();
  for (const m of (text ?? "").matchAll(/\b([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/g)) out.add(`${m[1]}${Number(m[2])}`);
  if (named) {
    for (const m of (text ?? "").matchAll(/\b(\p{Lu}\p{Ll}+)\s(\d{2,5})\b/gu)) {
      if (!placeNumberWords.has(m[1]!.toLowerCase())) out.add(`#${Number(m[2])}`);
    }
  }
  return out;
}

const placeNumberWords = new Set([
  "terminal", "platform", "gate", "coach", "car", "carriage", "seat", "seats", "row", "room", "deck", "cabin", "berth",
  "pier", "track", "zone", "level", "floor", "stand", "hall", "day", "suite", "apartment", "unit", "number", "no",
]);

// Whether two of serviceNumbers' services are one: the same designator and
// number, or a number after a full name and any designator with it.
function sameService(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a.startsWith("#") && !b.startsWith("#")) return false;
  const number = (s: string) => s.match(/\d+$/)?.[0];
  return number(a) === number(b);
}

// Whether two texts name different services: both name one, and none in
// common. BA 999 is not BA 117, however alike the route; nor Eurostar 9014
// Eurostar 9024 (`named`, for a journey).
export function servicesConflict(a: string | undefined, b: string | undefined, named = false): boolean {
  const [x, y] = [serviceNumbers(a, named), serviceNumbers(b, named)];
  return x.size > 0 && y.size > 0 && ![...x].some((n) => [...y].some((m) => sameService(n, m)));
}

export const normalizeReference = (ref: string) => ref.toUpperCase().replace(/[^A-Z0-9]/g, "");

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
  if ((isPaymentReceipt(a) || isPaymentReceipt(b)) && wall(a.start) !== wall(b.start)) return sameUntimed(a, b);
  if (timedTypes.has(a.type)) {
    if (wall(a.start) !== wall(b.start) && !retimed(a, b) && !timeLearned(a, b)) return false;
  } else {
    if (localDate(a.start) !== localDate(b.start)) return false;
    if (a.end && b.end && localDate(a.end) !== localDate(b.end)) return false;
  }
  if (a.confirmation && b.confirmation) return normalizeReference(a.confirmation) === normalizeReference(b.confirmation);
  if (sameListing(a, b)) return true;
  if (placesConflict(a, b)) return false;
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

// One journey moved by a schedule change: the same reference and service
// (UA 122 and UA122) on the same day, leaving within six hours of each
// other, as an airline's "your flight time has changed" email tells it.
// Airports or stations both name must agree: one flight number can fly
// several legs (UA 154 Guam to Chuuk to Pohnpei).
function retimed(a: ExtractedSegment, b: ExtractedSegment): boolean {
  if (!journeyTypes.has(a.type) || !a.confirmation || !b.confirmation) return false;
  const differ = (x?: Place, y?: Place) => !!x?.code && !!y?.code && x.code.toUpperCase() !== y.code.toUpperCase();
  if (differ(a.origin, b.origin) || differ(a.destination, b.destination)) return false;
  if (normalizeReference(a.confirmation) !== normalizeReference(b.confirmation)) return false;
  if (localDate(a.start) !== localDate(b.start)) return false;
  if (Math.abs(Date.parse(a.start) - Date.parse(b.start)) > 6 * 3_600_000) return false;
  const [x, y] = [serviceNumbers(a.title, true), serviceNumbers(b.title, true)];
  return [...x].some((n) => [...y].some((m) => sameService(n, m)));
}

// One event told with a time and without: a ticket email that gives only
// the day, and another (the reminder, the e-ticket) that gives the time.
// Only under one reference, on the same day, and the same event: one
// order may hold two (a museum and an aquarium) on one day.
function timeLearned(a: ExtractedSegment, b: ExtractedSegment): boolean {
  if (isUntimed(a) === isUntimed(b) || !a.confirmation || !b.confirmation) return false;
  return normalizeReference(a.confirmation) === normalizeReference(b.confirmation) && localDate(a.start) === localDate(b.start) && sameTicketedEvent(a, b);
}

// Two lines of one order are one event when their event names and venues
// agree (eventIdentities): seats 6 and seats 7-8 of one show, not the
// museum and the aquarium bought together.
function sameTicketedEvent(a: ExtractedSegment, b: ExtractedSegment): boolean {
  const [ours, theirs] = eventIdentities(a, b);
  return ours.event.size > 0 && theirs.event.size > 0 && !identitiesConflict(ours, theirs);
}

// The tickets one email lists for one event, under one reference and at
// one time (seats 6, then seats 7-8), are one booking, their details
// merged; two events of one order, two rooms or two flights stay two.
export function oneBookingPerEvent<S extends ExtractedSegment>(segments: readonly S[]): S[] {
  const out: S[] = [];
  for (const segment of segments) {
    const event = segment.type === "activity" || segment.type === "other";
    const i = event && segment.confirmation
      ? out.findIndex(
          (o) =>
            o.type === segment.type &&
            !!o.confirmation &&
            normalizeReference(o.confirmation) === normalizeReference(segment.confirmation!) &&
            o.start.slice(0, 16) === segment.start.slice(0, 16) &&
            sameTicketedEvent(o, segment),
        )
      : -1;
    if (i < 0) out.push(segment);
    else out[i] = mergeDetails(out[i]!, segment);
  }
  return out;
}

// A name as compared: compatibility forms folded, accents dropped, case
// ignored, and only letters and numbers of any script kept, so "\u6771\u4eac" and
// "\u5927\u962a" still tell two listings apart.
const normalizeName = (text: string) =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// One stay told twice, by a booking request or receipt and its
// confirmation: the same provider, the same listing title, and the same
// check-in and check-out instants. The two may name its town differently
// (the city, then the suburb), so cities are not compared: without a list
// of which suburbs belong to which city, comparing them would keep St Kilda
// and Melbourne apart. Known countries must agree.
function sameListing(a: ExtractedSegment, b: ExtractedSegment): boolean {
  if (a.type !== "lodging" || b.type !== "lodging") return false;
  const [x, y] = [a.destination?.country, b.destination?.country];
  if (x && y && x.toUpperCase() !== y.toUpperCase()) return false;
  if (!a.provider || !b.provider || normalizeName(a.provider) !== normalizeName(b.provider)) return false;
  if (!normalizeName(a.title) || normalizeName(a.title) !== normalizeName(b.title)) return false;
  return !!a.end && !!b.end && compareInstants(a.start, b.start) === 0 && compareInstants(a.end, b.end) === 0;
}

// How much a place says, compared in order as a tuple: an address, then
// coordinates, then a city.
const placeDetail = (place: Place) => [place.address ? 1 : 0, place.lat !== undefined ? 1 : 0, place.city ? 1 : 0];

// Whether a stay's place found again says more than the one it has: more
// detail (placeDetail), or as much from the email bearing the reference
// the booking lacked (a confirmation, where the request named only the
// town).
function betterPlace(existing: ExtractedSegment, found: ExtractedSegment): boolean {
  if (existing.type !== "lodging" || !existing.destination || !found.destination) return false;
  const order = compareMatchRanks(placeDetail(found.destination), placeDetail(existing.destination));
  return order > 0 || (order === 0 && !existing.confirmation && !!found.confirmation);
}

// A place taken over another, keeping what only the other knew: its code,
// city, country, address and coordinates (both or neither), so a better
// place that leaves out the country does not drop it.
function fillPlace(preferred: Place, other: Place): Place {
  const filled: Place = { ...preferred };
  for (const key of ["code", "city", "country", "address"] as const) {
    if (filled[key] === undefined && other[key] !== undefined) filled[key] = other[key];
  }
  if (filled.lat === undefined && filled.lon === undefined && other.lat !== undefined && other.lon !== undefined) {
    filled.lat = other.lat;
    filled.lon = other.lon;
  }
  return filled;
}

// Every word of an event's name but a few that join others, accents and
// case aside: short words and numbers tell events apart.
const joiningWords = new Set(["the", "a", "an", "at", "of", "and"]);
function eventWords(...texts: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const word of tokens(text)) {
      if (!joiningWords.has(word)) out.add(word);
    }
  }
  return out;
}

// Whether two activities at the same minute are one event confirmed twice
// under different references (a cinema's booking email and its reservation
// email): the same seller, by its name or the domain the emails came from
// (`senderA`, `senderB`), the same town where both give one, and the same
// event by name. The event is the title before any " at <venue>", less the
// venue's and the seller's own words; one name must hold every word of the
// other, so two films at one cinema and time stay two.
export function sameEvent(a: ExtractedSegment, b: ExtractedSegment, senderA?: string, senderB?: string): boolean {
  if (a.type !== "activity" || b.type !== "activity") return false;
  if (a.start.slice(0, 16) !== b.start.slice(0, 16)) return false;
  const theirBrand = words(b.provider);
  const sameSeller =
    (!!senderA && !!senderB && senderA.trim().toLowerCase() === senderB.trim().toLowerCase()) ||
    [...words(a.provider)].some((word) => theirBrand.has(word));
  if (!sameSeller) return false;
  const differ = (x?: string, y?: string) => x !== undefined && y !== undefined && x.trim().toLowerCase() !== y.trim().toLowerCase();
  if (differ(a.destination?.city, b.destination?.city) || differ(a.destination?.country, b.destination?.country)) return false;
  const [ours, theirs] = eventIdentities(a, b);
  if (ours.event.size === 0 || theirs.event.size === 0) return false;
  return !identitiesConflict(ours, theirs);
}

export type EventIdentity = { event: Set<string>; venue: Set<string> };

// What two activities each are and where, as they are told apart: the event
// is the title before any " at <venue>", every word counting however short
// (Toy Story 4 is not Toy Story 5, nor Inside Out Inside Man), less the
// places' and the sellers' words; the venue is what follows " at ", or the
// place's name, less the sellers' and the towns' words. `ignore` leaves out
// more (a receipt's own words).
export function eventIdentities(a: ExtractedSegment, b: ExtractedSegment, ignore: readonly string[] = []): [EventIdentity, EventIdentity] {
  const seller = eventWords(a.provider, b.provider);
  const cities = eventWords(a.destination?.city, b.destination?.city);
  const places = eventWords(a.destination?.name, a.destination?.city, b.destination?.name, b.destination?.city);
  const identity = (s: ExtractedSegment): EventIdentity => {
    const [name = "", ...at] = s.title.split(/\s+(?:at|@)\s+/i);
    const venue = eventWords(at.join(" "), s.destination?.name);
    for (const word of [...seller, ...cities, ...ignore]) venue.delete(word);
    const event = eventWords(name);
    for (const word of [...places, ...seller, ...ignore]) event.delete(word);
    return { event, venue };
  };
  return [identity(a), identity(b)];
}

// Whether two named venues, or two event names, disagree: where both have
// one, one must hold every word of the other ("Everyman" may shorten
// "Everyman Muswell Hill", but Muswell Hill is not Hampstead).
export function identitiesConflict(x: EventIdentity, y: EventIdentity): boolean {
  const within = (p: Set<string>, q: Set<string>) => [...p].every((word) => q.has(word));
  const differ = (p: Set<string>, q: Set<string>) => p.size > 0 && q.size > 0 && !within(p, q) && !within(q, p);
  return differ(x.venue, y.venue) || differ(x.event, y.event);
}

// A booking found again, with what the new email adds to it: fields it
// lacked, the new notes (seats, a screen) where it has not got them, and the
// new reference when it differs. Nothing else it already says is replaced,
// but a stay's place, unless the user `edited` the booking, gives way to a
// more specific one (betterPlace): the suburb and address a confirmation
// gives over the town its request named, keeping what only the old place
// said (fillPlace).
// The same moment some milliseconds on, written in the instant's own offset
// (status.ts's shiftInstant, which imports this file).
function shifted(instant: string, ms: number): string {
  const offset = /([+-]\d{2}:\d{2}|Z)$/.exec(instant)?.[1] ?? "Z";
  const minutes = offset === "Z" ? 0 : (offset.startsWith("-") ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(Date.parse(instant) + ms + minutes * 60_000).toISOString().slice(0, 19);
  return `${local}${offset === "Z" ? "Z" : offset}`;
}

// A journey's times come from the newest email that gives them (`newer`:
// sent after every email already behind it), as a schedule change moves a
// flight; times the user set by hand stay.
export function mergeDetails<S extends ExtractedSegment>(existing: S, found: ExtractedSegment, { edited = false, newer = false }: { edited?: boolean; newer?: boolean } = {}): S {
  const merged: S = { ...existing };
  if (newer && !edited && journeyTypes.has(existing.type) && found.type === existing.type) {
    // A change that gives no arrival moves the old one with the departure,
    // keeping the journey's length, rather than leaving it before it.
    const moved = Date.parse(found.start) - Date.parse(existing.start);
    merged.start = found.start;
    if (found.end !== undefined) merged.end = found.end;
    else if (existing.end !== undefined) merged.end = shifted(existing.end, moved);
  }
  // An event first known by its day alone takes the time it was then told.
  if (!edited && isUntimed(existing) && !isUntimed(found) && found.type === existing.type && localDate(found.start) === localDate(existing.start)) {
    merged.start = found.start;
    if (found.end !== undefined) merged.end = found.end;
  }
  if (!edited && betterPlace(existing, found)) merged.destination = fillPlace(found.destination!, existing.destination!);
  if (merged.provider === undefined && found.provider !== undefined) merged.provider = found.provider;
  if (merged.confirmation === undefined && found.confirmation !== undefined) merged.confirmation = found.confirmation;
  if (merged.end === undefined && found.end !== undefined) merged.end = found.end;
  if (merged.origin === undefined && found.origin !== undefined) merged.origin = found.origin;
  if (merged.destination === undefined && found.destination !== undefined) merged.destination = found.destination;
  const notes = merged.notes?.trim() ? [merged.notes.trim()] : [];
  const has = (text: string) => notes.some((note) => note.toLowerCase().includes(text.toLowerCase()));
  const extra = found.notes?.trim();
  if (extra && !has(extra)) notes.push(extra);
  const other = found.confirmation;
  if (other && merged.confirmation && normalizeReference(other) !== normalizeReference(merged.confirmation) && !has(other)) {
    notes.push(`Other reference: ${other}`);
  }
  if (notes.length) merged.notes = notes.join("\n");
  return merged;
}

// Places both sides know must agree: two stays on the same nights in
// London and Manchester are two, whatever the chain; codes too.
function placesConflict(a: ExtractedSegment, b: ExtractedSegment): boolean {
  const codesDiffer = (x?: Place, y?: Place) =>
    x?.code !== undefined && y?.code !== undefined && x.code.toUpperCase() !== y.code.toUpperCase();
  if (codesDiffer(a.origin, b.origin) || codesDiffer(a.destination, b.destination)) return true;
  const known = (x?: string, y?: string) => x !== undefined && y !== undefined && x.trim().toLowerCase() !== y.trim().toLowerCase();
  for (const [x, y] of [[a.origin, b.origin], [a.destination, b.destination]] as const) {
    if (known(x?.city, y?.city) || known(x?.country, y?.country)) return true;
  }
  return false;
}

// Words that say a text is about a payment (a receipt, an invoice, a
// refund), not a booking: one list for every receipt check.
const paymentWords = /\b(payments?|paid|receipts?|invoices?|deposit|balance|refunds?|refunded)\b/i;

export function mentionsPayment(text: string | undefined): boolean {
  return !!text && paymentWords.test(text);
}

// A payment for a booking, not a visit: untimed, and called one.
export function isPaymentReceipt(segment: Pick<ExtractedSegment, "type" | "title" | "start" | "end">): boolean {
  return isUntimed(segment) && mentionsPayment(segment.title);
}

const dayNumber = (title: string) => /\bday\s*(\d+)\b/i.exec(title)?.[1];

// Two bookings at different times are one only when one of them is a
// payment receipt (dated the day it was paid, for a holiday club the week
// after, or the club's day with no time), never two dated visits: day 1 and day 2 of a camp share a
// provider, a name and often one order's reference. The receipt then needs
// the same reference, or, without one on both, the same provider and a
// distinctive word of both titles, within untimedMatchDays.
function sameUntimed(a: ExtractedSegment, b: ExtractedSegment): boolean {
  if (!isPaymentReceipt(a) && !isPaymentReceipt(b)) return false;
  if (placesConflict(a, b)) return false;
  if (Math.abs(daysBetween(localDate(a.start), localDate(b.start))) > untimedMatchDays) return false;
  const [dayA, dayB] = [dayNumber(a.title), dayNumber(b.title)];
  if (dayA && dayB && dayA !== dayB) return false;
  if (a.confirmation && b.confirmation) return normalizeReference(a.confirmation) === normalizeReference(b.confirmation);
  // The same event at the same venue as sameEvent tells them, the words
  // every receipt has aside.
  if (identitiesConflict(...eventIdentities(a, b, receiptWords))) return false;
  if (!a.provider || !b.provider || a.provider.trim().toLowerCase() !== b.provider.trim().toLowerCase()) return false;
  // What names the thing paid for: not the provider, the place's city, or
  // the words every receipt has ("Ballet payment" and "Swimming payment"
  // are two).
  const shared = new Set([...words(a.provider), ...words(a.destination?.city, b.destination?.city), ...receiptWords]);
  const ours = words(a.title);
  for (const word of words(b.title)) if (ours.has(word) && !shared.has(word)) return true;
  return false;
}

const receiptWords = ["payment", "payments", "paid", "receipt", "receipts", "invoice", "invoices", "deposit", "balance", "order", "confirmation", "booking", "fees"];

// Of several bookings sameBooking says a segment is, which it most likely
// is: lower is better, compared in order as a tuple. The same reference
// first; then, within either group, the same start minute, the same day and
// the nearest date, so of two lessons on one order the receipt goes to the
// one it is dated nearest.
export function matchRank(existing: ExtractedSegment, incoming: ExtractedSegment): [number, number, number, number] {
  const sameReference =
    !!existing.confirmation && !!incoming.confirmation && normalizeReference(existing.confirmation) === normalizeReference(incoming.confirmation);
  const days = Math.abs(daysBetween(localDate(existing.start), localDate(incoming.start)));
  return [sameReference ? 0 : 1, existing.start.slice(0, 16) === incoming.start.slice(0, 16) ? 0 : 1, days === 0 ? 0 : 1, days];
}

// Orders two matchRanks: negative when the first is the better match.
export function compareMatchRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

// Whether a cancellation email names this booking. Cancelling the wrong
// booking hides a real one, so a weak match never counts: a confirmation
// number decides when both have one; otherwise the dates must agree and the
// email's place must share a word with the booking's title or place that
// names this property or route, not its city or its chain ("Hilton London
// Kensington" doesn't cancel "Hilton London Paddington"). As in
// `sameBooking`, when the provider is the property itself (an independent
// hotel) and nothing is left on either side without it, its name is the
// evidence. Two providers that are plainly different companies never match
// (see `providersDiffer`). `sent` is when the email was sent, or read when
// that is unknown: references are recycled, so one alone reaches only
// bookings near it (`nearReference`).
export function cancels(c: ExtractedCancellation, s: ExtractedSegment, sent?: string): boolean {
  if (c.type && c.type !== s.type) return false;
  if (providersDiffer(c.provider, s.provider)) return false;
  // A journey's number may follow its operator's full name (Eurostar 9014).
  const journey = journeyTypes.has(s.type);
  // A shared reference decides which reservation; any part of it the email
  // names (a date, a time, a flight number, a direction) decides which of
  // its bookings. "BA 117 LHR to JFK on 10 June" is not the BA 116 return
  // under the same reference; the reference alone cancels them all, of
  // those near the email: an airline's ABC123 of two years ago is another
  // reservation.
  if (c.confirmation && s.confirmation) {
    if (normalizeReference(c.confirmation) !== normalizeReference(s.confirmation)) return false;
    if (!c.start && sent && !nearReference(s, sent)) return false;
    if (servicesConflict(c.place, s.title, journey)) return false;
    if (c.start) {
      if (localDate(c.start) !== localDate(s.start)) return false;
      if (s.type !== "lodging" && c.start.slice(11, 16) !== "00:00" && c.start.slice(11, 16) !== s.start.slice(11, 16)) return false;
    }
    if (c.end && s.end && localDate(c.end) !== localDate(s.end)) return false;
    if (journeyTypes.has(s.type)) {
      if (c.origin && s.origin && !sameEnd(c.origin, s.origin)) return false;
      if (c.destination && s.destination && !sameEnd(c.destination, s.destination)) return false;
    }
    return true;
  }
  if (!c.start || localDate(c.start) !== localDate(s.start)) return false;
  if (c.end && s.end && localDate(c.end) !== localDate(s.end)) return false;
  // Anything but a stay starts at the minute the email gives: a 14:00
  // Hamlet cancellation leaves the 19:30 performance alone. A stay's times
  // are the hotel's usual check-in, so its date is enough. Midnight is the
  // extraction's "no time given".
  const timed = c.start.slice(11, 16) !== "00:00";
  if (s.type !== "lodging" && timed && c.start.slice(11, 16) !== s.start.slice(11, 16)) return false;
  // A flight or train number on both sides must agree, before anything else
  // counts.
  if (servicesConflict(c.place, s.title, journey)) return false;
  // A journey must also go the same way: an 08:00 LHR to CDG cancellation
  // leaves the 20:00 CDG to LHR return alone.
  if (journeyTypes.has(s.type)) {
    if (!sameEnd(c.origin, s.origin) || !sameEnd(c.destination, s.destination)) return false;
    // The same way at the same minute is that leg. Without a time, the same
    // way on the same day is too, unless the email names something more
    // (a flight number), which must then agree, as below: "LHR to CDG" has
    // no word left once its codes and cities are set aside.
    if (timed) return true;
    // The same flight or train number, however spaced ("BA117", "BA 117"),
    // is that leg. A number on one side only leaves it open which service
    // this is, and the route's words alone don't say.
    const ours = serviceNumbers(c.place, true);
    const theirs = serviceNumbers(s.title, true);
    if ([...theirs].some((n) => [...ours].some((m) => sameService(n, m)))) return true;
    if (ours.size > 0 || theirs.size > 0) return false;
    const aside = words(s.origin?.city, s.destination?.city, c.provider, s.provider);
    if ([...words(c.place)].every((word) => aside.has(word))) return true;
  }
  // An event the email names must be this one, by the rule sameEvent uses:
  // Toy Story 4 is not Toy Story 5, at the same time and cinema.
  if (s.type === "activity" && c.place) {
    const named: ExtractedSegment = { type: s.type, title: c.place, start: c.start, ...(c.provider ? { provider: c.provider } : {}) };
    if (identitiesConflict(...eventIdentities(named, s))) return false;
  }
  // What the email names and what the booking is called, one tokenizer for
  // both the identity check and the evidence. Anything but a journey reads
  // names with eventWords, short words included ("The Ned", "ibis London
  // Bow"); a journey's ends and numbers were settled above, and its names
  // read with words, as there.
  const without = (found: Set<string>, drop: Set<string>) => new Set([...found].filter((w) => !drop.has(w)));
  // Somewhere else by name: not this booking, whatever else agrees.
  if (!journey && localityConflict(c.place, s.destination?.city ?? s.origin?.city, [s.title, s.destination?.name, s.origin?.name], c.city)) return false;
  const read = journey ? words : eventWords;
  const aside = journey ? words(s.origin?.city, s.destination?.city) : new Set([...eventWords(s.origin?.city, s.destination?.city), ...genericWords]);
  const brand = read(c.provider, s.provider);
  const withoutBrand = new Set([...aside, ...brand]);
  let ours = without(read(c.place), withoutBrand);
  let theirs = without(read(s.title, s.destination?.name, s.origin?.name), withoutBrand);
  if (ours.size === 0 && theirs.size === 0) {
    ours = without(read(c.place), aside);
    theirs = without(read(s.title, s.destination?.name, s.origin?.name), aside);
  }
  // A stay must be this hotel, as sameEvent tells events apart: one name
  // holds every word of the other, the city, the provider and the generic
  // words aside. A chain word alone is two hotels: "Hilton London
  // Kensington" and "Hilton London Paddington", "ibis London Bow" and
  // "ibis London City".
  const within = (p: Set<string>, q: Set<string>) => [...p].every((word) => q.has(word));
  if (s.type === "lodging" && ours.size > 0 && theirs.size > 0 && !within(ours, theirs) && !within(theirs, ours)) return false;
  for (const word of ours) if (theirs.has(word)) return true;
  return false;
}

// How far from a cancellation email a booking it names by reference alone
// can be: one that ended a month before it was sent (a late notice), or
// starts within two years after (about as far ahead as anything sells).
const referenceDaysBefore = 30;
const referenceDaysAfter = 730;

function nearReference(s: ExtractedSegment, sent: string): boolean {
  const at = Date.parse(sent);
  if (Number.isNaN(at)) return true;
  const day = (offset: number) => new Date(at + offset * 86_400_000).toISOString().slice(0, 10);
  return localDate(s.end ?? s.start) >= day(-referenceDaysBefore) && localDate(s.start) <= day(referenceDaysAfter);
}

// Sites and agencies that sell others' bookings under their own name: the
// airline, hotel or railway they sold is theirs to cancel too. Matched in
// the name run together ("Trip.com" is "tripcom").
const bookingSellers = [
  "expedia", "tripcom", "bookingcom", "hotelscom", "priceline", "orbitz", "travelocity", "agoda", "kayak", "hopper",
  "edreams", "opodo", "kiwicom", "lastminute", "ctrip", "gotogate", "mytrip", "hotwire", "egencia", "trainline",
  "raileurope", "sncf", "omio", "flightcentre", "trailfinders", "navan", "tripactions", "amextravel",
];
const sellerWords = new Set(["travel", "travels", "tours", "agency", "agent", "holidays", "vacations"]);
// What company names share without being one company.
const companyWords = new Set([
  "air", "airways", "airline", "airlines", "aer", "hotel", "hotels", "resort", "resorts", "group", "inc", "ltd",
  "limited", "plc", "co", "company", "corp", "sa", "ag", "gmbh", "the", "and", "by", "of", "de", "rail", "railway",
  "railways", "cruise", "cruises", "line", "lines", "international",
]);

// Whether two providers are plainly different companies: both named, no
// booking site or agency (which sells others' bookings) among them, no
// distinctive word in common, neither the other's initials (BA is British
// Airways) nor a code too short to tell (LH could be Lufthansa).
export function providersDiffer(a: string | undefined, b: string | undefined): boolean {
  const [x, y] = [tokens(a), tokens(b)];
  if (x.length === 0 || y.length === 0) return false;
  const [joinedX, joinedY] = [x.join(""), y.join("")];
  if (joinedX === joinedY) return false;
  const seller = (t: string[], joined: string) => bookingSellers.some((name) => joined.includes(name)) || t.some((w) => sellerWords.has(w));
  if (seller(x, joinedX) || seller(y, joinedY)) return false;
  const initials = (t: string[]) => t.map((w) => w[0]).join("");
  if (joinedX === initials(y) || joinedY === initials(x)) return false;
  const distinctive = (t: string[]) => t.filter((w) => !companyWords.has(w));
  const theirs = new Set(distinctive(y));
  if (distinctive(x).some((w) => theirs.has(w))) return false;
  if (joinedX.length <= 3 || joinedY.length <= 3) return false;
  return true;
}

// Whether a cancellation's end of a journey (a code or a name) is the
// booking's. A code decides when both have one (LHR is not LGW); otherwise
// the name must share a word that isn't the city's: London Heathrow and
// London Gatwick are both London.
function sameEnd(named: string | undefined, place: Place | undefined): boolean {
  if (!named || !place) return false;
  const code = place.code?.trim().toUpperCase();
  // Given as a code: three capital letters, as an airport's or a station's
  // is written ("LTN", "KGX"). A name such as "Luton" never is one.
  const given = named.trim();
  if (code && /^[A-Z]{3}$/.test(given)) return given === code;
  if (localityConflict(given, place.city, [place.name])) return false;
  // Named exactly as the booking names it ("Dublin Airport"), case,
  // accents and spacing aside: that end, though no word of it is left once
  // the city and "airport" are set aside.
  // Letters and digits of any script count (成田空港 is not 羽田空港), and
  // two names with none at all are never the same name.
  const plain = (text: string) => tokens(text).join(" ");
  const plainGiven = plain(given);
  if (plainGiven !== "" && plainGiven === plain(place.name)) return true;
  // Beyond an exact name, a word that names this end: not its city, and not
  // a word every airport or station has ("Newark Liberty International" is
  // not "John F Kennedy International").
  const aside = new Set([...words(place.city), ...endpointWords]);
  const ours = [...words(named)].filter((word) => !aside.has(word));
  const theirs = words(place.name, place.code);
  return ours.some((word) => theirs.has(word));
}

// What airports, stations and ports are called, in the languages their
// names are often given in: never evidence of which one.
const endpointWords = [
  "international", "intl", "airport", "aeroport", "aeropuerto", "aeroporto", "flughafen", "lufthavn", "airfield",
  "regional", "domestic", "terminal", "station", "central", "centrale", "centraal", "main", "hbf", "hauptbahnhof",
  "bahnhof", "gare", "estacion", "stazione", "railway", "rail", "port", "pier", "harbour", "harbor", "ferry", "coach",
  "bus", "north", "south", "east", "west",
];

// A cancellation keeps waiting after it finds a booking, since another leg
// under the same reference can still arrive. Each booking an email names
// stops waiting once nothing more can come for it: a month after the email
// was read (long enough for a backfill to reach the older confirmations)
// when that booking has ended, or after a year when it gives no dates. The
// email stops waiting when every booking it names has (a dated stay that has
// passed doesn't end the wait for a flight named by its reference only).
export const pendingCancellationGraceDays = 30;
export const pendingCancellationUndatedDays = 365;

type Waiting = { cancellations: readonly ExtractedCancellation[]; at: string };

function entryExpired(c: ExtractedCancellation, ageDays: number, today: string): boolean {
  if (ageDays < pendingCancellationGraceDays) return false;
  const dates = [c.start, c.end].filter((d): d is string => !!d);
  if (dates.length === 0) return ageDays >= pendingCancellationUndatedDays;
  return dates.every((d) => localDate(d) < today);
}

// The bookings a cancellation email still waits for.
export function stillWaiting(p: Waiting, now: string): ExtractedCancellation[] {
  const ageDays = (Date.parse(now) - Date.parse(p.at)) / 86_400_000;
  const today = now.slice(0, 10);
  return p.cancellations.filter((c) => !entryExpired(c, ageDays, today));
}

export function pendingCancellationExpired(p: Waiting, now: string): boolean {
  return stillWaiting(p, now).length === 0;
}

// Trips whose dates touch the range at all (no gap allowed), the candidates
// a booking could be a duplicate in.
export function overlappingTrips(trips: readonly Trip[], range: { start: string; end: string }): Trip[] {
  return trips.filter((trip) => trip.start <= range.end && trip.end >= range.start);
}
