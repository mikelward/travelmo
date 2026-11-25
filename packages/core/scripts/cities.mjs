// Regenerates src/cityCountries.json, a city's name to the ISO country it is
// in, for placing a booking whose source names the city but not the country
// (an email's "Liverpool", a train to "Las Vegas") without asking a geocoder.
//
// Source: GeoNames' cities of at least 1,000 people (CC BY 4.0,
// https://www.geonames.org), as packaged by `all-the-cities`. A name is kept
// only when it is unambiguous: every city of that name is in one country, or
// the largest is at least ten times the largest in any other (London is the
// UK's, Boston the US's; Birmingham, shared by the UK and Alabama, is left
// out, for the geocoder to answer).
//
// It also writes src/bigCities.json; see below.
//
//   pnpm --filter @travelmo/core cities
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cityKey } from "../src/cityKey.ts";

const require = createRequire(import.meta.url);
const cities = require("all-the-cities");

const dominance = 10;
// Name to country to the population of its largest city of that name.
const byName = new Map();
for (const city of cities) {
  for (const name of new Set([city.name, city.altName].filter(Boolean).map(cityKey))) {
    if (!name) continue;
    const countries = byName.get(name) ?? new Map();
    countries.set(city.country, Math.max(countries.get(city.country) ?? 0, city.population));
    byName.set(name, countries);
  }
}
const kept = [];
for (const [name, countries] of byName) {
  const [first, second] = [...countries].sort((a, b) => b[1] - a[1]);
  if (!second || first[1] >= dominance * Math.max(second[1], 1)) kept.push([name, first[0]]);
}
kept.sort(([a], [b]) => a.localeCompare(b));
// One line per city: diffs stay readable.
await writeFile(new URL("../src/cityCountries.json", import.meta.url), `{\n${kept.map(([n, c]) => `${JSON.stringify(n)}:${JSON.stringify(c)}`).join(",\n")}\n}\n`);
console.log(`${kept.length} of ${byName.size} names kept`);

// And src/bigCities.json: each name some city of at least `bigCity` people
// has, with the countries it is that big in (Windsor is a city in Canada, a
// town in England), so a trip's picture can tell a city from a town
// (placeSetting) without the whole table, which only the parser loads.
const bigCity = 250_000;
const big = new Map();
for (const city of cities) {
  if (city.population < bigCity) continue;
  for (const name of new Set([city.name, city.altName].filter(Boolean).map(cityKey))) {
    if (!name) continue;
    big.set(name, new Set([...(big.get(name) ?? []), city.country]));
  }
}
const bigKept = [...big].map(([name, countries]) => [name, [...countries].sort()]).sort(([a], [b]) => a.localeCompare(b));
await writeFile(new URL("../src/bigCities.json", import.meta.url), `{\n${bigKept.map(([n, c]) => `${JSON.stringify(n)}:${JSON.stringify(c)}`).join(",\n")}\n}\n`);
console.log(`${bigKept.length} big cities`);
