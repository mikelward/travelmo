import { formatDate, localTime } from "./format";
import { flightDeparted, flightNextStep, flightStatusKey, flightStatusShown, shownAfterLandingMs, type FlightStatus } from "./flightStatus";
import type { ExtractedSegment } from "./schema";
import { relativeTime, shiftInstant } from "./status";
import { eventVerb, isCancelled, localDate, nextEvent, type UpcomingEvent } from "./trips";

// What a trip card under way says comes next, in up to three lines:
//
//   VS 11 LHR to BOS
//   Departs in 2 h 1 min · Tue 24 Nov 17:20
//   Terminal 3 · Gate 12
//
// the booking, when (the verb, how soon, and the date and time as booked),
// and for a flight with live status the next step (flightNextStep). For an
// hour after a flight lands, the card stays on it, the step giving its gate
// and carousel, and a fourth line says what comes next:
//
//   VS 11 LHR to BOS
//   Landed 12 min ago · Tue 24 Nov 20:30
//   Terminal E · Gate B5 · Bags on carousel 7
//   Then Hertz at Boston Logan · Pick up Tue 24 Nov 20:15

export type NextUp<S extends ExtractedSegment = ExtractedSegment> = {
  segment: S;
  title: string;
  when: string;
  step?: string;
  // In the hour after a landing, what comes after the flight landed:
  // "Then Hertz at Boston Logan · Pick up Tue 24 Nov 20:15".
  then?: string;
};

type Statuses = Readonly<Record<string, FlightStatus>>;

// Flights that may be under way: booked to have left by now, while a trip
// page would show their status. The card may stay on one of them past
// anything else booked (heldEvent), so it must keep reading them.
function mayBeUnderWay<S extends ExtractedSegment>(segments: readonly S[], now: string): S[] {
  return segments.filter((s) => s.type === "flight" && flightStatusShown(s, now) && Date.parse(s.start) <= Date.parse(now));
}

// The flights whose live status the card reads: that of the next event, and
// of the next event after any booked to have left (a connection, which an
// early landing puts on the card before the booked arrival passes), while a
// trip page would show it; and any booked to have left that may be under way.
export function nextUpFlightKeys(segments: readonly ExtractedSegment[], now: string): string[] {
  const underWay = mayBeUnderWay(segments, now);
  const events = [nextEvent(segments, now), nextEvent(segments.filter((s) => !underWay.includes(s)), now)];
  const flights = [...underWay, ...events.flatMap((e) => (e && flightStatusShown(e.segment, now) ? [e.segment] : []))];
  return [...new Set(flights.flatMap((s) => flightStatusKey(s) ?? []))];
}

function statusOf(segment: ExtractedSegment, statuses: Statuses, now: string): FlightStatus | undefined {
  if (!flightStatusShown(segment, now)) return undefined;
  const key = flightStatusKey(segment);
  const status = key ? statuses[key] : undefined;
  return status?.found ? status : undefined;
}

// When a flight that has taken off lands: the service's landing, else its
// estimate, else as booked.
function landsAt(segment: ExtractedSegment, status: FlightStatus | undefined): string | undefined {
  return status?.actualIn ?? status?.estimatedIn ?? segment.end;
}

// Whether a flight has landed by now, by landsAt.
function landed(segment: ExtractedSegment, status: FlightStatus | undefined, now: string): boolean {
  const at = landsAt(segment, status);
  return at !== undefined && Date.parse(at) <= Date.parse(now);
}

// A flight the card stays on whatever else is booked before it is done:
// one late leaving past its booked time, and one in the air, until it lands
// (a car booked for the scheduled landing waits for the real one). The
// earliest such flight, if any.
function heldEvent<S extends ExtractedSegment>(segments: readonly S[], now: string, status: (s: S) => FlightStatus | undefined): UpcomingEvent<S> | undefined {
  return segments
    .filter((s) => s.type === "flight" && flightStatusShown(s, now) && (Date.parse(s.start) <= Date.parse(now) || flightDeparted(s, status(s), now)))
    .flatMap((s): UpcomingEvent<S>[] => {
      const live = status(s);
      if (live?.cancelled) return [];
      if (!flightDeparted(s, live, now)) return [{ segment: s, kind: "start", at: s.start }];
      // With no arrival time at all, booked or live, there is no telling
      // when it lands: it is held no longer than its departure, as before.
      if (!landsAt(s, live) || landed(s, live, now)) return [];
      return [{ segment: s, kind: "end", at: s.end ?? s.start }];
    })
    .sort((a, b) => Date.parse(a.segment.start) - Date.parse(b.segment.start))[0];
}

// How long after landing the card keeps to it: what waited on the landing,
// and the carousel.
export const afterLandingMs = shownAfterLandingMs;

type CardEvent<S extends ExtractedSegment> = { event: UpcomingEvent<S>; then?: UpcomingEvent<S> };

// The next event, with a flight's moved to its arrival once it has taken
// off (flightDeparted), and kept at its departure while it is late leaving.
function upcoming<S extends ExtractedSegment>(segments: readonly S[], now: string, status: (s: S) => FlightStatus | undefined): UpcomingEvent<S> | undefined {
  const next = nextEvent(segments, now);
  if (!next || next.segment.type !== "flight") return next;
  const { segment } = next;
  if (!flightDeparted(segment, status(segment), now)) return { segment, kind: "start", at: segment.start };
  return segment.end ? { segment, kind: "end", at: segment.end } : next;
}

// The hour after a flight lands (the latest to have landed, if several).
// What was booked to start while it was in the air (a car to pick up at the
// scheduled landing) has not happened yet, and comes next before anything
// else. While the service has news of the flight, the card stays on it, for
// its gate and carousel, with what comes next after it; without, what
// waited on the landing is the card's.
function afterLanding<S extends ExtractedSegment>(segments: readonly S[], now: string, status: (s: S) => FlightStatus | undefined): CardEvent<S> | undefined {
  const at = Date.parse(now);
  const flight = segments
    .filter((f) => f.type === "flight" && flightStatusShown(f, now) && !status(f)?.cancelled && landed(f, status(f), now))
    .filter((f) => at < Date.parse(landsAt(f, status(f))!) + afterLandingMs)
    .sort((a, b) => Date.parse(landsAt(b, status(b))!) - Date.parse(landsAt(a, status(a))!))[0];
  if (!flight) return undefined;
  const lands = Date.parse(landsAt(flight, status(flight))!);
  const waiting = segments
    .filter((s) => s.type !== "flight" && !isCancelled(s) && Date.parse(s.start) >= Date.parse(flight.start) && Date.parse(s.start) <= lands && Date.parse(s.start) <= at)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  // The flight landed is done, though its booked arrival may be to come.
  const rest = segments.filter((s) => s !== flight);
  const next: UpcomingEvent<S> | undefined = waiting ? { segment: waiting, kind: "start", at: waiting.start } : upcoming(rest, now, status);
  if (status(flight)) return { event: { segment: flight, kind: "end", at: flight.end ?? flight.start }, ...(next ? { then: next } : {}) };
  return waiting ? { event: next! } : undefined;
}

// What the card is about: a flight under way (heldEvent), then the hour
// after a landing (afterLanding), then the next event (upcoming).
function cardEvent<S extends ExtractedSegment>(segments: readonly S[], now: string, status: (s: S) => FlightStatus | undefined): CardEvent<S> | undefined {
  const held = heldEvent(segments, now, status);
  if (held) return { event: held };
  const landing = afterLanding(segments, now, status);
  if (landing) return landing;
  const next = upcoming(segments, now, status);
  return next && { event: next };
}

// "12 min ago", or "1 h 5 min ago": how long since a past instant.
function ago(now: string, at: string): string {
  const minutes = Math.max(1, Math.round((Date.parse(now) - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""} ago`;
}

// When the event is expected, as an instant in its place's offset: a
// flight's estimate where the service gives one, else as booked.
function expected(event: UpcomingEvent, status: FlightStatus | undefined): string {
  if (!status || status.cancelled) return event.at;
  const estimate = event.kind === "start" ? (status.actualOut ? undefined : status.estimatedOut) : (status.actualIn ?? status.estimatedIn);
  return estimate ? shiftInstant(event.at, Date.parse(estimate) - Date.parse(event.at)) : event.at;
}

// The card's lines for what comes next, or nothing when nothing does.
// `statuses` are the live flight statuses by key (nextUpFlightKeys).
// When an event happens: the verb, how soon, and the date and time as
// booked; a flight's landing once it has landed.
function whenLine(event: UpcomingEvent, status: FlightStatus | undefined, now: string): string {
  const booked = `${formatDate(localDate(event.at))} ${localTime(event.at)}`;
  const at = expected(event, status);
  if (event.segment.type === "flight" && event.kind === "end" && Date.parse(at) <= Date.parse(now)) return `Landed ${ago(now, at)} · ${booked}`;
  // "on Fri" says no more than the date after it.
  const relative = relativeTime(now, at);
  const soon = relative?.startsWith("on ") ? undefined : relative;
  return `${eventVerb(event)}${soon ? ` ${soon} ·` : ""} ${booked}`;
}

// The card's lines for what comes next, or nothing when nothing does.
// `statuses` are the live flight statuses by key (nextUpFlightKeys).
export function tripNextUp<S extends ExtractedSegment>(segments: readonly S[], now: string, statuses: Statuses = {}): NextUp<S> | undefined {
  const live = (s: S) => statusOf(s, statuses, now);
  const card = cardEvent(segments, now, live);
  if (!card) return undefined;
  const { event, then } = card;
  const status = live(event.segment);
  const step = status ? flightNextStep(status, event.segment, now) : undefined;
  let thenLine: string | undefined;
  if (then) {
    // A flight next, a connection say, with its own gate.
    const thenStatus = live(then.segment);
    const thenStep = thenStatus ? flightNextStep(thenStatus, then.segment, now) : undefined;
    thenLine = [`Then ${then.segment.title}`, whenLine(then, thenStatus, now), ...(thenStep ? [thenStep] : [])].join(" · ");
  }
  return { segment: event.segment, title: event.segment.title, when: whenLine(event, status, now), ...(step ? { step } : {}), ...(thenLine ? { then: thenLine } : {}) };
}
