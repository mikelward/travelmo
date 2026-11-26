// Regenerates src/airports.json, IATA code to IANA time zone, for preselecting
// a booking's time zone from the airport typed into From/To; and
// src/airportPlaces.json, IATA code to [ISO country, latitude, longitude, city],
// for placing a flight on the reports page's map and in its country, and
// naming the city of an airport an email gives only by its code ("ARN").
//
// Sources: the OpenFlights airport database (ODbL, https://openflights.org/data),
// as packaged by `airport-data`, then OurAirports (public domain,
// https://ourairports.com/data/), which is kept current: it adds the codes
// OpenFlights lacks and wins where the two disagree (a code reassigned to
// another airport, a country renamed or split). Airports without a zone get
// one from their coordinates (tz-lookup). Codes are kept only when the zone is
// one this runtime's Intl knows.
//
//   pnpm --filter @travelmo/core airports [path to OurAirports' airports.csv]
import { readFile, writeFile } from "node:fs/promises";
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

// The city an airport serves, as OpenFlights names it ("Tokyo" for Narita,
// where OurAirports names the town it is in), spelled as people write it
// where OpenFlights does not.
const cityNames = {
  "Agana": "Hagåtña",
  "Duesseldorf": "Düsseldorf",
  "Gothenborg": "Gothenburg",
  "Manchester NH": "Manchester",
  "Milano": "Milan",
  "Nandi": "Nadi",
  "Nuernberg": "Nuremberg",
  "Queenstown International": "Queenstown",
  "Raleigh-durham": "Raleigh-Durham",
  "Tel-aviv": "Tel Aviv",
};
const cityOf = (name) => {
  // OpenFlights escapes some apostrophes ("Fiti\\'uta").
  const city = name?.replace(/\\'/g, "'").trim() ?? "";
  return cityNames[city] ?? city;
};

const round = (n) => Math.round(n * 100) / 100;

// RFC 4180: quoted fields may hold commas, newlines and doubled quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

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
  if (country) places.set(code, [country, round(airport.latitude), round(airport.longitude), cityOf(airport.city)]);
  else unplaced.add(airport.country);
}
if (unplaced.size) throw new Error(`No ISO code for: ${[...unplaced].join(", ")}`);

// OurAirports, closed airports aside, by its IATA codes.
const ourAirportsUrl = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv";
const csv = process.argv[2] ? await readFile(process.argv[2], "utf8") : await (await fetch(ourAirportsUrl)).text();
let added = 0;
let corrected = 0;
const [header, ...rows] = parseCsv(csv);
const column = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`OurAirports has no ${name} column`);
  return i;
};
const [iata, type, country, lat, lon, municipality] = ["iata_code", "type", "iso_country", "latitude_deg", "longitude_deg", "municipality"].map(column);
for (const row of rows) {
  const code = row[iata]?.trim();
  if (!code || !/^[A-Z]{3}$/.test(code) || row[type] === "closed" || !/^[A-Z]{2}$/.test(row[country] ?? "")) continue;
  const latitude = Number(row[lat]);
  const longitude = Number(row[lon]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
  const known_ = places.get(code);
  const city = row[municipality]?.trim() ?? "";
  if (known_ && known_[0] === row[country]) {
    // A city OpenFlights left out, from OurAirports.
    if (!known_[3] && city) known_[3] = city;
    continue;
  }
  const zone = tzLookup(latitude, longitude);
  if (!known(zone)) continue;
  if (known_) corrected += 1;
  else added += 1;
  zones.set(code, zone);
  places.set(code, [row[country], round(latitude), round(longitude), city]);
}

const sorted = (map) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL("../src/airports.json", import.meta.url), `${JSON.stringify(sorted(zones), null, 1)}\n`);
// One line per airport: diffs stay readable at a third of the size.
const placeLines = Object.entries(sorted(places)).map(([code, place]) => `${JSON.stringify(code)}:${JSON.stringify(place)}`);
await writeFile(new URL("../src/airportPlaces.json", import.meta.url), `{\n${placeLines.join(",\n")}\n}\n`);
console.log(`${zones.size} airports (${fromCoordinates} zones from coordinates), ${places.size} placed; OurAirports added ${added}, corrected ${corrected}`);
