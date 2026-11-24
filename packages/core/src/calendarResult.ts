// What an import of calendar events did, as the parser's /import/ics and
// /feeds/add answer it, in words for the person who asked.

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The parser routes that connect Google Calendar, choose its calendars and
// disconnect it.
export const calendarConnectPath = "/calendar/connect";
export const calendarSelectPath = "/calendar/select";
export const calendarDisconnectPath = "/calendar/disconnect";

// The parser routes that subscribe to a calendar feed and drop one.
export const feedAddPath = "/feeds/add";
export const feedRemovePath = "/feeds/remove";

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
  exported?: number;
};

export function describeCalendarResult(r: CalendarResult): string {
  const parts = [`${count(r.imported, "event", "events")} imported`];
  if (r.not_booking) parts.push(`${r.not_booking} not bookings`);
  if (r.filtered) parts.push(`${r.filtered} skipped as not travel`);
  if (r.skipped) parts.push(`${r.skipped} read before`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.removed) parts.push(`${r.removed} removed as cancelled`);
  if (r.updated) parts.push(`${r.updated} read again after changing`);
  if (r.exported) parts.push(`${r.exported} of Travelmo's own events skipped`);
  let text = `${parts.join(", ")}.`;
  if (r.remaining) text += ` ${count(r.remaining, "event is", "events are")} left: import the file again to continue.`;
  return text;
}
