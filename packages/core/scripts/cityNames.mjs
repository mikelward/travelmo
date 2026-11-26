// Regenerates src/cityNames.json: the names one city goes by, so a booking in
// Göteborg is in the Gothenburg its airport names and a hotel in München is
// in Munich (sameCity). Each line is a city's own name, folded (foldCity:
// accents gone, lower case), with every other name it has in English or in
// a language of its country, folded the same way.
//
// Source: GeoNames (CC BY 4.0, https://www.geonames.org): its cities of at
// least 15,000 people, their alternate names, and each country's languages.
// Colloquial and historic names are left out, as are names in other
// languages (Munich has dozens), which a booking for that city would not
// use. A name two cities share goes to the larger only when it is at least
// ten times the other's size, as the city-to-country table decides; else to
// neither, and the two are told apart by place alone.
//
//   pnpm --filter @travelmo/core city-names [directory holding cities15000.txt,
//     alternateNamesV2.txt and countryInfo.txt, else they are downloaded]
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { foldCity } from "../src/cityFold.ts";

const minPopulation = 15000;
const dominance = 10;

async function source() {
  if (process.argv[2]) return process.argv[2];
  const dir = await mkdtemp(join(tmpdir(), "geonames-"));
  for (const file of ["cities15000.zip", "alternateNamesV2.zip", "countryInfo.txt"]) {
    const response = await fetch(`https://download.geonames.org/export/dump/${file}`);
    if (!response.ok) throw new Error(`GeoNames ${file}: HTTP ${response.status}`);
    await writeFile(join(dir, file), Buffer.from(await response.arrayBuffer()));
    if (file.endsWith(".zip")) execFileSync("unzip", ["-o", "-q", join(dir, file), "-d", dir]);
  }
  return dir;
}
const dir = await source();

// A country's languages, without their regions: Sweden's are sv, se, sma, fi.
const languages = new Map();
for (const line of (await readFile(join(dir, "countryInfo.txt"), "utf8")).split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const fields = line.split("\t");
  languages.set(fields[0], new Set((fields[15] ?? "").split(",").map((l) => l.split("-")[0]).filter(Boolean)));
}

// A code (MUC, ESSA) is an airport's, not the city's.
const isCode = (name) => /^[A-Z]{3,4}$/.test(name);
const cities = new Map();
for (const line of (await readFile(join(dir, "cities15000.txt"), "utf8")).split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const population = Number(f[14]);
  if (population < minPopulation) continue;
  cities.set(f[0], { own: foldCity(f[1]), country: f[8], population, names: new Set([f[1], f[2]]) });
}
const lines = createInterface({ input: createReadStream(join(dir, "alternateNamesV2.txt")), crlfDelay: Infinity });
for await (const line of lines) {
  const f = line.split("\t");
  const city = cities.get(f[1]);
  // Colloquial (f[6]) and historic (f[7]) names are not what a booking says.
  if (!city || f[6] === "1" || f[7] === "1") continue;
  if (f[2] === "en" || languages.get(city.country)?.has(f[2])) city.names.add(f[3]);
}

// Each name, to the cities' own names it belongs to with the largest
// population giving it each.
const owners = new Map();
for (const city of cities.values()) {
  for (const name of new Set([...city.names].filter((n) => n && !isCode(n)).map(foldCity).filter(Boolean))) {
    const byOwn = owners.get(name) ?? new Map();
    byOwn.set(city.own, Math.max(byOwn.get(city.own) ?? 0, city.population));
    owners.set(name, byOwn);
  }
}
// A city's own name is never another's other name (Mila, in Algeria, is not
// Milan's), so every name leads to one city in one step.
const owns = new Set([...cities.values()].map((city) => city.own));
const groups = new Map();
for (const [name, byOwn] of owners) {
  const [first, second] = [...byOwn].sort((a, b) => b[1] - a[1]);
  if (second && first[1] < dominance * second[1]) continue;
  if (owns.has(name)) continue;
  (groups.get(first[0]) ?? groups.set(first[0], []).get(first[0])).push(name);
}
// Names a booking uses that GeoNames does not tag as English or local:
// Cracow, which it calls historic, and the romanized Athina and Moskva.
// Each pair is one city, whichever of its names GeoNames keys it by.
const also = [["cracow", "krakow"], ["athina", "athens"], ["moskva", "moscow"]];
const ownOf = (name) => (groups.has(name) ? name : [...groups].find(([, names]) => names.includes(name))?.[0]);
for (const [a, b] of also) {
  const own = ownOf(b) ?? ownOf(a) ?? b;
  const names = groups.get(own) ?? groups.set(own, []).get(own);
  for (const name of [a, b]) if (name !== own && !names.includes(name)) names.push(name);
}
for (const names of groups.values()) for (const name of names) if (groups.has(name)) throw new Error(`${name} is a city's own name and another's other name`);
const sorted = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([own, names]) => [own, names.sort()]);
// One line per city: diffs stay readable.
await writeFile(new URL("../src/cityNames.json", import.meta.url), `{\n${sorted.map(([own, names]) => `${JSON.stringify(own)}:${JSON.stringify(names)}`).join(",\n")}\n}\n`);
console.log(`${cities.size} cities, ${sorted.length} with other names, ${sorted.reduce((n, [, names]) => n + names.length, 0)} names`);
