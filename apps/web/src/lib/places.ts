import { mergePlace, type Place, type PlaceDetails } from "@travelmo/core";
import { countryName } from "./countries";

// The country the form hands over for a place: what its picker shows, except
// for a flight, which shows none (its airport code says) and so keeps the
// booking's country, unless an address pick named one.
export function formCountry(type: string, country: string, picked?: boolean): string | undefined {
  if (type !== "flight") return country;
  return picked ? country : undefined;
}

// A place as the booking form leaves it. A country chosen without a place
// name still names the place, by the country, rather than being dropped
// with the empty name. `details` is what an address pick set (or cleared)
// in this form; left out, the place keeps its city and address.
export function formPlace(existing: Place | undefined, name: string, code: string, country: string | undefined, details?: PlaceDetails): Place | undefined {
  const named = name.trim() || (country ? countryName(country) : "");
  return mergePlace(existing, named, code, country, details);
}
