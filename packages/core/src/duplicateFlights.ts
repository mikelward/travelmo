import { formatDate } from "./format";
import type { ExtractedSegment } from "./schema";
import { flightNumber } from "./airlines";
import { flightDesignator } from "./flightStatus";
import { daysBetween, liveSegments, localDate } from "./trips";

// One flight booked for two days near each other (SPEC "Flights booked
// twice"): a booking cancelled and made again with another agent or the
// airline itself, whose cancellation never reached the mailbox, leaves the
// old one standing. The trip asks which wasn't taken.

// How far apart the two days may be.
export const duplicateFlightDays = 7;

export type DuplicateFlight<S> = { first: S; second: S };

// The pair as the trip stores the owner's word that both were taken.
export const duplicateFlightKey = (a: { id: string }, b: { id: string }) => [a.id, b.id].sort().join("|");

const code = (place?: { code?: string | undefined }) => place?.code?.trim().toUpperCase();

// The flights a trip seems to have booked twice, in order: still booked,
// the same flight number between the same airports, on different days
// within duplicateFlightDays, and not a pair the owner said both happened
// (`bothTaken`, by duplicateFlightKey). Each flight is in one pair at most.
export function duplicateFlights<S extends ExtractedSegment & { id: string }>(segments: readonly S[], bothTaken: readonly string[] = []): DuplicateFlight<S>[] {
  const flights = liveSegments(segments)
    .filter((s) => s.type === "flight" && code(s.origin) && code(s.destination))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const taken = new Set(bothTaken);
  const paired = new Set<string>();
  const out: DuplicateFlight<S>[] = [];
  for (let i = 0; i < flights.length; i++) {
    for (let j = i + 1; j < flights.length; j++) {
      const [first, second] = [flights[i]!, flights[j]!];
      if (paired.has(first.id) || paired.has(second.id)) continue;
      const [a, b] = [localDate(first.start), localDate(second.start)];
      if (a === b || daysBetween(a, b) > duplicateFlightDays) continue;
      if (code(first.origin) !== code(second.origin) || code(first.destination) !== code(second.destination)) continue;
      const number = flightDesignator(first);
      if (!number || number !== flightDesignator(second)) continue;
      if (taken.has(duplicateFlightKey(first, second))) continue;
      paired.add(first.id);
      paired.add(second.id);
      out.push({ first, second });
    }
  }
  return out;
}

const dayMonth = (instant: string) => formatDate(localDate(instant), "en-GB", { weekday: undefined });

// The flight as the notice names it: "EK 10 LGW to DXB".
export function duplicateFlightName(flight: ExtractedSegment): string {
  const number = flightNumber(flight);
  return `${number ? `${number} ` : ""}${code(flight.origin)} to ${code(flight.destination)}`;
}

// "EK 10 LGW to DXB is booked on 15 Dec and 17 Dec."
export function duplicateFlightText(pair: DuplicateFlight<ExtractedSegment>): string {
  return `${duplicateFlightName(pair.first)} is booked on ${dayMonth(pair.first.start)} and ${dayMonth(pair.second.start)}.`;
}

// Its buttons: "Mark 15 Dec cancelled".
export const duplicateFlightCancel = (flight: ExtractedSegment) => `Mark ${dayMonth(flight.start)} cancelled`;
