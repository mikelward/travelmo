import type { ExtractedSegment, Place } from "./schema";
import { isCancelled } from "./trips";

// Where a booking's directions lead: a journey's or a car rental's start
// (the airport, station or desk you head to), anything else's place (the
// stay, the venue). None for a cancelled booking or one with no place.
export function directionsPlace(segment: ExtractedSegment): Place | undefined {
  if (isCancelled(segment)) return undefined;
  const fromStart = segment.type === "flight" || segment.type === "train" || segment.type === "bus" || segment.type === "ferry" || segment.type === "car_rental";
  return fromStart ? (segment.origin ?? segment.destination) : (segment.destination ?? segment.origin);
}

// What Maps is asked to find: the place's name with its address, else its
// spot on the map, else its name with its town.
export function directionsQuery(place: Place): string {
  const withName = (rest: string) => (rest.toLowerCase().includes(place.name.toLowerCase()) ? rest : `${place.name}, ${rest}`);
  if (place.address) return withName(place.address);
  if (place.lat !== undefined && place.lon !== undefined) return `${place.lat},${place.lon}`;
  return place.city && !place.name.toLowerCase().includes(place.city.toLowerCase()) ? `${place.name}, ${place.city}` : place.name;
}

// Google Maps' directions to a booking's place, which phones open in the
// Maps app; undefined when it has none.
export function directionsUrl(segment: ExtractedSegment): string | undefined {
  const place = directionsPlace(segment);
  return place ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(directionsQuery(place))}` : undefined;
}
