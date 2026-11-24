import { airlineCheckIn } from "./airlines";
import { flightDesignator } from "./flightStatus";
import { formatDate, localTime } from "./format";
import type { ReminderMail, ReminderNotification } from "./reminders";
import type { ExtractedSegment } from "./schema";
import { checkInOpensAt, shiftInstant } from "./status";
import { isCancelled, localDate } from "./trips";

// A reminder when a flight's online check-in opens: one per booking and
// person, by the channels they turned reminders on for. The parser sends
// it from the every-minute flight-status job; this is when and what.

const minute = 60_000;
const hour = 60 * minute;

// However early an airline opens check-in (easyJet a month ahead), the
// reminder waits until two days before departure, when it is worth acting
// on; and none goes in the last hour, when online check-in has usually
// closed and the traveler is at the airport.
export const checkInReminderMaxLeadMs = 48 * hour;
export const checkInReminderCutoffMs = hour;

type Flight = Pick<ExtractedSegment, "type" | "title" | "start"> & { cancelledAt?: string | undefined };

// When the reminder is due: when check-in opens, or two days before
// departure for an airline that opens earlier. An instant in the
// departure's own offset.
export function checkInReminderAt(segment: Flight): string {
  const opens = checkInOpensAt(segment);
  const earliest = shiftInstant(segment.start, -checkInReminderMaxLeadMs);
  return Date.parse(opens) >= Date.parse(earliest) ? opens : earliest;
}

// Whether a flight's reminder should go now: check-in has opened (or the
// two-day mark passed) and departure is more than an hour off. A flight
// booked after its check-in opened gets its reminder at once, while that
// still holds; one already gone, or about to, gets none, and so does a
// cancelled one.
export function checkInReminderDue(segment: Flight, now: string): boolean {
  if (segment.type !== "flight" || isCancelled(segment)) return false;
  const at = Date.parse(now);
  return at >= Date.parse(checkInReminderAt(segment)) && at < Date.parse(segment.start) - checkInReminderCutoffMs;
}

// Local wall-clock time is UTC moved by at most 12 hours back or 14 on.
const localBound = (ms: number) => new Date(ms).toISOString().slice(0, 16);

// The flight bookings whose reminder could be due now, as bounds on their
// local start ("2026-12-12T09:00"): leaving from an hour to two days from
// now, widened by every offset a place can have.
export function checkInReminderWindow(now: string): { fromLocal: string; toLocal: string } {
  const at = Date.parse(now);
  return { fromLocal: localBound(at + checkInReminderCutoffMs - 12 * hour), toLocal: localBound(at + checkInReminderMaxLeadMs + 14 * hour) };
}

// "QF 1 to London", or "your flight to London" without a flight number.
function flightName(segment: Pick<ExtractedSegment, "type" | "title" | "destination">): string {
  const designator = flightDesignator(segment);
  const name = designator ? `${designator.slice(0, 2)} ${designator.slice(2)}` : "your flight";
  const to = segment.destination?.city ?? segment.destination?.name;
  return to ? `${name} to ${to}` : name;
}

type Booking = Pick<ExtractedSegment, "type" | "title" | "start" | "destination" | "confirmation"> & { id: string; tripId: string };

// The notification: what to check in for, that it is open, when the
// flight leaves (as written, in its own offset), and the booking
// reference. A tap opens the airline's site where the table knows it,
// otherwise the trip. Tagged per booking, so nothing else replaces it, and
// naming the booking, for its "I've checked in" action.
export function checkInNotification(segment: Booking, options: { origin: string }): ReminderNotification {
  const lines = [
    "Online check-in is open.",
    `Departs ${formatDate(localDate(segment.start))} ${localTime(segment.start)}.`,
    ...(segment.confirmation ? [`Booking reference ${segment.confirmation}.`] : []),
  ];
  return {
    title: `Check in for ${flightName(segment)}`,
    body: lines.join("\n"),
    url: airlineCheckIn(segment)?.site ?? tripUrl(segment, options.origin),
    tag: `checkin-${segment.tripId}-${segment.id}`,
    checkedIn: { tripId: segment.tripId, segmentId: segment.id },
  };
}

const tripUrl = (segment: Booking, origin: string) => `${origin}/trips/${segment.tripId}`;

// The same as one plain-text email, with the airline's site where known
// and the trip.
export function checkInEmail(segment: Booking, options: { origin: string }): ReminderMail {
  const { title, body } = checkInNotification(segment, options);
  const site = airlineCheckIn(segment)?.site;
  const text = [
    body,
    [...(site ? [`Check in: ${site}`] : []), `Your trip: ${tripUrl(segment, options.origin)}`].join("\n"),
    `You get these because reminders by email are on in your Travelmo settings: ${options.origin}/settings`,
  ].join("\n\n");
  return { subject: title, text };
}
