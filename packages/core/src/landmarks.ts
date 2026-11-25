import table from "./landmarks.json";
import { foldText } from "./tripSearch";

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
  d: string;
}

export const LANDMARKS: readonly Landmark[] = table.landmarks;

const SUITCASE = LANDMARKS.find((l) => l.id === "trip")!;

// The landmark of the city named first in `title` ("Paris and Lyon" is
// Paris), else the suitcase. Names match as whole words, accents and case
// ignored, so "Lisboa" is Lisbon and "Parisian" is nobody.
export function tripLandmark(title: string): Landmark {
  const words = ` ${foldText(title)} `;
  let best: { at: number; landmark: Landmark } | undefined;
  for (const landmark of LANDMARKS) {
    for (const city of landmark.cities) {
      const at = words.indexOf(` ${city} `);
      if (at >= 0 && (!best || at < best.at)) best = { at, landmark };
    }
  }
  return best?.landmark ?? SUITCASE;
}
