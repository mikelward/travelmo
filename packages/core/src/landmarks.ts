import table from "./landmarks.json";

// A trip's picture in the trip list: an outline of the best-known landmark
// of the city its title names, drawn in a 48-unit square as one SVG path
// for a 1.5-unit round-capped stroke (landmarks.json, which the Android app
// compiles in too). A title naming no city with a landmark gets the suitcase.
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
  // Longer names, folded, that a match of `cities` is not when it begins one:
  // "santiago de compostela" is not Santiago.
  not?: readonly string[];
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
// Paris), else the suitcase. Names match as whole words, accents and case
// ignored, so "Lisboa" is Lisbon and "Parisian" is nobody; a capitalized
// name keeps its case.
export function tripLandmark(title: string): Landmark {
  const plain = title.normalize("NFKD").replace(/\p{M}/gu, "").trim();
  // Folded as foldText does, case kept and then not.
  const kept = ` ${plain.replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const words = kept.toLowerCase();
  const opensTitle = (name: string) => plain === name || /^\s*[,;:(/\-–—]/u.test(plain.slice(name.length));
  let best: { at: number; landmark: Landmark } | undefined;
  const consider = (at: number, landmark: Landmark) => {
    if (at >= 0 && (!best || at < best.at)) best = { at, landmark };
  };
  for (const landmark of LANDMARKS) {
    const not = landmark.not ?? [];
    for (const city of landmark.cities) consider(firstAt(words, city, (at) => !not.some((n) => words.startsWith(` ${n} `, at))), landmark);
    for (const name of landmark.capitalized ?? []) consider(firstAt(kept, name, (at) => at > 0 || opensTitle(name)), landmark);
  }
  return best?.landmark ?? SUITCASE;
}
