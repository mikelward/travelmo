import { z } from "zod";
import type { ExtractedSegment } from "./schema";
import { checkInOpensAt } from "./status";
import { isCancelled } from "./trips";

// "I've checked in": the flights a person says they checked in for, theirs
// alone, one document per trip (`users/{uid}/checkedIn/{tripId}`, a list of
// booking ids). A mark stops the card's check-in line and the parser's
// check-in reminders for that person; on a shared trip it is the viewer's
// own, never the others'.

// At most this many bookings marked on one trip, as the rules bound it.
export const maxCheckedIn = 100;

// A booking id as stored; anything else is left out.
const segmentId = z.string().min(1).max(200);

export const CheckedIn = z.object({
  segmentIds: z
    .array(z.unknown())
    .max(maxCheckedIn)
    .transform((ids) => ids.filter((id): id is string => segmentId.safeParse(id).success))
    .default([]),
  updatedAt: z.string().optional(),
});
export type CheckedIn = z.infer<typeof CheckedIn>;

// The stored list with a booking marked or unmarked: each id once, the
// newest last, and the oldest dropped past the limit.
export function withCheckedIn(ids: readonly string[], id: string, checkedIn: boolean): string[] {
  const rest = ids.filter((other) => other !== id);
  return (checkedIn ? [...rest, id] : rest).slice(-maxCheckedIn);
}

type Flight = Pick<ExtractedSegment, "type" | "title" | "start"> & { id: string; cancelledAt?: string | undefined };

// What a flight on the trip page offers: "I've checked in" from when online
// check-in usually opens until departure, then "Checked in" with an undo
// once marked, until departure; nothing otherwise.
export function flightCheckInState(segment: Flight, checked: ReadonlySet<string>, now: string): "offer" | "done" | undefined {
  if (segment.type !== "flight" || isCancelled(segment)) return undefined;
  const at = Date.parse(now);
  if (at >= Date.parse(segment.start)) return undefined;
  if (checked.has(segment.id)) return "done";
  return at >= Date.parse(checkInOpensAt(segment)) ? "offer" : undefined;
}
