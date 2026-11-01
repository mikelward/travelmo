import {
  findTripForRange,
  segmentDateRange,
  type ExtractedSegment,
  type ParsedMessage,
  type Segment,
  type Trip,
} from "@travelmo/core";
import type { Extractor } from "./extract";
import { isNotFound, type EmailMessage } from "./gmail";
import { prefilter, senderDomain, type SenderPatterns } from "./prefilter";

export type TripBounds = Pick<Trip, "start" | "end" | "updatedAt">;

// Reads first, then writes: Firestore transactions require that order.
export type TripTx = {
  listTrips(): Promise<Trip[]>;
  createTrip(trip: Trip): void;
  extendTrip(tripId: string, bounds: TripBounds): void;
  putSegment(segment: Segment): void;
};

// A claim older than this with no outcome belongs to a worker that died;
// the next delivery may take it over.
export const claimLeaseMs = 15 * 60 * 1000;

export function claimable(existing: ParsedMessage | undefined, now: string): boolean {
  if (!existing) return true;
  return existing.outcome === "processing" && Date.parse(now) - Date.parse(existing.processedAt) > claimLeaseMs;
}

export type TripStore = {
  // Atomically records the message as being processed; false if a record
  // exists and is not an expired lease, so concurrent deliveries of one
  // message import it once while an abandoned claim can be retried.
  claimMessage(uid: string, messageId: string, processedAt: string): Promise<boolean>;
  setParsed(record: ParsedMessage): Promise<void>;
  // Removes the record so a message the user wants another look at can be
  // claimed again.
  forgetMessage(uid: string, messageId: string): Promise<void>;
  // Runs fn serialized per user, so two overlapping imports cannot both
  // decide to create a trip for the same dates.
  withUserLock<T>(uid: string, fn: (tx: TripTx) => Promise<T>): Promise<T>;
  senderPatterns(uid: string): Promise<SenderPatterns>;
  newId(): string;
};

export type ImportDeps = {
  store: TripStore;
  extract: Extractor;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export type ImportOutcome = Exclude<ParsedMessage["outcome"], "processing"> | "skipped";

export type ImportOptions = {
  // Skip the pre-filter: the user has asked for this message specifically.
  force?: boolean;
};

export async function importMessage(
  uid: string,
  message: EmailMessage,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const { store, now, log } = deps;
  if (!(await store.claimMessage(uid, message.id, now()))) return "skipped";
  const base = { messageId: message.id, uid, from: message.from, subject: message.subject };
  const record = (outcome: ParsedMessage["outcome"], extra: Partial<ParsedMessage> = {}): ParsedMessage => ({
    ...base,
    outcome,
    segmentIds: [],
    processedAt: now(),
    ...extra,
  });

  let reason = "requested by user";
  if (!options.force) {
    const verdict = prefilter(
      { from: message.from, subject: message.subject, listUnsubscribe: message.listUnsubscribe },
      await store.senderPatterns(uid),
    );
    if (!verdict.pass) {
      await store.setParsed(record("filtered", { reason: verdict.reason }));
      log("filtered", { uid, messageId: message.id, reason: verdict.reason });
      return "filtered";
    }
    reason = verdict.reason;
  }

  let booking;
  try {
    booking = await deps.extract(message);
  } catch (error) {
    const failure = (error as Error).message;
    await store.setParsed(record("failed", { reason: failure }));
    log("extract_failed", { uid, messageId: message.id, reason: failure });
    return "failed";
  }

  const range = segmentDateRange(booking.segments);
  if (!booking.isBooking || booking.segments.length === 0 || !range) {
    await store.setParsed(record("not_booking", { reason }));
    log("not_booking", { uid, messageId: message.id });
    return "not_booking";
  }

  const timestamp = now();
  const sender = senderDomain(message.from);
  const { tripId, segmentIds } = await store.withUserLock(uid, async (tx) => {
    const live = (await tx.listTrips()).filter((trip) => !trip.deleting);
    const existing = findTripForRange(live, range);
    let tripId: string;
    if (existing) {
      tripId = existing.id;
      // Only the bounds: sharing and title belong to the owner, who may be
      // editing them right now.
      tx.extendTrip(tripId, { start: min(existing.start, range.start), end: max(existing.end, range.end), updatedAt: timestamp });
    } else {
      tripId = store.newId();
      tx.createTrip({
        id: tripId,
        title: tripTitle(booking.segments),
        start: range.start,
        end: range.end,
        ownerUid: uid,
        sharedWith: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const segmentIds: string[] = [];
    for (const [index, extracted] of booking.segments.entries()) {
      // Deterministic ids keep a re-import of the same email from duplicating legs.
      const id = `${message.id}-${index}`;
      tx.putSegment({
        ...extracted,
        id,
        tripId,
        source: "gmail",
        gmailMessageIds: [message.id],
        ...(sender ? { sender } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      segmentIds.push(id);
    }
    return { tripId, segmentIds };
  });

  await store.setParsed(record("imported", { segmentIds, processedAt: timestamp }));
  log("imported", { uid, messageId: message.id, tripId, segments: segmentIds.length });
  return "imported";
}

export type ImportCounts = Record<ImportOutcome, number>;

export const emptyCounts = (): ImportCounts => ({ skipped: 0, filtered: 0, not_booking: 0, imported: 0, failed: 0 });

// A message deleted between Gmail's history entry and our fetch is gone for
// good; skipping it keeps one 404 from wedging every later message in the
// batch. Other fetch errors propagate so the delivery is retried.
export async function importMessages(
  uid: string,
  ids: readonly string[],
  fetch: (id: string) => Promise<EmailMessage>,
  deps: ImportDeps,
): Promise<ImportCounts> {
  const counts = emptyCounts();
  for (const id of ids) {
    let message: EmailMessage;
    try {
      message = await fetch(id);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      deps.log("message_gone", { uid, messageId: id });
      counts.skipped += 1;
      continue;
    }
    counts[await importMessage(uid, message, deps)] += 1;
  }
  return counts;
}

export function tripTitle(segments: readonly ExtractedSegment[]): string {
  const place = segments.find((s) => s.destination)?.destination;
  return place?.city ?? place?.name ?? segments[0]?.title ?? "Trip";
}

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);
