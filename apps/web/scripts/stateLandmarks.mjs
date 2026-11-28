// Regenerates the Australian and US state map outline entries in
// packages/core/src/landmarks.json: each state or territory's simplified 48×48
// outline (1.5-unit round-capped stroke), derived from Natural Earth's 1:50m
// admin-1 states/provinces with lakes (public domain). Preserves all city,
// country and fallback entries.
//
//   pnpm --filter @travelmo/web state-landmarks [path/to/ne_50m_admin_1_states_provinces_lakes.geojson]
import { readFile, writeFile } from "node:fs/promises";
import { albers, encodeClosedRing, fitTransform, foldText, ringArea } from "./outlineGeometry.mjs";

const DEFAULT_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lakes.geojson";

const AU_POSTAL = {
  WA: "WA",
  NT: "NT",
  SA: "SA",
  QL: "QLD",
  TS: "TAS",
  VI: "VIC",
  CT: "ACT",
  NS: "NSW",
};

// Stopgap state name previously attached to Hobart's city landmark.
const REMOVE_OLD_CITY_ALIASES = new Set(["tasmania"]);

// City exclusions so explicit state titles ("New York State", "Upstate New
// York", "Victoria, AU", "State of Victoria") reach the state outline rather
// than matching the city first (mirrors Washington's).
const ADD_CITY_NOT = {
  "new-york": ["new york state", "upstate new york"],
  victoria: ["victoria au", "state of victoria"],
};

// Bounding boxes [minLon, maxLon, minLat, maxLat] to drop distant outlying
// islands (Aleutians, Midway, Macquarie Island, Lord Howe Island) that would
// shrink the main outline.
const BOX = {
  "US-AK": [-168, -129, 54, 72],
  "US-HI": [-161, -154.5, 18.5, 22.5],
  "AU-TAS": [143.5, 149, -44, -39.5],
  "AU-NSW": [140.5, 154, -38, -28],
  "AU-QLD": [137.5, 154, -29.5, -10],
};

// Curvy coastal and archipelago states smooth cleanly; states with long
// straight borders stay polygonal so corners stay crisp.
const SMOOTH = new Set([
  "US-AK",
  "US-FL",
  "US-HI",
  "US-LA",
  "US-MD",
  "US-ME",
  "US-MI",
  "US-NJ",
  "AU-TAS",
]);

const SHAPE = {
  "US-AK": { maxRings: 1, minFrac: 0.2, eps: 1.1, proj: "albers-ak" },
  "US-HI": { maxRings: 6, minFrac: 0.015, eps: 0.75 },
  "US-MI": { maxRings: 2, minFrac: 0.1, eps: 1.0 },
  "US-NY": { maxRings: 2, minFrac: 0.02, eps: 1.05 },
  "US-VA": { maxRings: 2, minFrac: 0.01, eps: 1.0 },
  "US-MA": { maxRings: 1, minFrac: 0.1, eps: 0.9 },
  "US-MD": { maxRings: 1, minFrac: 0.1, eps: 0.9 },
  "US-FL": { maxRings: 1, minFrac: 0.1, eps: 1.0 },
  "US-LA": { maxRings: 1, minFrac: 0.1, eps: 1.0 },
  "US-RI": { maxRings: 1, minFrac: 0.2, eps: 0.85 },
  "AU-TAS": { maxRings: 1, minFrac: 0.1, eps: 1.1 },
  "AU-SA": { maxRings: 1, minFrac: 0.1, eps: 1.1 },
  "AU-WA": { maxRings: 1, minFrac: 0.1, eps: 1.1 },
  "AU-NT": { maxRings: 1, minFrac: 0.1, eps: 1.1 },
  "AU-QLD": { maxRings: 1, minFrac: 0.1, eps: 1.1 },
  "AU-NSW": { maxRings: 1, minFrac: 0.1, eps: 1.1 },
  "AU-VIC": { maxRings: 1, minFrac: 0.1, eps: 1.1 },
  "AU-ACT": { maxRings: 1, minFrac: 0.1, eps: 0.9 },
};

// Custom ids (avoiding collisions with city/country ids), aliases, safe
// all-caps 3-letter AU abbreviations (skipping ambiguous 2-letter codes like
// WA/CA/LA/IN/OR/ME/OK/HI and ACT), and false-match guards.
const META = {
  "AU-ACT": { id: "australian-capital-territory", name: "Australian Capital Territory", states: ["australian capital territory"] },
  "AU-NSW": { id: "new-south-wales", name: "New South Wales", states: ["new south wales"], capitalized: ["NSW"] },
  "AU-NT": { id: "northern-territory", name: "Northern Territory", states: ["northern territory"] },
  "AU-QLD": { id: "queensland", name: "Queensland", states: ["queensland"], capitalized: ["QLD"] },
  "AU-SA": { id: "south-australia", name: "South Australia", states: ["south australia"] },
  "AU-TAS": { id: "tasmania", name: "Tasmania", states: ["tasmania"], capitalized: ["TAS"] },
  // Bare "Victoria" stays Victoria, BC; explicit AU phrasing or VIC matches the state.
  "AU-VIC": { id: "victoria-au", name: "Victoria", states: ["victoria australia", "victoria au", "state of victoria"], capitalized: ["VIC"] },
  "AU-WA": { id: "western-australia", name: "Western Australia", states: ["western australia"] },
  "US-CA": { not: ["baja california"] },
  // Bare "Georgia" matches the US state; "Republic of Georgia" stays the country.
  "US-GA": { id: "georgia-us", name: "Georgia", states: ["georgia"], not: ["republic of georgia"] },
  "US-HI": { states: ["hawaii", "hawai i", "hawai\u02BBi"] },
  "US-KS": { not: ["kansas city"] },
  "US-NV": { not: ["sierra nevada"] },
  // Bare "New York" matches NYC first; excluded titles ("New York State",
  // "Upstate New York", "Rome, New York") fall through to the state outline.
  "US-NY": { id: "new-york-state", name: "New York", states: ["new york", "new york state", "upstate new york"] },
  "US-VA": { not: ["west virginia"] },
  // Bare "Washington" matches DC first; excluded titles ("Washington State",
  // "Vancouver, Washington") fall through to the state outline.
  "US-WA": { id: "washington-state", name: "Washington", states: ["washington"], not: ["washington dc", "washington d c"] },
};

function buildOutline(feature, key) {
  const cfg = { maxRings: 1, minFrac: 0.05, eps: 1.05, smooth: SMOOTH.has(key), pad: 4.5, ...SHAPE[key] };
  const polys = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let rings = polys.map((p) => p[0]);
  const box = BOX[key];
  if (box) {
    rings = rings.filter((r) => {
      const cx = r.reduce((s, p) => s + p[0], 0) / r.length;
      const cy = r.reduce((s, p) => s + p[1], 0) / r.length;
      return cx >= box[0] && cx <= box[1] && cy >= box[2] && cy <= box[3];
    });
  }
  if (rings.length === 0) throw new Error(`Empty geometry after box filter for ${key}`);

  let sumLat = 0;
  let sumLon = 0;
  let cnt = 0;
  for (const r of rings) {
    for (const [lon, lat] of r) {
      sumLon += lon;
      sumLat += lat;
      cnt++;
    }
  }
  const meanLat = sumLat / cnt;
  const meanLon = sumLon / cnt;
  const cosLat = Math.cos(meanLat * (Math.PI / 180));
  const projFn = ([lon, lat]) => {
    if (cfg.proj === "albers-ak") return albers(lon, lat, 55, 65, 62, -152);
    if (key.startsWith("US-") && meanLat > 34 && meanLon > -126 && meanLon < -66) {
      return albers(lon, lat, 29.5, 45.5, meanLat, meanLon);
    }
    return [lon * cosLat, -lat];
  };

  const projected = rings.map((r) => r.map(projFn));
  const areas = projected.map(ringArea);
  const maxArea = Math.max(...areas);
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const kept = projected
    .map((r, i) => ({ r, a: areas[i] }))
    .filter(({ a }) => a === maxArea || a >= totalArea * cfg.minFrac)
    .sort((x, y) => y.a - x.a)
    .slice(0, cfg.maxRings)
    .map(({ r }) => r);

  const scalePts = fitTransform(kept, cfg.pad);
  return kept
    .map((r) => encodeClosedRing(scalePts(r), { eps: cfg.eps, smooth: cfg.smooth, minEps: 0.35, spanFactor: 0.14 }))
    .filter(Boolean)
    .join("");
}

const sourcePath = process.argv[2];
const geo = sourcePath
  ? JSON.parse(await readFile(sourcePath, "utf8"))
  : await (async () => {
      const res = await fetch(DEFAULT_URL);
      if (!res.ok) throw new Error(`Fetching Natural Earth admin-1 failed: ${res.status}`);
      return res.json();
    })();

const targets = [];
for (const feature of geo.features) {
  const iso = feature.properties?.iso_a2;
  const postal = feature.properties?.postal;
  if (iso === "AU" && AU_POSTAL[postal]) {
    targets.push({ key: `AU-${AU_POSTAL[postal]}`, feature });
  } else if (iso === "US" && postal && postal !== "DC") {
    targets.push({ key: `US-${postal}`, feature });
  }
}
if (targets.length !== 58) {
  throw new Error(`Expected 58 AU/US state entries, got ${targets.length}`);
}

const stateEntries = targets
  .map(({ key, feature }) => {
    const meta = META[key] ?? {};
    const name = meta.name ?? feature.properties.name;
    const id = meta.id ?? foldText(name).replace(/ /g, "-");
    const states = (meta.states ?? [foldText(name)]).map(foldText);
    const entry = { id, name, cities: [], states };
    if (meta.capitalized?.length) entry.capitalized = meta.capitalized;
    if (meta.not?.length) entry.not = meta.not.map(foldText);
    entry.d = buildOutline(feature, key);
    return entry;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const landmarksUrl = new URL("../../../packages/core/src/landmarks.json", import.meta.url);
const existing = JSON.parse(await readFile(landmarksUrl, "utf8"));

const preserved = existing.landmarks
  .filter((l) => !(l.states && l.states.length > 0))
  .map((l) => {
    let next = l;
    const cleaned = l.cities.filter((c) => !REMOVE_OLD_CITY_ALIASES.has(c));
    if (cleaned.length !== l.cities.length) next = { ...next, cities: cleaned };
    const extraNot = ADD_CITY_NOT[l.id];
    if (extraNot) {
      const mergedNot = [...(next.not ?? [])];
      for (const phrase of extraNot) {
        if (!mergedNot.includes(phrase)) mergedNot.push(phrase);
      }
      if (mergedNot.length !== (next.not?.length ?? 0)) {
        // Keep field order matching apps/android/core Landmarks.kt's sequential parser.
        const { id, name, cities, states, countries, capitalized, fallback, d, dashed } = next;
        next = { id, name, cities };
        if (states?.length) next.states = states;
        if (countries?.length) next.countries = countries;
        if (capitalized?.length) next.capitalized = capitalized;
        next.not = mergedNot;
        if (fallback?.length) next.fallback = fallback;
        next.d = d;
        if (dashed) next.dashed = dashed;
      }
    }
    return next;
  });

// Insert state outlines right before country outlines (or fallbacks).
const insertAt = preserved.findIndex(
  (l) => (l.countries && l.countries.length > 0) || (l.fallback && l.fallback.length > 0) || l.id === "trip",
);
const combined =
  insertAt >= 0
    ? [...preserved.slice(0, insertAt), ...stateEntries, ...preserved.slice(insertAt)]
    : [...preserved, ...stateEntries];

const lines = ["{\"landmarks\":["];
for (let i = 0; i < combined.length; i++) {
  lines.push(`${JSON.stringify(combined[i])}${i < combined.length - 1 ? "," : ""}`);
}
lines.push("]}", "");

await writeFile(landmarksUrl, lines.join("\n"));
console.log(`Wrote ${combined.length} landmarks (${stateEntries.length} states) to ${landmarksUrl.pathname}`);
