import { countryName } from "./countries";
import type { Place, Segment } from "./schema";
import { displayBounds } from "./trips";

// Searching the trips list (SPEC "Searching trips"): a query is words and,
// optionally, a date. Every word must appear in the trip's title or one of
// its bookings (title, provider, reference, and each place's name, code,
// city and country); a date picks the trips under way during it. TripSearch.kt is
// the Kotlin twin.

export type TripQuery = {
  words: string[];
  // A date in the query: a year, a month (of any year when no year is
  // given), or a day of one.
  year?: number;
  month?: number;
  day?: number;
};

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// "march", "mar", "sept": the month's number, 1-12.
function monthOf(word: string): number | undefined {
  if (word.length < 3) return undefined;
  const at = months.findIndex((m) => m.startsWith(word));
  return at < 0 ? undefined : at + 1;
}

// Letters and numbers only, accents dropped, case ignored.
export const foldText = (text: string) =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function parseTripQuery(text: string): TripQuery {
  const query: TripQuery = { words: [] };
  const tokens = text.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  const numbers: string[] = [];
  for (const token of tokens) {
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(token);
    // A month or day that cannot be is a word, not a date.
    const iso = match && Number(match[2]) >= 1 && Number(match[2]) <= 12 && (!match[3] || (Number(match[3]) >= 1 && Number(match[3]) <= 31)) ? match : null;
    const month = monthOf(token.replace(/\.$/, ""));
    if (iso) {
      query.year = Number(iso[1]);
      query.month = Number(iso[2]);
      if (iso[3]) query.day = Number(iso[3]);
    } else if (/^(19|20)\d{2}$/.test(token)) {
      query.year = Number(token);
    } else if (month !== undefined) {
      query.month = month;
    } else if (/^\d{1,2}(st|nd|rd|th)?$/.test(token)) {
      numbers.push(token);
    } else {
      query.words.push(...foldText(token).split(" ").filter(Boolean));
    }
  }
  // A number beside a month is its day; otherwise it is a word ("VS 11").
  for (const n of numbers) {
    const day = parseInt(n, 10);
    if (query.month !== undefined && query.day === undefined && day >= 1 && day <= 31) query.day = day;
    else query.words.push(foldText(n));
  }
  return query;
}

export function isEmptyQuery(query: TripQuery): boolean {
  return query.words.length === 0 && query.year === undefined && query.month === undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Whether the trip is under way at some time the query's date names.
function onDate(query: TripQuery, start: string, end: string): boolean {
  if (query.year === undefined && query.month === undefined) return true;
  const years = query.year !== undefined ? [query.year] : range(Number(start.slice(0, 4)), Number(end.slice(0, 4)));
  return years.some((year) => {
    const from = query.month === undefined ? `${year}-01-01` : `${year}-${pad(query.month)}-${pad(query.day ?? 1)}`;
    const to = query.month === undefined ? `${year}-12-31` : `${year}-${pad(query.month)}-${pad(query.day ?? lastDay(year, query.month))}`;
    return from <= end && to >= start;
  });
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let y = from; y <= to; y++) out.push(y);
  return out;
}

function placeText(place: Place | undefined): string[] {
  if (!place) return [];
  return [place.name, place.code ?? "", place.city ?? "", ...(place.country ? [place.country, countryName(place.country)] : [])];
}

export type SearchedSegment = Pick<Segment, "title" | "provider" | "confirmation" | "origin" | "destination">;

export function tripMatches(
  query: TripQuery,
  trip: { start: string; end: string; liveStart?: string | undefined; liveEnd?: string | undefined },
  title: string,
  segments: readonly SearchedSegment[],
): boolean {
  const { start, end } = displayBounds(trip);
  if (!onDate(query, start, end)) return false;
  if (query.words.length === 0) return true;
  const text = ` ${foldText([title, ...segments.flatMap((s) => [s.title, s.provider ?? "", s.confirmation ?? "", ...placeText(s.origin), ...placeText(s.destination)])].join(" "))}`;
  // Each word as the start of a word in the text, so "par" finds Paris and
  // "ba" finds BA but not Cuba.
  return query.words.every((word) => text.includes(` ${word}`));
}
