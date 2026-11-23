import { parseIcs, summarizeIcs } from "@travelmo/core";

export { describeCalendarResult, type CalendarResult } from "@travelmo/core";

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
    s.exported ? count(s.exported, "event from Travelmo's own calendar", "events from Travelmo's own calendar") : undefined,
  ].filter(Boolean);
  if (skipped.length) text += ` Skipping ${skipped.join(" and ")}.`;
  return { text, fileText, importable: s.importable };
}

