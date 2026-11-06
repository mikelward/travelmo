import {
  daysBetween,
  findTripForRange,
  localDate,
  segmentDateRange,
  type ExtractedBooking,
  type ExtractedSegment,
  type ParsedMessage,
  type Segment,
  type Trip,
} from "@travelmo/core";
import { gmailCandidate, type Candidate, type TripHint } from "./candidate";
import type { Extractor } from "./extract";
import { isNotFound, type EmailMessage } from "./gmail";
import { prefilter, senderDomain, type SenderPatterns } from "./prefilter";
import { embeddingText, similarityVerdict, type Example, type ExampleLabel, type Examples } from "./similarity";

export type TripBounds = Pick<Trip, "start" | "end" | "updatedAt">;

// Reads first, then writes: Firestore transactions require that order.
export type TripTx = {
  listTrips(): Promise<Trip[]>;
  listSegments(tripId: string): Promise<Segment[]>;
  createTrip(trip: Trip): void;
  extendTrip(tripId: string, bounds: TripBounds): void;
  putSegment(segment: Segment): void;
};

// A claim older than this with no outcome belongs to a worker that died;
// the next delivery may take it over.
export const claimLeaseMs = 15 * 60 * 1000;

function leaseExpired(existing: ParsedMessage, now: string): boolean {
  return Date.parse(now) - Date.parse(existing.processedAt) > claimLeaseMs;
}

export function claimable(existing: ParsedMessage | undefined, now: string): boolean {
  if (!existing) return true;
  return existing.outcome === "processing" && leaseExpired(existing, now);
}

// An imported message stays imported: running extraction again could change
// the set of segments, and nothing here reconciles the old ones. Edit or
// delete those bookings on the trip page instead.
export function reclaimable(existing: ParsedMessage | undefined, now: string): boolean {
  if (!existing) return true;
  if (existing.outcome === "imported") return false;
  return existing.outcome !== "processing" || leaseExpired(existing, now);
}

export type TripStore = {
  // Atomically records the message as being processed; false if a record
  // exists and is not an expired lease, so concurrent deliveries of one
  // message import it once while an abandoned claim can be retried.
  claimMessage(uid: string, messageId: string, processedAt: string): Promise<boolean>;
  // Like claimMessage, but a record that did not become a booking is claimed
  // again too; an imported one and an unexpired processing claim are
  // refused. For the user asking for another look at a message.
  reclaimMessage(uid: string, messageId: string, processedAt: string): Promise<boolean>;
  setParsed(record: ParsedMessage): Promise<void>;
  // The records that exist among these ids, for previewing a file import.
  parsedRecords(uid: string, ids: readonly string[]): Promise<Map<string, ParsedMessage>>;
  // Runs fn serialized per user, so two overlapping imports cannot both
  // decide to create a trip for the same dates.
  withUserLock<T>(uid: string, fn: (tx: TripTx) => Promise<T>): Promise<T>;
  // Plain reads outside a transaction, for previews.
  userTrips(uid: string): Promise<Trip[]>;
  tripSegments(tripId: string): Promise<Segment[]>;
  senderPatterns(uid: string): Promise<SenderPatterns>;
  // Embeddings of emails the model has judged for this user (see similarity.ts).
  examples(uid: string): Promise<Examples>;
  saveExample(uid: string, label: ExampleLabel, example: Example): Promise<void>;
  newId(): string;
};

export type Embedder = (text: string) => Promise<number[]>;

export type ImportDeps = {
  store: TripStore;
  extract: Extractor;
  // Without one, the similarity pre-filter is off.
  embed?: Embedder;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export type ImportOutcome = Exclude<ParsedMessage["outcome"], "processing"> | "skipped";

export type ImportOptions = {
  // Skip the pre-filter: the user has asked for this message specifically.
  force?: boolean;
  // Take another look at a message that already has an outcome.
  reclaim?: boolean;
  // Leave out bookings the target trip already holds (see isDuplicate).
  // Defaults to on for structured candidates, off for text.
  dedupe?: boolean;
};

type DateRange = { start: string; end: string };

// A candidate that passed every check before the trip transaction.
type Prepared = {
  candidate: Candidate;
  booking: ExtractedBooking;
  range: DateRange;
  record: (outcome: ParsedMessage["outcome"], extra?: Partial<ParsedMessage>) => ParsedMessage;
  learn: (label: ExampleLabel) => Promise<void>;
};

type Stage = { done: ImportOutcome } | { ready: Prepared };

// Claim, pre-filter, similarity, extraction and the not-a-booking check:
// everything up to writing the trip.
async function prepare(uid: string, candidate: Candidate, deps: ImportDeps, options: ImportOptions): Promise<Stage> {
  const { store, now, log } = deps;
  const { id, source } = candidate;
  const claim = options.reclaim ? store.reclaimMessage : store.claimMessage;
  if (!(await claim(uid, id, now()))) return { done: "skipped" };
  const base: Omit<ParsedMessage, "outcome" | "segmentIds" | "processedAt"> = {
    messageId: id,
    uid,
    subject: candidate.subject,
    ...(candidate.from !== undefined ? { from: candidate.from } : {}),
    ...(source !== "gmail" ? { source } : {}),
  };
  const record = (outcome: ParsedMessage["outcome"], extra: Partial<ParsedMessage> = {}): ParsedMessage => ({
    ...base,
    outcome,
    segmentIds: [],
    processedAt: now(),
    ...extra,
  });
  const fields = { uid, messageId: id, source };
  const text = candidate.kind === "text" ? candidate.message : undefined;

  let reason = candidate.kind === "booking" ? "structured import" : "requested by user";
  if (text && !options.force) {
    const verdict = prefilter(
      { from: text.from, subject: text.subject, listUnsubscribe: text.listUnsubscribe },
      await store.senderPatterns(uid),
    );
    if (!verdict.pass) {
      await store.setParsed(record("filtered", { reason: verdict.reason }));
      log("filtered", { ...fields, reason: verdict.reason });
      return { done: "filtered" };
    }
    reason = verdict.reason;
  }

  // The similarity stage: an allowed sender or the user's own request goes
  // straight to the model, but still teaches it. Embedding trouble is never
  // a reason to drop an email.
  let vector: number[] | undefined;
  if (text && deps.embed) {
    try {
      vector = await deps.embed(embeddingText(text));
    } catch (error) {
      log("embed_failed", { ...fields, reason: (error as Error).message });
    }
  }
  if (vector && !options.force && reason === "subject keyword") {
    // The stage is optional: whatever goes wrong in it (the examples
    // document, a vector of another length after a model change), the email
    // still reaches the model rather than staying claimed and unimported.
    let similar;
    try {
      similar = similarityVerdict(vector, await store.examples(uid));
    } catch (error) {
      log("similarity_failed", { ...fields, reason: (error as Error).message });
    }
    if (similar?.skip) {
      await store.setParsed(record("filtered", { reason: similar.reason }));
      log("filtered", { ...fields, reason: similar.reason });
      return { done: "filtered" };
    }
  }
  const learn = async (label: ExampleLabel) => {
    if (!vector) return;
    try {
      await store.saveExample(uid, label, { subject: candidate.subject, vector });
    } catch (error) {
      log("example_save_failed", { ...fields, reason: (error as Error).message });
    }
  };

  let booking: ExtractedBooking;
  if (candidate.kind === "booking") {
    booking = candidate.booking;
  } else {
    try {
      booking = await deps.extract(candidate.message);
    } catch (error) {
      const failure = (error as Error).message;
      await store.setParsed(record("failed", { reason: failure }));
      log("extract_failed", { ...fields, reason: failure });
      return { done: "failed" };
    }
  }

  const range = segmentDateRange(booking.segments);
  if (!booking.isBooking || booking.segments.length === 0 || !range) {
    await store.setParsed(record("not_booking", { reason: candidate.note ? `${reason}; ${candidate.note}` : reason }));
    await learn("others");
    log("not_booking", fields);
    return { done: "not_booking" };
  }
  return { ready: { candidate, booking, range, record, learn } };
}

// The trip a booking joins. With a hint, the live trip whose dates overlap
// the hint's the most (or, for a "title" hint, the one with exactly that
// title); without one, a trip within two days of the booking.
export function resolveTrip(live: readonly Trip[], range: DateRange, hint?: TripHint): Trip | undefined {
  if (!hint) return findTripForRange(live, range);
  if (hint.merge === "title") return live.find((trip) => trip.title === hint.title);
  let best: Trip | undefined;
  let bestOverlap = -1;
  for (const trip of live) {
    const from = max(trip.start, hint.start);
    const to = min(trip.end, hint.end);
    if (from > to) continue;
    const overlap = daysBetween(from, to);
    if (overlap > bestOverlap) {
      best = trip;
      bestOverlap = overlap;
    }
  }
  return best;
}

// Two bookings for the same thing from different sources: same kind, same
// local day, and either the same route by code or the same title. Narrow on
// purpose; the preview shows what it would skip.
export function isDuplicate(a: ExtractedSegment, b: ExtractedSegment): boolean {
  if (a.type !== b.type || localDate(a.start) !== localDate(b.start)) return false;
  const ra = route(a);
  const rb = route(b);
  if (ra && rb) return ra === rb;
  return normalizeTitle(a.title) === normalizeTitle(b.title);
}

function route(segment: ExtractedSegment): string | undefined {
  const from = segment.origin?.code;
  const to = segment.destination?.code;
  return from && to ? `${from}-${to}`.toUpperCase() : undefined;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Firestore allows 500 writes per transaction; a trip, its lock and this
// many segments stay under it.
export const maxSegmentsPerTransaction = 400;

type Written = { prepared: Prepared; outcome: "imported" | "filtered"; segmentIds: string[]; reason?: string };

type WriteResult = { tripId: string; created: boolean; results: Written[] };

// One transaction: resolve (or reuse) the trip, widen it to hold every
// booking, write the segments that are not duplicates.
async function writeGroup(
  uid: string,
  items: readonly Prepared[],
  deps: ImportDeps,
  options: ImportOptions,
  hint: TripHint | undefined,
  knownTripId: string | undefined,
): Promise<WriteResult> {
  const { store, now } = deps;
  const timestamp = now();
  const groupRange = items.reduce<DateRange>(
    (acc, item) => ({ start: min(acc.start, item.range.start), end: max(acc.end, item.range.end) }),
    hint ? { start: hint.start, end: hint.end } : items[0]!.range,
  );
  const dedupeNeeded = items.some((item) => options.dedupe ?? item.candidate.kind === "booking");

  return store.withUserLock(uid, async (tx) => {
    const live = (await tx.listTrips()).filter((trip) => !trip.deleting);
    const existing = knownTripId ? live.find((trip) => trip.id === knownTripId) : resolveTrip(live, groupRange, hint);
    const taken: ExtractedSegment[] = existing && dedupeNeeded ? await tx.listSegments(existing.id) : [];
    let tripId: string;
    if (existing) {
      tripId = existing.id;
      // Only the bounds: sharing and title belong to the owner, who may be
      // editing them right now.
      tx.extendTrip(tripId, {
        start: min(existing.start, groupRange.start),
        end: max(existing.end, groupRange.end),
        updatedAt: timestamp,
      });
    } else {
      tripId = store.newId();
      tx.createTrip({
        id: tripId,
        title: hint?.title ?? tripTitle(items[0]!.booking.segments),
        start: groupRange.start,
        end: groupRange.end,
        ownerUid: uid,
        sharedWith: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const tripTitleFor = existing?.title ?? hint?.title ?? tripTitle(items[0]!.booking.segments);
    const results: Written[] = [];
    for (const item of items) {
      const { candidate, booking } = item;
      const dedupe = options.dedupe ?? candidate.kind === "booking";
      const sender = candidate.from ? senderDomain(candidate.from) : undefined;
      const segmentIds: string[] = [];
      let duplicateOf: string | undefined;
      for (const [index, extracted] of booking.segments.entries()) {
        const twin = dedupe ? taken.find((held) => isDuplicate(extracted, held)) : undefined;
        if (twin) {
          duplicateOf ??= twin.title;
          continue;
        }
        // Deterministic ids keep a re-import of the same item from duplicating legs.
        const id = `${candidate.id}-${index}`;
        tx.putSegment({
          ...extracted,
          id,
          tripId,
          source: candidate.source,
          gmailMessageIds: candidate.gmailMessageIds ?? [],
          ...(sender ? { sender } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        taken.push(extracted);
        segmentIds.push(id);
      }
      results.push(
        segmentIds.length > 0
          ? { prepared: item, outcome: "imported", segmentIds }
          : { prepared: item, outcome: "filtered", segmentIds, reason: `duplicates "${duplicateOf}" in ${tripTitleFor}` },
      );
    }
    return { tripId, created: !existing, results };
  });
}

async function recordWritten(uid: string, written: WriteResult, deps: ImportDeps): Promise<void> {
  const { store, now, log } = deps;
  for (const { prepared, outcome, segmentIds, reason } of written.results) {
    const { candidate } = prepared;
    const fields = { uid, messageId: candidate.id, source: candidate.source, tripId: written.tripId };
    if (outcome === "imported") {
      await store.setParsed(prepared.record("imported", { segmentIds, processedAt: now() }));
      await prepared.learn("bookings");
      log("imported", { ...fields, segments: segmentIds.length });
    } else {
      await store.setParsed(prepared.record("filtered", { reason }));
      log("filtered", { ...fields, reason });
    }
  }
}

// Imports one candidate from any source: an email, a calendar event or a
// structured booking from a file.
export async function importCandidate(
  uid: string,
  candidate: Candidate,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const stage = await prepare(uid, candidate, deps, options);
  if ("done" in stage) return stage.done;
  const written = await writeGroup(uid, [stage.ready], deps, options, candidate.tripHint, undefined);
  await recordWritten(uid, written, deps);
  return written.results[0]!.outcome;
}

export function importMessage(
  uid: string,
  message: EmailMessage,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  return importCandidate(uid, gmailCandidate(message), deps, options);
}

export type ImportCounts = Record<ImportOutcome, number>;

export const emptyCounts = (): ImportCounts => ({ skipped: 0, filtered: 0, not_booking: 0, imported: 0, failed: 0 });

export type GroupResult = { counts: ImportCounts; tripId?: string; created: boolean };

// How many text candidates the model reads at once.
export const extractionConcurrency = 6;

// Candidates that belong to one trip (a TripIt trip): each is claimed and
// read on its own, then the trip is written in as few transactions as the
// write limit allows, with duplicates between them and the trip left out.
export async function importGroup(
  uid: string,
  candidates: readonly Candidate[],
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<GroupResult> {
  const counts = emptyCounts();
  const stages = await mapLimit(candidates, extractionConcurrency, (candidate) => prepare(uid, candidate, deps, options));
  const ready: Prepared[] = [];
  for (const stage of stages) {
    if ("done" in stage) counts[stage.done] += 1;
    else ready.push(stage.ready);
  }
  if (ready.length === 0) return { counts, created: false };

  const hint = candidates[0]?.tripHint;
  let tripId: string | undefined;
  let created = false;
  for (const chunk of chunkBySegments(ready, maxSegmentsPerTransaction)) {
    const written = await writeGroup(uid, chunk, deps, options, hint, tripId);
    tripId = written.tripId;
    created ||= written.created;
    await recordWritten(uid, written, deps);
    for (const result of written.results) counts[result.outcome] += 1;
  }
  return { counts, created, ...(tripId ? { tripId } : {}) };
}

function chunkBySegments(items: readonly Prepared[], limit: number): Prepared[][] {
  const chunks: Prepared[][] = [];
  let current: Prepared[] = [];
  let size = 0;
  for (const item of items) {
    const segments = item.booking.segments.length;
    if (current.length > 0 && size + segments > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += segments;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
