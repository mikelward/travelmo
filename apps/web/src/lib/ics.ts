import { parseIcs, summarizeIcs } from "@travelmo/core";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type CalendarPreview = { text: string; fileText: string; importable: number };

// Read in the browser first, so the user sees what the file holds before
// anything is sent or read by the model.
export function previewIcs(fileText: string): CalendarPreview {
  const s = summarizeIcs(parseIcs(fileText));
  let text = `${count(s.events, "event", "events")}; ${s.importable} will be checked for bookings.`;
  const skipped = [
    s.recurring ? count(s.recurring, "repeating event", "repeating events") : undefined,
    s.cancelled ? count(s.cancelled, "cancelled event", "cancelled events") : undefined,
  ].filter(Boolean);
  if (skipped.length) text += ` Skipping ${skipped.join(" and ")}.`;
  return { text, fileText, importable: s.importable };
}

export type CalendarResult = {
  removed?: number;
  updated?: number;
  skipped: number;
  filtered: number;
  not_booking: number;
  imported: number;
  failed: number;
  recurring: number;
  cancelled: number;
  remaining: number;
};

export function describeCalendarResult(r: CalendarResult): string {
  const parts = [`${count(r.imported, "event", "events")} imported`];
  if (r.not_booking) parts.push(`${r.not_booking} not bookings`);
  if (r.filtered) parts.push(`${r.filtered} skipped as not travel`);
  if (r.skipped) parts.push(`${r.skipped} read before`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.removed) parts.push(`${r.removed} removed as cancelled`);
  if (r.updated) parts.push(`${r.updated} read again after changing`);
  let text = `${parts.join(", ")}.`;
  if (r.remaining) text += ` ${count(r.remaining, "event is", "events are")} left: import the file again to continue.`;
  return text;
}
