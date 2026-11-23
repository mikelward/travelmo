import { homeAt, type HomePeriod, countryCode } from "./home";
import { reportBounds, tripDayPlaces, type PlaceLookup, type TripWithSegments } from "./reports";

// Days in and out of countries, for residence and visa limits: where the
// traveler was on each calendar day, from their bookings, and the limits
// countries set on days away (settlement, citizenship) or days in (a
// Schengen short stay, US tax). An estimate from the bookings the app
// knows about, not legal advice; the sources are cited beside each rule.

// ---- Dates ----

const dayMs = 86_400_000;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type DateShift = { years?: number; months?: number; days?: number };

// A calendar date moved by whole years and months (keeping to the last day
// of a shorter month: 29 Feb 2024 plus a year is 28 Feb 2025), then days.
export function shiftDate(date: string, { years = 0, months = 0, days = 0 }: DateShift): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + years * 12 + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return new Date(Date.UTC(year, month - 1, day) + days * dayMs).toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

function* dates(from: string, to: string): Generator<string> {
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += dayMs) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

// ---- Where the traveler was ----

// One calendar day: the countries the traveler was in (any part of the day),
// the trips that say so, whether nothing was booked and they are taken to
// be at home, and whether they spent the whole day between countries (a
// flight across the date line). No country and not in transit is a day
// nothing places: a trip day whose bookings name no country, or a day at a
// home with no country.
export type DayPresence = { countries: Set<string>; tripIds: Set<string>; assumedHome: boolean; inTransit: boolean };

export function presenceTimeline(
  all: readonly TripWithSegments[],
  homes: readonly HomePeriod[],
  from: string,
  to: string,
  lookup?: PlaceLookup,
): Map<string, DayPresence> {
  const days = new Map<string, DayPresence>();
  const byId = new Map(all.map((t) => [t.trip.id, t]));
  for (const { trip, segments } of byId.values()) {
    const bounds = reportBounds(trip, segments);
    if (!bounds || bounds.end < from || bounds.start > to) continue;
    for (const [day, place] of tripDayPlaces(trip, segments, to, lookup)) {
      // A trip dated before its first booking says nothing about those days.
      if (day < from || !place.started) continue;
      const known = days.get(day) ?? { countries: new Set<string>(), tripIds: new Set<string>(), assumedHome: false, inTransit: false };
      for (const c of place.countries) known.countries.add(c);
      known.tripIds.add(trip.id);
      known.inTransit = !known.countries.size && (known.inTransit || place.inTransit);
      days.set(day, known);
    }
  }
  const timeline = new Map<string, DayPresence>();
  for (const day of dates(from, to)) {
    const known = days.get(day);
    if (known) {
      timeline.set(day, known);
      continue;
    }
    // As a code, however the home was written ("UK" is GB).
    const homeCountry = homeAt(homes, day)?.country;
    const home = homeCountry ? countryCode(homeCountry) : undefined;
    timeline.set(day, { countries: new Set(home ? [home] : []), tripIds: new Set(), assumedHome: true, inTransit: false });
  }
  return timeline;
}

// ---- Rules ----

// Schengen members as of 1 January 2025, when Bulgaria and Romania joined in
// full (Croatia joined on 1 January 2023); Ireland and Cyprus are EU members
// outside it. Monaco, San Marino and Vatican City have open borders with
// it but are not members, so they are left out.
// https://home-affairs.ec.europa.eu/news/bulgaria-and-romania-join-schengen-area-2025-01-03_en
export const schengenCountries: readonly string[] = [
  "AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "GR", "FR", "HR", "HU", "IS",
  "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK",
];

// The United States for naturalization includes Puerto Rico, Guam, the US
// Virgin Islands and the Northern Mariana Islands (INA 101(a)(38)); for the
// substantial presence test it is the states and DC alone
// (https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test).
const usForImmigration = ["US", "PR", "GU", "VI", "MP"];

// How a rule counts a day. Both come to the same thing for a day the
// traveler crossed a border: it touches the country, so it is no absence
// under "whole-days" and is a day in under "any-part".
//  - "whole-days": a day away counts as an absence only when no part of it
//    was spent in the country, so the days of leaving and coming back are
//    not absences (UK Home Office).
//  - "any-part": any part of a day in the country counts as a day there,
//    so the days of arriving and leaving count (Schengen, US, Canada,
//    Australia).
export type Counting = "whole-days" | "any-part";

export type ResidenceRule = {
  id: string;
  // What it measures, as the report shows it.
  label: string;
  // The countries that count as being in.
  area: readonly string[];
  counting: Counting;
  // The page the rule comes from.
  source: string;
} & (
  | {
      // At most `limit` days away (maxAbsent), at least `limit` days in
      // (minPresent), or at most `limit` days in (maxPresent), in the
      // `window` before the date; with `rolling`, in any such window ending
      // within that long before the date. With `qualifying`, `rolling` is a
      // qualifying period whose days alone count: every window lies wholly
      // inside it (UK settlement's five years), where otherwise a window
      // may start before it (Schengen's 180 days ending in the last year).
      kind: "maxAbsent" | "minPresent" | "maxPresent";
      limit: number;
      window: DateShift;
      rolling?: DateShift;
      qualifying?: boolean;
    }
  | {
      // No single absence, within `window` before the date, longer than
      // `nearMonths` (a warning) or as long as `overMonths`, with what each
      // means for the person.
      kind: "longestAbsence";
      window: DateShift;
      nearMonths: number;
      overMonths: number;
      notes: { near: string; over: string };
    }
  | {
      // The US substantial presence test, for the calendar year of the date.
      kind: "substantialPresence";
    }
);

export type ResidenceRuleSet = {
  id: string;
  label: string;
  // Whether the date is when the person applies.
  application: boolean;
  rules: readonly ResidenceRule[];
};

const continuousNotes = {
  near: "Away over 6 months: USCIS takes this to break continuous residence unless you show otherwise.",
  over: "Away a year or more: this breaks continuous residence.",
};

export const residenceRuleSets: readonly ResidenceRuleSet[] = [
  {
    id: "uk-settlement",
    label: "UK settlement (indefinite leave to remain)",
    application: true,
    rules: [
      {
        // No more than 180 days outside the UK in any 12 months of the
        // qualifying period (five years on most routes), counted in whole
        // days: the days of leaving and coming back are not absences.
        // https://www.gov.uk/government/publications/indefinite-leave-to-remain-calculating-continuous-period-in-uk
        id: "uk-settlement-absences",
        label: "Days outside the UK in any 12 months",
        area: ["GB"],
        counting: "whole-days",
        kind: "maxAbsent",
        limit: 180,
        window: { months: 12 },
        rolling: { years: 5 },
        qualifying: true,
        source: "https://www.gov.uk/government/publications/indefinite-leave-to-remain-calculating-continuous-period-in-uk",
      },
    ],
  },
  {
    id: "uk-citizenship",
    label: "UK citizenship (naturalisation)",
    application: true,
    rules: [
      {
        // No more than 450 days outside the UK in the five years before
        // applying, and no more than 90 in the last 12 months, in whole days.
        // https://www.gov.uk/government/publications/form-an-guidance
        id: "uk-citizenship-five-years",
        label: "Days outside the UK in the 5 years before applying",
        area: ["GB"],
        counting: "whole-days",
        kind: "maxAbsent",
        limit: 450,
        window: { years: 5 },
        source: "https://www.gov.uk/government/publications/form-an-guidance",
      },
      {
        id: "uk-citizenship-last-year",
        label: "Days outside the UK in the 12 months before applying",
        area: ["GB"],
        counting: "whole-days",
        kind: "maxAbsent",
        limit: 90,
        window: { months: 12 },
        source: "https://www.gov.uk/government/publications/form-an-guidance",
      },
    ],
  },
  {
    id: "schengen",
    label: "Schengen short stays (90 days in 180)",
    application: false,
    rules: [
      {
        // At most 90 days in any 180, the days of entering and leaving
        // both counted as days of stay, looking back from each day.
        // https://home-affairs.ec.europa.eu/policies/schengen/border-crossing/short-stay-calculator_en
        id: "schengen-90-180",
        label: "Days in the Schengen area in any 180 days",
        area: schengenCountries,
        counting: "any-part",
        kind: "maxPresent",
        limit: 90,
        window: { days: 180 },
        rolling: { years: 1 },
        source: "https://home-affairs.ec.europa.eu/policies/schengen/border-crossing/short-stay-calculator_en",
      },
    ],
  },
  {
    id: "us-citizenship",
    label: "US citizenship",
    application: true,
    rules: [
      {
        // Physically present for at least half of the five years before
        // applying (30 months, 913 days); the days of leaving and coming
        // back count as days present.
        // https://www.uscis.gov/policy-manual/volume-12-part-d-chapter-4
        id: "us-citizenship-presence",
        label: "Days in the US in the 5 years before applying",
        area: usForImmigration,
        counting: "any-part",
        kind: "minPresent",
        limit: 913,
        window: { years: 5 },
        source: "https://www.uscis.gov/policy-manual/volume-12-part-d-chapter-4",
      },
      {
        // An absence of more than six months but less than a year is
        // presumed to break continuous residence unless shown otherwise; one
        // of a year or more breaks it.
        // https://www.uscis.gov/policy-manual/volume-12-part-d-chapter-3
        id: "us-citizenship-continuous",
        label: "Longest time away from the US in the 5 years before applying",
        area: usForImmigration,
        counting: "any-part",
        kind: "longestAbsence",
        window: { years: 5 },
        nearMonths: 6,
        overMonths: 12,
        notes: continuousNotes,
        source: "https://www.uscis.gov/policy-manual/volume-12-part-d-chapter-3",
      },
    ],
  },
  {
    id: "us-citizenship-spouse",
    label: "US citizenship, married to a US citizen",
    application: true,
    rules: [
      {
        // Half of the three years before applying: 18 months, 548 days.
        // https://www.uscis.gov/policy-manual/volume-12-part-g-chapter-2
        id: "us-citizenship-spouse-presence",
        label: "Days in the US in the 3 years before applying",
        area: usForImmigration,
        counting: "any-part",
        kind: "minPresent",
        limit: 548,
        window: { years: 3 },
        source: "https://www.uscis.gov/policy-manual/volume-12-part-g-chapter-2",
      },
      {
        // https://www.uscis.gov/policy-manual/volume-12-part-d-chapter-3
        id: "us-citizenship-spouse-continuous",
        label: "Longest time away from the US in the 3 years before applying",
        area: usForImmigration,
        counting: "any-part",
        kind: "longestAbsence",
        window: { years: 3 },
        nearMonths: 6,
        overMonths: 12,
        notes: continuousNotes,
        source: "https://www.uscis.gov/policy-manual/volume-12-part-d-chapter-3",
      },
    ],
  },
  {
    id: "us-green-card",
    label: "US green card",
    application: false,
    rules: [
      {
        // Absences of over six months may be questioned on return; one of a
        // year or more, without a reentry permit, may mean the green card
        // was given up.
        // https://www.uscis.gov/green-card/after-we-grant-your-green-card/international-travel-as-a-permanent-resident
        id: "us-green-card-absence",
        label: "Longest time away from the US",
        area: usForImmigration,
        counting: "any-part",
        kind: "longestAbsence",
        window: { years: 5 },
        nearMonths: 6,
        overMonths: 12,
        notes: {
          near: "Away over 6 months: you may be asked on your return whether you still live in the US.",
          over: "Away a year or more: without a reentry permit, your green card may be taken as given up.",
        },
        source: "https://www.uscis.gov/green-card/after-we-grant-your-green-card/international-travel-as-a-permanent-resident",
      },
    ],
  },
  {
    id: "us-tax",
    label: "US tax (substantial presence test)",
    application: false,
    rules: [
      {
        // At least 31 days this year, and 183 counting all of this year's
        // days, a third of last year's and a sixth of the year before's;
        // any part of a day in the US counts.
        // https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test
        id: "us-substantial-presence",
        label: "Days in the US for the substantial presence test",
        area: ["US"],
        counting: "any-part",
        kind: "substantialPresence",
        source: "https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test",
      },
    ],
  },
  {
    id: "ca-permanent-residence",
    label: "Canada permanent residence",
    application: false,
    rules: [
      {
        // At least 730 days in Canada in the last five years; the days of
        // leaving and coming back count as days in Canada.
        // https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/permanent-residence/card/permanent-resident-determination.html
        id: "ca-pr-presence",
        label: "Days in Canada in the last 5 years",
        area: ["CA"],
        counting: "any-part",
        kind: "minPresent",
        limit: 730,
        window: { years: 5 },
        source:
          "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/permanent-residence/card/permanent-resident-determination.html",
      },
    ],
  },
  {
    id: "ca-citizenship",
    label: "Canada citizenship",
    application: true,
    rules: [
      {
        // At least 1,095 days in Canada in the five years before applying;
        // a day of leaving or arriving counts, as part of it was in Canada.
        // https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/canadian-citizenship/grant/residence/calculate-physical-presence.html
        id: "ca-citizenship-presence",
        label: "Days in Canada in the 5 years before applying",
        area: ["CA"],
        counting: "any-part",
        kind: "minPresent",
        limit: 1095,
        window: { years: 5 },
        source:
          "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/canadian-citizenship/grant/residence/calculate-physical-presence.html",
      },
    ],
  },
  {
    id: "au-citizenship",
    label: "Australia citizenship",
    application: true,
    rules: [
      {
        // Lived in Australia for the four years before applying, away for
        // no more than 12 months in total, and no more than 90 days in the
        // last 12 months.
        // https://immi.homeaffairs.gov.au/citizenship/become-a-citizen/permanent-resident
        id: "au-citizenship-four-years",
        label: "Days outside Australia in the 4 years before applying",
        area: ["AU"],
        counting: "any-part",
        kind: "maxAbsent",
        limit: 365,
        window: { years: 4 },
        source: "https://immi.homeaffairs.gov.au/citizenship/become-a-citizen/permanent-resident",
      },
      {
        id: "au-citizenship-last-year",
        label: "Days outside Australia in the 12 months before applying",
        area: ["AU"],
        counting: "any-part",
        kind: "maxAbsent",
        limit: 90,
        window: { months: 12 },
        source: "https://immi.homeaffairs.gov.au/citizenship/become-a-citizen/permanent-resident",
      },
    ],
  },
];

// ---- Evaluating ----

// The first day of a span ending on `end`, both days included: 12 months
// ending 23 Nov 2026 start on 24 Nov 2025, 180 days on 28 May 2026.
const severity: Record<ResidenceStatus, number> = { ok: 0, near: 1, over: 2 };

const spanStart = (end: string, span: DateShift) =>
  shiftDate(shiftDate(end, { years: -(span.years ?? 0), months: -(span.months ?? 0) }), { days: 1 - (span.days ?? 0) });

export type DateRange = { start: string; end: string };

// A run of days counted against a rule (away, or in the area), within the
// window it was counted in.
export type Stretch = { start: string; end: string; days: number; countries: string[]; tripIds: string[] };

// "near" is within a tenth of the limit; "over" is past it, short of a
// minimum, a single absence as long as the rule allows, or meeting the
// substantial presence test.
export type ResidenceStatus = "ok" | "near" | "over";

export type RuleResult = {
  rule: ResidenceRule;
  // Days counted in the worst window: away, or in; the weighted total for
  // the substantial presence test; the longest absence in days.
  used: number;
  limit: number;
  // Days to the limit (negative once past it), or days still needed for a
  // minimum.
  remaining: number;
  status: ResidenceStatus;
  // The window counted, the worst one for a rolling rule, or the longest
  // absence from the day of leaving to the day of coming back.
  window: DateRange;
  // For a rolling rule, the window ending on the date; for the substantial
  // presence test, this year's days.
  current?: { used: number; window: DateRange };
  // Days in the window nothing places: counted against the traveler (away
  // for a limit on absences or a minimum, in for a limit on days in).
  unknownDays: number;
  // The absences, or the stays in the area, in the window.
  stretches: Stretch[];
};

const isUnknown = (d: DayPresence | undefined) => !d || (!d.countries.size && !d.inTransit);

// Whether a day counts towards what the rule measures: a day in the area
// for a rule on days in, a day away for a rule on absences. A day nothing
// places is counted the way that keeps the traveler safe: in, for a limit
// on days in; away, for a limit on absences or a minimum of days in.
function counter(rule: ResidenceRule): (d: DayPresence | undefined) => boolean {
  const area = new Set(rule.area);
  const inside = (d: DayPresence | undefined) => Boolean(d && [...d.countries].some((c) => area.has(c)));
  if (rule.kind === "maxPresent" || rule.kind === "substantialPresence") return (d) => inside(d) || isUnknown(d);
  if (rule.kind === "minPresent") return inside;
  return (d) => !inside(d);
}

function stretches(timeline: Map<string, DayPresence>, range: DateRange, counted: (d: DayPresence | undefined) => boolean, area: ReadonlySet<string>, absence: boolean): Stretch[] {
  const runs: Stretch[] = [];
  let run: { start: string; end: string; days: number; countries: Set<string>; tripIds: Set<string> } | undefined;
  const close = () => {
    if (run) runs.push({ start: run.start, end: run.end, days: run.days, countries: [...run.countries].sort(), tripIds: [...run.tripIds].sort() });
    run = undefined;
  };
  for (const day of dates(range.start, range.end)) {
    const d = timeline.get(day);
    if (!counted(d)) {
      close();
      continue;
    }
    run ??= { start: day, end: day, days: 0, countries: new Set(), tripIds: new Set() };
    run.end = day;
    run.days += 1;
    for (const c of d?.countries ?? []) if (area.has(c) !== absence) run.countries.add(c);
    for (const t of d?.tripIds ?? []) run.tripIds.add(t);
  }
  close();
  return runs;
}

function statusOf(kind: "maxAbsent" | "minPresent" | "maxPresent", used: number, limit: number): ResidenceStatus {
  if (kind === "minPresent") return used < limit ? "over" : used < limit * 1.1 ? "near" : "ok";
  return used > limit ? "over" : used >= limit * 0.9 ? "near" : "ok";
}

// How a rule stands on `date` from a timeline covering everything it looks
// at (`presenceTimeline` from eight years before the date is enough for
// every rule here).
export function evaluateRule(rule: ResidenceRule, timeline: Map<string, DayPresence>, date: string): RuleResult {
  const counted = counter(rule);
  const area = new Set(rule.area);
  const countIn = (range: DateRange) => {
    let n = 0;
    for (const day of dates(range.start, range.end)) if (counted(timeline.get(day))) n += 1;
    return n;
  };
  const unknownIn = (range: DateRange) => {
    let n = 0;
    for (const day of dates(range.start, range.end)) if (isUnknown(timeline.get(day))) n += 1;
    return n;
  };

  if (rule.kind === "substantialPresence") {
    const year = Number(date.slice(0, 4));
    const thisYear = countIn({ start: `${year}-01-01`, end: date });
    const lastYear = countIn({ start: `${year - 1}-01-01`, end: `${year - 1}-12-31` });
    const yearBefore = countIn({ start: `${year - 2}-01-01`, end: `${year - 2}-12-31` });
    // Compared in sixths of a day, whole numbers, so exactly 183 is not
    // rounded short of it; divided only for display.
    const sixths = 6 * thisYear + 2 * lastYear + yearBefore;
    const used = sixths / 6;
    const window = { start: `${year - 2}-01-01`, end: date };
    const status: ResidenceStatus = thisYear >= 31 && sixths >= 6 * 183 ? "over" : sixths * 10 >= 9 * 6 * 183 ? "near" : "ok";
    return {
      rule,
      used,
      limit: 183,
      remaining: 183 - used,
      status,
      window,
      current: { used: thisYear, window: { start: `${year}-01-01`, end: date } },
      unknownDays: unknownIn(window),
      stretches: stretches(timeline, window, counted, area, false),
    };
  }

  if (rule.kind === "longestAbsence") {
    const window = { start: spanStart(date, rule.window), end: date };
    // Every absence touching the window, from the day of leaving to the day
    // of coming back (or the date, while still away).
    const absences = stretches(timeline, { start: shiftDate(window.start, { years: -2 }), end: date }, counted, area, true).filter((s) => s.end >= window.start);
    let worst: { range: DateRange; days: number; status: ResidenceStatus } | undefined;
    for (const s of absences) {
      const left = shiftDate(s.start, { days: -1 });
      const back = s.end === date ? date : shiftDate(s.end, { days: 1 });
      const days = daysBetween(left, back);
      const status: ResidenceStatus = back >= shiftDate(left, { months: rule.overMonths }) ? "over" : back > shiftDate(left, { months: rule.nearMonths }) ? "near" : "ok";
      // The most serious absence, and the longest of those: the thresholds
      // are calendar months, so the longest by days may be the milder one.
      const worse = !worst || severity[status] > severity[worst.status] || (status === worst.status && days > worst.days);
      if (worse) worst = { range: { start: left, end: back }, days, status };
    }
    const limit = Math.round((rule.overMonths * 365) / 12);
    return {
      rule,
      used: worst?.days ?? 0,
      limit,
      remaining: limit - (worst?.days ?? 0),
      status: worst?.status ?? "ok",
      window: worst?.range ?? window,
      unknownDays: unknownIn(window),
      stretches: absences.map((s) => (s.start < window.start ? { ...s, start: window.start, days: s.days - daysBetween(s.start, window.start) } : s)),
    };
  }

  const windowEnding = (end: string): DateRange => ({ start: spanStart(end, rule.window), end });
  const latest = windowEnding(date);
  let window = latest;
  let used = countIn(latest);
  const current = rule.rolling ? { used, window: latest } : undefined;
  if (rule.rolling) {
    // Every window ending within the rolling period, kept as a running
    // count: the latest of the worst is the one shown. For a qualifying
    // period, only windows wholly inside it, as days before it do not count.
    const period = spanStart(date, rule.rolling);
    let firstEnd = period;
    // Moved on a day at a time, as month arithmetic is not reversible (a
    // period starting on 29 February); a window's length bounds it.
    if (rule.qualifying) while (firstEnd < date && windowEnding(firstEnd).start < period) firstEnd = shiftDate(firstEnd, { days: 1 });
    const ends = [...dates(firstEnd < date ? firstEnd : date, date)];
    const first = windowEnding(ends[0]!);
    let count = countIn(first);
    let start = first.start;
    const better = (n: number) => (rule.kind === "minPresent" ? n <= used : n >= used);
    used = count;
    window = first;
    for (let i = 1; i < ends.length; i++) {
      const next = windowEnding(ends[i]!);
      for (const day of dates(start, shiftDate(next.start, { days: -1 }))) if (counted(timeline.get(day))) count -= 1;
      if (counted(timeline.get(next.end))) count += 1;
      start = next.start;
      if (better(count)) {
        used = count;
        window = next;
      }
    }
  }
  return {
    rule,
    used,
    limit: rule.limit,
    remaining: rule.limit - used,
    status: statusOf(rule.kind, used, rule.limit),
    window,
    ...(current ? { current } : {}),
    unknownDays: unknownIn(window),
    // For a minimum of days in, the absences that took from it.
    stretches: rule.kind === "minPresent" ? stretches(timeline, window, (d) => !counted(d), area, true) : stretches(timeline, window, counted, area, rule.kind === "maxAbsent"),
  };
}


export type ResidenceReport = {
  results: RuleResult[];
  // Whether home, for the days with no trip, has a country: without one,
  // those days are counted as nothing places.
  homeCountryKnown: boolean;
};

// Every rule of a set on `date`. Trips booked up to the date count, so a
// date ahead shows how planned trips would leave things; days with no
// trip are taken as at home.
export function residenceReport(
  all: readonly TripWithSegments[],
  homes: readonly HomePeriod[],
  set: ResidenceRuleSet,
  date: string,
  lookup?: PlaceLookup,
): ResidenceReport {
  const timeline = presenceTimeline(all, homes, shiftDate(date, { years: -8 }), date, lookup);
  return {
    results: set.rules.map((rule) => evaluateRule(rule, timeline, date)),
    homeCountryKnown: homes.some((h) => Boolean(h.country)),
  };
}
