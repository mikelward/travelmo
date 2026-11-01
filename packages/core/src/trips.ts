import type { ExtractedSegment, Trip } from "./schema";

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
  let start: string | undefined;
  let end: string | undefined;
  for (const segment of segments) {
    const s = localDate(segment.start);
    const e = localDate(segment.end ?? segment.start);
    if (start === undefined || s < start) start = s;
    if (end === undefined || e > end) end = e;
  }
  return start !== undefined && end !== undefined ? { start, end } : undefined;
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
