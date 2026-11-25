import { zoneOffset, type ExtractedBooking, type ExtractedSegment, type Place } from "@travelmo/core";
import { airportZone } from "@travelmo/core/airports";

// Dates the model gave a year the email doesn't show. An itinerary that
// says "Thu 2 Jan" in an email sent in October means the coming January;
// the model, told to go by the email's date, sometimes puts it in the past
// year instead, and a trip then runs from one January to the next,
// swallowing everything between (a Virgin Australia booking did).
//
// A booking is for the future: one wholly over before the email was sent,
// its dates in a year the email's text never mentions, moves on a year. A date whose year the
// email gives is left as the model read it (a receipt for a stay that is
// over says its year), as is one in an email of unknown date, and every
// date in one whose PDFs the model read: their years can't be seen here.

// How long before an email's date a booking may start and still be the
// one it means (a confirmation sent the evening of the day after).
const slackMs = 2 * 86_400_000;

export function withInferredYears(booking: ExtractedBooking, text: string, sent: string | undefined): ExtractedBooking {
  const sentMs = sent ? Date.parse(sent) : NaN;
  if (Number.isNaN(sentMs)) return booking;
  const shown = shownYears(text);
  // Any of it not over when the email was sent (a stay paid for mid-stay,
  // the flight home of a trip under way): the booking's dates are anchored,
  // and moving its past legs would put them after the ones still to come.
  if (booking.segments.some((s) => Date.parse(s.end ?? s.start) >= sentMs - slackMs)) return booking;
  // A year shown for any part ("Outbound 30 Dec; return 2 Jan 2025") dates
  // the whole booking.
  if (booking.segments.some((s) => shown.has(s.start.slice(0, 4)) || (s.end && shown.has(s.end.slice(0, 4))))) return booking;
  // Every part moves or none, so the booking keeps its order: not when a
  // date has no day a year on (29 February), or the move would still leave
  // it before the email.
  const segments: ExtractedSegment[] = [];
  for (const segment of booking.segments) {
    // Only a flight's places are airports.
    const flight = segment.type === "flight";
    const start = nextYear(segment.start, flight ? segment.origin : undefined);
    const end = segment.end ? nextYear(segment.end, flight ? segment.destination : undefined) : undefined;
    if (!start || (segment.end && !end) || Date.parse(start) < sentMs - slackMs) return booking;
    segments.push({ ...segment, start, ...(end ? { end } : {}) });
  }
  return segments.length > 0 ? { ...booking, segments } : booking;
}

// The years a text gives: written out (2025), in a date in numbers
// ("02/01/25", "2.1.25") or after an apostrophe ("Jan '25").
function shownYears(text: string): Set<string> {
  const years = new Set(text.match(/\b(19|20)\d{2}\b/g) ?? []);
  for (const m of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{2})\b|[\u2018\u2019'](\d{2})\b/g)) years.add(`20${m[1] ?? m[2]}`);
  return years;
}

// The same wall time a year on, or undefined for 29 February (or a time
// it can't read). Its offset is
// the one `place`'s airport keeps that day (London is +01:00 on 25 October
// 2025 and +00:00 on 25 October 2026); with no airport zone known, the
// offset stays as read.
function nextYear(instant: string, place: Place | undefined): string | undefined {
  // The wall time and its offset, whether or not it gives seconds.
  const parts = instant.match(/^(\d{4})(-\d{2}-\d{2}T[\d:.]+)(Z|[+-]\d{2}:?\d{2})?$/);
  if (!parts || instant.slice(5, 10) === "02-29") return undefined;
  const wall = `${Number(parts[1]) + 1}${parts[2]}`;
  const offset = parts[3] ?? "";
  // The airport's zone, if it agrees with the offset as read: a code that
  // isn't that airport's (a station's BHM is Birmingham, not Alabama) keeps
  // the offset.
  const zone = place?.code ? airportZone(place.code) : undefined;
  const was = `${parts[1]}${parts[2]}`;
  const fits = zone && zoneOffset(zone, was.slice(0, 10), was.slice(11, 16)) === offset.replace("Z", "+00:00");
  return `${wall}${fits ? zoneOffset(zone, wall.slice(0, 10), wall.slice(11, 16)) : offset}`;
}
