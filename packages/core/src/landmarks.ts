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

// Where ` name ` first occurs in `text` at a place `ok` accepts, else -1.
function firstAt(text: string, name: string, ok: (at: number) => boolean): number {
  for (let at = text.indexOf(` ${name} `); at >= 0; at = text.indexOf(` ${name} `, at + 1)) if (ok(at)) return at;
  return -1;
}

// The landmark of the city named first in `title` ("Paris and Lyon" is
// Paris), else the first matching place kind, season, holiday or vacation
// word (`fallback`), else the suitcase. Names match as whole words, accents
// and case ignored, so "Lisboa" is Lisbon and "Parisian" is nobody; a
// capitalized name keeps its case.
export function tripLandmark(title: string): Landmark {
  const plain = title.normalize("NFKD").replace(/\p{M}/gu, "").trim();
  // Folded as foldText does, case kept and then not.
  const kept = ` ${plain.replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const words = kept.toLowerCase();
  const opensTitle = (name: string) => plain === name || /^\s*[,;:(/\-–—]/u.test(plain.slice(name.length));
  const pick = (match: (landmark: Landmark, consider: (at: number) => void) => void): Landmark | undefined => {
    let best: { at: number; landmark: Landmark } | undefined;
    for (const landmark of LANDMARKS) {
      match(landmark, (at) => {
        if (at >= 0 && (!best || at < best.at)) best = { at, landmark };
      });
    }
    return best?.landmark;
  };
  const notExcluded = (not: readonly string[], name: string) => (at: number) =>
    !not.some((n) => {
      const padded = ` ${n} `;
      for (let off = padded.indexOf(` ${name} `); off >= 0; off = padded.indexOf(` ${name} `, off + 1)) {
        if (at >= off && words.startsWith(padded, at - off)) return true;
      }
      return false;
    });
  return (
    pick((landmark, consider) => {
      const not = landmark.not ?? [];
      for (const city of landmark.cities) consider(firstAt(words, city, notExcluded(not, city)));
      for (const name of landmark.capitalized ?? []) consider(firstAt(kept, name, (at) => at > 0 || opensTitle(name)));
    }) ??
    pick((landmark, consider) => {
      const not = landmark.not ?? [];
      for (const word of landmark.fallback ?? []) consider(firstAt(words, word, notExcluded(not, word)));
    }) ??
    SUITCASE
  );
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
