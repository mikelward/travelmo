"use client";

import { countryDays, countryDaysRange, decodeReportSnapshot, encodeReportSnapshot, shiftDate, displayTitles, favoritePlaces, formatDateRange, placeRows, placeRowsCsv, travelReport, tripRows, watchedTrip, tripRowsCsv, type FavoritePlace, type CountryCounting, type CountryDaysReport, type HomePeriod, type PlaceLookup, type SummaryTrip, type TravelReport } from "@travelmo/core";
import Link from "next/link";
import type { User } from "firebase/auth";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ResidenceDays } from "@/components/ResidenceDays";
import { SignInGate } from "@/components/SignInGate";
import { WorldMap, type WorldMapData } from "@/components/WorldMap";
import { countryName } from "@/lib/countries";
import { localToday } from "@/lib/dates";
import { useSaveForOffline } from "@/lib/offline";
import { deriveHomes, ownTripSegments } from "@/lib/home";
import { usePeople } from "@/lib/people";
import { allRead, useAllSegments, useProfile, useTripsState } from "@/lib/trips";

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

const days = (n: number) => plural(n, "day");

// How days in each country count, kept in this browser (SPEC "Reports").
const countingKey = "travelmo.countryCounting";
const countings: readonly CountryCounting[] = ["part", "whole", "nights"];

function useCounting(): [CountryCounting, (next: CountryCounting) => void] {
  const [counting, setCounting] = useState<CountryCounting>("part");
  // Read after the first render, so the page the server sent matches.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(countingKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only there after hydration
      if (countings.includes(stored as CountryCounting)) setCounting(stored as CountryCounting);
    } catch (e) {
      // Storage may be blocked (a private window): part days, the default.
      console.debug("Reading how Reports counts days failed; counting part days", e);
    }
  }, []);
  const update = (next: CountryCounting) => {
    setCounting(next);
    try {
      localStorage.setItem(countingKey, next);
    } catch (e) {
      // It still applies for this visit.
      console.debug("Saving how Reports counts days failed; it lasts this visit", e);
    }
  };
  return [counting, update];
}

// Where the user was each day, home included, split into stays at each
// border crossing; each country opens to its stays, latest first, so a
// surprising one can be found and fixed. Days nothing places come first,
// to be given a place, and count nowhere until they are.
// A section worked out only once opened, as it takes a while: Days in each country and Residence and visa days.
function OnDemand({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="mt-8" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-medium">
        <button type="button" aria-expanded={open} onClick={onToggle} className="hover:underline">
          <span aria-hidden="true">{open ? "▾ " : "▸ "}</span>
          {title}
        </button>
      </h2>
      {open && children}
    </section>
  );
}

// Said under an opened section while what it needs is still loading.
function Working() {
  return <p className="mt-2 text-muted">Working it out…</p>;
}

function Countries({
  report,
  counting,
  onCounting,
  titles,
  today,
}: {
  report: CountryDaysReport;
  counting: CountryCounting;
  onCounting: (next: CountryCounting) => void;
  titles: Map<string, string>;
  today: string;
}) {
  const [open, setOpen] = useState<string>();
  // Kept up while another count is picked, even with no days to show, so it can be changed back.
  if (!report.countries.length && !report.unplaced.length && report.homeCountryKnown && counting === "part") return null;
  const nights = counting === "nights";
  return (
    <>
      <select
        value={counting}
        onChange={(e) => onCounting(e.target.value as CountryCounting)}
        aria-label="Count"
        className="mt-1 rounded-lg border border-field bg-background px-2 py-1"
      >
        <option value="part">Part days</option>
        <option value="whole">Whole days</option>
        <option value="nights">Nights</option>
      </select>
      {!report.homeCountryKnown && (
        <p className="mt-1 text-muted">
          Days with no trip count as at home, but home has no country yet. Add one on your{" "}
          <Link href="/profile" className="underline">
            Profile
          </Link>
          .
        </p>
      )}
      {report.unplaced.length > 0 && (
        <div className="mt-1" data-testid="unplaced">
          <p className="text-muted">
            {days(report.unplaced.reduce((n, s) => n + s.days, 0))} we can&rsquo;t place aren&rsquo;t counted. Give these trips&rsquo; bookings a
            country, or a flight its airport code.
          </p>
          <ul className="mt-1 space-y-1" aria-label="Days we can't place">
            {report.unplaced.map((s) => (
              <li key={s.start}>
                {formatDateRange(s.start, s.end)} · {days(s.days)}
                {s.tripIds.map((id) => (
                  <span key={id}>
                    {" · "}
                    <Link href={`/trips/${id}`} className="hover:underline">
                      {titles.get(id) ?? "Trip"}
                    </Link>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      <table className="mt-2 w-full" aria-label="Days in each country">
        <thead className="text-left text-muted">
          <tr>
            <th className="py-1 font-normal">Country</th>
            <th className="py-1 text-right font-normal">{nights ? "Nights" : "Days"}</th>
          </tr>
        </thead>
        <tbody>
          {report.countries.map((c) => (
            <Fragment key={c.country}>
              <tr className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-1">
                  <button
                    type="button"
                    aria-expanded={open === c.country}
                    onClick={() => setOpen(open === c.country ? undefined : c.country)}
                    className="text-left hover:underline"
                  >
                    {countryName(c.country)}
                  </button>
                </td>
                <td className="py-1 text-right tabular-nums">{c.days.toLocaleString("en-US")}</td>
              </tr>
              {open === c.country && (
                <tr>
                  <td colSpan={2} className="pb-2">
                    <ul aria-label={`Stays in ${countryName(c.country)}`} className="ml-4">
                      {c.stays.map((s) => (
                        <li key={s.start}>
                          {/* A run of nights reads as a hotel booking does, to the morning after the last (if it has come). */}
                          {formatDateRange(s.start, nights && s.end < today ? shiftDate(s.end, { days: 1 }) : s.end)} · {nights ? plural(s.days, "night") : days(s.days)}
                          {s.home && " · Home"}
                          {s.tripIds.map((id) => (
                            <span key={id}>
                              {" · "}
                              <Link href={`/trips/${id}`} className="hover:underline">
                                {titles.get(id) ?? "Trip"}
                              </Link>
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

// That some trips' bookings couldn't be read, which holds the reports back: the counts shown are the last visit's.
function Unreadable({ count }: { count: number }) {
  if (!count) return null;
  return (
    <p className="mt-2 text-danger">
      {plural(count, "trip")} couldn&apos;t be read, so these counts are from your last visit. Reload to try again.
    </p>
  );
}

// A summary of every trip to download, for visa and settlement forms: one
// row per trip or per place, optionally only what was abroad.
function DownloadTrips({ trips, homes, lookup, titles, today }: { trips: readonly SummaryTrip[]; homes: () => readonly HomePeriod[] | undefined; lookup: PlaceLookup; titles: Map<string, string>; today: string }) {
  const [byPlace, setByPlace] = useState(false);
  const [international, setInternational] = useState(false);
  const [until, setUntil] = useState(today);
  const download = () => {
    // Home is worked out only now, when the file is made.
    const options = { periods: homes() ?? [], lookup, international, titles, until: until || today };
    const text = byPlace ? placeRowsCsv(placeRows(trips, options)) : tripRowsCsv(tripRows(trips, options));
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = byPlace ? "travelmo-places.csv" : "travelmo-trips.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="mt-8" aria-labelledby="download-trips">
      <h2 id="download-trips" className="text-lg font-medium">
        Download trips
      </h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        A spreadsheet of where you went and when, for visa and residence forms. Events, tickets and cancelled trips are left
        out.
      </p>
      <fieldset className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <legend className="sr-only">Rows</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="rows" checked={!byPlace} onChange={() => setByPlace(false)} /> One row per trip
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="rows" checked={byPlace} onChange={() => setByPlace(true)} /> One row per place
        </label>
      </fieldset>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={international} onChange={(e) => setInternational(e.target.checked)} /> Outside my home country only
      </label>
      <label className="mt-2 flex items-center gap-2">
        Trips starting up to
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="rounded-lg border border-field bg-background px-2 py-1"
        />
      </label>
      <button
        type="button"
        onClick={download}
        disabled={!homes}
        className="mt-3 rounded-lg border border-field px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-900"
      >
        Download CSV
      </button>
    </section>
  );
}

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

// The places the traveler rated or marked on their trip pages, favorites
// first, each linking to the trips it was on.
function Favorites({ places, titles }: { places: readonly FavoritePlace[]; titles: Map<string, string> }) {
  if (!places.length) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">Favorite places</h2>
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="Favorite places">
        {places.map((p) => (
          <li key={`${p.name}|${p.country ?? ""}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <span className="font-medium">
              {p.favorite && (
                <span className="mr-1 text-rose-500" aria-label="Favorite">
                  ♥
                </span>
              )}
              {p.name}
            </span>
            {(p.city || p.country) && <span className="text-muted">{[p.city, p.country ? countryName(p.country) : undefined].filter(Boolean).join(", ")}</span>}
            {p.rating !== undefined && (
              <span className="text-amber-500" aria-label={`Rated ${p.rating} ${p.rating === 1 ? "star" : "stars"}`}>
                {stars(p.rating)}
              </span>
            )}
            <span className="text-muted">
              {p.trips.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && " · "}
                  <Link href={`/trips/${t.id}`} className="hover:underline">
                    {titles.get(t.id) ?? t.title}
                  </Link>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Years({ report, onPick }: { report: TravelReport; onPick: (year: string) => void }) {
  if (!report.years.length) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">Trips per year</h2>
      <table className="mt-2 w-full" aria-label="Trips per year">
        <thead className="text-left text-muted">
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

// Every year's counts and map as last worked out in this browser, drawn
// while the bookings are read (SPEC "Reports"); `fresh` replaces them once
// worked out.
const snapshotKey = "travelmo.reportSnapshot";

function useReportSnapshot(uid: string, fresh: TravelReport | undefined): TravelReport | undefined {
  const [saved, setSaved] = useState<TravelReport>();
  // Read after the first render, so the page the server sent matches.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only there after hydration
      setSaved(decodeReportSnapshot(localStorage.getItem(snapshotKey), uid));
    } catch (e) {
      // Blocked storage, or text from another version: worked out from the bookings in a moment.
      console.debug("Reading Reports' last counts failed; waiting for the bookings", e);
    }
  }, [uid]);
  useEffect(() => {
    if (!fresh) return;
    try {
      localStorage.setItem(snapshotKey, encodeReportSnapshot(uid, fresh));
    } catch (e) {
      // The next visit works them out before drawing, as before.
      console.debug("Saving Reports' counts for next time failed", e);
    }
  }, [uid, fresh]);
  return saved;
}

function Report({ user }: { user: User }) {
  useSaveForOffline();
  const tripsState = useTripsState(user);
  const trips = tripsState?.trips;
  const segments = useAllSegments(trips, user.uid, Boolean(tripsState?.confirmed));
  // Nothing is worked out from part of the trips: not before the server has answered for every trip and its
  // bookings (offline, the cache can hold only some, or none), nor while one couldn't be read.
  const ready = Boolean(tripsState?.confirmed && segments && allRead(segments));
  const unreadable = segments?.failed.length ?? 0;
  const tables = useTables();
  const profile = useProfile(user.uid);
  // Whom the user's bookings name: a trip they're only watching isn't theirs to count.
  const travelers = usePeople(user.uid);
  const [year, setYear] = useState("");
  const today = localToday();

  const all = useMemo(() => {
    if (!ready || !trips || !segments || !travelers || !tables || tables instanceof Error) return undefined;
    const withSegments = trips.flatMap((trip) => {
      const s = segments.byTrip[trip.id];
      return s && !watchedTrip(trip, s, travelers) ? [{ trip, segments: s }] : [];
    });
    return { withSegments, report: travelReport(withSegments, today, { lookup: tables.lookup }) };
  }, [ready, trips, segments, travelers, tables, today]);
  const report = useMemo(
    () => (all && tables && !(tables instanceof Error) && year ? travelReport(all.withSegments, today, { year, lookup: tables.lookup }) : all?.report),
    [all, tables, year, today],
  );
  const favorites = useMemo(() => (all ? favoritePlaces(all.withSegments) : []), [all]);

  // Days in each country and residence days take a while (home over time, then every day of every year), so each
  // is worked out only once opened, and home only for them or the download.
  const [countriesOpen, setCountriesOpen] = useState(false);
  const [residenceOpen, setResidenceOpen] = useState(false);
  // Home over time, for the days with no trip: from the viewer's own trips,
  // already read, with their corrections over it, as the Profile works it out.
  const homesOf = useCallback(() => {
    if (!ready || !trips || !segments || !travelers || !profile) return undefined;
    return deriveHomes(ownTripSegments(trips, segments.byTrip, user.uid, travelers), [], profile.homes ?? [], profile.homeAirports ?? [], profile.notHome ?? []).periods;
  }, [ready, trips, segments, travelers, profile, user.uid]);
  const homes = useMemo(() => (countriesOpen || residenceOpen ? homesOf() : undefined), [countriesOpen, residenceOpen, homesOf]);
  const titles = useMemo(() => displayTitles(trips ?? []), [trips]);
  const [counting, setCounting] = useCounting();
  const countries = useMemo(() => {
    if (!countriesOpen || !all || !homes || !tables || tables instanceof Error) return undefined;
    const range = countryDaysRange(all.withSegments, today, year || undefined);
    return range && countryDays(all.withSegments, homes, range, tables.lookup, counting);
  }, [countriesOpen, all, homes, tables, today, year, counting]);

  const snapshot = useReportSnapshot(user.uid, all?.report);
  // Until the bookings are read, every year's counts and map as last worked out here.
  const whole = all?.report ?? snapshot;
  const shown = report ?? (year ? undefined : snapshot);
  const visited = useMemo(() => new Set(shown?.countries.map((c) => c.country)), [shown]);

  if (tables instanceof Error) return <p className="text-danger">The map couldn&apos;t be loaded: {tables.message}</p>;
  if (!shown || !whole || !tables)
    return (
      <>
        <p className="text-muted">Loading reports…</p>
        <Unreadable count={unreadable} />
      </>
    );

  const years = whole.years.map((y) => y.year);
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            // Another year is worked out from the bookings: until they are read the saved counts stand.
            disabled={!all}
            aria-label="Year"
            className="rounded-lg border border-field bg-background px-2 py-1"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
      </div>
      <Summary report={shown} />
      <Unreadable count={unreadable} />
      <WorldMap
        data={tables.map}
        visited={visited}
        airports={shown.airports}
        places={shown.places}
        name={countryName}
      />
      {!all && !unreadable && <Working />}
      {all && (
        <>
        <OnDemand id="countries-heading" title="Days in each country" open={countriesOpen} onToggle={() => setCountriesOpen(!countriesOpen)}>
          {countries ? (
            <Countries report={countries} counting={counting} onCounting={setCounting} titles={titles} today={today} />
          ) : homes ? (
            <p className="mt-2 text-muted">No trip has begun yet, so there are no days to count.</p>
          ) : (
            <Working />
          )}
        </OnDemand>
        <Favorites places={favorites} titles={titles} />
        <OnDemand id="residence-heading" title="Residence and visa days" open={residenceOpen} onToggle={() => setResidenceOpen(!residenceOpen)}>
          {homes ? <ResidenceDays trips={all.withSegments} homes={homes} lookup={tables.lookup} today={today} titles={titles} /> : <Working />}
        </OnDemand>
        <Years report={all.report} onPick={setYear} />
        {/* Once the profile has answered, so "outside my home country" never takes a home not yet read for none. */}
        {profile && <DownloadTrips trips={all.withSegments} homes={() => homes ?? homesOf()} lookup={tables.lookup} titles={titles} today={today} />}
        {all.report.upcoming > 0 && (
          <p className="mt-6 text-muted">
            {plural(all.report.upcoming, "trip")} still ahead {all.report.upcoming === 1 ? "isn't" : "aren't"} counted.
          </p>
        )}
        {all.report.trips === 0 && all.report.upcoming === 0 && <p className="mt-6 text-muted">No trips yet.</p>}
        </>
      )}
    </>
  );
}

export default function ReportsPage() {
  return <SignInGate>{(user) => <Report user={user} />}</SignInGate>;
}
