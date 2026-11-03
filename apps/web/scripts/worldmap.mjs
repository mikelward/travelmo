// Regenerates src/lib/worldMap.json, the countries of the reports page's map:
// each one's ISO code and SVG path in the Equal Earth projection, with the
// scale and offset that place an airport on it.
//
// Source: Natural Earth's 1:110m countries (public domain), as packaged in
// TopoJSON by `world-atlas`; ISO numeric codes are turned into the two-letter
// ones bookings use by `i18n-iso-countries`. Antarctica is left out.
//
//   pnpm --filter @travelmo/web worldmap
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import countries from "i18n-iso-countries";
import { equalEarth } from "../../../packages/core/src/projection.ts";

const require = createRequire(import.meta.url);
const topology = require("world-atlas/countries-110m.json");

// Places Natural Earth draws apart without an ISO number of their own.
const unnumbered = { Kosovo: "XK", "N. Cyprus": "CY", Somaliland: "SO" };

// Map units per Earth radius: about 1000 wide.
const scale = 185;
const project = ([lon, lat]) => equalEarth(lon, lat).map((v) => v * scale);

// Natural Earth cuts a country at the antimeridian, so a ring that crosses it
// jumps from 180° to -180°: each side is drawn as its own ring.
function pieces(ring) {
  const runs = [[ring[0]]];
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) runs.push([]);
    runs.at(-1).push(ring[i]);
  }
  if (runs.length > 1) runs[0] = [...runs.pop(), ...runs[0]];
  return runs;
}

const paths = new Map();
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of feature(topology, topology.objects.countries).features) {
  const name = f.properties.name;
  const code = f.id ? countries.numericToAlpha2(f.id) : unnumbered[name];
  if (code === "AQ") continue;
  if (!code) throw new Error(`No ISO code for ${name}`);
  const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let d = paths.get(code) ?? "";
  for (const ring of polygons.flat().flatMap(pieces)) {
    const points = ring.map(project);
    for (const [x, y] of points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    // Whole map units are under half a pixel on a phone; repeats are dropped.
    const rounded = points.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).filter((p, i, all) => p !== all[i - 1]);
    if (rounded.length >= 3) d += `M${rounded.join("L")}Z`;
  }
  paths.set(code, d);
}

const pad = 4;
const viewBox = [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad].map((v) => Math.round(v));
const out = { scale, viewBox, countries: Object.fromEntries([...paths].sort(([a], [b]) => a.localeCompare(b))) };
await writeFile(new URL("../src/lib/worldMap.json", import.meta.url), `${JSON.stringify(out, null, 0).replace(/("[A-Z]{2}":)/g, "\n$1")}\n`);
console.log(`${paths.size} countries, viewBox ${viewBox.join(" ")}`);
