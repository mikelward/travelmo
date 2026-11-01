import {
  findTripForRange,
  segmentDateRange,
  type ExtractedSegment,
  type ParsedMessage,
  type Segment,
  type Trip,
} from "@travelmo/core";
import type { Extractor } from "./extract";
import type { EmailMessage } from "./gmail";
import { prefilter, type SenderPatterns } from "./prefilter";

export type TripStore = {
  getParsed(uid: string, messageId: string): Promise<ParsedMessage | undefined>;
  setParsed(record: ParsedMessage): Promise<void>;
  listTrips(uid: string): Promise<Trip[]>;
  putTrip(trip: Trip): Promise<void>;
  putSegment(segment: Segment): Promise<void>;
  senderPatterns(uid: string): Promise<SenderPatterns>;
  newId(): string;
};

export type ImportDeps = {
  store: TripStore;
  extract: Extractor;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export type ImportOutcome = ParsedMessage["outcome"] | "skipped";

export async function importMessage(uid: string, message: EmailMessage, deps: ImportDeps): Promise<ImportOutcome> {
  const { store, now, log } = deps;
  if (await store.getParsed(uid, message.id)) return "skipped";

  const verdict = prefilter(
    { from: message.from, subject: message.subject, listUnsubscribe: message.listUnsubscribe },
    await store.senderPatterns(uid),
  );
  if (!verdict.pass) {
    await store.setParsed({ messageId: message.id, uid, outcome: "filtered", reason: verdict.reason, segmentIds: [], processedAt: now() });
    log("filtered", { uid, messageId: message.id, reason: verdict.reason });
    return "filtered";
  }

  let booking;
  try {
    booking = await deps.extract(message);
  } catch (error) {
    const reason = (error as Error).message;
    await store.setParsed({ messageId: message.id, uid, outcome: "failed", reason, segmentIds: [], processedAt: now() });
    log("extract_failed", { uid, messageId: message.id, reason });
    return "failed";
  }

  const range = segmentDateRange(booking.segments);
  if (!booking.isBooking || booking.segments.length === 0 || !range) {
    await store.setParsed({ messageId: message.id, uid, outcome: "not_booking", reason: verdict.reason, segmentIds: [], processedAt: now() });
    log("not_booking", { uid, messageId: message.id });
    return "not_booking";
  }

  const timestamp = now();
  const trips = await store.listTrips(uid);
  let trip = findTripForRange(trips, range);
  if (trip) {
    trip = { ...trip, start: min(trip.start, range.start), end: max(trip.end, range.end), updatedAt: timestamp };
  } else {
    trip = {
      id: store.newId(),
      title: tripTitle(booking.segments),
      start: range.start,
      end: range.end,
      ownerUid: uid,
      sharedWith: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  await store.putTrip(trip);

  const segmentIds: string[] = [];
  for (const [index, extracted] of booking.segments.entries()) {
    // Deterministic ids keep a re-import of the same email from duplicating legs.
    const id = `${message.id}-${index}`;
    await store.putSegment({
      ...extracted,
      id,
      tripId: trip.id,
      source: "gmail",
      gmailMessageIds: [message.id],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    segmentIds.push(id);
  }
  await store.setParsed({ messageId: message.id, uid, outcome: "imported", segmentIds, processedAt: timestamp });
  log("imported", { uid, messageId: message.id, tripId: trip.id, segments: segmentIds.length });
  return "imported";
}

export function tripTitle(segments: readonly ExtractedSegment[]): string {
  const place = segments.find((s) => s.destination)?.destination;
  return place?.city ?? place?.name ?? segments[0]?.title ?? "Trip";
}

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);
