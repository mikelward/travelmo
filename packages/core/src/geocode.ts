import { isCountryCode } from "./countries";
import { stableHash } from "./hash";
import type { ExtractedSegment, Place } from "./schema";

// Filling in a place's country (and city) from a geocoder when its source
// gave none: the reports and the passport warnings need the country, and an
// email or a TripIt object often names only a hotel and a town. The network
// parts live in the parser; this is what to ask, how to read the answer and
// how to apply it, shared with the booking form's address lookup, which
// reads the same address components from the Places API.

export type GeocodeResult = { country: string; city?: string };

// An address component as the Geocoding API (`long_name`, `short_name`) or
// the Places API (New) (`longText`, `shortText`) writes it.
export type AddressComponent = {
  types?: string[];
  long_name?: string;
  short_name?: string;
  longText?: string;
  shortText?: string;
};

export class GeocodeError extends Error {
  constructor(
    public readonly status: string,
    message?: string,
  ) {
    super(message ? `${status}: ${message}` : status);
  }
}

const cityTypes = ["locality", "postal_town", "administrative_area_level_2"];

// The country and city named by a set of address components, or nothing
// when no component is a country Travelmo knows.
export function placeFromComponents(components: readonly AddressComponent[] | undefined): GeocodeResult | undefined {
  const of = (type: string) => components?.find((c) => c.types?.includes(type));
  const country = (of("country")?.short_name ?? of("country")?.shortText)?.toUpperCase();
  if (!country || !isCountryCode(country)) return undefined;
  for (const type of cityTypes) {
    const c = of(type);
    const city = (c?.long_name ?? c?.longText)?.trim();
    if (city) return { country, city };
  }
  return { country };
}

// The Geocoding API's JSON answer, read for its first result. "none" is a
// place Google cannot name a country for; any status but OK and ZERO_RESULTS
// (a refused key, an exhausted quota) is an error to log, not a result.
export function parseGeocodeResponse(json: unknown): GeocodeResult | "none" {
  const body = (json ?? {}) as { status?: unknown; error_message?: unknown; results?: unknown };
  const status = typeof body.status === "string" ? body.status : "UNKNOWN";
  if (status === "ZERO_RESULTS") return "none";
  if (status !== "OK") throw new GeocodeError(status, typeof body.error_message === "string" ? body.error_message : undefined);
  const first = Array.isArray(body.results) ? (body.results[0] as { address_components?: AddressComponent[] } | undefined) : undefined;
  return placeFromComponents(first?.address_components) ?? "none";
}

// A place is worth asking about when it has a name that is more than its
// code and no country yet. A name that is the place's own code, or written
// like one (two to four capitals or digits: "LHR", "KX"), is not a name;
// "Rome" or "Oslo" is.
export function geocodeQuery(place: Place | undefined): string | undefined {
  if (!place || place.country) return undefined;
  const name = place.name.trim();
  if (!name) return undefined;
  if (place.code && name.toUpperCase() === place.code.trim().toUpperCase()) return undefined;
  if (/^[A-Z0-9]{2,4}$/.test(name)) return undefined;
  const city = place.city?.trim();
  return city && city.toLowerCase() !== name.toLowerCase() ? `${name}, ${city}` : name;
}

export const normalizeQuery = (query: string) =>
  query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const geocodeKey = (query: string) => stableHash(normalizeQuery(query));

// Fills what the source left empty, never what it gave.
export function applyGeocode(place: Place, result: GeocodeResult): Place {
  return {
    ...place,
    ...(place.country ? {} : { country: result.country }),
    ...(place.city || !result.city ? {} : { city: result.city }),
  };
}

export type CountryLookup = (code: string) => { country: string } | undefined;

// A flight's airport code names its country without asking anyone.
export function fillAirportCountries(segment: ExtractedSegment, lookup: CountryLookup): ExtractedSegment {
  if (segment.type !== "flight") return segment;
  const fill = (place: Place | undefined) => {
    if (!place || place.country || !place.code) return place;
    const found = lookup(place.code);
    return found ? { ...place, country: found.country } : place;
  };
  const origin = fill(segment.origin);
  const destination = fill(segment.destination);
  return {
    ...segment,
    ...(origin ? { origin } : {}),
    ...(destination ? { destination } : {}),
  };
}

export type GeocodeLookup = (query: string) => Promise<GeocodeResult | "none">;

export type Enriched = { segments: ExtractedSegment[]; filled: number; failed: number };

// The segments with their places filled from `lookup`, asked once per
// distinct query. A failing lookup leaves its place as it was: an import
// never fails for want of a country.
export async function enrichSegments(segments: readonly ExtractedSegment[], lookup: GeocodeLookup): Promise<Enriched> {
  const answers = new Map<string, Promise<GeocodeResult | "none" | undefined>>();
  let failed = 0;
  const ask = (query: string) => {
    const key = normalizeQuery(query);
    let pending = answers.get(key);
    if (!pending) {
      pending = lookup(query).catch(() => {
        failed += 1;
        return undefined;
      });
      answers.set(key, pending);
    }
    return pending;
  };
  let filled = 0;
  const fill = async (place: Place | undefined) => {
    const query = geocodeQuery(place);
    if (!place || !query) return place;
    const result = await ask(query);
    if (!result || result === "none") return place;
    filled += 1;
    return applyGeocode(place, result);
  };
  const out: ExtractedSegment[] = [];
  for (const segment of segments) {
    const origin = await fill(segment.origin);
    const destination = await fill(segment.destination);
    out.push({ ...segment, ...(origin ? { origin } : {}), ...(destination ? { destination } : {}) });
  }
  return { segments: out, filled, failed };
}
