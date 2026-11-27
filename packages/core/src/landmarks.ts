import big from "./bigCities.json";
import table from "./landmarks.json";
import { cityKey } from "./cityKey";
import { compareInstants } from "./instant";
import { isOuting } from "./home";
import type { ExtractedSegment, Place, PlaceSetting, Trip, TripSetting } from "./schema";
import { liveSegments } from "./trips";

// A trip's picture in the trip list: an outline of the best-known landmark
// of the city its title names, or a matching place kind, season, holiday or
// vacation drawing when no city is named, drawn in a 48-unit square as one
// SVG path for a 1.5-unit round-capped stroke (landmarks.json, which the
// Android app compiles in too). Anything else gets the drawing of the kind
// of place it goes to (tripPicture), else the suitcase.
export interface Landmark {
  id: string;
  // What it shows, for whoever maintains the drawings.
  name: string;
  // The city names it stands for, folded (foldText).
  cities: readonly string[];
  // Names that are also everyday words ("Nice", "Bath"), accents dropped:
  // they count only written with a capital and not opening the title, unless
  // the title is the name alone or punctuation follows it ("Nice, France"),
  // so "Nice weekend" and "Bath time" are nobody.
  capitalized?: readonly string[];
  // Longer names, folded, that a match of `cities` or `fallback` is not when
  // it is part of one: "santiago de compostela" is not Santiago, and
  // "lake victoria" is not Victoria.
  not?: readonly string[];
  // Kind-of-place, season, holiday or vacation words, folded: matched only
  // when the title names no place from `cities` or `capitalized`, so
  // "Summer in Paris" is Paris and "Summer vacation" is Summer.
  fallback?: readonly string[];
  d: string;
}

export const LANDMARKS: readonly Landmark[] = table.landmarks;

const SUITCASE = LANDMARKS.find((l) => l.id === "trip")!;

type LandmarkHit = { order: number; landmark: Landmark; name: string; paddedNot: readonly string[] };

const LANDMARK_INDEX = (() => {
  const cities = new Map<string, LandmarkHit[]>();
  const capitalized = new Map<string, LandmarkHit[]>();
  const fallback = new Map<string, LandmarkHit[]>();
  const add = (map: Map<string, LandmarkHit[]>, phrase: string, hit: LandmarkHit) => {
    const space = phrase.indexOf(" ");
    const first = space < 0 ? phrase : phrase.slice(0, space);
    if (!first) return;
    let list = map.get(first);
    if (!list) {
      list = [];
      map.set(first, list);
    }
    list.push(hit);
  };
  LANDMARKS.forEach((landmark, order) => {
    const paddedNot = (landmark.not ?? []).map((n) => ` ${n} `);
    for (const city of landmark.cities) add(cities, city, { order, landmark, name: city, paddedNot });
    for (const name of landmark.capitalized ?? []) add(capitalized, name, { order, landmark, name, paddedNot });
    for (const word of landmark.fallback ?? []) add(fallback, word, { order, landmark, name: word, paddedNot });
  });
  return { cities, capitalized, fallback };
})();

const landmarkCache = new Map<string, Landmark>();
const MAX_LANDMARK_CACHE = 500;

// Where ` name ` first occurs in `text` at a place `ok` accepts, else -1.
function firstAt(text: string, name: string, ok: (at: number) => boolean): number {
  const needle = ` ${name} `;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) if (ok(at)) return at;
  return -1;
}

function isNotExcluded(words: string, paddedNot: readonly string[], name: string, at: number): boolean {
  if (paddedNot.length === 0) return true;
  const needle = ` ${name} `;
  for (const padded of paddedNot) {
    for (let off = padded.indexOf(needle); off >= 0; off = padded.indexOf(needle, off + 1)) {
      if (at >= off && words.startsWith(padded, at - off)) return false;
    }
  }
  return true;
}

// The landmark of the city named first in `title` ("Paris and Lyon" is
// Paris), else the first matching place kind, season, holiday or vacation
// word (`fallback`), else the suitcase. Names match as whole words, accents
// and case ignored, so "Lisboa" is Lisbon and "Parisian" is nobody; a
// capitalized name keeps its case.
export function tripLandmark(title: string): Landmark {
  const cached = landmarkCache.get(title);
  if (cached) return cached;
  const plain = title.normalize("NFKD").replace(/\p{M}/gu, "").trim();
  // Folded as foldText does, case kept and then not.
  const keptTrimmed = plain.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const kept = ` ${keptTrimmed} `;
  const words = kept.toLowerCase();
  const opensTitle = (name: string) => plain === name || /^\s*[,;:(/\-–—]/u.test(plain.slice(name.length));
  const keptTokens = keptTrimmed ? new Set(keptTrimmed.split(" ")) : new Set<string>();
  const lowerTokens = keptTrimmed ? new Set(keptTrimmed.toLowerCase().split(" ")) : new Set<string>();

  let bestAt = Number.POSITIVE_INFINITY;
  let bestOrder = Number.POSITIVE_INFINITY;
  let best: Landmark | undefined;
  const consider = (at: number, order: number, landmark: Landmark) => {
    if (at >= 0 && (at < bestAt || (at === bestAt && order < bestOrder))) {
      bestAt = at;
      bestOrder = order;
      best = landmark;
    }
  };

  for (const token of lowerTokens) {
    const hits = LANDMARK_INDEX.cities.get(token);
    if (!hits) continue;
    for (const hit of hits) {
      consider(firstAt(words, hit.name, (at) => isNotExcluded(words, hit.paddedNot, hit.name, at)), hit.order, hit.landmark);
    }
  }
  for (const token of keptTokens) {
    const hits = LANDMARK_INDEX.capitalized.get(token);
    if (!hits) continue;
    for (const hit of hits) {
      consider(firstAt(kept, hit.name, (at) => at > 0 || opensTitle(hit.name)), hit.order, hit.landmark);
    }
  }
  if (!best) {
    for (const token of lowerTokens) {
      const hits = LANDMARK_INDEX.fallback.get(token);
      if (!hits) continue;
      for (const hit of hits) {
        consider(firstAt(words, hit.name, (at) => isNotExcluded(words, hit.paddedNot, hit.name, at)), hit.order, hit.landmark);
      }
    }
  }

  const result = best ?? SUITCASE;
  if (landmarkCache.size >= MAX_LANDMARK_CACHE) landmarkCache.clear();
  landmarkCache.set(title, result);
  return result;
}

const byId = new Map(LANDMARKS.map((l) => [l.id, l]));

// The booking type whose icon a trip that is just an event takes, whatever
// its title: a dinner's calendar, a show's ticket (its `setting`).
export function tripBookingType(setting?: Trip["setting"]): OutingType | undefined {
  return setting && (outingTypes as readonly string[]).includes(setting) ? (setting as OutingType) : undefined;
}

const outingTypes = ["activity", "other", "car_rental"] as const;
type OutingType = (typeof outingTypes)[number];

// A trip's picture, for a trip not just an event (tripBookingType): what its
// title names (tripLandmark), else the drawing of the kind of place it goes
// to (the trip's `setting`), else the suitcase.
export function tripPicture(title: string, setting?: Trip["setting"]): Landmark {
  const named = tripLandmark(title);
  return named !== SUITCASE ? named : ((setting && byId.get(setting)) ?? SUITCASE);
}

const bigCities = big as Record<string, readonly string[]>;

// What kind of place a booking's place is: what the email or the reader
// said, else by its town's size: a city of 250,000 people or more in its
// country (bigCities.json) is a city, any other named town a town.
// Undefined for a place with neither, such as an airport the source gave no
// town for.
export function placeSetting(place: Place | undefined): PlaceSetting | undefined {
  if (place?.setting) return place.setting;
  if (!place?.city) return undefined;
  const countries = bigCities[cityKey(place.city)];
  return countries && (!place.country || countries.includes(place.country)) ? "city" : "town";
}

const journey = new Set(["flight", "train", "bus", "ferry"]);
const length = (s: ExtractedSegment) => (s.end ? Date.parse(s.end) - Date.parse(s.start) : 0);
// Earliest first, then by title, so every app picks the same booking.
const inOrder = (a: ExtractedSegment, b: ExtractedSegment) => compareInstants(a.start, b.start) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

// What kind of place a trip goes to, for its picture: that of its longest
// stay, else of its first outing, else of where its first journey arrives;
// "none" when none of them says. Goes by what is still booked unless
// nothing is.
export function tripSetting(segments: readonly ExtractedSegment[]): TripSetting {
  const live = liveSegments(segments);
  // A show, a dinner, a day out: its first booking's icon, not the town it
  // is in (localOnly).
  if (live.length > 0 && live.every(isOuting)) return [...live].sort(inOrder)[0]!.type as OutingType;
  const from = live.length > 0 ? live : [...segments];
  const stays = from.filter((s) => s.type === "lodging").sort((a, b) => length(b) - length(a) || inOrder(a, b));
  const outings = from.filter((s) => s.type !== "lodging" && !journey.has(s.type)).sort(inOrder);
  const journeys = from.filter((s) => journey.has(s.type)).sort(inOrder);
  for (const s of [...stays, ...outings]) {
    const setting = placeSetting(s.destination ?? s.origin);
    if (setting) return setting;
  }
  for (const s of journeys) {
    const setting = placeSetting(s.destination);
    if (setting) return setting;
  }
  return "none";
}
