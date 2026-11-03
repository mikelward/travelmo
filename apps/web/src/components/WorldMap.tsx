import { equalEarth } from "@travelmo/core/projection";
import type { AirportVisit } from "@travelmo/core";

// The shape of src/lib/worldMap.json, drawn by scripts/worldmap.mjs.
export type WorldMapData = { scale: number; viewBox: number[]; countries: Record<string, string> };

// Countries visited are filled; airports flown through are dots.
export function WorldMap({
  data,
  visited,
  airports,
  name,
}: {
  data: WorldMapData;
  visited: ReadonlySet<string>;
  airports: readonly AirportVisit[];
  name: (code: string) => string;
}) {
  const label = visited.size
    ? `Map of the world with ${[...visited].map(name).sort().join(", ")} marked`
    : "Map of the world, with nowhere marked yet";
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
      {airports.map((a) => {
        const [x, y] = equalEarth(a.lon, a.lat).map((v) => v * data.scale) as [number, number];
        return (
          <circle key={a.code} cx={x} cy={y} r={6} data-airport={a.code} className="fill-amber-500 stroke-white dark:stroke-zinc-950" strokeWidth={1.5}>
            <title>{a.code}</title>
          </circle>
        );
      })}
    </svg>
  );
}
