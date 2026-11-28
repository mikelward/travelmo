// Regenerates the country map outline entries in packages/core/src/landmarks.json:
// each country's simplified 48×48 outline (1.5-unit round-capped stroke), derived
// from Natural Earth's 1:50m countries (public domain, via `world-atlas`), with
// ISO codes mapped by `i18n-iso-countries`. Preserves all non-country entries.
//
//   pnpm --filter @travelmo/web country-landmarks
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { feature, merge } from "topojson-client";
import countriesLib from "i18n-iso-countries";
import { albers, encodeClosedRing, encodeOpenArc, fitTransform, foldText, ringArea } from "./outlineGeometry.mjs";

const require = createRequire(import.meta.url);
const world50 = require("world-atlas/countries-50m.json");
const world110 = require("world-atlas/countries-110m.json");

// Places Natural Earth draws apart without an ISO number of their own.
const UNNUMBERED = { Kosovo: "XK", "N. Cyprus": "CY", Somaliland: "SO" };

// Territories and countries that already have a dedicated city or beach landmark.
const SKIP = new Set(["AQ", "TF", "FK", "EH", "NC", "PR", "BS", "FJ", "LU", "SG", "MC", "MT", "MV"]);

// Stopgap country names previously attached to a city/safari landmark.
const REMOVE_OLD_CITY_ALIASES = new Set(["panama", "uzbekistan", "azerbaijan", "ecuador", "uruguay", "madagascar"]);

// Bounding boxes [minLon, maxLon, minLat, maxLat] to keep the main territory
// and drop distant overseas territories that would shrink the outline.
const BOX = {
  US: [-126, -66, 24, 50],
  FR: [-6, 10, 41, 52],
  ES: [-10, 5, 35.5, 44.5],
  PT: [-10, -6, 36.5, 42.5],
  NL: [3, 7.5, 50.5, 54],
  DK: [7.5, 13.5, 54.4, 58],
  NO: [4, 32, 57.5, 71.5],
  GB: [-9, 2.5, 49.5, 61],
  AU: [112, 155, -44.5, -10],
  NZ: [165, 179.5, -48, -33.5],
  JP: [128, 146.5, 30, 46],
  IT: [6, 19, 36.5, 47.5],
  GR: [19, 27, 34.5, 42],
  CA: [-142, -52, 41.5, 76],
  CL: [-76, -66, -56, -17],
  EC: [-81.5, -75, -5.2, 1.8],
  ZA: [16, 33.5, -35.5, -22],
  IN: [68, 97.5, 7.5, 36],
  CN: [73, 135.5, 18, 54],
  KR: [125.5, 130, 33, 39],
  MX: [-118, -86, 14, 33],
  CO: [-79.5, -66.5, -4.5, 13],
  BR: [-74.5, -34, -34, 6],
  AR: [-74, -53, -55.5, -21],
  OM: [51.5, 60, 16, 26.8],
  YE: [42, 54.5, 12, 19.5],
  RU: [27, 195, 41, 78],
};

// Per-country shape tuning: wide high-latitude countries use Albers conic;
// straight-border countries stay polygonal so borders don't round into blobs.
const SHAPE = {
  CA: { maxRings: 1, minFrac: 0.2, eps: 1.15, smooth: false, proj: "albers-ca" },
  RU: { maxRings: 1, minFrac: 0.2, eps: 1.25, smooth: false, proj: "albers-ru", unwrapLon: true },
  US: { maxRings: 1, minFrac: 0.2, eps: 1.15, smooth: false, proj: "albers-us" },
  GL: { maxRings: 1, minFrac: 0.2, eps: 1.3, smooth: true, proj: "albers-gl" },
  AU: { maxRings: 2, minFrac: 0.008, eps: 1.3, smooth: true },
  JP: { maxRings: 3, minFrac: 0.05, eps: 1.1, smooth: true },
  IT: { maxRings: 3, minFrac: 0.02, eps: 1.3, smooth: true },
  FR: { maxRings: 2, minFrac: 0.01, eps: 1.3, smooth: true },
  GB: { maxRings: 2, minFrac: 0.02, eps: 1.35, smooth: true },
  NZ: { maxRings: 2, minFrac: 0.02, eps: 1.3, smooth: true },
  GR: { maxRings: 2, minFrac: 0.04, eps: 1.35, smooth: true },
  DK: { maxRings: 2, minFrac: 0.1, eps: 1.3, smooth: true },
  NO: { maxRings: 1, minFrac: 0.2, eps: 1.35, smooth: true },
  SE: { maxRings: 1, minFrac: 0.2, eps: 1.3, smooth: true },
  FI: { maxRings: 1, minFrac: 0.2, eps: 1.3, smooth: true },
  CL: { maxRings: 1, minFrac: 0.2, eps: 1.25, smooth: true },
  HR: { maxRings: 1, minFrac: 0.2, eps: 1.25, smooth: true },
  CU: { maxRings: 1, minFrac: 0.2, eps: 1.2, smooth: true },
  ID: { maxRings: 5, minFrac: 0.04, eps: 1.35, smooth: true },
  PH: { maxRings: 3, minFrac: 0.07, eps: 1.3, smooth: true },
  MY: { maxRings: 2, minFrac: 0.1, eps: 1.3, smooth: true },
  PG: { maxRings: 2, minFrac: 0.06, eps: 1.3, smooth: true },
  TT: { maxRings: 2, minFrac: 0.04, eps: 1.2, smooth: true },
  SB: { maxRings: 3, minFrac: 0.08, eps: 0.9, smooth: true },
  VU: { maxRings: 3, minFrac: 0.08, eps: 0.9, smooth: true },
  IL: { maxRings: 1, minFrac: 0.2, eps: 0.9, smooth: true },
  EE: { maxRings: 1, minFrac: 0.2, eps: 1.3, smooth: true },
  AR: { maxRings: 1, minFrac: 0.2, eps: 1.25, smooth: true },
  CN: { maxRings: 1, minFrac: 0.2, eps: 1.25, smooth: true },
  KR: { maxRings: 1, minFrac: 0.2, eps: 1.25, smooth: true },
  IN: { maxRings: 1, minFrac: 0.2, eps: 1.25, smooth: true },
  EG: { smooth: false, eps: 1.2 },
  LY: { smooth: false, eps: 1.2 },
  DZ: { smooth: false, eps: 1.2 },
  SA: { smooth: false, eps: 1.2 },
  IQ: { smooth: false, eps: 1.2 },
  JO: { smooth: false, eps: 1.2 },
  SY: { smooth: false, eps: 1.2 },
  NA: { smooth: false, eps: 1.2 },
  BW: { smooth: false, eps: 1.2 },
  SD: { smooth: false, eps: 1.2 },
  SS: { smooth: false, eps: 1.2 },
  TD: { smooth: false, eps: 1.2 },
  MR: { smooth: false, eps: 1.2 },
  ML: { smooth: false, eps: 1.2 },
  NE: { smooth: false, eps: 1.2 },
  OM: { smooth: false, eps: 1.2 },
  YE: { smooth: false, eps: 1.2 },
  KW: { smooth: false, eps: 1.2 },
  AE: { smooth: false, eps: 1.2 },
};

// Display names, aliases, capitalized codes, and false-match guards for
// countries where ISO's formal English name needs cleaning or common aliases.
const META = {
  AE: { id: "united-arab-emirates", name: "United Arab Emirates", countries: ["united arab emirates", "uae", "u a e"] },
  AT: { countries: ["austria", "osterreich"] },
  BA: { id: "bosnia-and-herzegovina", name: "Bosnia and Herzegovina", countries: ["bosnia and herzegovina", "bosnia"] },
  BE: { countries: ["belgium", "belgique", "belgie"] },
  BN: { id: "brunei", name: "Brunei", countries: ["brunei", "brunei darussalam"] },
  BO: { id: "bolivia", name: "Bolivia", countries: ["bolivia"] },
  BR: { countries: ["brazil", "brasil"] },
  CD: {
    id: "democratic-republic-of-the-congo",
    name: "Democratic Republic of the Congo",
    countries: ["democratic republic of the congo", "dr congo", "drc", "congo kinshasa"],
  },
  CF: { id: "central-african-republic", name: "Central African Republic", countries: ["central african republic"] },
  CG: { id: "republic-of-the-congo", name: "Republic of the Congo", countries: ["republic of the congo", "congo brazzaville"] },
  CH: { countries: ["switzerland", "schweiz", "suisse"] },
  CI: { id: "ivory-coast", name: "Ivory Coast", countries: ["ivory coast", "cote d ivoire"] },
  CL: { countries: ["chile"], not: ["green chile", "red chile"] },
  CN: { id: "china", name: "China", countries: ["china"] },
  CZ: { id: "czechia", name: "Czechia", countries: ["czechia", "czech republic"] },
  DE: { countries: ["germany", "deutschland"] },
  DK: { countries: ["denmark", "danmark"] },
  DO: { id: "dominican-republic", name: "Dominican Republic", countries: ["dominican republic"] },
  ES: { countries: ["spain", "espana"] },
  FI: { countries: ["finland", "suomi"] },
  GB: {
    id: "united-kingdom",
    name: "United Kingdom",
    countries: ["united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "u k"],
    capitalized: ["UK"],
    not: ["new england", "new south wales"],
  },
  // Bare "Georgia" is commonly the US state ("Savannah, Georgia", "Athens, GA").
  GE: { id: "georgia", name: "Georgia", countries: ["republic of georgia"] },
  GM: { id: "gambia", name: "The Gambia", countries: ["gambia", "the gambia"] },
  GN: { countries: ["guinea"], not: ["papua new guinea", "equatorial guinea", "guinea bissau"] },
  GR: { countries: ["greece", "hellas"] },
  HR: { countries: ["croatia", "hrvatska"] },
  IE: { countries: ["ireland", "eire"], not: ["northern ireland"] },
  IR: { id: "iran", name: "Iran", countries: ["iran"] },
  IT: { countries: ["italy", "italia"] },
  JP: { countries: ["japan", "nippon"] },
  KP: { id: "north-korea", name: "North Korea", countries: ["north korea", "dprk"] },
  KR: { id: "south-korea", name: "South Korea", countries: ["south korea", "korea", "republic of korea"], not: ["north korea"] },
  LA: { id: "laos", name: "Laos", countries: ["laos"] },
  MD: { id: "moldova", name: "Moldova", countries: ["moldova"] },
  MK: { id: "north-macedonia", name: "North Macedonia", countries: ["north macedonia", "macedonia"] },
  MM: { id: "myanmar", name: "Myanmar", countries: ["myanmar", "burma"] },
  MX: { countries: ["mexico"], not: ["new mexico", "gulf of mexico"] },
  NL: { countries: ["netherlands", "holland"] },
  NO: { countries: ["norway", "norge"] },
  NZ: { id: "new-zealand", name: "New Zealand", countries: ["new zealand", "aotearoa"], capitalized: ["NZ"] },
  PS: { id: "palestine", name: "Palestine", countries: ["palestine", "west bank"] },
  RU: { id: "russia", name: "Russia", countries: ["russia", "russian federation"] },
  SD: { countries: ["sudan"], not: ["south sudan"] },
  SE: { countries: ["sweden", "sverige"] },
  SY: { id: "syria", name: "Syria", countries: ["syria"] },
  SZ: { id: "eswatini", name: "Eswatini", countries: ["eswatini", "swaziland"] },
  TL: { id: "timor-leste", name: "Timor-Leste", countries: ["timor leste", "east timor"] },
  TR: { id: "turkey", name: "Turkey", countries: ["turkey", "turkiye"], not: ["turkey day", "turkey trot", "turkey dinner"] },
  TT: { id: "trinidad-and-tobago", name: "Trinidad and Tobago", countries: ["trinidad and tobago", "trinidad", "tobago"] },
  TW: { id: "taiwan", name: "Taiwan", countries: ["taiwan"] },
  TZ: { id: "tanzania", name: "Tanzania", countries: ["tanzania"] },
  US: {
    id: "united-states",
    name: "United States",
    countries: ["united states", "united states of america", "usa", "u s a", "america"],
    capitalized: ["US"],
    not: ["south america", "central america", "north america", "latin america"],
  },
  VE: { id: "venezuela", name: "Venezuela", countries: ["venezuela"] },
  VN: { id: "vietnam", name: "Vietnam", countries: ["vietnam", "viet nam"] },
  XK: { id: "kosovo", name: "Kosovo", countries: ["kosovo"] },
};

const targetCodes = new Set();
for (const g of world110.objects.countries.geometries) {
  const code = g.id ? countriesLib.numericToAlpha2(String(g.id).padStart(3, "0")) : UNNUMBERED[g.properties.name];
  if (code && !SKIP.has(code)) targetCodes.add(code);
}
for (const extra of ["BH", "AD", "LI"]) targetCodes.add(extra);

const geomsByCode = new Map();
for (const g of world50.objects.countries.geometries) {
  const code = g.id ? countriesLib.numericToAlpha2(String(g.id).padStart(3, "0")) : UNNUMBERED[g.properties.name];
  if (!code || !targetCodes.has(code)) continue;
  if (!geomsByCode.has(code)) geomsByCode.set(code, []);
  geomsByCode.get(code).push(g);
}

const world50ByName = new Map(world50.objects.countries.geometries.map((g) => [g.properties.name, g]));

function mainRingOf(name) {
  const g = world50ByName.get(name);
  if (!g) throw new Error(`Missing 50m geometry: ${name}`);
  const f = feature(world50, g);
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polys.map((p) => p[0]).sort((a, b) => ringArea(b) - ringArea(a))[0];
}

function nearestIndex(ring, lon, lat) {
  const n = ring.length - 1; // last vertex repeats ring[0]
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(ring[i][0] - lon, ring[i][1] - lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (bestD > 0.25) throw new Error(`Vertex (${lon}, ${lat}) not found in ring (nearest dist ${bestD.toFixed(3)})`);
  return best;
}

// Walks a closed ring (last point == first point) forward from `from` to `to` inclusive.
function walkRing(ring, from, to) {
  const n = ring.length - 1;
  const out = [];
  for (let i = from; ; i = (i + 1) % n) {
    out.push(ring[i]);
    if (i === to) break;
  }
  return out;
}

// Disputed or occupied territories that are large enough to read at 40px:
// uncontested territory is stroked solid (`d`), while disputed/occupied outer
// boundaries are stroked dashed (`dashed`) without doubling over shared seams.
function disputedGeometry(code) {
  if (code === "UA") {
    const ru = world50ByName.get("Russia");
    const crimeaPoly = feature(world50, ru).geometry.coordinates
      .map((p) => p[0])
      .find((r) => {
        const cx = r.reduce((s, p) => s + p[0], 0) / r.length;
        const cy = r.reduce((s, p) => s + p[1], 0) / r.length;
        return cx > 33 && cx < 36 && cy > 44.5 && cy < 46;
      });
    if (!crimeaPoly) throw new Error("Could not locate Crimea polygon in 50m data");
    return { solidRings: [mainRingOf("Ukraine")], dashedClosed: [crimeaPoly], dashedOpen: [] };
  }
  if (code === "IL") {
    const il = mainRingOf("Israel");
    const banias = nearestIndex(il, 35.628, 33.275);
    const yarmouk = nearestIndex(il, 35.61, 32.683);
    const jordanLine = [
      [35.628, 33.275],
      [35.63, 32.92],
      [35.65, 32.76],
      [35.61, 32.683],
    ];
    const solid = [...walkRing(il, yarmouk, banias), ...jordanLine.slice(1)];
    const golanOuter = walkRing(il, banias, yarmouk);
    const palPolys = feature(world50, world50ByName.get("Palestine")).geometry.coordinates.map((p) => p[0]);
    const gaza = palPolys.find((r) => r.every((p) => p[0] < 34.7));
    const westBank = palPolys.find((r) => r.every((p) => p[0] > 34.7));
    if (!gaza || !westBank) throw new Error("Missing Gaza or West Bank polygons in 50m data");
    const gazaSouth = nearestIndex(gaza, 34.245, 31.209);
    const gazaNorth = nearestIndex(gaza, 34.476, 31.585);
    const wbNorth = nearestIndex(westBank, 35.552, 32.396);
    const wbSouth = nearestIndex(westBank, 35.451, 31.48);
    return {
      solidRings: [solid],
      dashedClosed: [],
      dashedOpen: [golanOuter, walkRing(westBank, wbNorth, wbSouth), walkRing(gaza, gazaSouth, gazaNorth)],
    };
  }
  if (code === "SY") {
    const sy = mainRingOf("Syria");
    const golanOuter = [
      [35.786, 32.735],
      [35.736, 32.73],
      [35.61, 32.683],
      [35.65, 32.76],
      [35.63, 32.92],
      [35.628, 33.275],
      [35.736, 33.332],
      [35.869, 33.433],
    ];
    return { solidRings: [sy], dashedClosed: [], dashedOpen: [golanOuter] };
  }
  if (code === "MA") {
    const merged = merge(world50, [world50ByName.get("Morocco"), world50ByName.get("W. Sahara")]).coordinates[0][0];
    const west27 = nearestIndex(merged, -13.174, 27.655);
    const east27 = nearestIndex(merged, -8.685, 27.657);
    const solid = [...walkRing(merged, west27, east27), merged[west27]];
    const wsOuter = walkRing(merged, east27, west27);
    return { solidRings: [solid], dashedClosed: [], dashedOpen: [wsOuter] };
  }
  if (code === "IN") {
    const india = mainRingOf("India");
    const jammuSouth = nearestIndex(india, 75.304, 32.318);
    const ladakhSouth = nearestIndex(india, 78.454, 32.301);
    const solid = [
      ...walkRing(india, ladakhSouth, jammuSouth),
      [76.2, 32.5],
      [77.4, 32.8],
      india[ladakhSouth],
    ];
    const jkOuter = walkRing(india, jammuSouth, ladakhSouth);
    return { solidRings: [solid], dashedClosed: [], dashedOpen: [jkOuter] };
  }
  if (code === "PK") {
    const pk = mainRingOf("Pakistan");
    const ajkSouth = nearestIndex(pk, 74.645, 32.608);
    const gbWest = nearestIndex(pk, 73.41, 36.88);
    const solid = [
      ...walkRing(pk, ajkSouth, gbWest),
      [73.6, 35.4],
      [73.5, 34.4],
      [73.7, 33.4],
      pk[ajkSouth],
    ];
    const gbAjkOuter = walkRing(pk, gbWest, ajkSouth);
    return { solidRings: [solid], dashedClosed: [], dashedOpen: [gbAjkOuter] };
  }
  if (code === "RS") {
    const rs = mainRingOf("Serbia");
    const xk = mainRingOf("Kosovo");
    const eastTripoint = nearestIndex(xk, 21.562, 42.248);
    const westTripoint = nearestIndex(xk, 20.346, 42.828);
    const xkOuter = walkRing(xk, eastTripoint, westTripoint);
    return { solidRings: [rs], dashedClosed: [], dashedOpen: [xkOuter] };
  }
  return null;
}

function buildOutline(code) {
  const cfg = { maxRings: 2, minFrac: 0.05, eps: 1.25, smooth: true, pad: 4.5, ...SHAPE[code] };
  const disputed = disputedGeometry(code);
  let rings;
  let dashedClosed = [];
  let dashedOpen = [];
  if (disputed) {
    rings = disputed.solidRings;
    dashedClosed = disputed.dashedClosed;
    dashedOpen = disputed.dashedOpen;
  } else {
    const geoms = geomsByCode.get(code);
    if (!geoms || geoms.length === 0) throw new Error(`No 50m geometry for ${code}`);
    const merged = merge(world50, geoms);
    rings = merged.coordinates.map((poly) => poly[0]);
    if (cfg.unwrapLon) {
      rings = rings.map((r) => r.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]));
    }
    const box = BOX[code];
    if (box) {
      rings = rings.filter((r) => {
        const cx = r.reduce((s, p) => s + p[0], 0) / r.length;
        const cy = r.reduce((s, p) => s + p[1], 0) / r.length;
        return cx >= box[0] && cx <= box[1] && cy >= box[2] && cy <= box[3];
      });
    }
  }
  if (rings.length === 0) throw new Error(`Empty geometry after box filter for ${code}`);
  let sumLat = 0;
  let cnt = 0;
  for (const r of [...rings, ...dashedClosed, ...dashedOpen]) {
    for (const p of r) {
      sumLat += p[1];
      cnt++;
    }
  }
  const cosLat = Math.cos((sumLat / cnt) * (Math.PI / 180));
  const projFn = ([lon, lat]) => {
    if (cfg.proj === "albers-ca") return albers(lon, lat, 50, 70, 58, -96, -12);
    if (cfg.proj === "albers-us") return albers(lon, lat, 29.5, 45.5, 37.5, -96, 0);
    if (cfg.proj === "albers-ru") return albers(lon, lat, 50, 70, 62, 100, 0);
    if (cfg.proj === "albers-gl") return albers(lon, lat, 62, 78, 72, -42, 0);
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
  const projDashedClosed = dashedClosed.map((r) => r.map(projFn));
  const projDashedOpen = dashedOpen.map((r) => r.map(projFn));

  const scalePts = fitTransform([...kept, ...projDashedClosed, ...projDashedOpen], cfg.pad);
  const encodeClosed = (r) => encodeClosedRing(scalePts(r), { eps: cfg.eps, smooth: cfg.smooth });
  const encodeOpen = (r) => encodeOpenArc(scalePts(r), { eps: cfg.eps, smooth: cfg.smooth });

  const d = kept.map(encodeClosed).filter(Boolean).join("");
  const dashed = [...projDashedClosed.map(encodeClosed), ...projDashedOpen.map(encodeOpen)].filter(Boolean).join("");
  return dashed ? { d, dashed } : { d };
}

const countryEntries = [...targetCodes]
  .map((code) => {
    const meta = META[code] ?? {};
    const defaultName = code === "XK" ? "Kosovo" : countriesLib.getName(code, "en");
    if (!defaultName) throw new Error(`No English name for ${code}`);
    const name = meta.name ?? defaultName;
    const id = meta.id ?? foldText(name).replace(/ /g, "-");
    const countries = (meta.countries ?? [foldText(name)]).map(foldText);
    const entry = { id, name, cities: [], countries };
    if (meta.capitalized?.length) entry.capitalized = meta.capitalized;
    if (meta.not?.length) entry.not = meta.not.map(foldText);
    const outline = buildOutline(code);
    entry.d = outline.d;
    if (outline.dashed) entry.dashed = outline.dashed;
    return entry;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const landmarksUrl = new URL("../../../packages/core/src/landmarks.json", import.meta.url);
const existing = JSON.parse(await readFile(landmarksUrl, "utf8"));

const preserved = existing.landmarks
  .filter((l) => !(l.countries && l.countries.length > 0))
  .map((l) => {
    const cleaned = l.cities.filter((c) => !REMOVE_OLD_CITY_ALIASES.has(c));
    return cleaned.length === l.cities.length ? l : { ...l, cities: cleaned };
  });

// Insert country outlines right before the fallback/setting drawings ("beach", ..., "trip").
const fallbackStart = preserved.findIndex((l) => (l.fallback && l.fallback.length > 0) || l.id === "trip");
const combined =
  fallbackStart >= 0
    ? [...preserved.slice(0, fallbackStart), ...countryEntries, ...preserved.slice(fallbackStart)]
    : [...preserved, ...countryEntries];

const lines = ["{\"landmarks\":["];
for (let i = 0; i < combined.length; i++) {
  lines.push(`${JSON.stringify(combined[i])}${i < combined.length - 1 ? "," : ""}`);
}
lines.push("]}", "");

await writeFile(landmarksUrl, lines.join("\n"));
console.log(`Wrote ${combined.length} landmarks (${countryEntries.length} countries) to ${landmarksUrl.pathname}`);
