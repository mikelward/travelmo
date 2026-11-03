import type { ExtractedSegment, Place, Trip } from "./schema";

// The user's trips as an iCalendar (RFC 5545) feed that Google or Apple
// Calendar can subscribe to: each trip an all-day event across its dates,
// each booking a timed one.

// Every event's UID ends with this, so an import that meets Travelmo's own
// feed (a subscribed copy in Google Calendar, say) skips it rather than
// reading its trips back in as new bookings.
export const exportUidSuffix = "@export.travelmo";
export const isExportedUid = (uid: string | undefined) => !!uid && uid.endsWith(exportUidSuffix);

export const exportCalendarName = "Travelmo";

// TEXT values escape backslash, semicolon, comma and newlines.
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const encoder = new TextEncoder();

// Lines longer than 75 octets are folded: a line break and a space, never
// inside a UTF-8 sequence.
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (size + n > limit) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

// An instant with an offset as UTC: every calendar app reads it the same
// way, and shows it in the viewer's zone.
function utc(instant: string): string {
  return new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const dateValue = (date: string) => date.replace(/-/g, "");

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function placeText(place: Place | undefined): string | undefined {
  if (!place) return undefined;
  const name = place.code && !place.name.includes(place.code) ? `${place.name} (${place.code})` : place.name;
  return place.city && !name.includes(place.city) ? `${name}, ${place.city}` : name;
}

function location(segment: ExtractedSegment): string | undefined {
  const from = placeText(segment.origin);
  const to = placeText(segment.destination);
  if (from && to && from !== to) return `${from} → ${to}`;
  return to ?? from;
}

function description(segment: ExtractedSegment, url: string): string {
  return [
    segment.provider && `Provider: ${segment.provider}`,
    segment.confirmation && `Confirmation: ${segment.confirmation}`,
    segment.notes,
    url,
  ]
    .filter(Boolean)
    .join("\n");
}

export type ExportTrip = {
  trip: Pick<Trip, "id" | "title" | "start" | "end" | "updatedAt">;
  segments: readonly (ExtractedSegment & { id: string; updatedAt?: string })[];
};

export function exportCalendar(items: readonly ExportTrip[], options: { stamp: string; tripUrl: (tripId: string) => string }): string {
  const stamp = utc(options.stamp);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Travelmo//Trips//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${exportCalendarName}`,
    // Asks subscribing apps to refresh a few times a day; most choose their own.
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  const event = (fields: string[]) => lines.push("BEGIN:VEVENT", ...fields, "END:VEVENT");
  const sorted = [...items].sort((a, b) => a.trip.start.localeCompare(b.trip.start) || a.trip.id.localeCompare(b.trip.id));
  for (const { trip, segments } of sorted) {
    const url = options.tripUrl(trip.id);
    event([
      `UID:trip-${trip.id}${exportUidSuffix}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateValue(trip.start)}`,
      // All-day ends are exclusive.
      `DTEND;VALUE=DATE:${dateValue(nextDay(trip.end))}`,
      `SUMMARY:${escapeText(trip.title)}`,
      `URL:${url}`,
      "TRANSP:TRANSPARENT",
    ]);
    for (const s of [...segments].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))) {
      const where = location(s);
      // A stay is free time, a journey busy.
      event([
        `UID:segment-${trip.id}-${s.id}${exportUidSuffix}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${utc(s.start)}`,
        // RFC 5545 wants an end after the start; with none, the event is a
        // moment.
        ...(s.end && new Date(s.end) > new Date(s.start) ? [`DTEND:${utc(s.end)}`] : []),
        `SUMMARY:${escapeText(s.title)}`,
        ...(where ? [`LOCATION:${escapeText(where)}`] : []),
        `DESCRIPTION:${escapeText(description(s, url))}`,
        `URL:${url}`,
        `TRANSP:${s.type === "lodging" || s.type === "car_rental" ? "TRANSPARENT" : "OPAQUE"}`,
      ]);
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
