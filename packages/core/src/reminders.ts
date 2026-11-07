import { countryName } from "./countries";
import { onTrip, tripWarnings, warningText, type PersonDocuments } from "./documents";
import { formatDate, formatDateRange } from "./format";
import type { PlaceLookup } from "./reports";
import { tripPlaces } from "./reports";
import type { ExtractedSegment, Trip } from "./schema";
import { daysBetween } from "./trips";
import { entryLabel, needsAction, travelerEntry, type EntryNeed, type VisaTable } from "./visas";

// Reminders before a trip: the document warnings and the entry
// requirements the app shows, worded the same, gathered for the trips
// starting within a month, each line sent once. The parser mails them; this
// is what to say and when.

export const reminderWindowDays = 30;

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Trips under way or starting within the window, soonest first.
export function dueForReminders(trips: readonly Trip[], today: string): Trip[] {
  const horizon = addDays(today, reminderWindowDays);
  return trips.filter((t) => !t.deleting && t.end >= today && t.start <= horizon).sort((a, b) => a.start.localeCompare(b.start));
}

// One entry requirement as a line: the country, the rule, whose passport.
export function entryLine(person: Pick<PersonDocuments, "own" | "email">, need: EntryNeed): string {
  const whose = person.own ? "your" : `${person.email ?? "a fellow traveler"}’s`;
  const base = `${countryName(need.country)}: ${entryLabel(need.best.rule).toLowerCase()} with ${whose} ${countryName(need.best.passport)} passport`;
  const holder = person.own ? "you hold" : `${person.email ?? "they"} holds`;
  return need.visa ? `${base} · ${holder} a visa until ${formatDate(need.visa.expires, "en-GB", { weekday: undefined, year: "numeric" })}` : base;
}

export type ReminderLookups = { airportPlace?: PlaceLookup; visaTable?: VisaTable };

// Everything worth a reminder for one trip: every document warning, and the
// entry requirements that need action and no held visa covers.
export function reminderLines(
  people: readonly PersonDocuments[],
  trip: Trip,
  segments: readonly ExtractedSegment[],
  today: string,
  lookups: ReminderLookups,
): string[] {
  const lines = tripWarnings(people, trip, segments, today, lookups.airportPlace).map((w) => warningText(w, today));
  if (lookups.visaTable) {
    const { countries } = tripPlaces(segments, lookups.airportPlace);
    for (const person of people.filter((p) => onTrip(p, trip))) {
      const { needs } = travelerEntry(lookups.visaTable, person.documents, countries, trip);
      for (const need of needs) if (needsAction(need.best.rule.kind) && !need.visa) lines.push(entryLine(person, need));
    }
  }
  return [...new Set(lines)];
}

// The lines not sent before, in order.
export const newLines = (lines: readonly string[], sent: readonly string[]): string[] => lines.filter((l) => !sent.includes(l));

export type TripReminder = { trip: Trip; lines: string[] };

export type ReminderMail = { subject: string; text: string };

// One plain-text email for everything new across a person's coming trips.
export function reminderEmail(reminders: readonly TripReminder[], options: { origin: string; today: string }): ReminderMail {
  const first = reminders[0]!;
  const subject = reminders.length === 1 ? `Before your trip to ${first.trip.title}` : `Before your next ${reminders.length} trips`;
  const sections = reminders.map(({ trip, lines }) => {
    const days = daysBetween(options.today, trip.start);
    const when = days <= 0 ? "under way" : days === 1 ? "starts tomorrow" : `starts in ${days} days`;
    return [`${trip.title} (${formatDateRange(trip.start, trip.end)}), ${when}:`, ...lines.map((l) => `  - ${l}`), `  ${options.origin}/trips/${trip.id}`].join("\n");
  });
  const text = [
    ...sections,
    "",
    `You get these because reminders by email are on in your Travelmo settings: ${options.origin}/settings`,
  ].join("\n\n");
  return { subject, text };
}
