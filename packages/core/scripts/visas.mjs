// Regenerates src/visaRules.json: what a passport needs to enter each
// country, for the entry-requirements box on a trip page.
//
// Source: the Passport Index dataset maintained at
// https://github.com/imorte/passport-index-data (MIT), compiled from
// passportindex.org. Entry rules change, so this is rerun by hand now and
// then; the file records when it was fetched and the page shows it.
//
//   pnpm --filter @travelmo/core visas
import { writeFile } from "node:fs/promises";

const url = "https://raw.githubusercontent.com/imorte/passport-index-data/main/passport-index-tidy-iso2.csv";
const out = new URL("../src/visaRules.json", import.meta.url);

// One character per rule. Letters that are not a day count: see days below.
const codes = {
  "visa free": "F",
  "visa on arrival": "A",
  eta: "T",
  "e-visa": "E",
  "visa required": "R",
  "no admission": "N",
  "-1": "-",
};
// Day counts take the remaining letters and digits, assigned as met.
const dayLetters = "abcdefghijklmnopqrstuvwxyz0123456789";

const response = await fetch(url);
if (!response.ok) throw new Error(`fetching the dataset failed: ${response.status}`);
const text = await response.text();
const lines = text.trim().split(/\r?\n/);
const header = lines.shift();
if (header !== "Passport,Destination,Requirement") throw new Error(`unexpected header: ${header}`);

const rules = new Map(); // passport → Map(destination → value)
const countries = new Set();
for (const line of lines) {
  const [from, to, value] = line.split(",");
  if (!/^[A-Z]{2}$/.test(from) || !/^[A-Z]{2}$/.test(to)) throw new Error(`unexpected codes: ${line}`);
  countries.add(from);
  countries.add(to);
  if (!rules.has(from)) rules.set(from, new Map());
  rules.get(from).set(to, value.trim().toLowerCase());
}
const destinations = [...countries].sort();

const days = {};
const dayCode = new Map();
let unknown = 0;
function code(value) {
  if (value in codes) return codes[value];
  if (/^\d+$/.test(value)) {
    if (!dayCode.has(value)) {
      const letter = dayLetters[dayCode.size];
      if (!letter) throw new Error("more distinct day counts than letters");
      dayCode.set(value, letter);
      days[letter] = Number(value);
    }
    return dayCode.get(value);
  }
  // Legacy values ("covid ban", an event permit) are no data.
  unknown += 1;
  return "?";
}

const table = {};
for (const passport of destinations) {
  const row = rules.get(passport) ?? new Map();
  table[passport] = destinations.map((to) => (to === passport ? "-" : code(row.get(to) ?? "?"))).join("");
}

const json = {
  source: "https://github.com/imorte/passport-index-data",
  license: "MIT",
  fetched: new Date().toISOString().slice(0, 10),
  destinations,
  days,
  rules: table,
};
await writeFile(out, JSON.stringify(json) + "\n");
console.log(`${destinations.length} countries, ${Object.keys(days).length} day counts, ${unknown} values without data`);
