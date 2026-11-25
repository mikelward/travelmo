import { z } from "zod";
import { localTime } from "./format";
import { isoDate, isoDateTime, type ExtractedSegment } from "./schema";
import { shiftInstant } from "./status";
import { isCancelled, localDate } from "./trips";

// Live gates, terminals, the baggage carousel, delays, cancellation and
// diversion for a flight, read from a
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
  // Landing somewhere other than planned, and where when the service says.
  diverted: z.boolean().optional(),
  divertedTo: z.string().min(1).optional(),
  // The departure time the last news gave (UTC), so a delay that creeps a
  // few minutes a look is news once it adds up.
  noticedOut: isoDateTime.optional(),
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
// How long after landing a trip page and card still say where the flight
// arrived and where its bags come out.
export const shownAfterLandingMs = hour;
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

// A departure or landing this far from the schedule is shown; one moved
// this far from what the last news said is news again.
export const delayShownMs = 5 * minute;
export const delayNewsMs = 15 * minute;

// The booking a status is for: its own instants carry the places' offsets,
// so times are given as the airport's clock reads.
type Booked = Pick<ExtractedSegment, "start" | "end" | "destination">;

// "40 min", "1 h", "2 h 5 min".
function span(ms: number): string {
  const total = Math.round(Math.abs(ms) / minute);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

// A UTC instant as the clock reads where `place` (an instant with that
// place's offset) is: "10:25". Nothing without a place.
function clockAt(at: string, place: string | undefined): string | undefined {
  return place ? localTime(shiftInstant(place, Date.parse(at) - Date.parse(place))) : undefined;
}

// "40 min late, at 10:25", "20 min early, at 18:10" or "on time, at 09:00".
function timing(scheduled: string, estimated: string, place: string | undefined): string {
  const off = Date.parse(estimated) - Date.parse(scheduled);
  const word = Math.abs(off) < delayShownMs ? "on time" : `${span(off)} ${off > 0 ? "late" : "early"}`;
  const at = clockAt(estimated, place);
  return at ? `${word}, at ${at}` : word;
}

const offSchedule = (scheduled: string | undefined, estimated: string | undefined): boolean =>
  scheduled !== undefined && estimated !== undefined && Math.abs(Date.parse(estimated) - Date.parse(scheduled)) >= delayShownMs;

function divertedLine(status: FlightStatus, booked: Booked | undefined): string {
  const to = status.divertedTo?.toUpperCase();
  return to && to !== booked?.destination?.code?.toUpperCase() ? `Diverted to ${to}` : "Diverted";
}

// Whether a departure time is worth saying: the flight has not left and
// is off schedule, or news of a delay went out (so back on time is said).
const leavesLate = (status: FlightStatus): boolean =>
  !status.actualOut && status.estimatedOut !== undefined && (offSchedule(status.scheduledOut, status.estimatedOut) || status.noticedOut !== undefined);

// Whether the flight has taken off as of `at`: the service says it left,
// or the time it is expected to leave (else the one scheduled, else the
// booking's) has passed. A cancelled flight goes by its booking's time.
export function flightDeparted(booked: Pick<ExtractedSegment, "start">, status: FlightStatus | undefined, at: string): boolean {
  if (status?.found && !status.cancelled) {
    if (status.actualOut) return true;
    const out = status.estimatedOut ?? status.scheduledOut;
    if (out) return Date.parse(at) >= Date.parse(out);
  }
  return Date.parse(at) >= Date.parse(booked.start);
}

// Whether the flight landed more than shownAfterLandingMs before `at`: the
// service's landing, else its estimate, else the schedule, else as booked.
function longLanded(status: FlightStatus, booked: Pick<ExtractedSegment, "end"> | undefined, at: string): boolean {
  const lands = status.actualIn ?? status.estimatedIn ?? status.scheduledIn ?? booked?.end;
  return lands !== undefined && Date.parse(at) >= Date.parse(lands) + shownAfterLandingMs;
}

// "Terminal 3 · Gate 12", "Terminal E · Bags on carousel 7": what is known.
function listed(parts: readonly (string | false | undefined)[]): string | undefined {
  const known = parts.filter((p): p is string => Boolean(p));
  return known.length ? known.join(" · ") : undefined;
}

// The next thing to do for a flight, for a trip card's last line: before
// takeoff, how late it leaves when it is late, else the terminal and gate
// it leaves from; after, the terminal and gate it arrives at and where the
// bags come out, for an hour after it lands. A cancelled or diverted flight
// says that instead. Nothing when nothing is known.
export function flightNextStep(status: FlightStatus | undefined, booked: Booked, now: string): string | undefined {
  if (!status?.found) return undefined;
  if (status.cancelled) return "Flight cancelled";
  if (!flightDeparted(booked, status, now)) {
    if (leavesLate(status)) return `Leaves ${timing(status.scheduledOut!, status.estimatedOut!, booked.start)}`;
    return listed([status.departureTerminal && `Terminal ${status.departureTerminal}`, status.departureGate && `Gate ${status.departureGate}`]);
  }
  if (longLanded(status, booked, now)) return undefined;
  if (status.diverted) return divertedLine(status, booked);
  return listed([
    status.arrivalTerminal && `Terminal ${status.arrivalTerminal}`,
    status.arrivalGate && `Gate ${status.arrivalGate}`,
    status.baggageClaim && `Bags on carousel ${status.baggageClaim}`,
  ]);
}

// Whether the flight had taken off as of `at` (flightDeparted), going by
// the status alone when the booking is not given.
function departedAt(status: FlightStatus, booked: Pick<ExtractedSegment, "start"> | undefined, at: string): boolean {
  if (booked) return flightDeparted(booked, status, at);
  if (status.cancelled) return false;
  if (status.actualOut) return true;
  const out = status.estimatedOut ?? status.scheduledOut;
  return out !== undefined && Date.parse(at) >= Date.parse(out);
}

// What of a status is said at its stage: before takeoff, where it leaves
// from and the arrival terminal, but no arrival gate or carousel; after,
// where it arrives and the carousel, but not where it left from.
function staged(status: FlightStatus, departed: boolean): FlightStatus {
  if (departed) {
    const { departureGate: _gate, departureTerminal: _terminal, ...rest } = status;
    return rest;
  }
  const { arrivalGate: _gate, baggageClaim: _bags, ...rest } = status;
  return rest;
}

// What the flight's card says, by its stage as of `now` (the look's own
// time when not given): whether it is cancelled or diverted; before
// takeoff, how late it leaves, where it leaves from and the arrival
// terminal; after, when it lands, where it arrives and where the bags come
// out, until an hour after it lands, when it says nothing. Times read as the airports' clocks do when the booking is given; a
// cancelled flight says only that. A departure back on time after news of
// a delay still says so (it has a noticedOut), on the card and in a
// retried notification.
export function flightStatusLines(status: FlightStatus | undefined, booked?: Booked, now?: string): string[] {
  if (!status?.found) return [];
  if (status.cancelled) return ["Flight cancelled"];
  const at = now ?? status.checkedAt;
  const departed = departedAt(status, booked, at);
  if (departed && longLanded(status, booked, at)) return [];
  const { departure, arrival, bags } = places(staged(status, departed));
  const leaves = !departed && leavesLate(status);
  const lands = departed && !status.actualIn && status.scheduledIn !== undefined && status.estimatedIn !== undefined;
  return [
    ...(status.diverted ? [divertedLine(status, booked)] : []),
    ...(leaves ? [`Leaves ${timing(status.scheduledOut!, status.estimatedOut!, booked?.start)}`] : []),
    ...(departure ? [`Departs from ${departure}`] : []),
    ...(lands ? [`Lands ${timing(status.scheduledIn!, status.estimatedIn!, booked?.end)}`] : []),
    ...(arrival ? [`Arrives at ${arrival}`] : []),
    ...(bags ? [`Bags on carousel ${bags}`] : []),
  ];
}

// Whether this look's departure time is news: it has not left, and its
// estimate moved at least delayNewsMs from what the last news said (the
// schedule, before any did).
function departureMoved(before: FlightStatus | undefined, after: FlightStatus): boolean {
  if (!after.found || after.cancelled || after.actualOut || !after.estimatedOut || !after.scheduledOut) return false;
  const said = before?.noticedOut ?? after.scheduledOut;
  return Math.abs(Date.parse(after.estimatedOut) - Date.parse(said)) >= delayNewsMs;
}

// The answer with the departure time news has given: this look's estimate
// when it is news (flightStatusNews), else the last one.
export function noticeDeparture(before: FlightStatus | undefined, after: FlightStatus): FlightStatus {
  const { noticedOut: _dropped, ...rest } = after;
  const noticedOut = departureMoved(before, after) ? after.estimatedOut : before?.noticedOut;
  return noticedOut ? { ...rest, noticedOut } : rest;
}

// The answer with any gate, terminal or carousel it lacks taken from the
// last one: a service that loses a field for a look and finds it again is
// not news either way, and the card keeps saying where to go. A gate and
// its terminal go together: one is kept only while the other is unchanged
// (or lost too), so a new terminal never shows with the old one's gate.
// An answer that misses a flight the last one found is the service
// stumbling, not the flight vanishing: the last status stands, stamped with
// this look, so the card and the phone's Live Update keep it.
export function keepKnownPlaces(before: FlightStatus | undefined, after: FlightStatus): FlightStatus {
  if (before?.found && !after.found) return { ...before, checkedAt: after.checkedAt };
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
//
// Also news: the flight cancelled or diverted, and its departure moved at
// least a quarter of an hour from what the last news said ("Now leaves
// 40 min late, at 10:25").
export function flightStatusNews(before: FlightStatus | undefined, after: FlightStatus, booked?: Booked): string[] {
  if (!after.found) return [];
  if (after.cancelled) return before?.cancelled ? [] : ["Flight cancelled"];
  // Each look as it was said at its own stage, so a carousel known before
  // takeoff is news at the first look after, and a departure gate is no
  // news once the flight has left.
  const known = before?.found ? staged(before, departedAt(before, booked, before.checkedAt)) : undefined;
  const shown = staged(after, departedAt(after, booked, after.checkedAt));
  const was = places(known);
  const now = places(shown);
  const given = (old: string | undefined, next: string | undefined) => next !== undefined && next !== old;
  const news = (oldGate: string | undefined, oldTerminal: string | undefined, gate: string | undefined, terminal: string | undefined) => {
    const changed = given(oldGate, gate) || given(oldTerminal, terminal);
    // A change, rather than news, when what was known is replaced: a
    // gate by another, or a terminal by another.
    const replaced = (oldGate !== undefined && given(oldGate, gate)) || (oldTerminal !== undefined && given(oldTerminal, terminal));
    return { changed, replaced };
  };
  const lines: string[] = [];
  if (after.diverted && !known?.diverted) lines.push(divertedLine(after, booked));
  if (departureMoved(before, after)) {
    lines.push(`${before?.noticedOut ? "Now leaves" : "Leaves"} ${timing(after.scheduledOut!, after.estimatedOut!, booked?.start)}`);
  }
  const departure = news(known?.departureGate, known?.departureTerminal, shown.departureGate, shown.departureTerminal);
  if (now.departure && departure.changed) {
    lines.push(departure.replaced && was.departure ? `Now departs from ${now.departure} (was ${was.departure})` : `Departs from ${now.departure}`);
  }
  const arrival = news(known?.arrivalGate, known?.arrivalTerminal, shown.arrivalGate, shown.arrivalTerminal);
  if (now.arrival && arrival.changed) {
    lines.push(arrival.replaced && was.arrival ? `Now arrives at ${now.arrival} (was ${was.arrival})` : `Arrives at ${now.arrival}`);
  }
  if (now.bags && given(was.bags, now.bags)) {
    lines.push(was.bags ? `Bags now on carousel ${now.bags} (was ${was.bags})` : `Bags on carousel ${now.bags}`);
  }
  return lines;
}
