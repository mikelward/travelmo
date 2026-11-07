import { formatDate } from "./format";
import { compareInstants, splitInstant } from "./instant";
import type { ExtractedSegment } from "./schema";
import { localDate, nextEvent, type UpcomingEvent } from "./trips";

// What a trip card says about the moment: how soon the next thing is, the
// stay under way, and whether a flight's online check-in is open. All of it
// is read from the segments' own instants, in each place's offset.

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const offsetMinutes = (offset: string): number => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) throw new Error(`Offset must look like +01:00, got ${offset}`);
  return (Number(m[2]) * 60 + Number(m[3])) * (m[1] === "-" ? -1 : 1);
};

// The calendar date it is at `now` in the offset an instant carries.
export function localDateAt(now: string, offset: string): string {
  return new Date(Date.parse(now) + offsetMinutes(offset) * minute).toISOString().slice(0, 10);
}

// The same moment some milliseconds on, written in the instant's own offset.
export function shiftInstant(instant: string, ms: number): string {
  const { offset } = splitInstant(instant);
  const local = new Date(Date.parse(instant) + ms + offsetMinutes(offset) * minute).toISOString().slice(0, 16);
  return `${local}:00${offset}`;
}

// How far ahead an instant is, as a person would say it: minutes within the
// hour, hours within the day, then the day itself up to a week out, in the
// place's own calendar. Nothing for a moment past or more than a week away.
export function relativeTime(now: string, at: string): string | undefined {
  const ms = Date.parse(at) - Date.parse(now);
  if (ms < 0 || ms > 7 * day) return undefined;
  // Whole minutes first, so 7 h 59 min 40 s reads as 8 h, never 7 h 60 min.
  const totalMinutes = Math.round(ms / minute);
  if (totalMinutes < 60) return `in ${Math.max(1, totalMinutes)} min`;
  if (totalMinutes < 24 * 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `in ${hours} h ${minutes} min` : `in ${hours} h`;
  }
  const { offset } = splitInstant(at);
  const today = localDateAt(now, offset);
  const date = localDate(at);
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / day);
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  return `on ${formatDate(date, "en-GB", { day: undefined, month: undefined })}`;
}

// Most airlines open online check-in a day before departure and close it
// at the gate; the exact window is theirs, so the card says "usually".
export const checkInOpensHoursBefore = 24;

export type CheckIn<S extends ExtractedSegment = ExtractedSegment> = { segment: S; opensAt: string; open: boolean };

// The next flight's online check-in, from a day before its window opens
// until it departs; nothing once it has gone or while it is further off.
export function flightCheckIn<S extends ExtractedSegment>(segments: readonly S[], now: string): CheckIn<S> | undefined {
  let next: S | undefined;
  for (const segment of segments) {
    if (segment.type !== "flight" || compareInstants(segment.start, now) < 0) continue;
    if (!next || compareInstants(segment.start, next.start) < 0) next = segment;
  }
  if (!next) return undefined;
  const opensAt = shiftInstant(next.start, -checkInOpensHoursBefore * hour);
  if (Date.parse(now) < Date.parse(opensAt) - day) return undefined;
  return { segment: next, opensAt, open: compareInstants(now, opensAt) >= 0 };
}

// The stay the traveler is in the middle of, if any: checked in, not yet out.
export function currentStay<S extends ExtractedSegment>(segments: readonly S[], now: string): S | undefined {
  return segments.find((s) => s.type === "lodging" && s.end && compareInstants(s.start, now) <= 0 && compareInstants(now, s.end) < 0);
}

export type TripStatus<S extends ExtractedSegment = ExtractedSegment> = {
  next?: UpcomingEvent<S>;
  stay?: S;
  checkIn?: CheckIn<S>;
};

export function tripStatus<S extends ExtractedSegment>(segments: readonly S[], now: string): TripStatus<S> {
  const next = nextEvent(segments, now);
  const stay = currentStay(segments, now);
  const checkIn = flightCheckIn(segments, now);
  return { ...(next ? { next } : {}), ...(stay ? { stay } : {}), ...(checkIn ? { checkIn } : {}) };
}
