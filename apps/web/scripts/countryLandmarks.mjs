// Regenerates the country map outline entries in packages/core/src/landmarks.json:
// each country's simplified 48×48 outline (1.5-unit round-capped stroke), derived
// from Natural Earth's 1:50m countries (public domain, via `world-atlas`), with
// ISO codes mapped by `i18n-iso-countries`. Preserves all non-country entries.
//
//   pnpm --filter @travelmo/web country-landmarks
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { merge } from "topojson-client";
import countriesLib from "i18n-iso-countries";

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

function foldText(text) {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

function albers(lon, lat, phi1Deg, phi2Deg, phi0Deg, lam0Deg, rotDeg = 0) {
  const rad = Math.PI / 180;
  const phi1 = phi1Deg * rad;
  const phi2 = phi2Deg * rad;
  const phi0 = phi0Deg * rad;
  const lam0 = lam0Deg * rad;
  const n = 0.5 * (Math.sin(phi1) + Math.sin(phi2));
  const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n;
  const rho = Math.sqrt(Math.max(0, C - 2 * n * Math.sin(lat * rad))) / n;
  const theta = n * (lon * rad - lam0);
  const x = rho * Math.sin(theta);
  const y = rho * Math.cos(theta) - rho0;
  if (!rotDeg) return [x, y];
  const r = rotDeg * rad;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a) / 2;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function dpOpen(pts, eps) {
  if (pts.length <= 2) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = dpOpen(pts.slice(0, idx + 1), eps);
    const right = dpOpen(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

function dpRing(ring, eps) {
  const open = ring.slice(0, -1);
  if (open.length <= 3) return open;
  let far = 1;
  let maxD = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > maxD) {
      maxD = d;
      far = i;
    }
  }
  const a = dpOpen(open.slice(0, far + 1), eps);
  const b = dpOpen(open.slice(far).concat([open[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

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

function buildOutline(code) {
  const geoms = geomsByCode.get(code);
  if (!geoms || geoms.length === 0) throw new Error(`No 50m geometry for ${code}`);
  const merged = merge(world50, geoms);
  const cfg = { maxRings: 2, minFrac: 0.05, eps: 1.25, smooth: true, pad: 4.5, ...SHAPE[code] };
  let rings = merged.coordinates.map((poly) => poly[0]);
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
  if (rings.length === 0) throw new Error(`Empty geometry after box filter for ${code}`);
  let sumLat = 0;
  let cnt = 0;
  for (const r of rings) {
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

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of kept) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const scale = (48 - 2 * cfg.pad) / Math.max(w, h);
  const ox = (48 - w * scale) / 2 - minX * scale;
  const oy = (48 - h * scale) / 2 - minY * scale;

  const fmt = (n) => Math.round(n * 10) / 10;
  const paths = [];
  for (const r of kept) {
    const scaled = r.map(([x, y]) => [x * scale + ox, y * scale + oy]);
    let rxMin = Infinity;
    let rxMax = -Infinity;
    let ryMin = Infinity;
    let ryMax = -Infinity;
    for (const [x, y] of scaled) {
      if (x < rxMin) rxMin = x;
      if (x > rxMax) rxMax = x;
      if (y < ryMin) ryMin = y;
      if (y > ryMax) ryMax = y;
    }
    const span = Math.max(rxMax - rxMin, ryMax - ryMin);
    // Secondary islands (Tasmania, Northern Ireland, Corsica) need a smaller
    // tolerance so Douglas-Peucker does not collapse them below 3 points.
    const ringEps = Math.min(cfg.eps, Math.max(0.4, span * 0.16));
    const simp = dpRing(scaled, ringEps);
    if (simp.length < 3) continue;
    if (cfg.smooth) {
      const n = simp.length;
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const start = mid(simp[n - 1], simp[0]);
      let d = `M${fmt(start[0])} ${fmt(start[1])}`;
      for (let i = 0; i < n; i++) {
        const m = mid(simp[i], simp[(i + 1) % n]);
        d += `Q${fmt(simp[i][0])} ${fmt(simp[i][1])} ${fmt(m[0])} ${fmt(m[1])}`;
      }
      paths.push(`${d}Z`);
    } else {
      paths.push(`M${simp.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}Z`);
    }
  }
  return paths.join("");
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
    entry.d = buildOutline(code);
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
