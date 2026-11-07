import type { Place, Segment, SegmentType, Trip } from "./schema";

// The places the traveler rated or marked as favorites, gathered across
// their trips for the reports page: one entry per place (by name and
// country), with the best rating given to it and every trip it was on.

export type FavoritePlace = {
  name: string;
  city?: string;
  country?: string;
  type: SegmentType;
  favorite: boolean;
  rating?: number;
  // Latest first.
  trips: { id: string; title: string; start: string }[];
};

export type TripWithBookings = { trip: Pick<Trip, "id" | "title" | "start">; segments: readonly Segment[] };

// The place a booking is "at": where it ends for a journey, where it is
// for a stay or activity; the booking's title when it names no place.
export function bookingPlace(segment: Pick<Segment, "type" | "title" | "origin" | "destination">): Place {
  return segment.destination ?? segment.origin ?? { name: segment.title };
}

const placeKey = (p: Place) => `${p.name.trim().toLowerCase()}|${(p.country ?? "").toUpperCase()}`;

// Favorites first, then the best rated, then by name. A place rated on two
// trips keeps the higher rating, and links every trip it was booked on,
// rated there or not; a place never rated or marked is left out.
export function favoritePlaces(all: readonly TripWithBookings[]): FavoritePlace[] {
  const byPlace = new Map<string, FavoritePlace>();
  const seen = new Set<string>();
  for (const { trip, segments } of all) {
    if (seen.has(trip.id)) continue;
    seen.add(trip.id);
    for (const s of segments) {
      const place = bookingPlace(s);
      const key = placeKey(place);
      const entry = byPlace.get(key) ?? {
        name: place.name,
        ...(place.city ? { city: place.city } : {}),
        ...(place.country ? { country: place.country.toUpperCase() } : {}),
        type: s.type,
        favorite: false,
        trips: [],
      };
      entry.favorite = entry.favorite || Boolean(s.favorite);
      if (s.rating !== undefined && (entry.rating === undefined || s.rating > entry.rating)) entry.rating = s.rating;
      if (!entry.trips.some((t) => t.id === trip.id)) entry.trips.push({ id: trip.id, title: trip.title, start: trip.start });
      byPlace.set(key, entry);
    }
  }
  const out = [...byPlace.values()].filter((e) => e.favorite || e.rating !== undefined);
  for (const e of out) e.trips.sort((a, b) => b.start.localeCompare(a.start));
  return out.sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name),
  );
}
