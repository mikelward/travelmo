"use client";

import { travelReport, type PlaceLookup, type TravelReport } from "@travelmo/core";
import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { WorldMap, type WorldMapData } from "@/components/WorldMap";
import { countryName } from "@/lib/countries";
import { localToday } from "@/lib/dates";
import { useSaveForOffline } from "@/lib/offline";
import { useAllSegments, useTrips } from "@/lib/trips";

type Tables = { lookup: PlaceLookup; map: WorldMapData };

// The airport and map tables are a few hundred kilobytes between them, so
// only this page loads them.
function useTables(): Tables | Error | undefined {
  const [tables, setTables] = useState<Tables | Error>();
  useEffect(() => {
    let current = true;
    Promise.all([import("@travelmo/core/airportPlaces"), import("@/lib/worldMap.json")])
      .then(([places, map]) => {
        if (current) setTables({ lookup: places.airportPlace, map: map.default as WorldMapData });
      })
      .catch((error: Error) => {
        console.error("Loading the map tables failed", error);
        if (current) setTables(error);
      });
    return () => {
      current = false;
    };
  }, []);
  return tables;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Summary({ report }: { report: TravelReport }) {
  return (
    <p className="mt-2 text-zinc-600 dark:text-zinc-400" data-testid="summary">
      {plural(report.trips, "trip")} · {plural(report.days, "day")} away · {plural(report.countries.length, "country", "countries")}
    </p>
  );
}

function Countries({ report }: { report: TravelReport }) {
  if (!report.countries.length) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">Days in each country</h2>
      <table className="mt-2 w-full text-sm" aria-label="Days in each country">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="py-1 font-normal">Country</th>
            <th className="py-1 text-right font-normal">Days</th>
            <th className="py-1 text-right font-normal">Trips</th>
          </tr>
        </thead>
        <tbody>
          {report.countries.map((c) => (
            <tr key={c.country} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-1">{countryName(c.country)}</td>
              <td className="py-1 text-right tabular-nums">{c.days}</td>
              <td className="py-1 text-right tabular-nums">{c.trips}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Years({ report, onPick }: { report: TravelReport; onPick: (year: string) => void }) {
  if (!report.years.length) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">Trips per year</h2>
      <table className="mt-2 w-full text-sm" aria-label="Trips per year">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="py-1 font-normal">Year</th>
            <th className="py-1 text-right font-normal">Trips</th>
            <th className="py-1 text-right font-normal">Days</th>
            <th className="py-1 text-right font-normal">Countries</th>
          </tr>
        </thead>
        <tbody>
          {report.years.map((y) => (
            <tr key={y.year} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-1">
                <button type="button" className="hover:underline" onClick={() => onPick(y.year)}>
                  {y.year}
                </button>
              </td>
              <td className="py-1 text-right tabular-nums">{y.trips}</td>
              <td className="py-1 text-right tabular-nums">{y.days}</td>
              <td className="py-1 text-right tabular-nums">{y.countries}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Report({ user }: { user: User }) {
  useSaveForOffline();
  const trips = useTrips(user);
  const ids = useMemo(() => trips?.map((t) => t.id).sort(), [trips]);
  const segments = useAllSegments(ids);
  const tables = useTables();
  const [year, setYear] = useState("");
  const today = localToday();

  const all = useMemo(() => {
    if (!trips || !segments || !tables || tables instanceof Error) return undefined;
    const withSegments = trips.flatMap((trip) => {
      const s = segments.byTrip[trip.id];
      return s ? [{ trip, segments: s }] : [];
    });
    return { withSegments, report: travelReport(withSegments, today, { lookup: tables.lookup }) };
  }, [trips, segments, tables, today]);
  const report = useMemo(
    () => (all && tables && !(tables instanceof Error) && year ? travelReport(all.withSegments, today, { year, lookup: tables.lookup }) : all?.report),
    [all, tables, year, today],
  );

  if (tables instanceof Error) return <p className="text-red-600">The map couldn&apos;t be loaded: {tables.message}</p>;
  if (!report || !tables || !all || !segments) return <p className="text-zinc-500">Loading reports…</p>;

  const years = all.report.years.map((y) => y.year);
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label="Year"
            className="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
      </div>
      <Summary report={report} />
      {segments.failed.length > 0 && (
        <p className="mt-2 text-sm text-red-600">
          {plural(segments.failed.length, "trip")} couldn&apos;t be read, so {segments.failed.length === 1 ? "it isn't" : "they aren't"}{" "}
          counted. Reload to try again.
        </p>
      )}
      <WorldMap
        data={tables.map}
        visited={new Set(report.countries.map((c) => c.country))}
        airports={report.airports}
        places={report.places}
        name={countryName}
      />
      {(report.unknownDays > 0 || report.unplaced > 0) && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" data-testid="unplaced">
          {[
            report.unknownDays > 0 && `${plural(report.unknownDays, "day")} away with no country known`,
            report.unplaced > 0 && `${plural(report.unplaced, "booking")} with no country`,
          ]
            .filter(Boolean)
            .join("; ")}
          : bookings say where they are by their country, or for a flight its airport code; the map shows the places that know their
          spot.
        </p>
      )}
      <Countries report={report} />
      <Years report={all.report} onPick={setYear} />
      {all.report.upcoming > 0 && (
        <p className="mt-6 text-sm text-zinc-500">
          {plural(all.report.upcoming, "trip")} still ahead {all.report.upcoming === 1 ? "isn't" : "aren't"} counted.
        </p>
      )}
      {all.report.trips === 0 && all.report.upcoming === 0 && <p className="mt-6 text-zinc-500">No trips yet.</p>}
    </>
  );
}

export default function ReportsPage() {
  return <SignInGate>{(user) => <Report user={user} />}</SignInGate>;
}
