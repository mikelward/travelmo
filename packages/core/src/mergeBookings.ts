import { normalizeReference, sameBooking } from "./trips";
import { canonicalTravelers } from "./travelers";
import { compareInstants } from "./instant";
import type { ExtractedSegment, Segment, SourceRef } from "./schema";
import { hasWords } from "./words";

// Two bookings the user says are one (a car's reservation and its rental
// agreement, read from two emails), as one: `keep` as it is, with what only
// `other` knew filled in (a provider, a reference, an end, a place, notes,
// travelers, a rating), every source of both, and `other`'s id remembered
// (`mergedFrom`) with what it said (`mergedBookings`), so its email read
// again finds this booking (mergedBookingOf). A hand edit
// (`editedAt`), so Refresh from email leaves it as merged. Mirrored on
// Android (core's mergedBookingDocument): keep the two the same.
export function mergeBookings(keep: Segment, other: Segment, timestamp: string): Segment {
  const merged: Segment = { ...keep };
  for (const key of ["provider", "confirmation", "end", "origin", "destination", "sender", "rating"] as const) {
    if (merged[key] === undefined && other[key] !== undefined) (merged as Record<string, unknown>)[key] = other[key];
  }
  const otherReference =
    keep.confirmation && other.confirmation && normalizeReference(keep.confirmation) !== normalizeReference(other.confirmation) ? `Other reference: ${other.confirmation}` : undefined;
  // Each note once: one the kept notes already say isn't added again.
  const notes: string[] = [];
  for (const note of [keep.notes?.trim(), other.notes?.trim(), otherReference]) if (note && !notes.some((n) => hasWords(n, note))) notes.push(note);
  if (notes.length) merged.notes = notes.join("\n");
  // Everyone either names, each once, as many as a booking holds.
  const travelers = canonicalTravelers([...(keep.travelers ?? []), ...(other.travelers ?? [])]);
  if (travelers) merged.travelers = travelers;
  if (keep.favorite || other.favorite) merged.favorite = true;
  const sources: SourceRef[] = [...(keep.sources ?? []), ...(other.sources ?? [])].filter((s, i, all) => all.findIndex((r) => r.kind === s.kind && r.id === s.id) === i);
  if (sources.length) merged.sources = sources;
  merged.gmailMessageIds = [...new Set([...keep.gmailMessageIds, ...other.gmailMessageIds])];
  // A cancellation either was restored from stays taken back: merging two
  // live bookings never undoes a Restore.
  const restoredFrom = [...new Set([...(keep.restoredFrom ?? []), ...(other.restoredFrom ?? [])])].slice(0, 50);
  if (restoredFrom.length) merged.restoredFrom = restoredFrom;
  if (other.restoredAt && (!keep.restoredAt || compareInstants(other.restoredAt, keep.restoredAt) > 0)) merged.restoredAt = other.restoredAt;
  merged.mergedFrom = [...new Set([...(keep.mergedFrom ?? []), other.id, ...(other.mergedFrom ?? [])])].slice(0, 50);
  merged.mergedBookings = [...(keep.mergedBookings ?? []), mergedBooking(other), ...(other.mergedBookings ?? [])].slice(0, 50);
  merged.editedAt = timestamp;
  merged.updatedAt = timestamp;
  return merged;
}

// What a booking merged into another said, as `mergedBookings` keeps it.
function mergedBooking(segment: Segment): NonNullable<Segment["mergedBookings"]>[number] {
  const { type, title, start, end, provider, confirmation, origin, destination } = segment;
  return { type, title, start, ...(end ? { end } : {}), ...(provider ? { provider } : {}), ...(confirmation ? { confirmation } : {}), ...(origin ? { origin } : {}), ...(destination ? { destination } : {}) };
}

// Which booking merged into `keeper` an item an email gives is (sameBooking),
// as an index into its `mergedBookings`, of those no other item of the email
// has `claimed`: each booking merged in is one item, so several merged
// together all find their keeper and two alike rooms stay two.
export function mergedBookingOf(keeper: Pick<Segment, "mergedBookings">, item: ExtractedSegment, claimed: ReadonlySet<number>): number | undefined {
  const index = (keeper.mergedBookings ?? []).findIndex((merged, i) => !claimed.has(i) && sameBooking(merged, item));
  return index < 0 ? undefined : index;
}
