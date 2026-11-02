import { formatOffset, stableHash, type GoogleCalendarChoice, type IcsCalendar, type IcsEvent, type IcsTime } from "@travelmo/core";
import { google, type calendar_v3 } from "googleapis";
import { describeFeedResult } from "./feeds";
import { oauthClient, type OAuthConfig } from "./gmail";
import { importCalendar, type ImportDeps } from "./importer";

// Google Calendar, read through the API with the user's consent and imported
// like a calendar file: each event becomes the text the model reads, keyed by
// its iCalendar UID, so an event that also arrives through a feed or a file
// is read once.

export const calendarScopes = ["https://www.googleapis.com/auth/calendar.readonly"];

// Model reads per calendar per day, as for a feed; a backlog clears over the
// following days.
export const calendarMaxRead = 100;

export type GoogleCalendar = calendar_v3.Calendar;

export function calendarFor(config: OAuthConfig, refreshToken: string): GoogleCalendar {
  const auth = oauthClient(config);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

export type ListedCalendar = { id: string; summary: string; primary?: boolean };

export async function listCalendars(api: GoogleCalendar): Promise<ListedCalendar[]> {
  const listed: ListedCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await api.calendarList.list({ maxResults: 250, ...(pageToken ? { pageToken } : {}) });
    for (const c of data.items ?? []) {
      if (!c.id) continue;
      listed.push({ id: c.id, summary: c.summaryOverride ?? c.summary ?? c.id, ...(c.primary ? { primary: true } : {}) });
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return listed;
}

// Every event of a calendar, deleted ones included so a cancellation can
// remove its booking. Repeating events come as one entry each (with their
// exceptions), not expanded: they are never bookings.
export async function listEvents(api: GoogleCalendar, calendarId: string): Promise<{ events: calendar_v3.Schema$Event[]; zone?: string }> {
  const events: calendar_v3.Schema$Event[] = [];
  let zone: string | undefined;
  let pageToken: string | undefined;
  do {
    const { data } = await api.events.list({
      calendarId,
      maxResults: 2500,
      showDeleted: true,
      singleEvents: false,
      ...(pageToken ? { pageToken } : {}),
    });
    events.push(...(data.items ?? []));
    zone ??= data.timeZone ?? undefined;
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return { events, ...(zone ? { zone } : {}) };
}

// The account's calendars as the user sees them, keeping each one's choice
// and last result; new calendars start unchosen, and gone ones are dropped.
export function mergeCalendarList(existing: readonly GoogleCalendarChoice[], listed: readonly ListedCalendar[]): GoogleCalendarChoice[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  return listed.map((c) => {
    const { primary: _primary, ...previous } = byId.get(c.id) ?? { selected: false };
    return { ...previous, id: c.id, summary: c.summary, ...(c.primary ? { primary: true } : {}) };
  });
}

// The wall time of an instant in a zone, with the offset in force at that
// instant: read from the instant, not the wall time, which repeats when
// clocks go back.
function localIn(zone: string, instant: string): { date: string; time: string; offset: string } | undefined {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return undefined;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    // A zone name this runtime does not know: the caller keeps the instant
    // with the offset Google sent instead.
    return undefined;
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  const wall = Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day")), Number(part("hour")), Number(part("minute")));
  const minute = Math.floor(at.getTime() / 60_000) * 60_000;
  return { date, time, offset: formatOffset(Math.round((wall - minute) / 60_000)) };
}

const offsetPattern = /(Z|[+-]\d{2}:\d{2})$/;

// Google gives times in the calendar's zone; a booking is shown in the zone
// of its place, which the event names when it was created there.
export function eventTime(time: calendar_v3.Schema$EventDateTime | undefined, calendarZone?: string): IcsTime | undefined {
  if (!time) return undefined;
  if (time.date) return { date: time.date };
  const instant = time.dateTime;
  if (!instant) return undefined;
  const zone = time.timeZone ?? calendarZone;
  const local = zone ? localIn(zone, instant) : undefined;
  if (zone && local) return { ...local, zone };
  const offset = offsetPattern.exec(instant)?.[1];
  if (!offset || instant.length < 16) return undefined;
  return { date: instant.slice(0, 10), time: instant.slice(11, 16), offset: offset === "Z" ? "+00:00" : offset };
}

// Events that are never bookings: Calendar's own status blocks and birthdays.
const notBookings = new Set(["outOfOffice", "focusTime", "workingLocation", "birthday"]);

// Google gives an event made in Google Calendar this UID; others (invited,
// imported, subscribed) keep the UID they came with.
export const nativeUid = (eventId: string) => `${eventId}@google.com`;

// Event id → UID for the events whose UID is not derived from their id. A
// deleted event may come back with its id alone; these let it still find
// what it imported.
export function eventAliases(events: readonly calendar_v3.Schema$Event[], previous: Readonly<Record<string, string>> = {}): Record<string, string> {
  const listed = new Set(events.map((e) => e.id).filter(Boolean));
  // Kept while Google still lists the event, deleted or not.
  const aliases: Record<string, string> = Object.fromEntries(Object.entries(previous).filter(([id]) => listed.has(id)));
  for (const e of events) {
    if (e.id && e.iCalUID && e.iCalUID !== nativeUid(e.id)) aliases[e.id] = e.iCalUID;
  }
  return aliases;
}

export function toIcsEvent(
  event: calendar_v3.Schema$Event,
  calendarZone?: string,
  aliases: Readonly<Record<string, string>> = {},
): IcsEvent | undefined {
  const uid = event.iCalUID ?? (event.id ? (aliases[event.id] ?? nativeUid(event.id)) : undefined);
  if (!uid) return undefined;
  const recurring = Boolean(event.recurrence?.length || event.recurringEventId);
  const cancelled = event.status === "cancelled";
  const start = eventTime(event.start, calendarZone);
  // A deleted event may come back with nothing but its ids; that is enough
  // to find and remove what it imported.
  if (!start && !cancelled) return undefined;
  const end = eventTime(event.end, calendarZone);
  return {
    key: stableHash(uid),
    summary: event.summary ?? "",
    ...(event.location ? { location: event.location } : {}),
    ...(event.description ? { description: event.description } : {}),
    start: start ?? { date: "" },
    ...(end ? { end } : {}),
    ...(event.updated ? { stamp: event.updated } : {}),
    recurring,
    cancelled,
  };
}

// Whether the Gmail import reads this calendar account's own mailbox, where
// the emails behind its Gmail-made events are. Google addresses are
// case-insensitive.
export function sameAccount(gmailAddress: string | undefined, calendarAddress: string): boolean {
  return gmailAddress !== undefined && gmailAddress.toLowerCase() === calendarAddress.toLowerCase();
}

// A calendar's events as a calendar file would give them. The calendar's
// name stands in for the file's producer, so one named after TripIt is read
// as a travel calendar. Events Gmail added from emails are skipped when that
// same mailbox is imported: the email itself is already read.
export function toIcsCalendar(
  summary: string,
  events: readonly calendar_v3.Schema$Event[],
  options: { calendarZone?: string; mailboxImported: boolean; aliases?: Readonly<Record<string, string>> },
): IcsCalendar {
  return {
    prodId: `Google Calendar: ${summary}`,
    events: events.flatMap((e) => {
      if (e.eventType && notBookings.has(e.eventType)) return [];
      if (options.mailboxImported && e.eventType === "fromGmail") return [];
      const converted = toIcsEvent(e, options.calendarZone, options.aliases);
      return converted ? [converted] : [];
    }),
  };
}

export type CalendarIo = {
  events: (calendarId: string) => Promise<{ events: calendar_v3.Schema$Event[]; zone?: string }>;
  aliases: {
    load: (calendarId: string) => Promise<Record<string, string>>;
    save: (calendarId: string, aliases: Record<string, string>) => Promise<void>;
  };
  mailboxImported: boolean;
  deps: ImportDeps;
};

function accessWithdrawn(error: unknown): boolean {
  const data = (error as { response?: { data?: { error?: unknown } } } | undefined)?.response?.data;
  return data?.error === "invalid_grant" || /invalid_grant/.test((error as Error | undefined)?.message ?? "");
}

// Reads one chosen calendar and says how it went, for its owner to see. A
// failure is recorded, not thrown: the other calendars carry on.
export async function readCalendar(uid: string, choice: GoogleCalendarChoice, io: CalendarIo): Promise<GoogleCalendarChoice> {
  const at = io.deps.now();
  try {
    const { events, zone } = await io.events(choice.id);
    const previous = await io.aliases.load(choice.id);
    const aliases = eventAliases(events, previous);
    const calendar = toIcsCalendar(choice.summary, events, { mailboxImported: io.mailboxImported, aliases, ...(zone ? { calendarZone: zone } : {}) });
    const counts = await importCalendar(uid, calendar, io.deps, calendarMaxRead);
    if (JSON.stringify(aliases) !== JSON.stringify(previous)) await io.aliases.save(choice.id, aliases);
    io.deps.log("google_calendar_read", { uid, calendar: stableHash(choice.id), events: calendar.events.length, ...counts });
    const { lastError: _cleared, ...rest } = choice;
    return { ...rest, lastReadAt: at, lastResult: describeFeedResult(counts) };
  } catch (error) {
    // Calendar ids are email addresses; logs carry a hash.
    io.deps.log("google_calendar_failed", { uid, calendar: stableHash(choice.id), reason: (error as Error).message });
    const lastError = accessWithdrawn(error)
      ? "Google Calendar access was withdrawn; disconnect and connect it again."
      : "This calendar could not be read; it will be tried again tomorrow.";
    return { ...choice, lastReadAt: at, lastError };
  }
}

// Puts read results into the current list: the choice stays as it is now,
// in case the user changed it while the calendars were being read.
export function withResults(current: readonly GoogleCalendarChoice[], results: readonly GoogleCalendarChoice[]): GoogleCalendarChoice[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return current.map((c) => {
    const result = byId.get(c.id);
    return result ? { ...result, selected: c.selected, summary: c.summary } : c;
  });
}
