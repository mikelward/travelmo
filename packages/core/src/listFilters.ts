import { isOuting } from "./home";
import type { ExtractedSegment, Trip } from "./schema";
import { allCancelled, liveSegments } from "./trips";

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

// What the list's filters need to know of a trip's bookings, kept on the
// trip (`allCancelled`, `localOnly`) so the list filters without reading
// them: the parser records it as it files bookings, and an app that sees a
// trip's bookings disagree with it puts it right (tripFlagsToWrite), which
// also fills it in for trips from before it was kept.
export type TripFlags = { allCancelled: boolean; localOnly: boolean };
// As a trip has them: either may be missing.
type KeptFlags = { allCancelled?: boolean | undefined; localOnly?: boolean | undefined };

export function tripFlags(segments: readonly ExtractedSegment[]): TripFlags {
  return { allCancelled: allCancelled(segments), localOnly: localOnly(segments) };
}

// The flags to write on a trip whose bookings have just been read, or
// undefined when the trip already says so.
export function tripFlagsToWrite(trip: KeptFlags, segments: readonly ExtractedSegment[]): TripFlags | undefined {
  const flags = tripFlags(segments);
  return trip.allCancelled === flags.allCancelled && trip.localOnly === flags.localOnly ? undefined : flags;
}

// Whether the list needs a trip's bookings to filter it: only while the
// trip doesn't yet say.
export function flagsUnknown(trip: KeptFlags): boolean {
  return trip.allCancelled === undefined || trip.localOnly === undefined;
}

// Whether the list leaves a trip out: by its own cancellation and flags,
// else, for a trip from before the flags were kept, by its bookings once
// read (`segments`; undefined until then).
export function hiddenFromList(
  trip: Pick<Trip, "cancelledAt"> & KeptFlags,
  segments: readonly ExtractedSegment[] | undefined,
  filters: ListFilters,
): boolean {
  const known = (flag: keyof TripFlags) => trip[flag] ?? (segments ? tripFlags(segments)[flag] : false);
  if (filters.hideCancelled && (trip.cancelledAt !== undefined || known("allCancelled"))) return true;
  return filters.hideLocal && known("localOnly");
}
