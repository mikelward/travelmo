import { airportPlace } from "./airportPlaces";
import { canonicalName, sameTraveler } from "./travelers";
import { placeCountry } from "./reports";
import type { ExtractedSegment, Place } from "./schema";
import { liveSegments, localDate } from "./trips";

// Why a trip looks like two in one (SPEC "Two trips in one"), as its page
// says it: two flights in the air at once; a flight leaving from another
// country hours after the one before it landed; or bookings for two groups
// of people who share no flight.
export type MixedTrip<S extends ExtractedSegment = ExtractedSegment> =
  | { kind: "overlap"; first: S; second: S }
  | { kind: "elsewhere"; first: S; second: S }
  | { kind: "travelers"; groups: string[][] };

// How soon after landing a flight from another country gives a traveler
// away: no one person lands in one country and takes off from another
// within half a day.
export const elsewhereHours = 12;

const ms = (instant: string) => Date.parse(instant);
const arrives = (s: ExtractedSegment) => s.end ?? s.start;
// What a place goes by: its name, its city and, for an airport code, the
// city the airport serves (BOS is Boston).
const placeNames = (p: Place) =>
  new Set([p.name, p.city, p.code ? airportPlace(p.code)?.city : undefined, p.code].flatMap((n) => (n?.trim() ? [n.trim().toLowerCase()] : [])));
// One place however a booking writes it: the same airport code, or a name
// or city the other goes by ("Boston" beside BOS). Two codes are the same
// only alike, so LHR is never LGW. Two places neither booking gives match.
function samePlace(a: Place | undefined, b: Place | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.code && b.code) return a.code.trim().toUpperCase() === b.code.trim().toUpperCase();
  const other = placeNames(b);
  return [...placeNames(a)].some((n) => other.has(n));
}
const sameRoute = (a: ExtractedSegment, b: ExtractedSegment) => samePlace(a.origin, b.origin) && samePlace(a.destination, b.destination);
// One flight however many bookings give it: its route and its day.
const sameFlight = (a: ExtractedSegment, b: ExtractedSegment) => sameRoute(a, b) && localDate(a.start) === localDate(b.start);
// The same place, known on both: an airport a booking leaves out matches
// nothing.
const sharedPlace = (a: Place | undefined, b: Place | undefined) => !!a && !!b && samePlace(a, b);
// How far apart two bookings may put one journey's ends: a schedule change
// one booking heard of and the other didn't.
const journeySlackMs = 60 * 60_000;
const near = (a: string, b: string) => Math.abs(ms(a) - ms(b)) <= journeySlackMs;
// Whether `leg` is part of `journey`: within its times, and leaving from
// where and when it leaves or landing where and when it lands, as one
// booking writes ADL to LHR and another its legs, ADL to DOH and DOH to LHR.
const legOf = (leg: ExtractedSegment, journey: ExtractedSegment) =>
  ms(leg.start) >= ms(journey.start) - journeySlackMs &&
  ms(arrives(leg)) <= ms(arrives(journey)) + journeySlackMs &&
  ((sharedPlace(leg.origin, journey.origin) && near(leg.start, journey.start)) || (sharedPlace(leg.destination, journey.destination) && near(arrives(leg), arrives(journey))));
// One journey, however the bookings write it: the same route, or one a leg
// of the other.
const oneJourney = (a: ExtractedSegment, b: ExtractedSegment) => sameRoute(a, b) || legOf(a, b) || legOf(b, a);

// Whether a trip's bookings look like two trips filed as one, and why;
// undefined when they could all be one traveler's (or one party's). Goes by
// what is still booked, leaving out the names its owner took off it
// (`removed`). Flights alike (the same route at once) are one flight booked
// twice, not two, and a flight with its legs is one journey.
export function mixedTrip<S extends ExtractedSegment>(segments: readonly S[], removed: readonly string[] = []): MixedTrip<S> | undefined {
  const live = liveSegments(segments);
  const flights = live.filter((s) => s.type === "flight").sort((a, b) => ms(a.start) - ms(b.start));
  for (let i = 0; i < flights.length; i++) {
    for (let j = i + 1; j < flights.length; j++) {
      const a = flights[i]!;
      const b = flights[j]!;
      if (ms(b.start) >= ms(arrives(a)) && ms(b.start) !== ms(a.start)) break;
      if (!oneJourney(a, b)) return { kind: "overlap", first: a, second: b };
    }
  }
  for (let i = 1; i < flights.length; i++) {
    const a = flights[i - 1]!;
    const b = flights[i]!;
    // Only a known landing: a flight without its arrival time says nothing
    // of when it lands, and one flight booked twice isn't two.
    if (!a.end || (sameRoute(a, b) && ms(a.start) === ms(b.start))) continue;
    const gap = ms(b.start) - ms(a.end);
    if (gap < 0 || gap > elsewhereHours * 3_600_000) continue;
    const landed = placeCountry(a.destination, "flight", airportPlace);
    const leaves = placeCountry(b.origin, "flight", airportPlace);
    if (landed && leaves && landed !== leaves) return { kind: "elsewhere", first: a, second: b };
  }
  // Groups that fly, and share no flight with each other: a party flying
  // apart from the rest would share at least one (travelerGroups joins
  // those that do).
  const flying = travelerGroups(live, removed).filter((g) => flights.some((f) => names(f, removed).some((n) => g.includes(n))));
  if (flying.length > 1) return { kind: "travelers", groups: [flying[0]!, flying[1]!] };
  return undefined;
}

const names = (s: ExtractedSegment, removed: readonly string[]) => {
  const gone = new Set(removed.flatMap((n) => canonicalName(n) ?? []));
  return (s.travelers ?? []).flatMap((n) => canonicalName(n) ?? []).filter((n) => !gone.has(n));
};

// The trip's travelers in groups that travel together: names on one booking
// are one group, and a name on two bookings joins theirs, as do another
// spelling of it and anyone on the same flight.
function travelerGroups(live: readonly ExtractedSegment[], removed: readonly string[]): string[][] {
  const parent = new Map<string, string>();
  const find = (n: string): string => {
    const p = parent.get(n) ?? n;
    if (p === n) return n;
    const root = find(p);
    parent.set(n, root);
    return root;
  };
  for (const s of live) {
    const ns = names(s, removed);
    for (const n of ns) if (!parent.has(n)) parent.set(n, n);
    for (const n of ns.slice(1)) parent.set(find(n), find(ns[0]!));
  }
  // Those on one flight however many bookings give it, or on a flight and
  // its legs: a party booked apart.
  const flown = live.filter((s) => s.type === "flight").flatMap((s) => {
    const first = names(s, removed)[0];
    return first ? [{ s, first }] : [];
  });
  for (let i = 0; i < flown.length; i++) {
    for (let j = i + 1; j < flown.length; j++) {
      const [a, b] = [flown[i]!, flown[j]!];
      if (sameFlight(a.s, b.s) || legOf(a.s, b.s) || legOf(b.s, a.s)) parent.set(find(b.first), find(a.first));
    }
  }
  // One person however the bookings spell them ("John Smith", "John Andrew
  // Smith", "J Smith"): sameTraveler.
  const all = [...parent.keys()];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) if (sameTraveler(all[i]!, all[j]!)) parent.set(find(all[j]!), find(all[i]!));
  }
  const byRoot = new Map<string, string[]>();
  for (const n of parent.keys()) byRoot.set(find(n), [...(byRoot.get(find(n)) ?? []), n]);
  return [...byRoot.values()];
}
