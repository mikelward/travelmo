import { z } from "zod";
import { isoDate, isoDateTime, type ExtractedSegment } from "./schema";
import { isCancelled, localDate } from "./trips";

// Live gates, terminals and the baggage carousel for a flight, read from a
// flight-status service by the parser and kept once per flight
// (`flightStatus/{key}`), not on any booking: everyone booked on the
// flight reads the same document, one look serves them all, and a status
// check never moves a booking's revision or races an edit.

export const FlightStatus = z.object({
  // The flight number asked about, as an airline designator ("QF1"), the
  // local date it leaves and the airport it leaves from, when known: one
  // number can fly several legs a day.
  ident: z.string().min(1),
  date: isoDate,
  origin: z.string().min(1).optional(),
  // Whether the service knew a flight matching the booking.
  found: z.boolean(),
  departureGate: z.string().min(1).optional(),
  departureTerminal: z.string().min(1).optional(),
  arrivalGate: z.string().min(1).optional(),
  arrivalTerminal: z.string().min(1).optional(),
  baggageClaim: z.string().min(1).optional(),
  // The service's times, in UTC: they say when to look again.
  scheduledOut: isoDateTime.optional(),
  estimatedOut: isoDateTime.optional(),
  actualOut: isoDateTime.optional(),
  scheduledIn: isoDateTime.optional(),
  estimatedIn: isoDateTime.optional(),
  actualIn: isoDateTime.optional(),
  cancelled: z.boolean().optional(),
  checkedAt: isoDateTime,
});
export type FlightStatus = z.infer<typeof FlightStatus>;

// The flight number in a booking's title ("BA 117 LHR to JFK" → "BA117"),
// as a two-character airline code and up to four digits, leading zeros
// dropped. Nothing for a booking that is not a flight or names no number.
export function flightDesignator(segment: Pick<ExtractedSegment, "type" | "title">): string | undefined {
  if (segment.type !== "flight") return undefined;
  const match = /(?:^|[^A-Z0-9])([A-Z][A-Z0-9]|[0-9][A-Z]) ?0*(\d{1,4})(?![0-9])/.exec(segment.title);
  return match ? `${match[1]}${match[2]}` : undefined;
}

// The flight a booking is on, as a document id: "QF1_2026-12-13_SYD".
// Nothing for a booking with no flight number.
export function flightStatusKey(segment: Pick<ExtractedSegment, "type" | "title" | "start" | "origin">): string | undefined {
  const ident = flightDesignator(segment);
  if (!ident) return undefined;
  const origin = segment.origin?.code?.toUpperCase();
  return [ident, localDate(segment.start), ...(origin && /^[A-Z]{3}$/.test(origin) ? [origin] : [])].join("_");
}

const minute = 60_000;
const hour = 60 * minute;

// When the parser looks: every minute from two hours before departure,
// while gates are given and changed, and from half an hour before landing
// to 45 minutes after, while the arrival gate and the carousel are; every
// quarter of an hour in between. A flight it cannot find is looked for
// every quarter of an hour until an hour after it was due to leave.
export const fastBeforeDepartureMs = 2 * hour;
export const fastBeforeArrivalMs = 30 * minute;
export const afterArrivalMs = 45 * minute;
export const fastIntervalMs = minute;
export const slowIntervalMs = 15 * minute;
// Opening the trip page looks again from this long before departure, at
// most once a minute per flight.
export const refreshBeforeDepartureMs = 6 * hour;
export const refreshIntervalMs = minute;
// However late a flight runs, nobody looks after this long past its booked
// departure.
export const giveUpAfterMs = 30 * hour;
// A scheduler's minute is not exact: a check this much early still counts.
const slackMs = 15_000;

type Times = { departure: number; arrival?: number; departed: boolean };

function times(segment: Pick<ExtractedSegment, "start" | "end">, status: FlightStatus | undefined): Times {
  const departure = Date.parse(status?.estimatedOut ?? status?.scheduledOut ?? segment.start);
  const arrivalAt = status?.actualIn ?? status?.estimatedIn ?? status?.scheduledIn ?? segment.end;
  return { departure, ...(arrivalAt ? { arrival: Date.parse(arrivalAt) } : {}), departed: Boolean(status?.actualOut) };
}

// How often to look at a flight right now, in milliseconds, or nothing when
// it is not being watched (too early, over, cancelled, or never found).
export function flightCheckInterval(
  segment: Pick<ExtractedSegment, "start" | "end">,
  status: FlightStatus | undefined,
  now: string,
): number | undefined {
  const at = Date.parse(now);
  if (status?.cancelled) return undefined;
  if (at > Date.parse(segment.start) + giveUpAfterMs) return undefined;
  const { departure, arrival, departed } = times(segment, status);
  if (at < departure - fastBeforeDepartureMs) return undefined;
  if (status && !status.found) return at <= departure + hour ? slowIntervalMs : undefined;
  if (arrival !== undefined && at >= arrival + afterArrivalMs) return undefined;
  if (!departed && at < departure + 30 * minute) return fastIntervalMs;
  if (arrival === undefined) return slowIntervalMs;
  return at >= arrival - fastBeforeArrivalMs ? fastIntervalMs : slowIntervalMs;
}

const staleFor = (status: FlightStatus | undefined, now: string, interval: number): boolean =>
  !status || Date.parse(now) - Date.parse(status.checkedAt) >= interval - slackMs;

// Whether the scheduled job should look at the flight now.
export function flightCheckDue(segment: Pick<ExtractedSegment, "start" | "end">, status: FlightStatus | undefined, now: string): boolean {
  const interval = flightCheckInterval(segment, status, now);
  return interval !== undefined && staleFor(status, now, interval);
}

// Whether someone looking at the trip may have the flight looked at now:
// from six hours before departure until the scheduled job stops, once a
// minute at most.
export function flightRefreshDue(segment: Pick<ExtractedSegment, "start" | "end">, status: FlightStatus | undefined, now: string): boolean {
  const at = Date.parse(now);
  const { departure } = times(segment, status);
  if (status?.cancelled || at < departure - refreshBeforeDepartureMs) return false;
  const watched = at < departure - fastBeforeDepartureMs || flightCheckInterval(segment, status, now) !== undefined;
  return watched && staleFor(status, now, refreshIntervalMs);
}

// Whether a trip page shows the flight's status: from a day before its
// booked departure until the parser stops looking at it; never for a
// cancelled booking.
export function flightStatusShown(segment: Pick<ExtractedSegment, "type" | "start"> & { cancelledAt?: string }, now: string): boolean {
  const at = Date.parse(now);
  const start = Date.parse(segment.start);
  return segment.type === "flight" && !isCancelled(segment) && at >= start - 24 * hour && at <= start + giveUpAfterMs;
}

// "terminal 1, gate 8", "gate 8" or "terminal 1".
function where(gate: string | undefined, terminal: string | undefined): string | undefined {
  const parts = [terminal && `terminal ${terminal}`, gate && `gate ${gate}`].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

type Places = { departure?: string; arrival?: string; bags?: string };

function places(status: FlightStatus | undefined): Places {
  if (!status?.found) return {};
  const departure = where(status.departureGate, status.departureTerminal);
  const arrival = where(status.arrivalGate, status.arrivalTerminal);
  return {
    ...(departure ? { departure } : {}),
    ...(arrival ? { arrival } : {}),
    ...(status.baggageClaim ? { bags: status.baggageClaim } : {}),
  };
}

// What the flight's card says: where it leaves from and arrives at, and
// where the bags come out.
export function flightStatusLines(status: FlightStatus | undefined): string[] {
  const { departure, arrival, bags } = places(status);
  return [
    ...(departure ? [`Departs from ${departure}`] : []),
    ...(arrival ? [`Arrives at ${arrival}`] : []),
    ...(bags ? [`Bags on carousel ${bags}`] : []),
  ];
}

// The answer with any gate, terminal or carousel it lacks taken from the
// last one: a service that loses a field for a look and finds it again is
// not news either way, and the card keeps saying where to go. A gate and
// its terminal go together: one is kept only while the other is unchanged
// (or lost too), so a new terminal never shows with the old one's gate.
export function keepKnownPlaces(before: FlightStatus | undefined, after: FlightStatus): FlightStatus {
  if (!before?.found || !after.found) return after;
  const kept: Partial<FlightStatus> = {};
  const pair = (gate: "departureGate" | "arrivalGate", terminal: "departureTerminal" | "arrivalTerminal") => {
    const gateStays = after[gate] === undefined && (after[terminal] === undefined || after[terminal] === before[terminal]);
    const terminalStays = after[terminal] === undefined && (after[gate] === undefined || after[gate] === before[gate]);
    if (gateStays && before[gate] !== undefined) kept[gate] = before[gate];
    if (terminalStays && before[terminal] !== undefined) kept[terminal] = before[terminal];
  };
  pair("departureGate", "departureTerminal");
  pair("arrivalGate", "arrivalTerminal");
  if (after.baggageClaim === undefined && before.baggageClaim !== undefined) kept.baggageClaim = before.baggageClaim;
  return { ...after, ...kept };
}

// What is new since the last look, worded for a notification: a gate,
// terminal or carousel given for the first time, or changed to another.
// Only a field given a new value is news: one taken away is the service
// losing it, so a gate dropped while the terminal stays says nothing. A
// gate given where only the terminal was known is news, not a change.
export function flightStatusNews(before: FlightStatus | undefined, after: FlightStatus): string[] {
  const known = before?.found ? before : undefined;
  const was = places(known);
  const now = places(after);
  const given = (old: string | undefined, next: string | undefined) => next !== undefined && next !== old;
  const news = (oldGate: string | undefined, oldTerminal: string | undefined, gate: string | undefined, terminal: string | undefined) => {
    const changed = given(oldGate, gate) || given(oldTerminal, terminal);
    // A change, rather than news, when what was known is replaced: a
    // gate by another, or a terminal by another.
    const replaced = (oldGate !== undefined && given(oldGate, gate)) || (oldTerminal !== undefined && given(oldTerminal, terminal));
    return { changed, replaced };
  };
  const lines: string[] = [];
  const departure = news(known?.departureGate, known?.departureTerminal, after.departureGate, after.departureTerminal);
  if (now.departure && departure.changed && !after.actualOut) {
    lines.push(departure.replaced && was.departure ? `Now departs from ${now.departure} (was ${was.departure})` : `Departs from ${now.departure}`);
  }
  const arrival = news(known?.arrivalGate, known?.arrivalTerminal, after.arrivalGate, after.arrivalTerminal);
  if (now.arrival && arrival.changed) {
    lines.push(arrival.replaced && was.arrival ? `Now arrives at ${now.arrival} (was ${was.arrival})` : `Arrives at ${now.arrival}`);
  }
  if (now.bags && given(was.bags, now.bags)) {
    lines.push(was.bags ? `Bags now on carousel ${now.bags} (was ${was.bags})` : `Bags on carousel ${now.bags}`);
  }
  return lines;
}
