import { airportPlace } from "./airportPlaces";
import { countryCodeOf } from "./countries";
import { formatDate } from "./format";
import { farApart, homeCorrections, journeyHome, sameArea, sameCity, withChosenAirports, type HomePeriod } from "./home";
import { maxOneWayTrips, type ChosenHomeAirports, type ExtractedSegment, type HomeCorrection, type Place } from "./schema";
import { liveSegments, localDate } from "./trips";

// A trip whose journeys don't join up: a booking is probably missing (an
// email the import never read, or read wrong), as a Virgin Atlantic
// e-ticket's flight home once was, or a Qatar flight from Adelaide to London
// in the middle of a long trip. Each gap is shown on the trip, with its own
// search and ways to add it; the trip's card names the first. Gaps at the
// trip's ends go unshown once the person says the trip is one way
// (`oneWayTrips` on their profile).

type Booking = Pick<ExtractedSegment, "type" | "start" | "end" | "origin" | "destination"> & {
  cancelledAt?: string | undefined;
};

export type JourneyGap = {
  // "out": the trip ends at home but starts elsewhere, so the journey out
  // from home is missing. "between": one journey ends far from where the
  // next starts. "back": no journey back to where the trip started (the
  // usual case: a flight home not found).
  direction: "out" | "between" | "back";
  // The cities the missing journey goes from and to.
  from: string;
  to: string;
  // Their airport or station codes, where known, to search for too.
  fromCode?: string;
  toCode?: string;
  // "flight" when every journey on the trip flies, else "journey".
  mode: "flight" | "journey";
  // The first day the missing journey could be: what "Add it yourself"
  // starts on. Before the first journey for one out, after the landing
  // before it otherwise.
  date: string;
  // For one between journeys, the day the next leaves.
  until?: string;
};

const journeyTypes = new Set<ExtractedSegment["type"]>(["flight", "train", "bus", "ferry"]);

const city = (place: Place) => place.city ?? place.name;

function gap(direction: JourneyGap["direction"], from: Place, to: Place, mode: JourneyGap["mode"], date: string, until?: string): JourneyGap {
  return {
    direction,
    from: city(from),
    to: city(to),
    ...(from.code ? { fromCode: from.code } : {}),
    ...(to.code ? { toCode: to.code } : {}),
    mode,
    date,
    ...(until ? { until } : {}),
  };
}

const words = (text: string) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

// Whether a car hire's end is at a journey's: in the same town or near it,
// or named after it ("Example Cars Raleigh Durham Airport" for RDU's
// Raleigh/Durham). Where neither says where it is, it isn't.
// A known country that differs rules out the name: "London Downtown" in
// Ontario is not London's Heathrow.
function near(place: Place, end: Place): boolean {
  if (sameArea(place, end)) return true;
  const [a, b] = [countryOf(place), countryOf(end)];
  return !(a && b && a !== b) && words(place.name).includes(words(city(end)));
}

const countryOf = (place: Place) => {
  const named = place.country ? (countryCodeOf(place.country) ?? place.country.toUpperCase()) : undefined;
  return named ?? (place.code ? airportPlace(place.code)?.country : undefined);
};

const sameJourney = (a: Booking, b: Booking) =>
  Date.parse(a.start) === Date.parse(b.start) && sameArea(a.origin, b.origin) && sameArea(a.destination, b.destination);

// The journeys a trip seems to be missing, in order: its journeys (the ones
// still booked, with both ends known), in order, don't end where they
// started (one out or back), or one lands far from where the next leaves
// (farApart: a drive is not missing). `homes` (the person's own home
// corrections, as on Profile) tell a trip that only comes home from one that
// only leaves; without them a trip is taken to start at home. `oneWay`
// leaves out the trip's ends.
export function journeyGaps(segments: readonly Booking[], homes: readonly HomePeriod[] = [], oneWay = false): JourneyGap[] {
  const journeys = liveSegments(segments)
    .filter((s) => journeyTypes.has(s.type) && s.origin && s.destination)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    // Two travelers' own bookings on one flight are one journey.
    .filter((j, i, all) => !all.slice(0, i).some((k) => sameJourney(k, j)));
  const first = journeys[0];
  const last = journeys[journeys.length - 1];
  if (!first || !last) return [];
  const mode = journeys.every((j) => j.type === "flight") ? "flight" : "journey";
  const landed = (j: Booking) => localDate(j.end ?? j.start);
  // A car hired in one town and returned in another, as from Raleigh to
  // Savannah, is the journey between them: driven, not missing.
  const drives = liveSegments(segments).filter(
    (s): s is Booking & { end: string; origin: Place; destination: Place } =>
            // Returned elsewhere: by name, or by the airports its desks are at where both are called "Avis".
      s.type === "car_rental" &&
      !!s.end &&
      !!s.origin &&
      !!s.destination &&
      (!sameCity(city(s.origin), city(s.destination)) || (!!s.origin.code && !!s.destination.code && s.origin.code !== s.destination.code)),
  );
  const driven = (from: Place, to: Place, after: string, before?: string) =>
    drives.some(
      (d) =>
        near(d.origin, from) &&
        near(d.destination, to) &&
        localDate(d.end) >= after &&
        (!before || localDate(d.start) <= before),
    );
  const between = journeys.slice(1).flatMap((next, i) => {
    const before = journeys[i]!;
    if (!farApart(before.destination, next.origin)) return [];
    if (driven(before.destination!, next.origin!, landed(before), localDate(next.start))) return [];
    return [gap("between", before.destination!, next.origin!, mode, landed(before), localDate(next.start))];
  });
  const start = first.origin!;
  const end = last.destination!;
  if (oneWay || sameArea(start, end)) return between;
  const endsHome = homes.length > 0 && journeyHome(end, landed(last), homes) && !journeyHome(start, localDate(first.start), homes);
  if (endsHome) return driven(end, start, "", localDate(first.start)) ? between : [gap("out", end, start, mode, localDate(first.start)), ...between];
  return driven(end, start, landed(last)) ? between : [...between, gap("back", end, start, mode, landed(last))];
}

// The homes journeyGaps goes by: those the person set on Profile, each with
// the airports they chose for it, so landing at SFO is coming home to
// Mountain View.
export function journeyGapHomes(homes: readonly HomeCorrection[], chosen: readonly ChosenHomeAirports[]): HomePeriod[] {
  return withChosenAirports(homeCorrections(homes), chosen);
}

const dayMonth = (date: string) => formatDate(date, "en-GB", { weekday: undefined });

// What the trip says about it: "No flight from Boston back to London found",
// "No flight from London to Boston found" for one that only comes home, or
// "No flight from Adelaide to London found between 10 Jan and 15 Feb".
export function journeyGapText(gap: JourneyGap): string {
  const what = `No ${gap.mode} from ${gap.from} ${gap.direction === "back" ? "back " : ""}to ${gap.to} found`;
  if (gap.direction !== "between" || !gap.until) return what;
  return gap.until === gap.date ? `${what} on ${dayMonth(gap.date)}` : `${what} between ${dayMonth(gap.date)} and ${dayMonth(gap.until)}`;
}

// The places in a mailbox search for the missing booking's email (the
// parser's lookQuery adds the dates): both its ends, each by city or code,
// as a booking email names them: ("Adelaide" OR ADL) ("London" OR LHR).
export function journeyGapSearch(gap: JourneyGap): string {
  const term = (city: string, code: string | undefined) => {
    const name = `"${city.replaceAll('"', " ")}"`;
    return code && code.toLowerCase() !== city.toLowerCase() ? `(${name} OR ${code})` : name;
  };
  return `${term(gap.from, gap.fromCode)} ${term(gap.to, gap.toCode)}`;
}

// "Look for it" (the parser's findJourney.ts): the person's mailbox searched
// for a gap's emails, a few read at a time.
export const lookPath = "/trips/look";

// What came of one email a look found: read now ("imported", a
// "cancellation", "not_booking", "filtered" or "failed"), "already"
// imported before (its bookings are in Travelmo, perhaps on another trip),
// or "busy" being imported right now. `report`, for one read now, is Import
// anyway's, to copy.
export type LookedEmail = {
  messageId: string;
  subject: string;
  from: string;
  sent: string;
  outcome: "imported" | "cancellation" | "not_booking" | "filtered" | "failed" | "already" | "busy";
  report?: string;
};

// A look's emails, and `next`, where to keep looking from, while there are
// more.
export type LookResult = { emails: LookedEmail[]; next?: number };

// The list with one more trip, the newest kept when it is full.
export function withOneWay(trips: readonly string[], tripId: string): string[] {
  return [...trips.filter((id) => id !== tripId), tripId].slice(-maxOneWayTrips);
}
