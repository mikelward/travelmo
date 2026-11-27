import { isOuting } from "./home";
import type { ExtractedSegment, Trip } from "./schema";
import { canonicalName, findPerson, guessMe, type Person } from "./travelers";
import { tripBookingType, tripSetting } from "./landmarks";
import type { TripSetting } from "./schema";
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
// user isn't on for want of room for their name. Names the owner took off
// the trip (`removed`, Trip.removedTravelers) are left out, however a
// booking spells them.
export function tripTravelers(segments: readonly ExtractedSegment[], removed: readonly string[] = []): string[] {
  const live = liveSegments(segments);
  const gone = new Set(removed.flatMap((raw) => canonicalName(raw) ?? []));
  const names = [...new Set((live.length > 0 ? live : segments).flatMap((s) => s.travelers ?? []).flatMap((raw) => canonicalName(raw) ?? []))].filter((n) => !gone.has(n));
  return names.length > maxTripTravelers ? [] : names;
}

// Every name a trip's bookings give, those the owner took off too, as the
// Travelers… dialog lists them: what is still booked first, then the rest.
export function namedTravelers(segments: readonly ExtractedSegment[], removed: readonly string[] = []): string[] {
  const live = liveSegments(segments);
  const all = [...live, ...segments.filter((s) => !live.includes(s))].flatMap((s) => s.travelers ?? []);
  return [...new Set([...all, ...removed].flatMap((raw) => canonicalName(raw) ?? []))];
}

// A person as watching needs them: who they are, and what guessMe goes by.
type Known = Person & { bookings: number; direct: number };

// Whether the user is only watching a trip: its bookings name travelers and
// none of them is the user (guessMe, findPerson): a parent's forwarded
// itinerary, a child's school trip. Never while who the user is is unknown,
// nor for a trip whose bookings name no one, unless the owner took the user
// off it (`removed`): a printout that named them wrongly.
export function watching(travelers: readonly string[] | undefined, people: readonly Known[], removed: readonly string[] = []): boolean {
  const me = guessMe(people);
  if (!me) return false;
  const isMe = (t: string) => findPerson(people, t)?.id === me.id;
  if (travelers?.some(isMe)) return false;
  if (removed.some(isMe)) return true;
  return !!travelers && travelers.length > 0;
}

// Whether the user is only watching this trip: by its bookings when they
// are read (`segments`), else by what the trip keeps of them. What is the
// user's own (warnings, reminders, check-in, rides, reports, residence,
// the download, working out home) leaves such a trip out.
export function watchedTrip(
  trip: { travelers?: readonly string[] | undefined; removedTravelers?: readonly string[] | undefined },
  segments: readonly ExtractedSegment[] | undefined,
  people: readonly Known[],
): boolean {
  const removed = trip.removedTravelers ?? [];
  return watching(segments ? tripTravelers(segments, removed) : trip.travelers, people, removed);
}

// A trip's bookings with the names its owner took off it; a booking not
// yet filed has none.
export type TripBookings<S> = { removedTravelers?: readonly string[] | undefined; segments: readonly S[] };

// The bookings home is worked out from (homeTimeline): every trip's, by
// trip, but those the user is only watching (a parent's flights from their
// own home say nothing of the user's).
export function homeBookings<S extends ExtractedSegment>(byTrip: Iterable<readonly S[] | TripBookings<S>>, people: readonly Known[]): S[] {
  return [...byTrip]
    .map((t): TripBookings<S> => (Array.isArray(t) ? { segments: t as readonly S[] } : (t as TripBookings<S>)))
    .filter((t) => !watchedTrip(t, t.segments, people))
    .flatMap((t) => t.segments);
}

// What the list needs to know of a trip's bookings, kept on the trip
// (`allCancelled`, `localOnly`, `travelers` for its filters, `setting` for
// its picture) so the list goes without reading them: the parser records it
// as it files bookings, and an app that sees a trip's bookings disagree with
// it puts it right (tripFlagsToWrite), which also fills it in for trips from
// before it was kept.
export type TripFlags = { allCancelled: boolean; localOnly: boolean; travelers: string[]; setting: TripSetting };
// As a trip has them: any may be missing.
type KeptFlags = {
  allCancelled?: boolean | undefined;
  localOnly?: boolean | undefined;
  travelers?: readonly string[] | undefined;
  setting?: TripSetting | undefined;
  removedTravelers?: readonly string[] | undefined;
};

export function tripFlags(segments: readonly ExtractedSegment[], removed: readonly string[] = []): TripFlags {
  return { allCancelled: allCancelled(segments), localOnly: localOnly(segments), travelers: tripTravelers(segments, removed), setting: tripSetting(segments) };
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

// The flags to write on a trip whose bookings have just been read, or
// undefined when the trip already says so.
export function tripFlagsToWrite(trip: KeptFlags, segments: readonly ExtractedSegment[]): TripFlags | undefined {
  const flags = tripFlags(segments, trip.removedTravelers);
  const same = trip.allCancelled === flags.allCancelled && trip.localOnly === flags.localOnly && sameList(trip.travelers, flags.travelers) && trip.setting === flags.setting;
  return same ? undefined : flags;
}

// Whether the list needs a trip's bookings to filter it or draw it: only
// while the trip doesn't yet say.
export function flagsUnknown(trip: KeptFlags): boolean {
  return (
    trip.allCancelled === undefined ||
    trip.localOnly === undefined ||
    trip.travelers === undefined ||
    trip.setting === undefined ||
    // A trip of local events kept a town before events took their booking's icon.
    (trip.localOnly && !tripBookingType(trip.setting))
  );
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
  if (!filtering(filters)) return false;
  if (filters.hideCancelled) {
    if (trip.cancelledAt !== undefined) return true;
    const cancelled = trip.allCancelled ?? (segments ? allCancelled(segments) : false);
    if (cancelled) return true;
  }
  if (filters.hideLocal) {
    const local = trip.localOnly ?? (segments ? localOnly(segments) : false);
    if (local) return true;
  }
  if (filters.hideWatching) {
    const travelers = trip.travelers ?? (segments ? tripTravelers(segments, trip.removedTravelers) : undefined);
    if (watching(travelers, people, trip.removedTravelers)) return true;
  }
  return false;
}

// Whether any filter is on.
export const filtering = (filters: ListFilters) => filters.hideCancelled || filters.hideLocal || filters.hideWatching;
