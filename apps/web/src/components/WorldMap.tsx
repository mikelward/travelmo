import { equalEarth } from "@travelmo/core/projection";
import type { AirportVisit, PlaceVisit } from "@travelmo/core";

// The shape of src/lib/worldMap.json, drawn by scripts/worldmap.mjs.
export type WorldMapData = { scale: number; viewBox: number[]; countries: Record<string, string> };

const placeLabel = (p: PlaceVisit, name: (code: string) => string) =>
  [p.name, p.city && p.city !== p.name ? p.city : undefined, p.country ? name(p.country) : undefined].filter(Boolean).join(", ");

// Countries visited are filled; airports flown through are dots, and the
// stays, stations and other places whose bookings say where they are
// smaller ones.
export function WorldMap({
  data,
  visited,
  airports,
  places = [],
  name,
}: {
  data: WorldMapData;
  visited: ReadonlySet<string>;
  airports: readonly AirportVisit[];
  places?: readonly PlaceVisit[];
  name: (code: string) => string;
}) {
  const label = visited.size
    ? `Map of the world with ${[...visited].map(name).sort().join(", ")} marked`
    : "Map of the world, with nowhere marked yet";
  const project = (lon: number, lat: number) => equalEarth(lon, lat).map((v) => v * data.scale) as [number, number];
  return (
    <svg viewBox={data.viewBox.join(" ")} role="img" aria-label={label} className="mt-6 w-full" data-testid="world-map">
      {Object.entries(data.countries).map(([code, d]) => (
        <path
          key={code}
          d={d}
          data-country={code}
          data-visited={visited.has(code) || undefined}
          className={
            visited.has(code)
              ? "fill-sky-600 stroke-white dark:fill-sky-400 dark:stroke-zinc-950"
              : "fill-zinc-200 stroke-white dark:fill-zinc-800 dark:stroke-zinc-950"
          }
          strokeWidth={0.5}
        >
          <title>{name(code)}</title>
        </path>
      ))}
      {places.map((p) => {
        const [x, y] = project(p.lon, p.lat);
        return (
          <circle
            key={`${p.lat},${p.lon}`}
            cx={x}
            cy={y}
            r={4}
            data-place={p.name}
            className="fill-rose-500 stroke-white dark:stroke-zinc-950"
            strokeWidth={1}
          >
            <title>{placeLabel(p, name)}</title>
          </circle>
        );
      })}
      {airports.map((a) => {
        const [x, y] = project(a.lon, a.lat);
        return (
          <circle key={a.code} cx={x} cy={y} r={6} data-airport={a.code} className="fill-amber-500 stroke-white dark:stroke-zinc-950" strokeWidth={1.5}>
            <title>{a.code}</title>
          </circle>
        );
      })}
    </svg>
  );
}
