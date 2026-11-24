"use client";

import {
  formatDateRange,
  isCalendarDate,
  residenceReport,
  residenceRuleSets,
  spanText,
  type Stretch,
  type HomePeriod,
  type PlaceLookup,
  type RuleResult,
  type TripWithSegments,
} from "@travelmo/core";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { countryName } from "@/lib/countries";

const days = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "day" : "days"}`;
const range = (r: { start: string; end: string }) => formatDateRange(r.start, r.end);
const day = (date: string) => formatDateRange(date, date);

// How the result stands, in words that fit what the rule measures.
export function statusText(result: RuleResult): string {
  const { rule, status } = result;
  switch (rule.kind) {
    case "minPresent":
      return { ok: "Enough days", near: "Only just enough", over: "Not enough days" }[status];
    case "longestAbsence":
      return status === "ok" ? "No long absence" : rule.notes[status];
    case "substantialPresence":
      if (status === "over") return "Meets the test";
      return (result.current?.used ?? 0) < 31 ? "Not met: under 31 days this year" : status === "near" ? "Close to meeting it" : "Not met";
    default:
      return { ok: "Within the limit", near: "Close to the limit", over: "Over the limit" }[status];
  }
}

// The count against the rule: "45 of 180 days · 135 left".
export function countText(result: RuleResult): string {
  const { rule, used, limit, remaining } = result;
  switch (rule.kind) {
    case "minPresent":
      return `${used.toLocaleString("en-US")} of ${days(limit)} · ${remaining > 0 ? `${days(remaining)} short` : `${days(-remaining)} to spare`}`;
    case "longestAbsence":
      return used ? `Longest: ${days(used)}, ${range(result.window)}` : "No time away";
    case "substantialPresence":
      return `${used.toLocaleString("en-US", { maximumFractionDigits: 1 })} of ${days(limit)}, ${days(result.current?.used ?? 0)} this year`;
    default:
      return `${used.toLocaleString("en-US")} of ${days(limit)} · ${remaining >= 0 ? `${days(remaining)} left` : `${days(-remaining)} over`}`;
  }
}

const tone = { ok: "", near: "text-amber-700 dark:text-amber-400", over: "text-danger" } as const;

// Runs of days, latest first, each with its countries and trips.
function Stretches({ label, items, titles, children }: { label: string; items: readonly Stretch[]; titles: Map<string, string>; children?: ReactNode }) {
  return (
    <details className="mt-1 text-sm">
      <summary className="cursor-pointer text-muted">
        {label} ({items.length.toLocaleString("en-US")})
      </summary>
      <ul className="mt-1 space-y-1" aria-label={label}>
        {children}
        {[...items].reverse().map((s) => (
          <li key={s.start}>
            {range(s)} · {days(s.days)}
            {s.countries.length > 0 && ` · ${s.countries.map(countryName).join(", ")}`}
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
    </details>
  );
}

function Result({ result, titles }: { result: RuleResult; titles: Map<string, string> }) {
  const { rule } = result;
  const stays = rule.kind === "maxPresent" || rule.kind === "substantialPresence";
  const rolling = (rule.kind === "maxAbsent" || rule.kind === "maxPresent") && rule.rolling;
  return (
    <li className="py-3" data-testid="residence-rule">
      <h3 className="font-medium">{rule.label}</h3>
      <p className="tabular-nums">{countText(result)}</p>
      <p className={`text-sm ${tone[result.status]}`} data-status={result.status}>
        {statusText(result)}
      </p>
      {result.period && (
        <p className="text-sm text-muted">
          {result.period.moved && rule.areaName
            ? `Since you moved to ${rule.areaName} on ${day(result.period.start)}`
            : `Counted over ${range(result.period)}`}
        </p>
      )}
      {rule.kind !== "longestAbsence" && !(result.period && result.window.start === result.period.start && result.window.end === result.period.end) && (
        <p className="text-sm text-muted">
          {rolling ? `Worst ${spanText(rule.window)}: ${range(result.window)}` : range(result.window)}
          {result.current && rolling && result.current.window.start !== result.window.start && ` · Last ${spanText(rule.window)}: ${days(result.current.used)}`}
        </p>
      )}
      {result.unknownDays > 0 && (
        <p className="text-sm text-muted">
          Includes {days(result.unknownDays)} we can&rsquo;t place in a country, counted {stays ? "as inside" : "as away"} to be safe.
        </p>
      )}
      {result.unplaced.length > 0 && (
        <Stretches label="Days we can't place" items={result.unplaced} titles={titles}>
          <li className="text-muted">
            Give these trips&rsquo; bookings a place, or set home on your <Link href="/profile" className="underline">Profile</Link>.
          </li>
        </Stretches>
      )}
      {result.stretches.length > 0 && <Stretches label={stays ? "Stays" : "Time away"} items={result.stretches} titles={titles} />}
      <a href={rule.source} className="text-sm text-muted underline" target="_blank" rel="noreferrer">
        Official guidance
      </a>
    </li>
  );
}

// Days in and out of countries against residence and visa limits
// (`packages/core/src/residence.ts`), from the trips the page already read
// and home over time for the days with no trip.
export function ResidenceDays({
  trips,
  homes,
  lookup,
  today,
  titles,
}: {
  trips: readonly TripWithSegments[];
  homes: readonly HomePeriod[];
  lookup: PlaceLookup;
  today: string;
  titles: Map<string, string>;
}) {
  const [setId, setSetId] = useState(residenceRuleSets[0]!.id);
  const [picked, setPicked] = useState("");
  const date = isCalendarDate(picked) ? picked : today;
  const set = residenceRuleSets.find((s) => s.id === setId) ?? residenceRuleSets[0]!;
  const report = useMemo(() => residenceReport(trips, homes, set, date, lookup), [trips, homes, set, date, lookup]);
  return (
    <section className="mt-8" aria-labelledby="residence-heading">
      <h2 id="residence-heading" className="text-lg font-medium">
        Residence and visa days
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <select
          value={setId}
          onChange={(e) => setSetId(e.target.value)}
          aria-label="Rules"
          className="rounded-lg border border-field bg-background px-2 py-1"
        >
          {residenceRuleSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          {set.application ? "Applying on" : "On"}
          <input
            type="date"
            value={date}
            onChange={(e) => setPicked(e.target.value)}
            className="rounded-lg border border-field bg-background px-2 py-1"
          />
        </label>
      </div>
      {!report.homeCountryKnown && (
        <p className="mt-2 text-sm text-danger">
          Days with no trip count as at home, but home has no country yet. <Link href="/profile" className="underline">Add one on your Profile</Link>.
        </p>
      )}
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="Residence and visa days">
        {report.results.map((r) => (
          <Result key={r.rule.id} result={r} titles={titles} />
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted">
        An estimate from the bookings Travelmo knows about, with days between trips counted at home. It isn&apos;t legal advice.
      </p>
    </section>
  );
}
