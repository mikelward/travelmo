import { airportPlace } from "./airportPlaces";
import { countryCodeOf, isCountryCode } from "./countries";
import { formatDate } from "./format";
import { compareInstants } from "./instant";
import { HomeAirportCode, HomeCorrection, maxHomeAirports, maxHomeCityLength, type ChosenHomeAirports, type ExtractedSegment, type Place, type SegmentType, type Trip } from "./schema";
import { daysBetween, findTripForRange, isUntimed, liveSegments, segmentDateRange } from "./trips";

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
  // The airports and stations the person travels from while living here
  // (withHomeAirports), however far away: a journey back into one is a
  // journey home (journeyHome). Mountain View's is SFO, in another town.
  airports?: Place[];
};

type Town = { city: string; country?: string; lat?: number; lon?: number };

type Booking = Pick<ExtractedSegment, "type" | "start" | "end" | "origin" | "destination">;

const journeyTypes: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry"]);

// A place's town, for telling home from away: the city where the source gave
// one, otherwise its name (an airport or station named without a city).
// Where it is, when the source or the geocoder said, so a hotel in a suburb
// is in the town next door.
function town(place: Place | undefined): Town | undefined {
  const city = place?.city ?? place?.name;
  if (!city) return undefined;
  return {
    city,
    ...(place?.country ? { country: place.country } : {}),
    ...(place?.lat !== undefined && place.lon !== undefined ? { lat: place.lat, lon: place.lon } : {}),
  };
}

// How far apart two places can be and still be one town, in kilometers:
// a hotel in Solna and a show in Stockholm, or a dinner in a village down
// the road from the hotel.
export const nearKm = 20;

// The great-circle distance between two points, in kilometers.
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const located = (t: Town): t is Town & { lat: number; lon: number } => t.lat !== undefined && t.lon !== undefined;

// Two towns match when no country tells them apart, however it is written
// ("UK" and "GB" are one: countryCode), and they have the same city,
// ignoring case, accents and the local or English name (sameCity), or are
// within nearKm of each other where both say where they are. Home is a
// city's name with no point, so it matches by name alone.
function sameTown(a: Town, b: Town): boolean {
  if (a.country && b.country && countryCode(a.country) !== countryCode(b.country)) return false;
  return sameCity(a.city, b.city) || (located(a) && located(b) && distanceKm(a, b) <= nearKm);
}

// A country as its ISO code, whether written as one or by name ("UK",
// "United Kingdom" and "GB" are all GB).
export const countryCode = (country: string) => countryCodeOf(country) ?? country.trim().toUpperCase();

// Cities with an English name besides their own, by their own name folded
// (accents dropped, lower case), so a station in Göteborg is in the
// Gothenburg its airport names.
const cityNames: Record<string, string> = {
  goteborg: "gothenburg",
  munchen: "munich",
  koln: "cologne",
  wien: "vienna",
  praha: "prague",
  warszawa: "warsaw",
  krakow: "cracow",
  kobenhavn: "copenhagen",
  lisboa: "lisbon",
  roma: "rome",
  milano: "milan",
  napoli: "naples",
  firenze: "florence",
  venezia: "venice",
  torino: "turin",
  geneve: "geneva",
  bruxelles: "brussels",
  brussel: "brussels",
  "den haag": "the hague",
  sevilla: "seville",
  athina: "athens",
  moskva: "moscow",
  "ciudad de mexico": "mexico city",
};

// Letters that are not an accented letter, so no accent comes off them.
const plainLetters: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

const foldCity = (city: string) => {
  const folded = city
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[øæœßłđðþı]/g, (c) => plainLetters[c]!);
  return cityNames[folded] ?? folded;
};

export const sameCity = (a: string, b: string) => foldCity(a) === foldCity(b);

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

// A round trip: the town it leaves from and when, and the airport or
// station it leaves from and the one it comes back into.
type RoundTrip = { base: Town; start: string; from: Place; back: Place };

// The round trips in a run of journeys: each leaves from a town and ends
// with the first journey back into it, however many legs lie between. A
// chain that never returns (a one-way move, or bookings missing), or one
// away for longer than `stayDays`, gives no round trip, and the next journey
// starts afresh, so round trips within a long one count instead. Legs go in
// the order they leave, by instant, since local times misorder them across
// the date line; a journey within one town (a river bus) goes nowhere and
// says nothing.
function roundTrips(segments: readonly Booking[]): RoundTrip[] {
  // A cancelled journey was never travelled, so it says nothing about home.
  const journeys = liveSegments(segments)
    .filter((s) => {
      const from = town(s.origin);
      const to = town(s.destination);
      return journeyTypes.has(s.type) && from && to && !sameTown(from, to);
    })
    .sort((a, b) => compareInstants(a.start, b.start));
  const trips: RoundTrip[] = [];
  let i = 0;
  while (i < journeys.length) {
    const base = town(journeys[i]!.origin)!;
    const back = journeys.findIndex((j, k) => k >= i && sameTown(town(j.destination)!, base));
    if (back < 0 || Date.parse(journeys[back]!.start) - Date.parse(journeys[i]!.start) > stayDays * 86_400_000) {
      i++;
      continue;
    }
    trips.push({ base, start: localDate(journeys[i]!.start), from: journeys[i]!.origin!, back: journeys[back]!.destination! });
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
  return homeBases(segments).map(({ base, from, until }) => ({
    city: base.city,
    ...(base.country ? { country: base.country } : {}),
    ...(from ? { from } : {}),
    ...(until ? { until } : {}),
  }));
}

// homeTimeline's periods with the town each was worked out from, its point
// included, so what was found to leave from home is told as it was then
// (withHomeAirports).
function homeBases(segments: readonly Booking[]): { base: Town; from?: string; until?: string }[] {
  const trips = roundTrips(segments);
  const periods: { base: Town; from?: string; until?: string }[] = [];
  let current: Town | undefined;
  for (let i = 0; i < trips.length; i++) {
    const { base, start } = trips[i]!;
    if (!current) {
      current = base;
      periods.push({ base });
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
    periods.push({ base, from: start });
    current = base;
    i = end;
  }
  return periods;
}

// How many round trips must leave from or come back into an airport or
// station while someone lives somewhere for it to be one of that home's:
// one could be a trip from a relative's on a visit.
const homeAirportTrips = 2;

// One airport or station: by its code, else by its name in its city and
// country, as names repeat (Washington's Union Station and Chicago's).
const placeKey = (place: Place) => (place.code ?? [place.name, place.city ?? "", place.country ? countryCode(place.country) : ""].join("|")).trim().toLowerCase();

// Each period with the airports and stations its round trips (in
// `segments`) leave from or come back into, each at least homeAirportTrips
// times while it was home. For home as worked out and as the person
// corrected it alike: a correction to "Mountain View" gets the SFO its
// trips start from.
export function withHomeAirports(periods: readonly HomePeriod[], segments: readonly Booking[]): HomePeriod[] {
  // Only round trips from what the journeys say was home at the time
  // (homeTimeline): side trips on a visit whose way out was never imported
  // leave from where the visit was, not from home.
  // As homeTimeline tells them, by name or by being near (SFO and Oakland).
  const bases = homeBases(segments);
  const trips = roundTrips(segments).filter((t) => {
    const home = bases.find((b) => (!b.from || b.from <= t.start) && (!b.until || t.start <= b.until));
    return !!home && sameTown(t.base, home.base);
  });
  return periods.map((period) => {
    const counts = new Map<string, { place: Place; trips: number }>();
    for (const trip of trips.filter((t) => covers(period, t.start))) {
      const ends = new Map([trip.from, trip.back].map((place) => [placeKey(place), place] as const));
      for (const [key, place] of ends) counts.set(key, { place: counts.get(key)?.place ?? place, trips: (counts.get(key)?.trips ?? 0) + 1 });
    }
    const airports = [...counts.values()].filter((c) => c.trips >= homeAirportTrips).map((c) => c.place);
    const rest: HomePeriod = { ...period };
    delete rest.airports;
    return airports.length > 0 ? { ...rest, airports } : rest;
  });
}

// The airports a person chose for each home (Profile), by its town, in
// place of those worked out; a home they chose none for keeps its own.
// Each is known by its code alone, which is how journeys are matched to it
// (journeyHome).
export function withChosenAirports(periods: readonly HomePeriod[], chosen: readonly ChosenHomeAirports[]): HomePeriod[] {
  return periods.map((period) => {
    // Its own town's choice, else one saved without a country for its city.
    const choice =
      chosen.find((c) => homeTownKey(c.city, c.country) === homeTownKey(period.city, period.country)) ??
      chosen.find((c) => sameCity(c.city, period.city) && (!c.country || !period.country));
    if (!choice) return period;
    const rest: HomePeriod = { ...period };
    delete rest.airports;
    return choice.airports.length > 0 ? { ...rest, airports: choice.airports.map((code) => ({ name: code, code })) } : rest;
  });
}

// Home as worked out from `segments` and as corrected, each with its
// airports: worked out from its round trips, unless the person chose them.
export function homesWithAirports(
  segments: readonly Booking[],
  corrections: readonly HomePeriod[],
  chosen: readonly ChosenHomeAirports[] = [],
): { periods: HomePeriod[]; overrides: HomePeriod[] } {
  return {
    periods: withChosenAirports(withHomeAirports(homeTimeline(segments), segments), chosen),
    overrides: withChosenAirports(withHomeAirports(corrections, segments), chosen),
  };
}

// One home town, as Profile lists its airports and as its choice is stored:
// by city and country, as two Londons are two homes.
// Its city folded as sameCity folds it, so München and Munich are one.
export function homeTownKey(city: string, country?: string): string {
  return `${foldCity(city)}|${country ? countryCode(country) : ""}`;
}

// A home's airports as Profile lists them: their codes, else their names.
export function airportCodes(period: HomePeriod): string[] {
  return (period.airports ?? []).map((a) => a.code ?? a.name);
}

// Airport or station codes as typed ("SFO, sjc"), or why they can't be.
export function parseAirportCodes(text: string): { codes: string[] } | { error: string } {
  const words = text.split(/[\s,;]+/).filter(Boolean);
  const codes: string[] = [];
  for (const word of words) {
    const parsed = HomeAirportCode.safeParse(word);
    if (!parsed.success) return { error: `"${word}" isn't an airport or station code.` };
    if (!codes.includes(parsed.data)) codes.push(parsed.data);
  }
  if (codes.length > maxHomeAirports) return { error: `Up to ${maxHomeAirports} airports.` };
  return { codes };
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
  const gaps = [rideFromArrival(ride, journey), rideToDeparture(ride, journey)].filter((gap): gap is number => gap !== undefined);
  return gaps.length > 0 ? Math.min(...gaps) : undefined;
}

const waitBetween = (from: string, to: string) => {
  const ms = Date.parse(to) - Date.parse(from);
  return ms >= 0 && ms <= connectionHours * 3_600_000 ? ms : undefined;
};

// How long after a journey arrives a transfer leaves its airport or
// station; undefined when the transfer does not take the traveler on from
// it (connectionGap).
export function rideFromArrival(ride: Located, journey: Located): number | undefined {
  if (!isTransfer(ride) || !journeyTypes.has(journey.type) || !journey.destination) return undefined;
  return atHub(ride.origin!, journey.destination) ? waitBetween(journey.end ?? journey.start, ride.start) : undefined;
}

// How long before a journey leaves a transfer reaches its airport or
// station; undefined when the transfer does not bring the traveler to it.
export function rideToDeparture(ride: Located, journey: Located): number | undefined {
  if (!isTransfer(ride) || !journeyTypes.has(journey.type) || !journey.origin) return undefined;
  return atHub(ride.destination!, journey.origin) ? waitBetween(ride.end ?? ride.start, journey.start) : undefined;
}

// Whether a place is in the same town as an airport or station, or is it:
// where a car hired for a flight is collected.
export function nearHub(place: Place | undefined, hub: Place | undefined): boolean {
  if (!place || !hub) return false;
  if (atHub(place, hub)) return true;
  const a = town(place);
  const b = town(hub);
  return !!a && !!b && sameTown(a, b);
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

// Whether a place is in the town that was home on a date; false when
// either is unknown.
export function inHomeTown(
  place: Place | undefined,
  date: string,
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): boolean {
  const where = town(place);
  const home = homeAt(periods, date, overrides);
  return !!where && !!home && sameTown(where, home);
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

// A booking that goes somewhere: a journey, or a transfer (a car to the
// airport).
const goes = (s: Grouped) => journeyTypes.has(s.type) || isTransfer(s);

// An outing: a ticket, an event or a car hired and returned in one place;
// nothing that travels or stays.
export const isOuting = (s: Grouped) => (s.type === "activity" || s.type === "other" || s.type === "car_rental") && !goes(s);
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
// train only gets there after. Abroad, the country is enough: a dinner at a
// resort down the coast from the airport the flight lands at, or a stay
// that names another town, is in the country the trip is in, while in the
// home country only the same town counts (a day out in Brighton is not part
// of a flight from London).
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
  if (townsDuring(outing, travel).some((t) => sameTown(t, where))) return true;
  const abroad = !!where.country && !!base?.country && countryCode(where.country) !== countryCode(base.country);
  if (!abroad) return false;
  // Where the journeys have taken someone at the time, and the stays they
  // are in then: a hotel the trip has already left says nothing about a
  // dinner days later.
  const from = millis(outing.start);
  const to = isUntimed(outing) ? from + 86_400_000 - 1 : outing.end ? Math.max(from, millis(outing.end)) : from;
  const staying = travel.filter((s) => !goes(s) && millis(s.start) <= to && from <= millis(s.end ?? s.start)).flatMap((s) => town(s.destination) ?? []);
  const there = [...townsDuring(outing, travel.filter(goes)), ...staying];
  return there.some((t) => !!t.country && countryCode(t.country) === countryCode(where.country!));
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

// A booking of nothing but outings in runs of days: each run is the
// outings on consecutive days (a holiday camp Monday to Friday), and a gap
// of more than a day starts the next (a weekly class booked for a term is a
// day out each week, not one trip). A booking with any travel in it is one
// run, as it came.
export function outingRuns<S extends Grouped>(segments: readonly S[]): S[][] {
  if (!allOutings(segments)) return [segments.slice()];
  const runs: { last: string; segments: S[] }[] = [];
  for (const s of segments.slice().sort((a, b) => compareInstants(a.start, b.start))) {
    const run = runs[runs.length - 1];
    const ends = localDate(s.end ?? s.start);
    if (run && daysBetween(run.last, localDate(s.start)) <= 1) {
      run.segments.push(s);
      if (ends > run.last) run.last = ends;
    } else {
      runs.push({ last: ends, segments: [s] });
    }
  }
  return runs.map((run) => run.segments);
}

// When a booking finishes: a journey when it arrives (arrives), anything
// else at its end, or its start when it has none.
const finishes = (s: Grouped) => (goes(s) ? arrives(s) : (s.end ?? s.start));

// Whether `earlier` ends with a journey home that is over before `later`
// begins: the last thing in it to finish is a journey (a flight, train, bus
// or ferry; not a ride to the airport) from away into the home of its day,
// and everything in `later` starts after it arrives. A
// trip that has come home is over, so the next trip away a day or two
// later is a trip of its own. False when home is unknown.
function homeBetween(
  earlier: readonly Grouped[],
  later: readonly Grouped[],
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[],
): boolean {
  if (earlier.length === 0 || later.length === 0) return false;
  const last = earlier.reduce((a, b) => (compareInstants(finishes(b), finishes(a)) > 0 ? b : a));
  if (!journeyTypes.has(last.type)) return false;
  const back = finishes(last);
  if (!journeyHome(last.destination, localDate(back), periods, overrides)) return false;
  if (journeyHome(last.origin, localDate(last.start), periods, overrides)) return false;
  return later.every((s) => compareInstants(s.start, back) > 0);
}

// Whether `later` leaves from home after `earlier` was last seen away: its
// first journey leaves the home of its day (or one of its airports) once
// everything in `earlier` is over, and `earlier`'s last journey landed away
// from home. The journey home is missing (an email the import never read),
// but the person came home all the same, so `later` is another trip: without
// this, a trip whose flight home went missing took in everything after it
// that fell within its dates.
function homeLeftAfter(
  earlier: readonly Grouped[],
  later: readonly Grouped[],
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[],
): boolean {
  const journeysOf = (segments: readonly Grouped[]) => liveSegments(segments).filter((s) => journeyTypes.has(s.type));
  const before = journeysOf(earlier);
  const after = journeysOf(later);
  if (before.length === 0 || after.length === 0) return false;
  const last = before.reduce((a, b) => (compareInstants(finishes(b), finishes(a)) > 0 ? b : a));
  const first = after.reduce((a, b) => (compareInstants(a.start, b.start) <= 0 ? a : b));
  const landed = finishes(last);
  if (compareInstants(first.start, landed) <= 0) return false;
  if (!earlier.every((s) => compareInstants(finishes(s), first.start) <= 0)) return false;
  if (journeyHome(last.destination, localDate(landed), periods, overrides)) return false;
  return journeyHome(first.origin, localDate(first.start), periods, overrides);
}

// How far apart one city's airports or stations can be: JFK and Newark,
// Heathrow and Gatwick, Narita and Haneda.
export const areaKm = 80;

// A place's town with its point, the airport table's when it was given only
// a code, so JFK and Newark can be told apart by distance.
function located_(place: Place | undefined): Town | undefined {
  const t = town(place);
  if (!t || located(t) || !place?.code) return t;
  const airport = airportPlace(place.code);
  return airport ? { ...t, lat: airport.lat, lon: airport.lon } : t;
}

// Whether two places are one city's, as far as its airports and stations
// go: the same town, or within areaKm in one country.
export function sameArea(a: Place | undefined, b: Place | undefined): boolean {
  const [x, y] = [located_(a), located_(b)];
  if (!x || !y) return false;
  if (sameTown(x, y)) return true;
  if (x.country && y.country && countryCode(x.country) !== countryCode(y.country)) return false;
  return located(x) && located(y) && distanceKm(x, y) <= areaKm;
}

// Whether a journey's end (`place`, on `date`) is home: in the home of its
// day, or one of that home's airports or stations (withHomeAirports), so
// landing at SFO is coming home to Mountain View. Only for journeys: a hotel
// by the airport is not at home (inHomeTown).
export function journeyHome(
  place: Place | undefined,
  date: string,
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): boolean {
  if (inHomeTown(place, date, periods, overrides)) return true;
  const home = homeAt(periods, date, overrides);
  return !!place && !!home?.airports?.some((airport) => placeKey(airport) === placeKey(place));
}

// Whether `next` is the onward journey of a connection at `landing`'s
// destination: it leaves from there (or another of that city's airports)
// within twelve hours of landing. Paris between Zagreb and New York is a
// stop on the way, not where the trip goes.
export function isConnection(
  landing: Pick<ExtractedSegment, "type" | "start" | "end" | "destination">,
  next: Pick<ExtractedSegment, "type" | "start" | "origin">,
): boolean {
  if (!journeyTypes.has(landing.type) || !journeyTypes.has(next.type)) return false;
  const gap = millis(next.start) - millis(arrives({ ...landing, title: "" }));
  return gap > 0 && gap <= 12 * 3_600_000 && sameArea(landing.destination, next.origin);
}

// How far a rebooking may move a journey, in days.
// How far apart a rebooking's flights and the ones it replaced may leave.
export const rebookedWithinDays = 14;

type Flight = Pick<ExtractedSegment, "type" | "start" | "end" | "origin" | "destination" | "confirmation">;

const bookingReference = (flight: Flight) => flight.confirmation?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";

// Every journey the flights make: each whole run of connections
// (isConnection) under one reference, from a flight nothing connects onto
// to one that connects onto nothing. A flight on several runs is on each:
// an itinerary and a rebooking that kept its first leg, or its last, are
// two journeys sharing it, however the legs of other itineraries
// interleave. A connection booked separately is a journey of its own.
const maxJourneys = 64;
function journeys<S extends Flight>(flights: readonly S[]): S[][] {
  const sorted = [...flights].sort((a, b) => compareInstants(a.start, b.start));
  const joins = (landing: S, next: S) => bookingReference(landing) === bookingReference(next) && isConnection({ ...landing, title: "" }, { ...next, title: "" });
  const onward = sorted.map((flight, i) => sorted.filter((next, j) => j > i && joins(flight, next)));
  const reached = new Set(onward.flat());
  const out: S[][] = [];
  const walk = (path: S[]) => {
    if (out.length >= maxJourneys) return;
    const next = onward[sorted.indexOf(path[path.length - 1]!)]!;
    if (next.length === 0) out.push(path);
    for (const flight of next) walk([...path, flight]);
  };
  for (const flight of sorted) if (!reached.has(flight)) walk([flight]);
  return out;
}

// The flights of an older email (`older`) that a newer one (`newer`)
// rebooked, each with every newer journey that replaced it (the caller
// dates the cancellation by the latest email confirming one whole): a
// journey under the same reference, between the same cities (or their
// other airports), leaving within two weeks of it. Coming home two days
// early on other flights leaves the original flight home behind; this
// finds it, so it can be filed cancelled. Whole journeys are compared, legs
// the newer email kept included, so a rebooking that keeps the first leg
// and changes the rest still finds the onward flight it dropped; the
// caller leaves out the legs the newer email confirmed again (sameBooking).
export function rebookedFlights<S extends Flight, N extends Flight>(older: readonly S[], newer: readonly N[]): { flight: S; by: N[][] }[] {
  const fresh = journeys(newer.filter((f) => f.type === "flight" && bookingReference(f)));
  const found = new Map<S, N[][]>();
  for (const journey of journeys(older.filter((f) => f.type === "flight" && bookingReference(f)))) {
    const first = journey[0]!;
    const last = journey[journey.length - 1]!;
    const by = fresh.filter((other) => {
      const from = other[0]!;
      const to = other[other.length - 1]!;
      return (
        journey.every((f) => bookingReference(f) === bookingReference(from)) &&
        other.every((f) => bookingReference(f) === bookingReference(from)) &&
        sameArea(first.origin, from.origin) &&
        sameArea(last.destination, to.destination) &&
        Math.abs(Date.parse(from.start) - Date.parse(first.start)) <= rebookedWithinDays * 86_400_000
      );
    });
    // A leg two journeys share once, with what replaced either.
    for (const flight of by.length > 0 ? journey : []) found.set(flight, [...new Set([...(found.get(flight) ?? []), ...by])]);
  }
  return older.filter((f) => found.has(f)).map((flight) => ({ flight, by: found.get(flight)! }));
}

// Whether a journey that lands away from home opens the trip that follows:
// that trip's first booking is a journey leaving the same city, or another
// of its airports or stations, after it lands. A flight from Zagreb to New
// York belongs with the week in New York it starts, not with Zagreb, when
// nothing is booked there but the flight home from Newark.
export function opensTrip(
  landing: Pick<ExtractedSegment, "type" | "start" | "end" | "origin" | "destination">,
  next: Pick<ExtractedSegment, "type" | "start" | "end" | "origin" | "destination">,
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): boolean {
  if (!journeyTypes.has(landing.type) || !journeyTypes.has(next.type)) return false;
  const landed = arrives({ ...landing, title: "" });
  if (journeyHome(landing.destination, localDate(landed), periods, overrides)) return false;
  return compareInstants(next.start, landed) > 0 && sameArea(landing.destination, next.origin);
}

// The trip a new booking joins by its dates, knowing where home is if it
// can. Travel (journeys, stays, a car to the airport) joins travel within a
// couple of days (findTripForRange). Outings never join by nearness of dates
// alone, home known or not: each is a trip of its own (a dinner and a show
// on one evening at home are two) unless it is one thing with another on
// the same or the next day (oneThing: tickets for one event, the days of a
// course; a weekly class is a day out each week), it happens where
// travel within two days has taken someone at the time (onTheWay), or, with
// home known, it and another outing within two days are both away in one
// town. A journey, even one leaving from home, is never at home. Nothing
// joins a trip across a journey home (homeBetween): once a trip has come
// home, what starts after that is another trip, however soon; nor across a
// journey from home after the trip was last seen away (homeLeftAfter), as
// when its flight home is missing. Before any
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
    if (homeBetween(segments, booking, periods, overrides) || homeBetween(booking, segments, periods, overrides)) return false;
    if (homeLeftAfter(segments, booking, periods, overrides) || homeLeftAfter(booking, segments, periods, overrides)) return false;
    if (!allOutings(booking) && !allOutings(segments)) return near(trip, 2);
    if (!near(trip, 2)) return false;
    const theirs = segments.filter(isOuting);
    const theirTravel = segments.filter((s) => !isOuting(s));
    return (
      (near(trip, 1) && ours.some((a) => theirs.some((b) => oneThing(a, b)))) ||
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
      // As a code, however it was saved ("UK" before the form required one).
      ...(c.country ? { country: countryCode(c.country) } : {}),
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

// The Profile's home line: "Home: London since Mar 2021 · Boston 2018–2021",
// or nothing when no trip says where home is and nobody said.
export function homeLine(periods: readonly HomePeriod[]): string | undefined {
  const text = describeHomes(periods);
  return text ? `Home: ${text}` : undefined;
}

// One correction as the Profile lists it: "London, GB from 12 Mar 2021".
export function correctionText(c: HomeCorrection): string {
  const where = c.country ? `${c.city}, ${c.country}` : c.city;
  return `${where} from ${formatDate(c.from, "en-GB", { weekday: undefined, year: "numeric" })}`;
}

// A correction from the form's fields, or why it cannot be one.
export function parseCorrection(city: string, country: string, from: string): HomeCorrection | string {
  // A name or a common short form ("UK") is saved as its ISO code.
  const code = country.trim() ? countryCode(country) : "";
  if (!city.trim()) return "Enter a city.";
  if (city.trim().length > maxHomeCityLength) return `Use a city name of at most ${maxHomeCityLength} characters.`;
  if (code && !isCountryCode(code)) return "Use a two-letter country code, such as GB.";
  const parsed = HomeCorrection.safeParse({ city: city.trim(), ...(code ? { country: code } : {}), from });
  if (parsed.success) return parsed.data;
  return "Enter a date.";
}
