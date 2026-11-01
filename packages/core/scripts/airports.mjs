// Regenerates src/airports.json: IATA code to IANA time zone, for preselecting
// a booking's time zone from the airport typed into From/To.
//
// Source: the OpenFlights airport database (ODbL, https://openflights.org/data),
// itself built from OurAirports (public domain), as packaged by `airport-data`.
// Airports it lists without a zone get one from their coordinates (tz-lookup).
// Codes are kept only when the zone is one this runtime's Intl knows.
//
//   pnpm --filter @travelmo/core airports
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const airports = require("airport-data/airports.json");
const tzLookup = require("tz-lookup");

function known(zone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const zones = new Map();
let fromCoordinates = 0;
for (const airport of airports) {
  const code = airport.iata;
  if (!/^[A-Z]{3}$/.test(code) || zones.has(code)) continue;
  let zone = airport.tz;
  if (!known(zone)) {
    zone = tzLookup(airport.latitude, airport.longitude);
    if (!known(zone)) continue;
    fromCoordinates += 1;
  }
  zones.set(code, zone);
}

const sorted = Object.fromEntries([...zones].sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL("../src/airports.json", import.meta.url), `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${zones.size} airports (${fromCoordinates} zones from coordinates)`);
