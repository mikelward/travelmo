import { formatDate } from "./format";
import { farApart, homeCorrections, journeyHome, sameArea, withChosenAirports, type HomePeriod } from "./home";
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
  const between = journeys.slice(1).flatMap((next, i) => {
    const before = journeys[i]!;
    return farApart(before.destination, next.origin) ? [gap("between", before.destination!, next.origin!, mode, landed(before), localDate(next.start))] : [];
  });
  const start = first.origin!;
  const end = last.destination!;
  if (oneWay || sameArea(start, end)) return between;
  const endsHome = homes.length > 0 && journeyHome(end, landed(last), homes) && !journeyHome(start, localDate(first.start), homes);
  return endsHome ? [gap("out", end, start, mode, localDate(first.start)), ...between] : [...between, gap("back", end, start, mode, landed(last))];
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

// A Gmail search for the missing booking's email: both its ends, each by
// city or code, as a booking email names them: (Adelaide OR ADL) (London
// OR LHR). No dates: the email was sent long before the journey.
export function journeyGapSearch(gap: JourneyGap): string {
  const term = (city: string, code: string | undefined) => {
    const name = `"${city.replaceAll('"', " ")}"`;
    return code && code.toLowerCase() !== city.toLowerCase() ? `(${name} OR ${code})` : name;
  };
  return `${term(gap.from, gap.fromCode)} ${term(gap.to, gap.toCode)}`;
}

// That search in Gmail's web app, in whichever account the browser has open
// first.
export function gmailSearchUrl(query: string): string {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

// The list with one more trip, the newest kept when it is full.
export function withOneWay(trips: readonly string[], tripId: string): string[] {
  return [...trips.filter((id) => id !== tripId), tripId].slice(-maxOneWayTrips);
}
