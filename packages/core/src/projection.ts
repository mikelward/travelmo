// The Equal Earth projection (Šavrič, Patterson and Jenny, 2018): countries
// keep their true relative sizes, and the formula is short enough to share
// between the script that draws the world map and the page that marks it.
// Imports nothing, so the map script can load it as it is.

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

// Longitude and latitude in degrees to x (east) and y (south), in units of
// the Earth's radius: x within ±2.71 and y within ±1.32.
export function equalEarth(lon: number, lat: number): [number, number] {
  const lambda = (lon * Math.PI) / 180;
  const theta = Math.asin(M * Math.sin((lat * Math.PI) / 180));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const x = (lambda * Math.cos(theta)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, -y];
}
