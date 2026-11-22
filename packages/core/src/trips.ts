import type { Location } from "./geocode";
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

const journeyTypes: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry"]);
// The longest a journey is believed to take, in days: a week on the
// Trans-Siberian, with a day to spare.
const maxJourneyDays = 8;

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
  for (const segment of segments) {
    const tooLong = !!segment.end && journeyTypes.has(segment.type) && daysBetween(localDate(segment.start), localDate(segment.end)) > maxJourneyDays;
    const last = segment.end && !tooLong ? segment.end : segment.start;
    for (const date of [localDate(segment.start), localDate(last)]) {
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
  if ((isPaymentReceipt(a) || isPaymentReceipt(b)) && wall(a.start) !== wall(b.start)) return sameUntimed(a, b);
  if (timedTypes.has(a.type)) {
    if (wall(a.start) !== wall(b.start)) return false;
  } else {
    if (localDate(a.start) !== localDate(b.start)) return false;
    if (a.end && b.end && localDate(a.end) !== localDate(b.end)) return false;
  }
  if (a.confirmation && b.confirmation) return normalizeReference(a.confirmation) === normalizeReference(b.confirmation);
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

// Every word of an event's name but a few that join others, accents and
// case aside: short words and numbers tell events apart.
const joiningWords = new Set(["the", "a", "an", "at", "of", "and"]);
function eventWords(...texts: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const word of (text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (word && !joiningWords.has(word)) out.add(word);
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
// new reference when it differs. Nothing it already says is replaced.
export function mergeDetails<S extends ExtractedSegment>(existing: S, found: ExtractedSegment): S {
  const merged: S = { ...existing };
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

const paymentWords = /\b(payments?|paid|receipts?|invoices?|deposit|balance)\b/i;

// A payment for a booking, not a visit: untimed, and called one.
export function isPaymentReceipt(segment: Pick<ExtractedSegment, "type" | "title" | "start" | "end">): boolean {
  return isUntimed(segment) && paymentWords.test(segment.title);
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

// Trips whose dates touch the range at all (no gap allowed), the candidates
// a booking could be a duplicate in.
export function overlappingTrips(trips: readonly Trip[], range: { start: string; end: string }): Trip[] {
  return trips.filter((trip) => trip.start <= range.end && trip.end >= range.start);
}
