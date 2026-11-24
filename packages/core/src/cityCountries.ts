import table from "./cityCountries.json";
import { cityKey } from "./cityKey";

// A city's name to its ISO country, for the names that are unambiguous
// (scripts/cities.mjs). A separate entry point (`@travelmo/core/cityCountries`):
// the table is large and only the parser needs it.
const countries = table as unknown as Record<string, string>;

export function cityCountry(name: string): string | undefined {
  const key = cityKey(name);
  return key ? countries[key] : undefined;
}
