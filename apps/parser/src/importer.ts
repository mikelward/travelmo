import {
  findTripForRange,
  overlappingTrips,
  sameBooking,
  segmentDateRange,
  stableHash,
  type ExtractedSegment,
  type ParsedMessage,
  type Segment,
  type SegmentSource,
  type Trip,
  type TripItImport,
} from "@travelmo/core";
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
  getParsed(uid: string, messageId: string): Promise<ParsedMessage | undefined>;
  // Runs fn serialized per user, so two overlapping imports cannot both
  // decide to create a trip for the same dates.
  withUserLock<T>(uid: string, fn: (tx: TripTx) => Promise<T>): Promise<T>;
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
};

export async function importMessage(
  uid: string,
  message: EmailMessage,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const { store, now, log } = deps;
  const claim = options.reclaim ? store.reclaimMessage : store.claimMessage;
  if (!(await claim(uid, message.id, now()))) return "skipped";
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

  // The similarity stage: an allowed sender or the user's own request goes
  // straight to the model, but still teaches it. Embedding trouble is never
  // a reason to drop an email.
  let vector: number[] | undefined;
  if (deps.embed) {
    try {
      vector = await deps.embed(embeddingText(message));
    } catch (error) {
      log("embed_failed", { uid, messageId: message.id, reason: (error as Error).message });
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
      log("similarity_failed", { uid, messageId: message.id, reason: (error as Error).message });
    }
    if (similar?.skip) {
      await store.setParsed(record("filtered", { reason: similar.reason }));
      log("filtered", { uid, messageId: message.id, reason: similar.reason });
      return "filtered";
    }
  }
  const learn = async (label: ExampleLabel) => {
    if (!vector) return;
    try {
      await store.saveExample(uid, label, { subject: message.subject, vector });
    } catch (error) {
      log("example_save_failed", { uid, messageId: message.id, reason: (error as Error).message });
    }
  };

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
    await learn("others");
    log("not_booking", { uid, messageId: message.id });
    return "not_booking";
  }

  const sender = senderDomain(message.from);
  const filed = await fileBooking(
    uid,
    {
      sourceId: message.id,
      source: "gmail",
      segments: booking.segments,
      gmailMessageIds: [message.id],
      ...(sender ? { sender } : {}),
    },
    deps,
  );
  const { tripId, segmentIds, duplicates, timestamp } = filed;
  await store.setParsed(
    record("imported", { segmentIds, processedAt: timestamp, ...(duplicates ? { reason: duplicateReason(duplicates) } : {}) }),
  );
  await learn("bookings");
  log("imported", { uid, messageId: message.id, tripId, segments: segmentIds.length, duplicates });
  return "imported";
}

const duplicateReason = (n: number) => `${n} already imported from elsewhere`;

// Where a source wants its bookings filed. Without one, a booking joins the
// trip its dates fall in (or near) and otherwise starts one titled by its
// destination. With one, as for a TripIt trip, the source's own grouping
// wins: the booking goes into the trip with this id, creating it with this
// title and these dates; `joinOverlapping` lets it join a trip from another
// source that already covers those dates instead, so a TripIt trip and the
// Gmail import of the same journey do not end up as two trips.
export type TripHint = { id: string; title: string; start: string; end: string; joinOverlapping: boolean };

export type BookingToFile = {
  // Stable per source item, so a re-import overwrites rather than duplicates.
  sourceId: string;
  source: SegmentSource;
  segments: readonly ExtractedSegment[];
  gmailMessageIds?: string[];
  sender?: string;
  trip?: TripHint;
  // Never treat two of this source's own bookings as one.
  distinctWithinSource?: boolean;
  // Ids of existing segments already matched by earlier items of the same
  // import, which cannot stand in for another: matching is one to one, so
  // two alike TripIt rooms against one Gmail room leaves two rooms, and
  // against two Gmail rooms, two.
  consumed?: ReadonlySet<string>;
};

export type Filed = {
  tripId?: string;
  segmentIds: string[];
  duplicates: number;
  // Existing segments this booking was matched to, for the caller's
  // `consumed` set.
  matched: string[];
  timestamp: string;
};

// Trips an import created to keep a source's own grouping; another source's
// booking never joins them by overlap, only by id.
export const sourceTripPrefix = "tripit-";
// The one trip holding a source's unfiled items.
const holdingTripPrefix = `${sourceTripPrefix}unfiled-`;

// The part of every import after the booking is known, whatever it came
// from: trip assignment, duplicate detection against bookings already on the
// user's trips, and the segment writes, in one transaction serialized per
// user. A booking that matches one already imported from elsewhere (same
// type, time and route: sameBooking) is left out; when every one does,
// nothing is written.
export async function fileBooking(uid: string, booking: BookingToFile, deps: ImportDeps): Promise<Filed> {
  const { store } = deps;
  const range = segmentDateRange(booking.segments);
  if (!range) throw new Error(`booking ${booking.sourceId} has no segments`);
  const timestamp = deps.now();
  const result = await store.withUserLock(uid, async (tx) => {
    const trips = await tx.listTrips();
    const live = trips.filter((trip) => !trip.deleting);
    // A source that is already one deduplicated list (a TripIt export) is
    // checked only against other sources: two alike reservations in it are
    // two rooms, not one booking seen twice.
    const existing = (await Promise.all(overlappingTrips(live, range).map((trip) => tx.listSegments(trip.id))))
      .flat()
      .filter((other) => !booking.distinctWithinSource || other.source !== booking.source);
    const matchedTrips = new Set<string>();
    const matched: string[] = [];
    const taken = (other: Segment) => booking.consumed?.has(`${other.tripId}/${other.id}`) || matched.includes(`${other.tripId}/${other.id}`);
    const fresh = booking.segments
      .map((segment, index) => ({ segment, id: `${booking.sourceId}-${index}` }))
      .filter(({ segment, id }) => {
        const match = existing.find((other) => other.id !== id && !taken(other) && sameBooking(other, segment));
        if (match) {
          matchedTrips.add(match.tripId);
          matched.push(`${match.tripId}/${match.id}`);
        }
        return !match;
      });
    const duplicates = booking.segments.length - fresh.length;
    const freshRange = segmentDateRange(fresh.map((f) => f.segment));
    if (!freshRange) return { segmentIds: [], duplicates, matched };

    const hint = booking.trip;
    let target: Trip | undefined;
    if (hint) {
      target = live.find((trip) => trip.id === hint.id);
      // A trip already holding part of this booking comes before any that
      // merely overlaps its dates.
      if (!target && hint.joinOverlapping) target = live.find((trip) => matchedTrips.has(trip.id) && !trip.id.startsWith(holdingTripPrefix));
      if (!target && hint.joinOverlapping) {
        // The whole of the source's trip, not just its new bookings: a
        // return leg is in the same journey as the outbound already filed.
        const whole = { start: min(hint.start, range.start), end: max(hint.end, range.end) };
        target = overlappingTrips(live.filter((trip) => !trip.id.startsWith(sourceTripPrefix)), whole)[0];
      }
    } else {
      // The holding trip spans whatever years its items do; nothing joins
      // it by date.
      // A booking part of which is already filed (an outbound flight, now
      // sent again with its return) joins that trip; otherwise its whole
      // range, not only what is new, decides.
      const assignable = live.filter((trip) => !trip.id.startsWith(holdingTripPrefix));
      target = assignable.find((trip) => matchedTrips.has(trip.id)) ?? findTripForRange(assignable, range);
    }
    let tripId: string;
    if (target) {
      tripId = target.id;
      // Only the bounds: sharing and title belong to the owner, who may be
      // editing them right now.
      // A source's own trip dates (a TripIt itinerary) widen it too, so a
      // later booking within them finds this trip.
      const want = hint ? { start: min(hint.start, freshRange.start), end: max(hint.end, freshRange.end) } : freshRange;
      tx.extendTrip(tripId, { start: min(target.start, want.start), end: max(target.end, want.end), updatedAt: timestamp });
    } else {
      // A hinted id still taken by a trip being deleted cannot be reused.
      tripId = hint && !trips.some((trip) => trip.id === hint.id) ? hint.id : store.newId();
      tx.createTrip({
        id: tripId,
        title: hint?.title ?? tripTitle(booking.segments),
        start: hint ? min(hint.start, freshRange.start) : freshRange.start,
        end: hint ? max(hint.end, freshRange.end) : freshRange.end,
        ownerUid: uid,
        sharedWith: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    for (const { segment, id } of fresh) {
      tx.putSegment({
        ...segment,
        id,
        tripId,
        source: booking.source,
        gmailMessageIds: booking.gmailMessageIds ?? [],
        ...(booking.sender ? { sender: booking.sender } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    return { tripId, segmentIds: fresh.map((f) => f.id), duplicates, matched };
  });
  return { ...result, timestamp };
}

// An item from a source that hands over bookings already structured (a
// TripIt export), recorded like an email so that importing the same export
// twice imports it once.
export type StructuredItem = Omit<BookingToFile, "sourceId" | "source" | "gmailMessageIds" | "sender" | "distinctWithinSource"> & {
  id: string;
  source: "tripit";
  title: string;
};

export type StructuredResult = { outcome: "imported" | "skipped" | "failed"; segments: number; duplicates: number; matched: string[] };

export async function importStructured(uid: string, item: StructuredItem, deps: ImportDeps): Promise<StructuredResult> {
  const { store, now, log } = deps;
  // Reclaim, not claim: an item that failed is tried again on the next
  // upload; one already imported, or being imported, is not.
  if (!(await store.reclaimMessage(uid, item.id, now()))) {
    // Its matches still count against the rest of this upload.
    const previous = await store.getParsed(uid, item.id);
    return { outcome: "skipped", segments: 0, duplicates: 0, matched: previous?.matchedSegmentIds ?? [] };
  }
  const base = { messageId: item.id, uid, source: item.source, from: sourceLabels[item.source], subject: item.title };
  let filed: Filed;
  try {
    filed = await fileBooking(
      uid,
      {
        sourceId: item.id,
        source: item.source,
        segments: item.segments,
        distinctWithinSource: true,
        ...(item.trip ? { trip: item.trip } : {}),
        ...(item.consumed ? { consumed: item.consumed } : {}),
      },
      deps,
    );
  } catch (error) {
    const reason = (error as Error).message;
    await store.setParsed({ ...base, outcome: "failed", reason, segmentIds: [], processedAt: now() });
    log("import_failed", { uid, source: item.source, id: item.id, reason });
    return { outcome: "failed", segments: 0, duplicates: 0, matched: [] };
  }
  await store.setParsed({
    ...base,
    outcome: "imported",
    segmentIds: filed.segmentIds,
    ...(filed.matched.length ? { matchedSegmentIds: filed.matched } : {}),
    processedAt: filed.timestamp,
    ...(filed.duplicates ? { reason: duplicateReason(filed.duplicates) } : {}),
  });
  log("imported", { uid, source: item.source, id: item.id, tripId: filed.tripId, segments: filed.segmentIds.length, duplicates: filed.duplicates });
  return { outcome: "imported", segments: filed.segmentIds.length, duplicates: filed.duplicates, matched: filed.matched };
}

const sourceLabels: Record<StructuredItem["source"], string> = { tripit: "TripIt" };

export type TripItCounts = { trips: number; imported: number; duplicates: number; skipped: number; failed: number };

// Ids are derived from the uid and the export's content: trips live in one
// top-level collection, so two users importing the same itinerary must not
// collide, and the same user importing it twice must.
export const tripItTripId = (uid: string, key: string) => `${sourceTripPrefix}${stableHash(`${uid}|${key}`)}`;
export const tripItUnfiledTripId = (uid: string) => `${holdingTripPrefix}${stableHash(uid)}`;
export const unfiledTripTitle = "Unfiled from TripIt";

export async function importTripIt(uid: string, parsed: TripItImport, deps: ImportDeps): Promise<TripItCounts> {
  const counts: TripItCounts = { trips: 0, imported: 0, duplicates: 0, skipped: 0, failed: 0 };
  // Matching against other sources is one to one across the whole export:
  // an existing booking that one item matched cannot stand in for another.
  const consumed = new Set<string>();
  // On a retried upload, what items imported last time matched is reserved
  // before any item is tried again, whatever the order of the export.
  const ids = [...parsed.trips.map((t) => `tripit-${t.key}`), ...parsed.unfiled.map((u) => `tripit-unfiled-${u.key}`)];
  for (const previous of await Promise.all(ids.map((id) => deps.store.getParsed(uid, id)))) {
    if (previous?.outcome === "imported") for (const id of previous.matchedSegmentIds ?? []) consumed.add(id);
  }
  const tally = (result: StructuredResult) => {
    for (const id of result.matched) consumed.add(id);
    counts.imported += result.segments;
    counts.duplicates += result.duplicates;
    if (result.outcome === "skipped") counts.skipped += 1;
    if (result.outcome === "failed") counts.failed += 1;
  };
  for (const trip of parsed.trips) {
    const result = await importStructured(
      uid,
      {
        id: `tripit-${trip.key}`,
        source: "tripit",
        title: trip.title,
        segments: trip.segments,
        consumed,
        trip: { id: tripItTripId(uid, trip.key), title: trip.title, start: trip.start, end: trip.end, joinOverlapping: true },
      },
      deps,
    );
    if (result.outcome === "imported") counts.trips += 1;
    tally(result);
  }
  for (const item of parsed.unfiled) {
    const range = segmentDateRange(item.segments)!;
    tally(
      await importStructured(
        uid,
        {
          id: `tripit-unfiled-${item.key}`,
          source: "tripit",
          title: item.title,
          segments: item.segments,
          consumed,
          trip: { id: tripItUnfiledTripId(uid), title: unfiledTripTitle, ...range, joinOverlapping: false },
        },
        deps,
      ),
    );
  }
  return counts;
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
