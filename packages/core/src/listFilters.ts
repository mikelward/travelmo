import { isOuting } from "./home";
import type { ExtractedSegment, Trip } from "./schema";
import { canonicalName, findPerson, guessMe, type Person } from "./travelers";
import { tripSetting } from "./landmarks";
import type { PlaceSetting } from "./schema";
import { allCancelled, liveSegments } from "./trips";

// What the trip list leaves out (SPEC "Filtering the trip list"), as the
// person set it on this device; nothing by default.
export type ListFilters = { hideCancelled: boolean; hideLocal: boolean; hideWatching: boolean };
export const noListFilters: ListFilters = { hideCancelled: false, hideLocal: false, hideWatching: false };

// A trip of local events alone: everything still booked in it is an outing
// (a show, a class, a car hired and returned in one place), nothing that
// travels or stays. One with nothing booked is not: where it goes is unknown.
export function localOnly(segments: readonly ExtractedSegment[]): boolean {
  const live = liveSegments(segments);
  return live.length > 0 && live.every(isOuting);
}

// The most travelers a trip keeps, as the stored schema allows: a coach of
// schoolchildren, not every name on a big group's bookings.
export const maxTripTravelers = 100;

// Whom a trip's bookings are for: every name they give, as people write it
// (canonicalName), each spelling once, going by what is still booked unless
// nothing is. Spellings stay apart ("J Smith" beside "John Smith") until
// they're matched to the user's people, who may tell them apart. More than
// `maxTripTravelers` is kept as none, so a trip is never taken for one the
// user isn't on for want of room for their name.
export function tripTravelers(segments: readonly ExtractedSegment[]): string[] {
  const live = liveSegments(segments);
  const names = [...new Set((live.length > 0 ? live : segments).flatMap((s) => s.travelers ?? []).flatMap((raw) => canonicalName(raw) ?? []))];
  return names.length > maxTripTravelers ? [] : names;
}

// A person as watching needs them: who they are, and what guessMe goes by.
type Known = Person & { bookings: number; direct: number };

// Whether the user is only watching a trip: its bookings name travelers and
// none of them is the user (guessMe, findPerson): a parent's forwarded
// itinerary, a child's school trip. Never while who the user is is unknown,
// nor for a trip whose bookings name no one.
export function watching(travelers: readonly string[] | undefined, people: readonly Known[]): boolean {
  const me = guessMe(people);
  if (!me || !travelers || travelers.length === 0) return false;
  return !travelers.some((t) => findPerson(people, t)?.id === me.id);
}

// Whether the user is only watching this trip: by its bookings when they
// are read (`segments`), else by what the trip keeps of them. What is the
// user's own (warnings, reminders, check-in, rides, reports, residence,
// the download, working out home) leaves such a trip out.
export function watchedTrip(
  trip: { travelers?: readonly string[] | undefined },
  segments: readonly ExtractedSegment[] | undefined,
  people: readonly Known[],
): boolean {
  return watching(segments ? tripTravelers(segments) : trip.travelers, people);
}

// The bookings home is worked out from (homeTimeline): every trip's, by
// trip, but those the user is only watching (a parent's flights from their
// own home say nothing of the user's).
export function homeBookings<S extends ExtractedSegment>(byTrip: Iterable<readonly S[]>, people: readonly Known[]): S[] {
  return [...byTrip].filter((segments) => !watching(tripTravelers(segments), people)).flat();
}

// What the list needs to know of a trip's bookings, kept on the trip
// (`allCancelled`, `localOnly`, `travelers` for its filters, `setting` for
// its picture) so the list goes without reading them: the parser records it
// as it files bookings, and an app that sees a trip's bookings disagree with
// it puts it right (tripFlagsToWrite), which also fills it in for trips from
// before it was kept.
export type TripFlags = { allCancelled: boolean; localOnly: boolean; travelers: string[]; setting: PlaceSetting | "none" };
// As a trip has them: any may be missing.
type KeptFlags = {
  allCancelled?: boolean | undefined;
  localOnly?: boolean | undefined;
  travelers?: readonly string[] | undefined;
  setting?: PlaceSetting | "none" | undefined;
};

export function tripFlags(segments: readonly ExtractedSegment[]): TripFlags {
  return { allCancelled: allCancelled(segments), localOnly: localOnly(segments), travelers: tripTravelers(segments), setting: tripSetting(segments) };
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

// The flags to write on a trip whose bookings have just been read, or
// undefined when the trip already says so.
export function tripFlagsToWrite(trip: KeptFlags, segments: readonly ExtractedSegment[]): TripFlags | undefined {
  const flags = tripFlags(segments);
  const same = trip.allCancelled === flags.allCancelled && trip.localOnly === flags.localOnly && sameList(trip.travelers, flags.travelers) && trip.setting === flags.setting;
  return same ? undefined : flags;
}

// Whether the list needs a trip's bookings to filter it or draw it: only
// while the trip doesn't yet say.
export function flagsUnknown(trip: KeptFlags): boolean {
  return trip.allCancelled === undefined || trip.localOnly === undefined || trip.travelers === undefined || trip.setting === undefined;
}

// Whether the list leaves a trip out: by its own cancellation and flags,
// else, for a trip from before the flags were kept, by its bookings once
// read (`segments`; undefined until then). `people` are the user's, for
// whether they're only watching it.
export function hiddenFromList(
  trip: Pick<Trip, "cancelledAt"> & KeptFlags,
  segments: readonly ExtractedSegment[] | undefined,
  filters: ListFilters,
  people: readonly Known[] = [],
): boolean {
  const read = segments ? tripFlags(segments) : undefined;
  if (filters.hideCancelled && (trip.cancelledAt !== undefined || (trip.allCancelled ?? read?.allCancelled ?? false))) return true;
  if (filters.hideLocal && (trip.localOnly ?? read?.localOnly ?? false)) return true;
  return filters.hideWatching && watching(trip.travelers ?? read?.travelers, people);
}

// Whether any filter is on.
export const filtering = (filters: ListFilters) => filters.hideCancelled || filters.hideLocal || filters.hideWatching;
