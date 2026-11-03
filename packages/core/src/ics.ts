import { isExportedUid } from "./calendarExport";
import { stableHash } from "./hash";
import { isCalendarDate } from "./instant";
import { formatOffset, zoneOffset } from "./zone";

// Reads iCalendar (RFC 5545) files: a TripIt per-trip export, a calendar
// app's export, or a subscribed feed. Calendars carry text, not structure,
// so an event becomes the text the extraction model reads, with its times
// resolved to instants wherever the file says which zone they are in.

export type IcsTime = {
  date: string;
  // Absent for an all-day value.
  time?: string;
  // The UTC offset in force, when the file names a zone or UTC; a floating
  // time has none and the model infers it from the place, as for an email.
  offset?: string;
  zone?: string;
  // A zone the file defines itself (VTIMEZONE) that could not be resolved
  // to one offset: its name and offsets, passed on to the model.
  zoneNote?: string;
};

// A VTIMEZONE: its own TZID, the IANA name some apps add
// (X-LIC-LOCATION), and the offsets its rules switch between.
export type IcsZone = { iana?: string; offsets: string[] };

export type IcsEvent = {
  // Stable per event: derived from its UID, or from its summary and start
  // when it has none. Safe as a Firestore document id.
  key: string;
  summary: string;
  location?: string;
  description?: string;
  start: IcsTime;
  end?: IcsTime;
  stamp?: string;
  // Repeating events and their overrides are not bookings.
  recurring: boolean;
  cancelled: boolean;
  // One of Travelmo's own exported events, met again through a calendar.
  exported?: boolean;
};

export type IcsCalendar = { prodId?: string; events: IcsEvent[] };

export class NotACalendar extends Error {}

type Property = { name: string; params: Record<string, string>; value: string };

function parseLine(line: string): Property | undefined {
  // The value starts at the first colon outside a quoted parameter value.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return undefined;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1) };
}

export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

const dateTimePattern = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

// Calendar apps write TZIDs like "/mozilla.org/20070129_1/Europe/London";
// the IANA name is the tail.
function ianaZone(tzid: string): string | undefined {
  const parts = tzid.split("/").filter(Boolean);
  for (let n = Math.min(3, parts.length); n >= 1; n--) {
    const candidate = parts.slice(-n).join("/");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate });
      return candidate;
    } catch {
      // Not a zone this runtime knows; try a shorter tail.
    }
  }
  return undefined;
}

const normalizeOffset = (value: string) => {
  const m = /^([+-])(\d{2}):?(\d{2})/.exec(value.trim());
  return m ? `${m[1]}${m[2]}:${m[3]}` : undefined;
};

export function parseIcsTime(property: Property, zones: ReadonlyMap<string, IcsZone> = new Map()): IcsTime | undefined {
  const match = dateTimePattern.exec(property.value.trim());
  if (!match) return undefined;
  const [, y, mo, d, h, mi, , utc] = match;
  const date = `${y}-${mo}-${d}`;
  // Out-of-range parts make no time at all; the event is then left out.
  if (!isCalendarDate(date)) return undefined;
  if (h === undefined || property.params.VALUE === "DATE") return { date };
  if (Number(h) > 23 || Number(mi) > 59) return undefined;
  const time = `${h}:${mi}`;
  if (utc) return { date, time, offset: "+00:00", zone: "UTC" };
  const tzid = property.params.TZID;
  const defined = tzid ? zones.get(tzid) : undefined;
  const zone = (defined?.iana ? ianaZone(defined.iana) : undefined) ?? (tzid ? ianaZone(tzid) : undefined);
  if (zone) return { date, time, offset: zoneOffset(zone, date, time), zone };
  if (!tzid) return { date, time };
  // A zone the file defines but no runtime knows: one offset all year is
  // that offset; several (summer and winter) are left to the model, named.
  const offsets = [...new Set(defined?.offsets ?? [])];
  const valid = (o: string) => Number(o.slice(4, 6)) < 60 && Math.abs(Number(o.slice(1, 3)) * 60 + Number(o.slice(4, 6))) <= 14 * 60;
  if (offsets.length === 1 && valid(offsets[0]!)) return { date, time, offset: offsets[0]! };
  return { date, time, zoneNote: offsets.length ? `${tzid}, UTC ${offsets.join(" or ")}` : tzid };
}

export function parseIcs(text: string): IcsCalendar {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  if (!lines.some((l) => l.trim().toUpperCase() === "BEGIN:VCALENDAR")) {
    throw new NotACalendar("This file is not a calendar: it has no BEGIN:VCALENDAR.");
  }
  let prodId: string | undefined;
  const events: Property[][] = [];
  const zones = new Map<string, IcsZone>();
  let zone: { tzid?: string; iana?: string; offsets: string[] } | undefined;
  // Components nested in an event (alarms) have properties of their own,
  // which must not be read as the event's.
  let depth = 0;
  let current: Property[] | undefined;
  for (const raw of lines) {
    const property = parseLine(raw.trimEnd());
    if (!property) continue;
    if (!current && zone) {
      if (property.name === "END" && property.value.toUpperCase() === "VTIMEZONE") {
        if (zone.tzid) zones.set(zone.tzid, { ...(zone.iana ? { iana: zone.iana } : {}), offsets: zone.offsets });
        zone = undefined;
      } else if (property.name === "TZID") zone.tzid = property.value;
      else if (property.name === "X-LIC-LOCATION") zone.iana = property.value;
      else if (property.name === "TZOFFSETTO") {
        const offset = normalizeOffset(property.value);
        if (offset) zone.offsets.push(offset);
      }
      continue;
    }
    if (property.name === "BEGIN") {
      if (property.value.toUpperCase() === "VTIMEZONE" && !current) {
        zone = { offsets: [] };
        continue;
      }
      if (property.value.toUpperCase() === "VEVENT" && !current) {
        current = [];
        depth = 0;
      } else if (current) depth++;
      continue;
    }
    if (property.name === "END") {
      if (current && depth > 0) depth--;
      else if (current && property.value.toUpperCase() === "VEVENT") {
        events.push(current);
        current = undefined;
      }
      continue;
    }
    if (current) {
      if (depth === 0) current.push(property);
    } else if (property.name === "PRODID") {
      prodId = property.value;
    }
  }
  // Times are resolved last: a VTIMEZONE may come after the events using it.
  const parsed = events.map((props) => toEvent(props, zones)).filter((e): e is IcsEvent => e !== undefined);
  return { ...(prodId ? { prodId } : {}), events: parsed };
}

const durationPattern = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

// The wall clock in `zone` at an absolute moment, with the offset in force.
function wallIn(zone: string, ms: number): IcsTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return { date, time, offset: formatOffset(Math.round((asUtc - ms) / 60_000)), zone };
}

const offsetMinutes = (offset: string) => (offset.startsWith("-") ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));

// The end of an event given as DTSTART plus DURATION (RFC 5545 3.3.6):
// weeks and days are calendar days on the wall clock, hours, minutes and
// seconds exact time, so an evening flight across a DST change ends at the
// right local hour. Nothing for a negative or unreadable duration.
export function endFromDuration(start: IcsTime, duration: string): IcsTime | undefined {
  const match = durationPattern.exec(duration.trim());
  if (!match || match[1] === "-") return undefined;
  const [, , w, d, h, mi, s] = match;
  const days = Number(w ?? 0) * 7 + Number(d ?? 0);
  const exactMs = ((Number(h ?? 0) * 60 + Number(mi ?? 0)) * 60 + Number(s ?? 0)) * 1000;
  const [y, mo, da] = start.date.split("-").map(Number);
  const [hh, mm] = (start.time ?? "00:00").split(":").map(Number);
  const afterDays = new Date(Date.UTC(y!, mo! - 1, da! + days, hh!, mm!));
  const date = afterDays.toISOString().slice(0, 10);
  if (!start.time) return { date };
  const time = afterDays.toISOString().slice(11, 16);
  if (!start.zone) {
    // A floating time, a fixed offset or an unresolved zone has no rules to
    // change offset by; plain arithmetic, keeping what the start had.
    const end = new Date(afterDays.getTime() + exactMs).toISOString();
    return {
      date: end.slice(0, 10),
      time: end.slice(11, 16),
      ...(start.offset ? { offset: start.offset } : {}),
      ...(start.zoneNote ? { zoneNote: start.zoneNote } : {}),
    };
  }
  const offset = start.zone === "UTC" ? "+00:00" : zoneOffset(start.zone, date, time);
  const absolute = afterDays.getTime() - offsetMinutes(offset) * 60_000 + exactMs;
  // Instants here have minute precision; seconds left over would skew the
  // offset worked out from the wall clock.
  return wallIn(start.zone, Math.floor(absolute / 60_000) * 60_000);
}

function toEvent(properties: Property[], zones: ReadonlyMap<string, IcsZone>): IcsEvent | undefined {
  const get = (name: string) => properties.find((p) => p.name === name);
  const textOf = (name: string) => {
    const p = get(name);
    const value = p ? unescapeText(p.value).trim() : "";
    return value || undefined;
  };
  const dtstart = get("DTSTART");
  const start = dtstart ? parseIcsTime(dtstart, zones) : undefined;
  if (!start) return undefined;
  const dtend = get("DTEND");
  const duration = get("DURATION")?.value;
  const end = dtend ? parseIcsTime(dtend, zones) : duration ? endFromDuration(start, duration) : undefined;
  const summary = textOf("SUMMARY") ?? "(no title)";
  const uid = textOf("UID");
  const location = textOf("LOCATION");
  const description = textOf("DESCRIPTION");
  const stamp = get("DTSTAMP")?.value;
  return {
    key: stableHash(uid ?? `${summary}|${dtstart!.value}`),
    summary,
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    start,
    ...(end ? { end } : {}),
    ...(stamp ? { stamp } : {}),
    recurring: properties.some((p) => p.name === "RRULE" || p.name === "RDATE" || p.name === "RECURRENCE-ID"),
    cancelled: textOf("STATUS")?.toUpperCase() === "CANCELLED",
    ...(isExportedUid(uid) ? { exported: true } : {}),
  };
}

function describeTime(t: IcsTime): string {
  if (!t.time) return `${t.date} (all day)`;
  if (!t.offset && t.zoneNote) return `${t.date} ${t.time} (local time in the calendar's zone ${t.zoneNote})`;
  if (!t.offset) return `${t.date} ${t.time} (local time; zone not given)`;
  return `${t.date}T${t.time}:00${t.offset}${t.zone && t.zone !== "UTC" ? ` (${t.zone})` : ""}`;
}

// What the extraction model reads for an event, in place of an email body.
export function icsEventText(event: IcsEvent): string {
  return [
    "Calendar event",
    `Title: ${event.summary}`,
    `Starts: ${describeTime(event.start)}`,
    ...(event.end ? [`Ends: ${describeTime(event.end)}`] : []),
    ...(event.location ? [`Location: ${event.location}`] : []),
    ...(event.description ? ["", event.description] : []),
  ].join("\n");
}

// Calendars whose every event is a reservation: nothing from them needs a
// booking signal before it is read.
export function isTravelCalendar(calendar: IcsCalendar): boolean {
  return /tripit/i.test(calendar.prodId ?? "");
}

export type IcsSummary = { events: number; importable: number; recurring: number; cancelled: number; exported: number };

export function summarizeIcs(calendar: IcsCalendar): IcsSummary {
  const exported = calendar.events.filter((e) => e.exported).length;
  const recurring = calendar.events.filter((e) => e.recurring && !e.exported).length;
  const cancelled = calendar.events.filter((e) => e.cancelled && !e.recurring && !e.exported).length;
  return { events: calendar.events.length, importable: calendar.events.length - exported - recurring - cancelled, recurring, cancelled, exported };
}
