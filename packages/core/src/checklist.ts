import { formatDate, formatDateRange } from "./format";
import { countryCode, effectiveHomes, homeAt, homeTimeline, sameCity } from "./home";
import { placeCountry, tripPlaces, type PlaceLookup } from "./reports";
import { shiftDate } from "./residence";
import type { ReminderMail, ReminderNotification } from "./reminders";
import { maxDoneReminders, type ExtractedSegment, type HomeCorrection, type Lead, type OneOffReminder, type StandingReminder, type Trip } from "./schema";
import { daysBetween, displayBounds, liveSegments } from "./trips";

// The traveler's own reminders before a trip (SPEC "Before you go"): things
// to do before every international trip ("Apply for a visa", 30 days
// before), kept in Settings, and one-offs added to a single trip. The trip
// page lists them as a checklist with due dates; the parser's daily job
// sends each due one that is not ticked off, once. Mirrored in the Android
// app's core (Checklist.kt).

// ---- When ----

// The day a reminder is due: the trip's first day less the lead time, or
// the date a one-off names.
export function reminderDue(start: string, reminder: Lead | { date: string }): string {
  if ("date" in reminder) return reminder.date;
  const { amount, unit } = reminder;
  if (unit === "months") return shiftDate(start, { months: -amount });
  return shiftDate(start, { days: -(unit === "weeks" ? 7 * amount : amount) });
}

// "30 days before", "1 week before", "2 months before", "The day it starts".
export function leadText({ amount, unit }: Lead): string {
  if (amount === 0) return "The day it starts";
  const one = unit.slice(0, -1);
  return `${amount} ${amount === 1 ? one : unit} before`;
}

// ---- International ----

type Booking = ExtractedSegment;

// The country of home on a date, as a code: home from this trip's own round
// trip, unless the person corrected it on Profile (effectiveHomes), as the
// trip page's ride suggestions work it out. Where the home has no country,
// the country of a place of this trip in that town (an airport's, from the
// table). Undefined when nothing says.
export function homeCountry(
  segments: readonly Booking[],
  corrections: readonly HomeCorrection[],
  date: string,
  lookup?: PlaceLookup,
): string | undefined {
  const home = homeAt(effectiveHomes(homeTimeline(liveSegments(segments)), corrections), date);
  if (!home) return undefined;
  if (home.country) return countryCode(home.country);
  for (const s of liveSegments(segments)) {
    for (const place of [s.origin, s.destination]) {
      const town = place?.city ?? place?.name;
      if (!place || !town || !sameCity(town, home.city)) continue;
      const country = placeCountry(place, s.type, lookup);
      if (country) return countryCode(country);
    }
  }
  return undefined;
}

// Whether a trip goes abroad: some booking is in a country other than home
// on the day it starts. Without a known home country or any booking with a
// country, it is not.
export function isInternational(
  trip: Pick<Trip, "start" | "end" | "liveStart" | "liveEnd">,
  segments: readonly Booking[],
  corrections: readonly HomeCorrection[],
  lookup?: PlaceLookup,
): boolean {
  const home = homeCountry(segments, corrections, displayBounds(trip).start, lookup);
  if (!home) return false;
  return [...tripPlaces(segments, lookup).countries].some((c) => countryCode(c) !== home);
}

// ---- The checklist ----

export type ChecklistEntry = {
  id: string;
  text: string;
  due: string;
  done: boolean;
  // Added to this trip alone, so it can be removed from it.
  oneOff: boolean;
};

// A trip's reminders: the standing ones when it is international, and its
// one-offs whatever it is; soonest due first.
export function tripChecklist(
  trip: Pick<Trip, "start" | "end" | "liveStart" | "liveEnd">,
  standing: readonly StandingReminder[],
  mine: { done: readonly string[]; added: readonly OneOffReminder[] },
  international: boolean,
): ChecklistEntry[] {
  const start = displayBounds(trip).start;
  const done = new Set(mine.done);
  const entries = [
    ...(international ? standing.map((r) => ({ r, oneOff: false })) : []),
    ...mine.added.map((r) => ({ r, oneOff: true })),
  ];
  const seen = new Set<string>();
  return entries
    .filter(({ r }) => !seen.has(r.id) && Boolean(seen.add(r.id)))
    .map(({ r, oneOff }) => ({ id: r.id, text: r.text, due: reminderDue(start, r), done: done.has(r.id), oneOff }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.text.localeCompare(b.text));
}

// Whether a trip still has "Before you go": until the end of its first day.
export function checklistShown(trip: Pick<Trip, "start" | "end" | "liveStart" | "liveEnd">, today: string): boolean {
  return displayBounds(trip).start >= today;
}

// The entries to send today: not ticked off, due by today, for a trip that
// has not started yet (a trip booked after a reminder's day gets it at once).
export function dueEntries(trip: Pick<Trip, "start" | "end" | "liveStart" | "liveEnd">, entries: readonly ChecklistEntry[], today: string): ChecklistEntry[] {
  if (!checklistShown(trip, today)) return [];
  return entries.filter((e) => !e.done && e.due <= today);
}

// "By Thu 12 Nov", or "Today" on the day.
export function dueText(due: string, today: string): string {
  return due === today ? "Today" : `By ${formatDate(due)}`;
}

// ---- Editing ----

// Each reminder is a document in a numbered slot (standing ones s0 to s19,
// a trip's one-offs a0 to a9), so the rules can bound how many there are.
export const standingSlotPrefix = "s";
export const oneOffSlotPrefix = "a";

// The first slot not taken, or undefined when all are.
export function freeSlot(taken: readonly string[], prefix: string, max: number): string | undefined {
  for (let i = 0; i < max; i++) if (!taken.includes(`${prefix}${i}`)) return `${prefix}${i}`;
  return undefined;
}

// Slots in order: s2 before s10.
export const bySlot = (a: { slot: string }, b: { slot: string }) => Number(a.slot.slice(1)) - Number(b.slot.slice(1));

// The ticked list with one reminder ticked or not, newest kept when full.
export function withDone(done: readonly string[], id: string, on: boolean): string[] {
  const rest = done.filter((d) => d !== id);
  return on ? [...rest, id].slice(-maxDoneReminders) : rest;
}

// ---- Messages ----

// "Lisbon trip", or the title alone when it already says trip.
const tripName = (title: string) => {
  const line = title.replace(/\s+/g, " ").trim();
  return /\btrip\b/i.test(line) ? line : `${line} trip`;
};

// "in 30 days", "tomorrow", "today".
function startsIn(trip: Pick<Trip, "start" | "end" | "liveStart" | "liveEnd">, today: string): string {
  const days = daysBetween(today, displayBounds(trip).start);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

type Sent = { trip: Pick<Trip, "id" | "title" | "start" | "end" | "liveStart" | "liveEnd">; entry: Pick<ChecklistEntry, "id" | "text"> };

// A notification for one reminder: the reminder, then the trip and when it
// starts; tapping opens the trip.
export function checklistNotification({ trip, entry }: Sent, options: { origin: string; today: string }): ReminderNotification {
  const { start, end } = displayBounds(trip);
  return {
    title: entry.text,
    body: `${tripName(trip.title)} ${startsIn(trip, options.today)}, ${formatDateRange(start, end)}.`,
    url: `${options.origin}/trips/${trip.id}`,
    tag: `checklist-${trip.id}-${entry.id}`,
  };
}

// An email for one reminder: "Apply for a visa — Lisbon trip in 30 days".
export function checklistEmail(sent: Sent, options: { origin: string; today: string }): ReminderMail {
  const { title, body, url } = checklistNotification(sent, options);
  const subject = `${title} — ${tripName(sent.trip.title)} ${startsIn(sent.trip, options.today)}`;
  const text = [
    `${title}`,
    body,
    `Tick it off on the trip's page: ${url}`,
    `You get these because reminders by email are on in your Travelmo settings: ${options.origin}/settings`,
  ].join("\n\n");
  return { subject, text };
}
