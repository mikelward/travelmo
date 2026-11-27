import { displayBounds } from "./trips";
// Segment instants carry the offset of the place they happen in, so the
// display reads the local wall-clock straight from the string rather than
// converting to the viewer's zone.
export function localTime(instant: string): string {
  return instant.slice(11, 16);
}

function utcDate(date: string): Date {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(locale: string, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const fullKey = `${locale}|${key}`;
  let formatter = dateFormatters.get(fullKey);
  if (!formatter) {
    if (dateFormatters.size >= 100) dateFormatters.clear();
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(fullKey, formatter);
  }
  return formatter;
}

export function formatDate(date: string, locale = "en-GB", options?: Intl.DateTimeFormatOptions): string {
  const key = options ? JSON.stringify(options) : "default";
  const formatter = getDateFormatter(locale, `d:${key}`, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    ...options,
  });
  return formatter.format(utcDate(date));
}

const OPT_DAY: Intl.DateTimeFormatOptions = { day: "numeric", timeZone: "UTC" };
const OPT_DAY_MONTH: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
const OPT_FULL: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };

export function formatDateRange(start: string, end: string, locale = "en-GB"): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const sameMonth = sameYear && start.slice(5, 7) === end.slice(5, 7);
  const fullFmt = getDateFormatter(locale, "r:full", OPT_FULL);
  if (start === end) return fullFmt.format(utcDate(start));
  if (sameMonth) {
    return `${getDateFormatter(locale, "r:day", OPT_DAY).format(utcDate(start))}–${fullFmt.format(utcDate(end))}`;
  }
  if (sameYear) {
    return `${getDateFormatter(locale, "r:dm", OPT_DAY_MONTH).format(utcDate(start))} – ${fullFmt.format(utcDate(end))}`;
  }
  return `${fullFmt.format(utcDate(start))} – ${fullFmt.format(utcDate(end))}`;
}

// How each trip's title reads where trips are listed together: a title two
// or more of them share, compared ignoring case and spacing (the same camp
// every summer), gets each one's dates, "Debutots Camp (11–15 Aug 2025)";
// any other title reads as it is. Keyed by trip id.
export function displayTitles(
  trips: readonly { id: string; title: string; start: string; end: string; liveStart?: string | undefined; liveEnd?: string | undefined }[],
  locale = "en-GB",
): Map<string, string> {
  const key = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();
  const count = new Map<string, number>();
  for (const trip of trips) count.set(key(trip.title), (count.get(key(trip.title)) ?? 0) + 1);
  return new Map(
    trips.map((trip) => [trip.id, (count.get(key(trip.title)) ?? 0) > 1 ? `${trip.title.trim()} (${formatDateRange(displayBounds(trip).start, displayBounds(trip).end, locale)})` : trip.title]),
  );
}
