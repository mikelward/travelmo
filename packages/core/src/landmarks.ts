import table from "./landmarks.json";

// A trip's picture in the trip list: an outline of the best-known landmark
// of the city its title names, or a matching place kind, season, holiday or
// vacation drawing when no city is named, drawn in a 48-unit square as one
// SVG path for a 1.5-unit round-capped stroke (landmarks.json, which the
// Android app compiles in too). Anything else gets the suitcase.
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
  // it begins one: "santiago de compostela" is not Santiago.
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
  const notExcluded = (not: readonly string[]) => (at: number) => !not.some((n) => words.startsWith(` ${n} `, at));
  return (
    pick((landmark, consider) => {
      const ok = notExcluded(landmark.not ?? []);
      for (const city of landmark.cities) consider(firstAt(words, city, ok));
      for (const name of landmark.capitalized ?? []) consider(firstAt(kept, name, (at) => at > 0 || opensTitle(name)));
    }) ??
    pick((landmark, consider) => {
      const ok = notExcluded(landmark.not ?? []);
      for (const word of landmark.fallback ?? []) consider(firstAt(words, word, ok));
    }) ??
    SUITCASE
  );
}
