import { compareInstants } from "./instant";
import type { ExtractedSegment, HomeCorrection, Place, SegmentType, Trip } from "./schema";
import { findTripForRange, isUntimed, segmentDateRange } from "./trips";

// Where someone lives, over time. Nobody types it in: it is worked out from
// their journeys, since a round trip leaves from home and comes back to it.
// People move, so it is a timeline of periods, not one place. A period's
// bounds are calendar dates, inclusive; the first has no `from` and the last
// no `until`, as the bookings say nothing about before or after them.
export type HomePeriod = {
  city: string;
  country?: string;
  from?: string;
  until?: string;
};

type Booking = Pick<ExtractedSegment, "type" | "start" | "end" | "origin" | "destination">;

const journeyTypes: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry"]);

// A place's town, for telling home from away: the city where the source gave
// one, otherwise its name (an airport or station named without a city).
function town(place: Place | undefined): { city: string; country?: string } | undefined {
  const city = place?.city ?? place?.name;
  if (!city) return undefined;
  return place?.country ? { city, country: place.country } : { city };
}

// Two towns match on the city, ignoring case, and on the country when both
// give one.
function sameTown(a: { city: string; country?: string }, b: { city: string; country?: string }): boolean {
  if (a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) return false;
  return !a.country || !b.country || a.country.toUpperCase() === b.country.toUpperCase();
}

const localDate = (instant: string) => instant.slice(0, 10);

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// How long someone can be away from a town and still live there, in days.
// A round trip longer than this says nothing about where home is: they
// lived where it went for a while, or its way out was never imported and it
// is really the way back from one visit and the way out on the next.
const stayDays = 60;

// The round trips in a run of journeys: each leaves from a town and ends
// with the first journey back into it, however many legs lie between. A
// chain that never returns (a one-way move, or bookings missing), or one
// away for longer than `stayDays`, gives no round trip, and the next journey
// starts afresh, so round trips within a long one count instead. Legs go in
// the order they leave, by instant, since local times misorder them across
// the date line; a journey within one town (a river bus) goes nowhere and
// says nothing.
function roundTrips(segments: readonly Booking[]): { base: { city: string; country?: string }; start: string }[] {
  const journeys = segments
    .filter((s) => {
      const from = town(s.origin);
      const to = town(s.destination);
      return journeyTypes.has(s.type) && from && to && !sameTown(from, to);
    })
    .sort((a, b) => compareInstants(a.start, b.start));
  const trips: { base: { city: string; country?: string }; start: string }[] = [];
  let i = 0;
  while (i < journeys.length) {
    const base = town(journeys[i]!.origin)!;
    const back = journeys.findIndex((j, k) => k >= i && sameTown(town(j.destination)!, base));
    if (back < 0 || Date.parse(journeys[back]!.start) - Date.parse(journeys[i]!.start) > stayDays * 86_400_000) {
      i++;
      continue;
    }
    trips.push({ base, start: localDate(journeys[i]!.start) });
    i = back + 1;
  }
  return trips;
}

// Home over time from someone's bookings. The base of the first round trip
// is home until another base holds for two round trips in a row: that is a
// move, dated from the first of them. A single trip from somewhere else (a
// holiday flight home from a relative's) is not, and nor are trips from
// somewhere home comes straight back to (side trips on a visit whose way
// out was never imported): the next round trip after them is from home.
export function homeTimeline(segments: readonly Booking[]): HomePeriod[] {
  const trips = roundTrips(segments);
  const periods: HomePeriod[] = [];
  let current: { city: string; country?: string } | undefined;
  for (let i = 0; i < trips.length; i++) {
    const { base, start } = trips[i]!;
    if (!current) {
      current = base;
      periods.push({ ...base });
      continue;
    }
    if (sameTown(base, current)) continue;
    let end = i;
    while (end + 1 < trips.length && sameTown(trips[end + 1]!.base, base)) end++;
    const after = trips[end + 1];
    if (end === i || (after && sameTown(after.base, current))) {
      i = end;
      continue;
    }
    periods[periods.length - 1]!.until = dayBefore(start);
    periods.push({ ...base, from: start });
    current = base;
    i = end;
  }
  return periods.map(({ city, country, from, until }) => ({
    city,
    ...(country ? { country } : {}),
    ...(from ? { from } : {}),
    ...(until ? { until } : {}),
  }));
}

const covers = (period: HomePeriod, date: string) =>
  (!period.from || period.from <= date) && (!period.until || date <= period.until);

// Home on a date. Corrections the person made (`overrides`), once there are
// any, are the whole timeline: what was worked out no longer counts, and
// there is no home before the earliest of them (effectiveHomes).
export function homeAt(periods: readonly HomePeriod[], date: string, overrides: readonly HomePeriod[] = []): HomePeriod | undefined {
  return (overrides.length > 0 ? overrides : periods).find((p) => covers(p, date));
}

// Whether two places are one: the same code where both have one, else the
// same name or the same address.
function samePlace(a: Place, b: Place): boolean {
  const norm = (text: string | undefined) => text?.trim().toLowerCase();
  if (a.code && b.code) return norm(a.code) === norm(b.code);
  return norm(a.name) === norm(b.name) || (!!a.address && norm(a.address) === norm(b.address));
}

// A ground transfer: a car or taxi booked from one place to another (an
// airport to home), as opposed to a car hired and returned in one place.
// It travels like a journey, so it is never a day out at home, but it is
// no round trip and says nothing about where home is (roundTrips).
export function isTransfer(segment: Pick<ExtractedSegment, "type" | "origin" | "destination">): boolean {
  if (segment.type !== "car_rental" && segment.type !== "other") return false;
  return !!segment.origin && !!segment.destination && !samePlace(segment.origin, segment.destination);
}

// Words that say nothing about which airport or station a place is.
const hubWords = new Set(["airport", "international", "terminal", "station", "central", "railway", "rail", "city"]);
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Whether a place in a ride's booking is the airport or station a journey
// leaves from or arrives at: the same code, the code written in it
// ("Heathrow Terminal 3 - LHR"), or a word of the hub's name that is not
// its town's ("Heathrow" of London Heathrow).
function atHub(place: Place, hub: Place): boolean {
  if (place.code && hub.code) return place.code.toUpperCase() === hub.code.toUpperCase();
  const text = `${place.name} ${place.address ?? ""}`;
  const code = hub.code?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code && new RegExp(`\\b${code}\\b`, "i").test(text)) return true;
  const townWords = new Set(wordsOf(`${hub.city ?? ""} ${hub.country ?? ""}`));
  const words = new Set(wordsOf(text));
  return wordsOf(hub.name).some((w) => w.length >= 4 && !hubWords.has(w) && !townWords.has(w) && words.has(w));
}

// How close a ride must be to a journey at the same airport or station to
// belong with it: a car home after a delayed long-haul flight, or to the
// airport for the morning's first one.
const connectionHours = 12;

type Located = Pick<ExtractedSegment, "type" | "start" | "origin" | "destination"> & Partial<Pick<ExtractedSegment, "end">>;

// How long a traveler waits between a transfer and the journey it meets, in
// milliseconds: from landing to the ride leaving the airport, or from the
// ride reaching the airport to take-off. Undefined when they do not meet:
// another place, the wrong order (a ride from the airport before the flight
// lands), or more than `connectionHours` apart. Either may be given first.
export function connectionGap(a: Located, b: Located): number | undefined {
  const [ride, journey] = isTransfer(a) ? [a, b] : [b, a];
  if (!isTransfer(ride) || !journeyTypes.has(journey.type)) return undefined;
  const wait = (from: string, to: string) => {
    const ms = Date.parse(to) - Date.parse(from);
    return ms >= 0 && ms <= connectionHours * 3_600_000 ? ms : undefined;
  };
  const gaps = [
    journey.destination && atHub(ride.origin!, journey.destination) ? wait(journey.end ?? journey.start, ride.start) : undefined,
    journey.origin && atHub(ride.destination!, journey.origin) ? wait(ride.end ?? ride.start, journey.start) : undefined,
  ].filter((gap): gap is number => gap !== undefined);
  return gaps.length > 0 ? Math.min(...gaps) : undefined;
}

// Whether a transfer meets a journey (connectionGap).
export function connects(a: Located, b: Located): boolean {
  return connectionGap(a, b) !== undefined;
}

// A place's short name in a route: "Heathrow" for "Heathrow Terminal 3 -
// LHR, TW6 1SX", "London Heathrow" for "London Heathrow Airport (LHR)".
function shortName(place: Place): string {
  const first = place.name.split(/\s+[-–—]\s+|,/)[0] ?? place.name;
  const short = first
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(terminal\s*\w{0,2}|international|airport)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return short || place.city || place.name;
}

// A transfer named by its route, for a trip that is nothing else: "Heathrow
// to home" when it ends in the home of its day, else "Heathrow to London".
// An airport or station is named for itself, even in the home town.
export function transferTitle(
  segment: Pick<ExtractedSegment, "type" | "start" | "origin" | "destination">,
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): string | undefined {
  if (!isTransfer(segment)) return undefined;
  const home = homeAt(periods, localDate(segment.start), overrides);
  const label = (place: Place) => {
    if (place.code || /\b(airport|terminal|station)\b/i.test(`${place.name} ${place.address ?? ""}`)) return shortName(place);
    const where = town(place);
    if (home && where && sameTown(where, home)) return "home";
    return place.city ?? shortName(place);
  };
  const route = `${label(segment.origin!)} to ${label(segment.destination!)}`;
  return route.charAt(0).toUpperCase() + route.slice(1);
}

// Whether a booking that is not a journey (a stay, a ticket, a car) happens
// in the home of its day: a day out, not part of a trip away. A transfer
// travels, so it is not.
export function isAtHome(
  segment: Pick<ExtractedSegment, "type" | "start" | "destination"> & Partial<Pick<ExtractedSegment, "origin">>,
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): boolean {
  if (journeyTypes.has(segment.type) || isTransfer(segment)) return false;
  const place = town(segment.destination);
  const home = homeAt(periods, localDate(segment.start), overrides);
  return !!place && !!home && sameTown(place, home);
}

// A trip made of nothing but bookings at home: a day out, which a trip away
// never joins by nearness of dates. An empty trip says nothing.
export function isHomeTrip(
  segments: readonly (Pick<ExtractedSegment, "type" | "start" | "destination"> & Partial<Pick<ExtractedSegment, "origin">>)[],
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): boolean {
  return segments.length > 0 && segments.every((s) => isAtHome(s, periods, overrides));
}

// A title without the day or date of a course it names: "(Day 2)",
// "- Day 2", "- 11th Aug 2025", "(Mon 11 Aug)", ", 11/08/2025",
// "- 2025-08-11", "on 11 August". A date needs its month, so a number alone
// ("Toy Story 5") is kept.
const month = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const dayOfMonth = "\\d{1,2}(?:st|nd|rd|th)?";
const weekday = "(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?";
const date =
  `(?:${weekday}(?:${dayOfMonth}\\s+(?:of\\s+)?${month}|${month}\\s+${dayOfMonth})(?:,?\\s+\\d{4})?` +
  "|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|day\\s+\\d+)";
const dayOrDate = new RegExp(`(?:\\s*\\(\\s*${date}\\s*\\)|\\s*[-–—:,]\\s*${date}|\\s+on\\s+${date})\\s*$`, "i");
export const courseName = (title: string) => title.replace(dayOrDate, "").trim() || title;

type Grouped = Located & Pick<ExtractedSegment, "title">;
type Town = { city: string; country?: string };

// A booking that goes somewhere: a journey, or a transfer (a car to the
// airport).
const goes = (s: Grouped) => journeyTypes.has(s.type) || isTransfer(s);

// An outing: a ticket, an event or a car hired and returned in one place;
// nothing that travels or stays.
const isOuting = (s: Grouped) => (s.type === "activity" || s.type === "other" || s.type === "car_rental") && !goes(s);
const allOutings = (segments: readonly Grouped[]) => segments.length > 0 && segments.every(isOuting);

const millis = (instant: string) => Date.parse(instant);

// When a journey arrives: its end, unless that is more than eight days after
// it leaves (a ticket's expiry read as its arrival, as segmentDateRange).
const arrives = (s: Grouped) => (s.end && millis(s.end) - millis(s.start) <= 8 * 86_400_000 ? s.end : s.start);

const byStart = (segments: readonly Grouped[]) => segments.filter(goes).sort((a, b) => compareInstants(a.start, b.start));

// The towns some travel puts someone in while an outing is on: where the
// first journey leaves from, before it leaves; where each arrives, until the
// next leaves (and where that one leaves from); both ends of one under way;
// and where the last arrives, after it does. A stay puts them in its town
// whenever it is. An outing with no time (isUntimed: local midnight, no
// end) is on all its day, so a ticket for the day a flight lands is after
// it, and one for the day a flight leaves before it.
function townsDuring(outing: Grouped, travel: readonly Grouped[]): Town[] {
  const from = millis(outing.start);
  const to = isUntimed(outing) ? from + 86_400_000 - 1 : outing.end ? Math.max(from, millis(outing.end)) : from;
  const overlaps = (a: number, b: number) => a <= to && from <= b;
  const legs = byStart(travel);
  const places: (Place | undefined)[] = travel.filter((s) => !goes(s)).map((s) => s.destination);
  legs.forEach((leg, k) => {
    const next = legs[k + 1];
    if (k === 0 && from < millis(leg.start)) places.push(leg.origin);
    if (overlaps(millis(leg.start), millis(arrives(leg)))) places.push(leg.origin, leg.destination);
    if (next ? overlaps(millis(arrives(leg)), millis(next.start)) : to > millis(arrives(leg))) places.push(leg.destination, next?.origin);
  });
  return places.flatMap((place) => town(place) ?? []);
}

// Whether an outing happens where some travel has taken someone at the time
// (townsDuring), away from home: not in the home of its day, nor, with home
// unknown, where the travel sets off from. So a ticket in Stockholm joins
// the flight there before it or the flight back after it, while a dinner in
// London two days before a train from Southampton to London does not: that
// train only gets there after.
function onTheWay(
  outing: Grouped,
  travel: readonly Grouped[],
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[],
): boolean {
  const where = town(outing.destination);
  if (!where || travel.length === 0) return false;
  const base = homeAt(periods, localDate(outing.start), overrides) ?? town(byStart(travel)[0]?.origin);
  if (base && sameTown(where, base)) return false;
  return townsDuring(outing, travel).some((t) => sameTown(t, where));
}

// Whether two outings are one thing: tickets for one event (the same title,
// or the same town, at the same time), or days of one course in one town
// (titles the same but for the day or date, courseName).
function oneThing(a: Grouped, b: Grouped): boolean {
  const norm = (text: string) => text.trim().toLowerCase();
  const [x, y] = [town(a.destination), town(b.destination)];
  if (compareInstants(a.start, b.start) === 0 && (norm(a.title) === norm(b.title) || (x && y && sameTown(x, y)))) return true;
  const dated = a.title !== courseName(a.title) || b.title !== courseName(b.title);
  return dated && norm(courseName(a.title)) === norm(courseName(b.title)) && (!x || !y || sameTown(x, y));
}

// The trip a new booking joins by its dates, knowing where home is if it
// can. Travel (journeys, stays, a car to the airport) joins travel within a
// couple of days (findTripForRange). Outings never join by nearness of dates
// alone, home known or not: each is a trip of its own (a dinner and a show
// on one evening at home are two) unless it is one thing with another
// (oneThing: tickets for one event, the days of a course), it happens where
// travel within two days has taken someone at the time (onTheWay), or, with
// home known, it and another outing within two days are both away in one
// town. A journey, even one leaving from home, is never at home. Before any
// of that, a transfer joins the trip of the flight or train it meets
// (connects), and a journey the trip of a transfer that meets it, whichever
// came in first.
export function findTripForBooking(
  trips: readonly Trip[],
  segmentsOf: (tripId: string) => readonly Grouped[],
  booking: readonly ExtractedSegment[],
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): Trip | undefined {
  const range = segmentDateRange(booking);
  if (!range) return undefined;
  // The trip whose journey the transfer meets soonest, when several do.
  let met: { trip: Trip; gap: number } | undefined;
  for (const trip of trips) {
    for (const s of segmentsOf(trip.id)) {
      for (const b of booking) {
        const gap = connectionGap(b, s);
        if (gap !== undefined && (!met || gap < met.gap)) met = { trip, gap };
      }
    }
  }
  if (met) return met.trip;
  const near = (trip: Trip, gap: number) => !!findTripForRange([trip], range, gap);
  const away = (s: Grouped) => {
    const where = town(s.destination);
    const home = homeAt(periods, localDate(s.start), overrides);
    return !!where && !!home && !sameTown(where, home);
  };
  const ours = booking.filter(isOuting);
  const ourTravel = booking.filter((s) => !isOuting(s));
  return trips.find((trip) => {
    const segments = segmentsOf(trip.id);
    if (!allOutings(booking) && !allOutings(segments)) return near(trip, 2);
    if (!near(trip, 2)) return false;
    const theirs = segments.filter(isOuting);
    const theirTravel = segments.filter((s) => !isOuting(s));
    return (
      ours.some((a) => theirs.some((b) => oneThing(a, b))) ||
      ours.some((a) => onTheWay(a, theirTravel, periods, overrides)) ||
      theirs.some((b) => onTheWay(b, ourTravel, periods, overrides)) ||
      ours.some((a) => away(a) && theirs.some((b) => away(b) && sameTown(town(a.destination)!, town(b.destination)!)))
    );
  });
}

// Where a booking goes away from home, for naming its trip: the first
// destination that is not the home of its day, else the first origin that is
// not (a return journey booked on its own), else nothing.
export function awayPlace(
  segments: readonly Pick<ExtractedSegment, "start" | "origin" | "destination">[],
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): Place | undefined {
  const away = (place: Place | undefined, start: string) => {
    const where = town(place);
    const home = homeAt(periods, localDate(start), overrides);
    return !!where && (!home || !sameTown(where, home));
  };
  return (
    segments.find((s) => away(s.destination, s.start))?.destination ??
    segments.find((s) => away(s.origin, s.start))?.origin
  );
}

// A user's corrections as periods: each from its date until the day before
// the next one's, the last open-ended. Two on one date keep the later.
export function homeCorrections(corrections: readonly HomeCorrection[]): HomePeriod[] {
  const byDate = new Map<string, HomeCorrection>();
  for (const c of corrections) byDate.set(c.from, c);
  const sorted = [...byDate.values()].sort((a, b) => a.from.localeCompare(b.from));
  return sorted.map((c, i) => {
    const next = sorted[i + 1];
    return {
      city: c.city,
      ...(c.country ? { country: c.country } : {}),
      from: c.from,
      ...(next ? { until: dayBefore(next.from) } : {}),
    };
  });
}

// Home over time as the app uses it: what the journeys say until the person
// corrects it, then their corrections alone. What was worked out from
// trips they have since corrected says nothing about before them, so there
// is no home before the earliest correction.
export function effectiveHomes(inferred: readonly HomePeriod[], corrections: readonly HomeCorrection[]): HomePeriod[] {
  return corrections.length > 0 ? homeCorrections(corrections) : inferred.map((p) => ({ ...p }));
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (date: string) => `${months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

// Home over time in a line, newest first: "London since Mar 2021 · Boston
// 2018–2021". Empty when nothing is known.
export function describeHomes(periods: readonly HomePeriod[]): string {
  return [...periods]
    .reverse()
    .map((p) => {
      if (!p.from && !p.until) return p.city;
      if (!p.until) return `${p.city} since ${monthYear(p.from!)}`;
      if (!p.from) return `${p.city} until ${p.until.slice(0, 4)}`;
      const [a, b] = [p.from.slice(0, 4), p.until.slice(0, 4)];
      return `${p.city} ${a === b ? a : `${a}–${b}`}`;
    })
    .join(" · ");
}
