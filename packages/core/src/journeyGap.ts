import { homeCorrections, journeyHome, sameArea, withChosenAirports, type HomePeriod } from "./home";
import { maxOneWayTrips, type ChosenHomeAirports, type ExtractedSegment, type HomeCorrection, type Place } from "./schema";
import { liveSegments, localDate } from "./trips";

// A trip whose journeys don't come back to where they started: a booking is
// probably missing (an email the import never read, or read wrong), as a
// Virgin Atlantic e-ticket's flight home once was. Shown on the trip and its
// card, with ways to find or add it, unless the person said the trip is one
// way (`oneWayTrips` on their profile).

type Booking = Pick<ExtractedSegment, "type" | "start" | "end" | "origin" | "destination" | "confirmation"> & {
  cancelledAt?: string | undefined;
};

export type JourneyGap = {
  // "back": no journey back to where the trip started (the usual case: a
  // flight home not found). "out": the trip ends at home but starts
  // elsewhere, so the journey out from home is missing.
  direction: "back" | "out";
  // The city the missing journey goes to.
  to: string;
  // "flight" when every journey on the trip flies, else "journey".
  mode: "flight" | "journey";
  // The day the missing journey would be: after the last journey for one
  // back, before the first for one out. What "Add it yourself" starts on.
  date: string;
  // The trip's journeys' booking references, to search the mailbox for.
  references: string[];
};

const journeyTypes = new Set<ExtractedSegment["type"]>(["flight", "train", "bus", "ferry"]);

const city = (place: Place) => place.city ?? place.name;

// The journey a trip seems to be missing, if any: its journeys (the ones
// still booked, with both ends known), in order, don't end where they
// started. `homes` (the person's own home corrections, as on Profile) tell a
// trip that only comes home from one that only leaves; without them a trip
// is taken to start at home. A trip of no journeys, or one that comes back
// to its start's city or another of its airports, is missing nothing.
export function journeyGap(segments: readonly Booking[], homes: readonly HomePeriod[] = []): JourneyGap | undefined {
  const journeys = liveSegments(segments)
    .filter((s) => journeyTypes.has(s.type) && s.origin && s.destination)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const first = journeys[0];
  const last = journeys[journeys.length - 1];
  if (!first || !last) return undefined;
  const start = first.origin!;
  const end = last.destination!;
  if (sameArea(start, end)) return undefined;
  const mode = journeys.every((j) => j.type === "flight") ? "flight" : "journey";
  const references = [...new Set(journeys.flatMap((j) => (j.confirmation ? [j.confirmation.trim()] : [])))];
  const landed = localDate(last.end ?? last.start);
  const endsHome = homes.length > 0 && journeyHome(end, landed, homes) && !journeyHome(start, localDate(first.start), homes);
  return endsHome
    ? { direction: "out", to: city(start), mode, date: localDate(first.start), references }
    : { direction: "back", to: city(start), mode, date: landed, references };
}

// The homes journeyGap goes by: those the person set on Profile, each with
// the airports they chose for it, so landing at SFO is coming home to
// Mountain View.
export function journeyGapHomes(homes: readonly HomeCorrection[], chosen: readonly ChosenHomeAirports[]): HomePeriod[] {
  return withChosenAirports(homeCorrections(homes), chosen);
}

// What the trip says about it: "No flight back to London found", or for one
// that only comes home, "No flight to Boston found".
export function journeyGapText(gap: JourneyGap): string {
  return gap.direction === "back" ? `No ${gap.mode} back to ${gap.to} found` : `No ${gap.mode} to ${gap.to} found`;
}

// A Gmail search for the missing booking's email: the trip's booking
// references, which a return on the same booking shares, else the city it
// goes to.
export function journeyGapSearch(gap: JourneyGap): string {
  return gap.references.length > 0 ? gap.references.join(" OR ") : `"${gap.to.replaceAll('"', " ")}"`;
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
