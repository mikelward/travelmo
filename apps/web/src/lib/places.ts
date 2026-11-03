import { mergePlace, type Place } from "@travelmo/core";
import { countryName } from "./countries";

// A place as the booking form leaves it. A country chosen without a place
// name still names the place, by the country, rather than being dropped
// with the empty name.
export function formPlace(existing: Place | undefined, name: string, code: string, country: string | undefined): Place | undefined {
  const named = name.trim() || (country ? countryName(country) : "");
  return mergePlace(existing, named, code, country);
}
