// Segment instants carry the offset of the place they happen in, so the
// display reads the local wall-clock straight from the string rather than
// converting to the viewer's zone.
export function localTime(instant: string): string {
  return instant.slice(11, 16);
}

function utcDate(date: string): Date {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
}

export function formatDate(date: string, locale = "en-GB", options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    ...options,
  }).format(utcDate(date));
}

export function formatDateRange(start: string, end: string, locale = "en-GB"): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const sameMonth = sameYear && start.slice(5, 7) === end.slice(5, 7);
  const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(utcDate(date));
  if (start === end) return fmt(start, { day: "numeric", month: "short", year: "numeric" });
  if (sameMonth) {
    return `${fmt(start, { day: "numeric" })}–${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  if (sameYear) {
    return `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  const full = { day: "numeric", month: "short", year: "numeric" } as const;
  return `${fmt(start, full)} – ${fmt(end, full)}`;
}

// How each trip's title reads where trips are listed together: a title two
// or more of them share, compared ignoring case and spacing (the same camp
// every summer), gets each one's dates, "Debutots Camp (11–15 Aug 2025)";
// any other title reads as it is. Keyed by trip id.
export function displayTitles(trips: readonly { id: string; title: string; start: string; end: string }[], locale = "en-GB"): Map<string, string> {
  const key = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();
  const count = new Map<string, number>();
  for (const trip of trips) count.set(key(trip.title), (count.get(key(trip.title)) ?? 0) + 1);
  return new Map(
    trips.map((trip) => [trip.id, (count.get(key(trip.title)) ?? 0) > 1 ? `${trip.title.trim()} (${formatDateRange(trip.start, trip.end, locale)})` : trip.title]),
  );
}
