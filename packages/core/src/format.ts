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
