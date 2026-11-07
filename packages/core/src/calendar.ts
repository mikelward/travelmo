import type { Trip } from "./schema";

// A month of trips, laid out for a calendar: the weeks of a month (Monday
// first, padded with the neighboring months' days so every row is seven
// wide) and, per week, the bars the trips make across it, stacked into
// lanes so two overlapping trips never share a row.

export type Month = string; // "YYYY-MM"

const pad = (n: number) => String(n).padStart(2, "0");

export const monthOf = (date: string): Month => date.slice(0, 7);

export function addMonths(month: Month, n: number): Month {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(year, index, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthLabel(month: Month, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Monday is 0, Sunday 6.
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

// The month's weeks, each seven dates from Monday to Sunday; the first and
// last may begin or end in the months around it.
export function monthWeeks(month: Month): string[][] {
  const first = `${month}-01`;
  const start = addDays(first, -weekday(first));
  const weeks: string[][] = [];
  for (let day = start; weeks.length < 6 && (weeks.length === 0 || monthOf(day) === month); day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

export type TripBar = {
  trip: Trip;
  // Columns within the week, 0 to 6 inclusive.
  from: number;
  to: number;
  // Whether the trip goes on before this week's Monday or after its Sunday.
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
};

// The bars of the trips touching a week, earliest start first, each in the
// lowest lane free for its span. A trip keeps its lane from one week to
// the next only by luck; the rows are laid out one at a time.
export function weekBars(week: readonly string[], trips: readonly Trip[]): TripBar[] {
  const monday = week[0]!;
  const sunday = week[week.length - 1]!;
  const touching = trips
    .filter((t) => t.start <= sunday && t.end >= monday)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.title.localeCompare(b.title));
  const laneEnds: number[] = [];
  return touching.map((trip) => {
    const from = trip.start < monday ? 0 : week.indexOf(trip.start);
    const to = trip.end > sunday ? week.length - 1 : week.indexOf(trip.end);
    let lane = laneEnds.findIndex((end) => end < from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = to;
    return { trip, from, to, continuesBefore: trip.start < monday, continuesAfter: trip.end > sunday, lane };
  });
}

// The months a set of trips spans, earliest first, for a jump list.
export function tripMonths(trips: readonly Trip[]): Month[] {
  const months = new Set<Month>();
  for (const t of trips) for (let m = monthOf(t.start); m <= monthOf(t.end); m = addMonths(m, 1)) months.add(m);
  return [...months].sort();
}
