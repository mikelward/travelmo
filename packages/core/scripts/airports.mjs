// Regenerates src/airports.json, IATA code to IANA time zone, for preselecting
// a booking's time zone from the airport typed into From/To; and
// src/airportPlaces.json, IATA code to [ISO country, latitude, longitude], for
// placing a flight on the reports page's map and in its country.
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

// OpenFlights names countries in English; Intl names every ISO region, so
// reading its names backwards gives the code. These are the names the two
// spell differently, or regions OpenFlights groups that ISO splits.
const regionNames = new Intl.DisplayNames("en", { type: "region" });
const countryByName = new Map();
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// Codes Intl still names but ISO retired, each for a current one.
const retired = new Set(["BU", "CS", "DD", "NH", "RH", "SU", "TP", "VD", "YD", "YU", "ZR"]);
for (const a of letters) {
  for (const b of letters) {
    const name = regionNames.of(a + b);
    // The first code wins: FR over FX (Metropolitan France), GB over UK.
    if (retired.has(a + b)) continue;
    if (name && name !== a + b && !countryByName.has(simplify(name))) countryByName.set(simplify(name), a + b);
  }
}
const renamed = {
  "Burma": "MM",
  "Congo (Brazzaville)": "CG",
  "Congo (Kinshasa)": "CD",
  "Cote d'Ivoire": "CI",
  "Czech Republic": "CZ",
  "East Timor": "TL",
  "Hong Kong": "HK",
  "Johnston Atoll": "UM",
  "Macau": "MO",
  "Macedonia": "MK",
  "Midway Islands": "UM",
  "Myanmar": "MM",
  "Palestine": "PS",
  "Reunion": "RE",
  "Saint Helena": "SH",
  "Saint Vincent and the Grenadines": "VC",
  "Sao Tome and Principe": "ST",
  "Swaziland": "SZ",
  "Turkey": "TR",
  "Virgin Islands": "VI",
  "Wake Island": "UM",
};
// What was the Netherlands Antilles is three ISO regions now.
const antilles = { BON: "BQ", CUR: "CW", EUX: "BQ", SAB: "BQ", SXM: "SX" };

function simplify(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/^St\. /, "Saint ")
    .toLowerCase();
}

function countryOf(airport) {
  return antilles[airport.iata] ?? renamed[airport.country] ?? countryByName.get(simplify(airport.country));
}

const round = (n) => Math.round(n * 100) / 100;

const zones = new Map();
const places = new Map();
const unplaced = new Set();
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
  const country = countryOf(airport);
  if (country) places.set(code, [country, round(airport.latitude), round(airport.longitude)]);
  else unplaced.add(airport.country);
}
if (unplaced.size) throw new Error(`No ISO code for: ${[...unplaced].join(", ")}`);

const sorted = (map) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL("../src/airports.json", import.meta.url), `${JSON.stringify(sorted(zones), null, 1)}\n`);
// One line per airport: diffs stay readable at a third of the size.
const placeLines = Object.entries(sorted(places)).map(([code, place]) => `${JSON.stringify(code)}:${JSON.stringify(place)}`);
await writeFile(new URL("../src/airportPlaces.json", import.meta.url), `{\n${placeLines.join(",\n")}\n}\n`);
console.log(`${zones.size} airports (${fromCoordinates} zones from coordinates), ${places.size} placed`);
