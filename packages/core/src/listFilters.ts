import { isOuting } from "./home";
import type { ExtractedSegment, Trip } from "./schema";
import { liveSegments, tripCancelled } from "./trips";

// What the trip list leaves out (SPEC "Filtering the trip list"), as the
// person set it on this device; nothing by default.
export type ListFilters = { hideCancelled: boolean; hideLocal: boolean };
export const noListFilters: ListFilters = { hideCancelled: false, hideLocal: false };

// A trip of local events alone: everything still booked in it is an outing
// (a show, a class, a car hired and returned in one place), nothing that
// travels or stays. One with nothing booked is not: where it goes is unknown.
export function localOnly(segments: readonly ExtractedSegment[]): boolean {
  const live = liveSegments(segments);
  return live.length > 0 && live.every(isOuting);
}

// Whether the list leaves a trip out. Until its bookings are read
// (`segments` undefined) only the trip's own cancellation can tell.
export function hiddenFromList(trip: Pick<Trip, "cancelledAt">, segments: readonly ExtractedSegment[] | undefined, filters: ListFilters): boolean {
  if (filters.hideCancelled && tripCancelled(trip, segments)) return true;
  return filters.hideLocal && segments !== undefined && localOnly(segments);
}
