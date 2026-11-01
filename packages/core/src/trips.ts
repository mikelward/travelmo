import { compareInstants } from "./instant";
import type { ExtractedSegment, Place, SegmentType, Trip } from "./schema";

export type TripGroups = {
  current: Trip[];
  upcoming: Trip[];
  past: Trip[];
};

export function groupTrips(trips: readonly Trip[], today: string): TripGroups {
  const current: Trip[] = [];
  const upcoming: Trip[] = [];
  const past: Trip[] = [];
  for (const trip of trips) {
    if (trip.end < today) past.push(trip);
    else if (trip.start > today) upcoming.push(trip);
    else current.push(trip);
  }
  const byStart = (a: Trip, b: Trip) => a.start.localeCompare(b.start);
  current.sort(byStart);
  upcoming.sort(byStart);
  past.sort((a, b) => b.end.localeCompare(a.end));
  return { current, upcoming, past };
}

export function localDate(instant: string): string {
  return instant.slice(0, 10);
}

export function segmentDateRange(
  segments: readonly ExtractedSegment[],
): { start: string; end: string } | undefined {
  // Both endpoints feed both bounds: across the date line a flight can land
  // on an earlier local date than it departed.
  let start: string | undefined;
  let end: string | undefined;
  for (const segment of segments) {
    for (const date of [localDate(segment.start), localDate(segment.end ?? segment.start)]) {
      if (start === undefined || date < start) start = date;
      if (end === undefined || date > end) end = date;
    }
  }
  return start !== undefined && end !== undefined ? { start, end } : undefined;
}

export type UpcomingEvent<S extends ExtractedSegment = ExtractedSegment> = {
  segment: S;
  kind: "start" | "end";
  at: string;
};

// The soonest thing still ahead: a booking's start, or the end of one that
// is under way (a stay's check-out, a flight's arrival).
export function nextEvent<S extends ExtractedSegment>(segments: readonly S[], now: string): UpcomingEvent<S> | undefined {
  let best: UpcomingEvent<S> | undefined;
  for (const segment of segments) {
    let candidate: UpcomingEvent<S> | undefined;
    if (compareInstants(segment.start, now) >= 0) candidate = { segment, kind: "start", at: segment.start };
    else if (segment.end && compareInstants(segment.end, now) >= 0) candidate = { segment, kind: "end", at: segment.end };
    if (candidate && (!best || compareInstants(candidate.at, best.at) < 0)) best = candidate;
  }
  return best;
}

const eventVerbs: Record<SegmentType, { start: string; end: string }> = {
  flight: { start: "Departs", end: "Arrives" },
  train: { start: "Departs", end: "Arrives" },
  bus: { start: "Departs", end: "Arrives" },
  ferry: { start: "Departs", end: "Arrives" },
  lodging: { start: "Check-in", end: "Check-out" },
  car_rental: { start: "Pick up", end: "Return" },
  activity: { start: "Starts", end: "Ends" },
  other: { start: "Starts", end: "Ends" },
};

export function eventVerb(event: UpcomingEvent): string {
  return eventVerbs[event.segment.type][event.kind];
}

// A form edits a place's name and code; whatever else an import recorded
// about it (city, country) survives until the name is cleared.
export function mergePlace(existing: Place | undefined, name: string, code: string): Place | undefined {
  const trimmedName = name.trim();
  if (!trimmedName) return undefined;
  const trimmedCode = code.trim().toUpperCase();
  const { code: _oldCode, ...rest } = existing ?? { name: trimmedName };
  return { ...rest, name: trimmedName, ...(trimmedCode ? { code: trimmedCode } : {}) };
}

export function daysBetween(start: string, end: string): number {
  const ms = Date.UTC(
    Number(end.slice(0, 4)),
    Number(end.slice(5, 7)) - 1,
    Number(end.slice(8, 10)),
  ) -
    Date.UTC(
      Number(start.slice(0, 4)),
      Number(start.slice(5, 7)) - 1,
      Number(start.slice(8, 10)),
    );
  return Math.round(ms / 86_400_000);
}

// A booking belongs to an existing trip when its dates fall within, or within
// `gapDays` of, that trip. Flights home after a long gap start a new trip.
export function findTripForRange(
  trips: readonly Trip[],
  range: { start: string; end: string },
  gapDays = 2,
): Trip | undefined {
  return trips.find(
    (trip) =>
      daysBetween(trip.end, range.start) <= gapDays &&
      daysBetween(range.end, trip.start) <= gapDays,
  );
}
