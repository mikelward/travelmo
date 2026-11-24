import { formatDate, localTime } from "./format";
import { flightDeparted, flightNextStep, flightStatusKey, flightStatusShown, type FlightStatus } from "./flightStatus";
import type { ExtractedSegment } from "./schema";
import { relativeTime, shiftInstant } from "./status";
import { eventVerb, localDate, nextEvent, type UpcomingEvent } from "./trips";

// What a trip card under way says comes next, in up to three lines:
//
//   VS 11 LHR to BOS
//   Departs in 2 h 1 min · Tue 24 Nov 17:20
//   Terminal 3 · Gate 12
//
// the booking, when (the verb, how soon, and the date and time as booked),
// and for a flight with live status the next step (flightNextStep).

export type NextUp<S extends ExtractedSegment = ExtractedSegment> = {
  segment: S;
  title: string;
  when: string;
  step?: string;
};

type Statuses = Readonly<Record<string, FlightStatus>>;

// Flights booked to have landed by now that may still be under way: a late
// one keeps its place on the card for as long as a trip page would show its
// status, so the card must keep reading it.
function mayBeLate<S extends ExtractedSegment>(segments: readonly S[], now: string): S[] {
  return segments.filter((s) => s.type === "flight" && flightStatusShown(s, now) && Date.parse(s.end ?? s.start) < Date.parse(now));
}

// The flights whose live status the card reads: that of the next event, while
// a trip page would show it, and any booked to have landed that may be late.
export function nextUpFlightKeys(segments: readonly ExtractedSegment[], now: string): string[] {
  const event = nextEvent(segments, now);
  const flights = [...mayBeLate(segments, now), ...(event && flightStatusShown(event.segment, now) ? [event.segment] : [])];
  return [...new Set(flights.flatMap((s) => flightStatusKey(s) ?? []))];
}

function statusOf(segment: ExtractedSegment, statuses: Statuses, now: string): FlightStatus | undefined {
  if (!flightStatusShown(segment, now)) return undefined;
  const key = flightStatusKey(segment);
  const status = key ? statuses[key] : undefined;
  return status?.found ? status : undefined;
}

// The next event, with a flight's moved to its arrival once it has taken
// off (flightDeparted), and kept at its departure while it is late leaving.
//
// A flight booked to have landed already that the service says has not (no
// arrival yet, and one expected after now) is still the card's event: it is
// under way, or late leaving, whatever the booking said.
function cardEvent<S extends ExtractedSegment>(segments: readonly S[], now: string, status: (s: S) => FlightStatus | undefined): UpcomingEvent<S> | undefined {
  const late = mayBeLate(segments, now)
    .filter((s) => {
      const live = status(s);
      if (!live || live.cancelled || live.actualIn) return false;
      const arrives = live.estimatedIn ?? live.estimatedOut;
      return arrives !== undefined && Date.parse(arrives) > Date.parse(now);
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  const event: UpcomingEvent<S> | undefined = late ? { segment: late, kind: "end", at: late.end ?? late.start } : nextEvent(segments, now);
  if (!event || event.segment.type !== "flight") return event;
  const { segment } = event;
  const departed = flightDeparted(segment, status(segment), now);
  if (!departed) return { segment, kind: "start", at: segment.start };
  return segment.end ? { segment, kind: "end", at: segment.end } : event;
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
export function tripNextUp<S extends ExtractedSegment>(segments: readonly S[], now: string, statuses: Statuses = {}): NextUp<S> | undefined {
  const event = cardEvent(segments, now, (s) => statusOf(s, statuses, now));
  if (!event) return undefined;
  const status = statusOf(event.segment, statuses, now);
  // "on Fri" says no more than the date after it.
  const relative = relativeTime(now, expected(event, status));
  const soon = relative?.startsWith("on ") ? undefined : relative;
  const when = `${eventVerb(event)}${soon ? ` ${soon} ·` : ""} ${formatDate(localDate(event.at))} ${localTime(event.at)}`;
  const step = status ? flightNextStep(status, event.segment, now) : undefined;
  return { segment: event.segment, title: event.segment.title, when, ...(step ? { step } : {}) };
}
