import {
  enrichSegments,
  fillAirports,
  awayPlace,
  compareInstants,
  findTripForBooking,
  isTransfer,
  transferTitle,
  homeTimeline,
  type HomePeriod,
  icsEventText,
  isTravelCalendar,
  isPaymentReceipt,
  compareMatchRanks,
  matchRank,
  notBookings,
  withoutValidityEnds,
  type IcsCalendar,
  type IcsEvent,
  mergeDetails,
  overlappingTrips,
  sameBooking,
  sameEvent,
  segmentDateRange,
  segmentSources,
  stableHash,
  type ExtractedSegment,
  needsGeocoding,
  type GeocodeLookup,
  type ParsedMessage,
  type Segment,
  type SegmentSource,
  type SourceRef,
  type Trip,
  type TripItImport,
  untimedMatchDays,
} from "@travelmo/core";
import { airportPlace } from "@travelmo/core/airportPlaces";
import type { Extractor } from "./extract";
import type { RetryStore } from "./geocodeSweep";
import { isNotFound, type EmailMessage } from "./gmail";
import { calendarPrefilter, prefilter, senderDomain, type PrefilterResult, type SenderPatterns } from "./prefilter";
import { embeddingText, similarityVerdict, type Example, type ExampleLabel, type Examples } from "./similarity";

export type TripBounds = Pick<Trip, "start" | "end" | "updatedAt"> & Partial<Pick<Trip, "title">>;

// Reads first, then writes: Firestore transactions require that order.
export type TripTx = {
  listTrips(): Promise<Trip[]>;
  listSegments(tripId: string): Promise<Segment[]>;
  createTrip(trip: Trip): void;
  extendTrip(tripId: string, bounds: TripBounds): void;
  putSegment(segment: Segment): void;
  // Adds a source to a booking already filed: the same booking, found again.
  addSource(tripId: string, segmentId: string, source: SourceRef): void;
  getSegment(tripId: string, segmentId: string): Promise<Segment | undefined>;
  deleteSegment(tripId: string, segmentId: string): void;
  // Writes an import record in the same transaction as the bookings it names.
  putParsed(record: ParsedMessage): void;
  // Moves the trip's revision, as any change to its bookings must.
  touchTrip(tripId: string, updatedAt: string): void;
  // A new title and bounds for a trip regrouping reshaped (regroup.ts).
  updateTrip(tripId: string, fields: Pick<Trip, "title" | "start" | "end" | "updatedAt">): void;
  // Removes a trip regrouping emptied of bookings.
  deleteTrip(tripId: string): void;
  // Ids of up to `limit` of the user's import records (parsedMessages), and
  // removing one, for deleting all trips (tripsReset.ts).
  listParsedIds(limit: number): Promise<string[]>;
  deleteParsed(messageId: string): void;
  // How many times the user's trips have been reset, as the lock read it;
  // a reset moves it on (bumpGeneration), so an import that began before
  // can tell and give up rather than recreate what the reset removed.
  generation: number;
  bumpGeneration(): void;
  // Whether the user has a Gmail connection whose reading position a reset
  // would clear (a read), and clearing it (a write), so a reset forgets the
  // place in the same transaction that moves the generation on.
  hasGmail(): Promise<boolean>;
  clearBackfill(): void;
};

// An import that began before the user deleted all their trips: it files
// and records nothing, and the email is read again by the next import.
export class ImportSupersededError extends Error {
  constructor() {
    super("trips were reset while this import ran");
    this.name = "ImportSupersededError";
  }
}

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

// A failed outcome may be tried again (the model was rate-limited, say);
// anything else that finished stays as it is.
export function retryable(existing: ParsedMessage | undefined, now: string): boolean {
  return claimable(existing, now) || existing?.outcome === "failed";
}

// A changed calendar event may be claimed for another read only while its
// record is the very version the caller saw (so two overlapping polls do not
// both act on it), and not while another worker's claim is live.
export function changeClaimable(existing: ParsedMessage | undefined, expected: ParsedMessage, now: string): boolean {
  if (!existing || existing.processedAt !== expected.processedAt || existing.revision !== expected.revision) return false;
  return existing.outcome !== "processing" || leaseExpired(existing, now);
}

export type TripStore = {
  // Atomically records the message as being processed; false if a record
  // exists and is not an expired lease, so concurrent deliveries of one
  // message import it once while an abandoned claim can be retried.
  // With `generation`, every claim also refuses once the user's trips have
  // been reset since it was read (TripTx.generation), so a claim cannot
  // outlive the reset that deleted the records.
  claimMessage(uid: string, messageId: string, processedAt: string, generation?: number): Promise<boolean>;
  // Like claimMessage, but a record that did not become a booking is claimed
  // again too; an imported one and an unexpired processing claim are
  // refused. For the user asking for another look at a message.
  reclaimMessage(uid: string, messageId: string, processedAt: string, generation?: number): Promise<boolean>;
  // Like claimMessage, but a record whose import failed is claimed again
  // too. For sources the user can only re-send whole, such as a file.
  retryMessage(uid: string, messageId: string, processedAt: string, generation?: number): Promise<boolean>;
  // Claims a changed calendar event while its record is still `expected`
  // (see changeClaimable). The claim keeps the record's bookings, so a
  // worker that dies mid-change leaves them named for the next one.
  claimChange(uid: string, messageId: string, processedAt: string, expected: ParsedMessage, generation?: number): Promise<boolean>;
  // Writes `next` only while the record is still `expected`, on the same
  // terms as claimChange; false when another worker got there first.
  replaceIfUnchanged(uid: string, expected: ParsedMessage, next: ParsedMessage, now: string, generation?: number): Promise<boolean>;
  setParsed(record: ParsedMessage): Promise<void>;
  // The user's reset generation (TripTx.generation), read outside any lock.
  resetGeneration(uid: string): Promise<number>;
  // Writes the record only while the reset generation is still
  // `generation`; false, writing nothing, once a reset has moved it on.
  setParsedIfCurrent(record: ParsedMessage, generation: number): Promise<boolean>;
  getParsed(uid: string, messageId: string): Promise<ParsedMessage | undefined>;
  // Every booking in the user's own live trips, read outside any lock: a
  // snapshot for planning an import, never for deciding a write.
  listUserSegments(uid: string): Promise<Segment[]>;
  // One booking, read outside any lock.
  readSegment(tripId: string, segmentId: string): Promise<Segment | undefined>;
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
  // Fills a place's country when its source gave none (geocode.ts); without
  // one, places stay as the source left them.
  geocode?: GeocodeLookup;
  // Where a booking the geocoder put off waits for the daily sweep
  // (geocodeSweep.ts); without one, a spent budget is the end of it.
  geocodeRetries?: RetryStore;
  // Corrections the user made to where home was (none are stored yet):
  // they win over the home worked out from journeys for their dates.
  homeOverrides?: (uid: string) => Promise<readonly HomePeriod[]>;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export type ImportOutcome = Exclude<ParsedMessage["outcome"], "processing"> | "skipped";

export type ImportOptions = {
  // The reset generation, when the caller read it before state of its own
  // that the import depends on (a calendar's records, a batch's place);
  // otherwise importMessage reads it first thing.
  generation?: number;
  // Skip the pre-filter: the user has asked for this message specifically.
  force?: boolean;
  // Take another look at a message that already has an outcome.
  reclaim?: boolean;
  // Take another look at a message whose import failed, and only then.
  retryFailed?: boolean;
  // Recorded on the outcome: what version of the item was read.
  revision?: string;
  // A changed calendar event: its record as last read. The new read
  // replaces that record's bookings only once it has succeeded; a failed
  // read leaves record and bookings as they were.
  replacing?: ParsedMessage;
  // Existing bookings already matched by earlier items of the same upload;
  // this message's own matches are added to it.
  consumed?: Set<string>;
  // A calendar event read like an email: recorded and filed as `ics`, and
  // checked by this instead of the sender-and-subject pre-filter.
  source?: "gmail" | "ics" | "forward";
  prefilter?: (message: EmailMessage) => PrefilterResult;
};

export async function importMessage(
  uid: string,
  message: EmailMessage,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const { store, now, log } = deps;
  const replacing = options.replacing;
  // Read before the claim: a reset that runs at any point after this makes
  // every write below give up.
  const generation = options.generation ?? (await store.resetGeneration(uid));
  const save = async (r: ParsedMessage) => {
    if (!(await store.setParsedIfCurrent(r, generation))) log("import_superseded", { uid, messageId: message.id });
  };
  if (replacing) {
    if (!(await store.claimChange(uid, message.id, now(), replacing, generation))) return "skipped";
  } else {
    const claim = options.reclaim ? store.reclaimMessage : options.retryFailed ? store.retryMessage : store.claimMessage;
    if (!(await claim(uid, message.id, now(), generation))) return "skipped";
  }
  const source = options.source ?? "gmail";
  const base = {
    messageId: message.id,
    uid,
    ...(source === "gmail" ? {} : { source }),
    from: message.from,
    subject: message.subject,
    ...(options.revision ? { revision: options.revision } : {}),
  };
  const record = (outcome: ParsedMessage["outcome"], extra: Partial<ParsedMessage> = {}): ParsedMessage => ({
    ...base,
    outcome,
    segmentIds: [],
    processedAt: now(),
    ...extra,
  });

  // Before a changed event's new outcome is written, its old bookings go:
  // all of them, or, if the user edited one or another source was matched to
  // one meanwhile, none, and the old record stands with the change noted.
  const releaseReplaced = async (): Promise<boolean> => {
    if (!replacing?.tripId || replacing.segmentIds.length === 0) return true;
    // The claim stops naming the bookings in the transaction that deletes
    // them, so a worker that dies before the new outcome leaves a claim that
    // is simply read again once it expires: not one pointing at deleted
    // bookings (which would read as the user's deletion and block the
    // change), nor one that forgot bookings still there.
    const cleared: ParsedMessage = { ...replacing, outcome: "processing", segmentIds: [], processedAt: now() };
    let kept: string[];
    try {
      ({ kept } = await removeOwnBookings(uid, { ...replacing, tripId: replacing.tripId }, deps, true, cleared, generation));
    } catch (error) {
      if (!(error instanceof ImportSupersededError)) throw error;
      log("import_superseded", { uid, messageId: message.id });
      return false;
    }
    if (!kept.length) return true;
    await save({ ...replacing, ...(options.revision ? { revision: options.revision } : {}), reason: changeKeptReason });
    log("calendar_change_kept", { uid, messageId: message.id, kept: kept.length });
    return false;
  };

  let reason = "requested by user";
  if (!options.force) {
    const verdict = options.prefilter
      ? options.prefilter(message)
      : prefilter(
          { from: message.from, subject: message.subject, listUnsubscribe: message.listUnsubscribe },
          await store.senderPatterns(uid),
        );
    if (!verdict.pass) {
      if (!(await releaseReplaced())) return "skipped";
      await save(record("filtered", { reason: verdict.reason }));
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
      if (!(await releaseReplaced())) return "skipped";
      await save(record("filtered", { reason: similar.reason }));
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
    // A changed event's old record comes back whole, its old revision
    // included, so the change is tried again next time.
    await save(replacing ?? record("failed", { reason: failure }));
    log("extract_failed", { uid, messageId: message.id, reason: failure });
    return "failed";
  }

  // A membership, pass or voucher the model took for a dated visit is no
  // trip; what else the email books still is.
  booking = { ...booking, segments: withoutValidityEnds(booking.segments) };
  const bought = notBookings(booking.segments);
  if (bought.length) {
    booking = { ...booking, segments: booking.segments.filter((segment) => !bought.includes(segment)) };
    if (booking.segments.length === 0) reason = "membership, pass or voucher";
    log("not_booking_segments", { uid, messageId: message.id, dropped: bought.length });
  }
  const range = segmentDateRange(booking.segments);
  if (!(await releaseReplaced())) return "skipped";
  if (!booking.isBooking || booking.segments.length === 0 || !range) {
    await save(record("not_booking", { reason }));
    await learn("others");
    log("not_booking", { uid, messageId: message.id });
    return "not_booking";
  }

  // A forwarded email is an email: its sender (the original one, read out of
  // the forwarding block) is learnable, and two alike may be one booking.
  const isEmail = source === "gmail" || source === "forward";
  const sender = isEmail ? senderDomain(message.from) : undefined;
  let filed;
  try {
    filed = await fileBooking(
      uid,
      {
        generation,
        sourceId: message.id,
        source,
        label: message.subject,
        segments: booking.segments,
        ...(source === "gmail" ? { gmailMessageIds: [message.id] } : {}),
        ...(sender ? { sender } : {}),
        // Events of a calendar are one list with an id each: two alike are
        // two reservations. Emails are not; one booking is often confirmed
        // twice.
        ...(isEmail ? {} : { distinctWithinSource: true }),
        ...(options.consumed ? { consumed: options.consumed } : {}),
      },
      deps,
    );
  } catch (error) {
    // The user deleted all their trips while this ran: nothing is filed
    // or recorded, and the next import reads the email again.
    if (!(error instanceof ImportSupersededError)) throw error;
    log("import_superseded", { uid, messageId: message.id });
    return "skipped";
  }
  const { tripId, segmentIds, duplicates, timestamp, matched } = filed;
  for (const id of matched) options.consumed?.add(id);
  await save(
    record("imported", {
      segmentIds,
      processedAt: timestamp,
      ...(duplicates ? { reason: duplicateReason(duplicates) } : {}),
      ...(matched.length ? { matchedSegmentIds: matched } : {}),
      ...(tripId ? { tripId } : {}),
    }),
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
  // How the user knows the source: the email's subject, the trip's name.
  label?: string;
  source: Exclude<SegmentSource, "manual">;
  segments: readonly ExtractedSegment[];
  gmailMessageIds?: string[];
  sender?: string;
  trip?: TripHint;
  // Never treat two of this source's own bookings as one.
  distinctWithinSource?: boolean;
  // The reset generation the import began under: a booking from before a
  // reset is not filed after it (ImportSupersededError).
  generation?: number;
  // Ids of existing segments already matched by earlier items of the same
  // import, which cannot stand in for another: matching is one to one, so
  // two alike TripIt rooms against one Gmail room leaves two rooms, and
  // against two Gmail rooms, two.
  consumed?: ReadonlySet<string>;
  // Existing segments ("tripId/segmentId") set aside for the item of the
  // same import whose confirmation number they carry (by its source id):
  // no other item may take them first by looking alike.
  reserved?: ReadonlyMap<string, string>;
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

// Records the bookings just written that still have a place to ask about,
// when the import's lookups were put off. Outside the transaction, and best
// effort: the bookings are already filed, so a queue that cannot be written
// costs a retry (logged), never the import.
async function recordRetries(uid: string, segments: readonly Segment[], deps: ImportDeps, generation?: number): Promise<void> {
  const store = deps.geocodeRetries;
  if (!store) return;
  for (const segment of segments.filter(needsGeocoding)) {
    try {
      await store.put({ uid, tripId: segment.tripId, segmentId: segment.id, at: deps.now() }, generation);
    } catch (error) {
      deps.log("geocode_retry_queue_failed", { uid, tripId: segment.tripId, segmentId: segment.id, reason: (error as Error).message });
    }
  }
}

// A place's country and coordinates, before anything is written: a flight's
// from its airport code (a table, no call), anything else's from the
// geocoder when there is one. Network calls stay outside the transaction,
// which Firestore may run more than once. A geocoder failure costs the
// country, never the booking.
async function placeSegments(uid: string, booking: BookingToFile, deps: ImportDeps): Promise<{ segments: readonly ExtractedSegment[]; deferred: number }> {
  const fromAirports = booking.segments.map((segment) => fillAirports(segment, airportPlace));
  if (!deps.geocode) return { segments: fromAirports, deferred: 0 };
  const { segments, filled, failed, deferred } = await enrichSegments(fromAirports, deps.geocode);
  if (filled || failed || deferred) deps.log("geocoded", { uid, source: booking.source, sourceId: booking.sourceId, filled, failed, deferred });
  return { segments, deferred };
}

// The part of every import after the booking is known, whatever it came
// from: trip assignment, duplicate detection against bookings already on the
// user's trips, and the segment writes, in one transaction serialized per
// user. A booking that matches one already imported from elsewhere (same
// type, time and route: sameBooking) is left out; when every one does,
// nothing is written.
export async function fileBooking(uid: string, incoming: BookingToFile, deps: ImportDeps): Promise<Filed> {
  const { store } = deps;
  const placed = await placeSegments(uid, incoming, deps);
  const booking = { ...incoming, segments: placed.segments };
  const range = segmentDateRange(booking.segments);
  if (!range) throw new Error(`booking ${booking.sourceId} has no segments`);
  const timestamp = deps.now();
  const overrides = (await deps.homeOverrides?.(uid)) ?? [];
  const result = await store.withUserLock(uid, async (tx) => {
    if (booking.generation !== undefined && tx.generation !== booking.generation) throw new ImportSupersededError();
    const trips = await tx.listTrips();
    const live = trips.filter((trip) => !trip.deleting);
    // The bookings of the year either side, for where home was around this
    // one (homeTimeline): enough round trips to tell, without reading every
    // trip the user ever took on every import.
    const nearby = overlappingTrips(live, { start: shiftDate(range.start, -homeWindowDays), end: shiftDate(range.end, homeWindowDays) });
    const segmentsByTrip = new Map(await Promise.all(nearby.map(async (trip) => [trip.id, await tx.listSegments(trip.id)] as const)));
    const segmentsOf = (tripId: string) => segmentsByTrip.get(tripId) ?? [];
    const periods = homeTimeline([...[...segmentsByTrip.values()].flat(), ...booking.segments]);
    // A source that is already one deduplicated list (a TripIt export) is
    // checked only against other sources: two alike reservations in it are
    // two rooms, not one booking seen twice.
    // A payment receipt with no time of its own may be dated weeks from the
    // booking it pays for (sameBooking), whichever came first.
    const existing = overlappingTrips(live, { start: shiftDate(range.start, -untimedMatchDays), end: shiftDate(range.end, untimedMatchDays) })
      .flatMap((trip) => segmentsOf(trip.id))
      .filter((other) => !booking.distinctWithinSource || other.source !== booking.source);
    const matchedTrips = new Set<string>();
    const matched: string[] = [];
    const matchedSegments: { segment: Segment; found: ExtractedSegment }[] = [];
    // A receipt filed first, found to be this booking: it takes this
    // booking's date, time and details.
    const upgrades = new Map<string, ExtractedSegment>();
    const ref: SourceRef = {
      kind: booking.source,
      id: booking.sourceId,
      ...(booking.label ? { label: booking.label } : {}),
      uid,
      at: timestamp,
    };
    // A booking found again keeps this source too, so nothing dropped as a
    // duplicate is lost from view, and whatever this one adds to it (seats
    // only the second email gives, its own reference: mergeDetails).
    // A booking it fills out (an end it lacked) can outgrow its trip, which
    // then widens to hold it, in this transaction, with the trip this
    // booking files into (`target`) widened once for both. A receipt this
    // booking upgrades is replaced instead, and its trip settled last
    // (settleUpgradedTrips).
    const merges: Segment[] = [];
    const recordSources = (target?: string) => {
      const changedTrips = new Set<string>();
      for (const { segment, found } of matchedSegments) {
        if (upgrades.has(`${segment.tripId}/${segment.id}`)) {
          const sources = segmentSources(segment).some((s) => s.kind === ref.kind && s.id === ref.id) ? segmentSources(segment) : [...segmentSources(segment), ref];
          // Filed anew as the booking: a fresh revision, and still unedited
          // (updatedAt its createdAt), as a booking written now would be, so a
          // sweep or a merge that read the receipt before this one retries.
          const upgraded: Segment = { ...segment, ...found, id: segment.id, tripId: segment.tripId, sources, createdAt: timestamp, updatedAt: timestamp };
          tx.putSegment(upgraded);
          upgradedSegments.set(`${segment.tripId}/${segment.id}`, upgraded);
          continue;
        }
        const merged = mergeDetails(segment, found);
        if (JSON.stringify(merged) === JSON.stringify(segment)) {
          tx.addSource(segment.tripId, segment.id, ref);
          continue;
        }
        const kept = (segment.sources ?? []).filter((s) => s.kind !== ref.kind || s.id !== ref.id);
        // Filled out by an import, not edited: one still unedited stays so
        // (updatedAt its createdAt, a fresh revision), so a receipt can
        // still become its booking and a calendar change replace it.
        const unedited = segment.updatedAt === segment.createdAt;
        const written = { ...merged, sources: [...kept, ref], ...(unedited ? { createdAt: timestamp } : {}), updatedAt: timestamp };
        tx.putSegment(written);
        merges.push(written);
        changedTrips.add(segment.tripId);
      }
      for (const tripId of changedTrips) {
        if (tripId === target) continue;
        const trip = live.find((t) => t.id === tripId);
        const want = growth(tripId);
        if (trip && want && (want.start < trip.start || want.end > trip.end)) {
          tx.extendTrip(tripId, { start: min(trip.start, want.start), end: max(trip.end, want.end), updatedAt: timestamp });
        } else tx.touchTrip(tripId, timestamp);
      }
    };
    // A trip holding an upgraded receipt spans what it ends up with: its
    // other bookings, the upgraded ones and those written now (and any
    // bounds this import already gave it). One that held only receipts
    // moves to those dates; one with other bookings only widens. Written
    // last, so it supersedes bounds set from the trip as first read.
    const upgradedSegments = new Map<string, Segment>();
    const wanted = new Map<string, { start: string; end: string }>();
    const settleUpgradedTrips = (written: readonly Segment[]) => {
      for (const tripId of new Set([...upgradedSegments.values()].map((segment) => segment.tripId))) {
        const trip = live.find((t) => t.id === tripId);
        if (!trip) continue;
        const before = segmentsOf(tripId);
        const final = [
          ...before.map((segment) => upgradedSegments.get(`${tripId}/${segment.id}`) ?? merges.find((m) => m.tripId === tripId && m.id === segment.id) ?? segment),
          ...written.filter((segment) => segment.tripId === tripId),
        ];
        const dates = segmentDateRange(final);
        if (!dates) continue;
        const onlyReceipts = before.every((segment) => upgradedSegments.has(`${tripId}/${segment.id}`));
        let bounds = onlyReceipts ? dates : { start: min(trip.start, dates.start), end: max(trip.end, dates.end) };
        const extra = wanted.get(tripId);
        if (extra) bounds = { start: min(bounds.start, extra.start), end: max(bounds.end, extra.end) };
        tx.extendTrip(tripId, { ...bounds, updatedAt: timestamp });
      }
    };
    // The dates the bookings of a trip this one matched span once filled out
    // (or, for a receipt it upgrades, once it is this booking).
    const growth = (tripId: string) =>
      segmentDateRange(
        matchedSegments
          .filter((m) => m.segment.tripId === tripId)
          .map((m) => (upgrades.has(`${m.segment.tripId}/${m.segment.id}`) ? m.found : mergeDetails(m.segment, m.found))),
      );
    const taken = (other: Segment) => {
      const key = `${other.tripId}/${other.id}`;
      const owner = booking.reserved?.get(key);
      return booking.consumed?.has(key) || matched.includes(key) || (owner !== undefined && owner !== booking.sourceId);
    };
    const fresh = booking.segments
      .map((segment, index) => ({ segment, id: `${booking.sourceId}-${index}` }))
      .filter(({ segment, id }) => {
        // One event confirmed by two emails under two references is one
        // booking too (sameEvent).
        const candidate = (other: Segment) =>
          other.id !== id && !taken(other) && (sameBooking(other, segment) || sameEvent(other, segment, other.sender, booking.sender));
        // A booking set aside for this item comes first: matching a lookalike
        // instead would strand it, reserved for an item already done. Of the
        // rest, the likeliest (matchRank): a receipt goes to the booking with
        // its reference before one that merely shares a name.
        const best = (others: Segment[]) =>
          others.reduce<Segment | undefined>((top, other) => (top && compareMatchRanks(matchRank(top, segment), matchRank(other, segment)) <= 0 ? top : other), undefined);
        const match =
          existing.find((other) => booking.reserved?.get(`${other.tripId}/${other.id}`) === booking.sourceId && candidate(other)) ??
          best(existing.filter(candidate));
        if (match) {
          // Only a receipt nobody edited: one the user corrected by hand
          // keeps what they wrote, and gains this source.
          if (isPaymentReceipt(match) && !isPaymentReceipt(segment) && match.updatedAt === match.createdAt) upgrades.set(`${match.tripId}/${match.id}`, segment);
          matchedTrips.add(match.tripId);
          matched.push(`${match.tripId}/${match.id}`);
          matchedSegments.push({ segment: match, found: segment });
        }
        return !match;
      });
    const duplicates = booking.segments.length - fresh.length;
    const freshRange = segmentDateRange(fresh.map((f) => f.segment));
    if (!freshRange) {
      recordSources();
      settleUpgradedTrips([]);
      return { segmentIds: [], duplicates, matched, written: [...merges, ...upgradedSegments.values()] };
    }

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
      // With home known, a day out at home and a trip away never join by
      // nearness of dates (findTripForBooking).
      const assignable = live.filter((trip) => !trip.id.startsWith(holdingTripPrefix));
      target = assignable.find((trip) => matchedTrips.has(trip.id)) ?? findTripForBooking(assignable, segmentsOf, booking.segments, periods, overrides);
    }
    let tripId: string;
    if (target) {
      tripId = target.id;
      // Only the bounds: sharing and title belong to the owner, who may be
      // editing them right now.
      // A source's own trip dates (a TripIt itinerary) widen it too, so a
      // later booking within them finds this trip.
      const own = hint ? { start: min(hint.start, freshRange.start), end: max(hint.end, freshRange.end) } : freshRange;
      const filled = growth(tripId);
      const want = filled ? { start: min(own.start, filled.start), end: max(own.end, filled.end) } : own;
      wanted.set(tripId, want);
      // A trip of nothing but a ride from the airport, still named for its
      // route, takes the name of the flight's trip once the flight joins it.
      // Home may have been unknown when it was named ("Heathrow to London").
      const held = segmentsOf(tripId);
      const routeNamed = [tripTitle(held, periods, overrides), tripTitle(held)].includes(target.title);
      const renamed =
        held.length > 0 && held.every(isTransfer) && routeNamed
          ? tripTitle([...held, ...booking.segments].sort((a, b) => compareInstants(a.start, b.start)), periods, overrides)
          : undefined;
      tx.extendTrip(tripId, {
        start: min(target.start, want.start),
        end: max(target.end, want.end),
        ...(renamed && renamed !== target.title ? { title: renamed } : {}),
        updatedAt: timestamp,
      });
    } else {
      // A hinted id still taken by a trip being deleted cannot be reused.
      tripId = hint && !trips.some((trip) => trip.id === hint.id) ? hint.id : store.newId();
      tx.createTrip({
        id: tripId,
        title: hint?.title ?? tripTitle(booking.segments, periods, overrides),
        start: hint ? min(hint.start, freshRange.start) : freshRange.start,
        end: hint ? max(hint.end, freshRange.end) : freshRange.end,
        ownerUid: uid,
        sharedWith: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    recordSources(target ? tripId : undefined);
    const written: Segment[] = fresh.map(({ segment, id }) => ({
      ...segment,
      id,
      tripId,
      source: booking.source,
      gmailMessageIds: booking.gmailMessageIds ?? [],
      sources: [ref],
      ...(booking.sender ? { sender: booking.sender } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    for (const segment of written) tx.putSegment(segment);
    settleUpgradedTrips(written);
    return { tripId, segmentIds: written.map((s) => s.id), duplicates, matched, written: [...written, ...merges, ...upgradedSegments.values()] };
  });
  // A place the budget put off is asked about again by the daily sweep,
  // a receipt this booking upgraded included.
  const { written, ...filed } = result;
  // So is one a booking found again took from this one; both only while
  // the trips have not been reset since the import began.
  if (placed.deferred && written.length) await recordRetries(uid, written, deps, booking.generation);
  return { ...filed, timestamp };
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
  // As for an email: read first, and everything below gives up once the
  // user deletes all their trips meanwhile.
  const generation = item.generation ?? (await store.resetGeneration(uid));
  const save = async (r: ParsedMessage) => {
    if (!(await store.setParsedIfCurrent(r, generation))) log("import_superseded", { uid, source: item.source, id: item.id });
  };
  // Reclaim, not claim: an item that failed is tried again on the next
  // upload; one already imported, or being imported, is not.
  if (!(await store.reclaimMessage(uid, item.id, now(), generation))) {
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
        generation,
        sourceId: item.id,
        source: item.source,
        label: item.title,
        segments: item.segments,
        distinctWithinSource: true,
        ...(item.trip ? { trip: item.trip } : {}),
        ...(item.consumed ? { consumed: item.consumed } : {}),
        ...(item.reserved ? { reserved: item.reserved } : {}),
      },
      deps,
    );
  } catch (error) {
    if (error instanceof ImportSupersededError) {
      log("import_superseded", { uid, source: item.source, id: item.id });
      return { outcome: "skipped", segments: 0, duplicates: 0, matched: [] };
    }
    const reason = (error as Error).message;
    await save({ ...base, outcome: "failed", reason, segmentIds: [], processedAt: now() });
    log("import_failed", { uid, source: item.source, id: item.id, reason });
    return { outcome: "failed", segments: 0, duplicates: 0, matched: [] };
  }
  await save({
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

// Matching is one item at a time, so without this an item that only looks
// like an existing booking (TripIt trip objects carry no confirmation
// numbers) could take it before the item whose confirmation number it
// carries got there. Each existing booking another source made is set aside
// for the first item of the export whose segment matches it by reference.
export function reserveByReference(
  items: readonly { id: string; segments: readonly ExtractedSegment[] }[],
  existing: readonly Segment[],
  consumed: ReadonlySet<string>,
): Map<string, string> {
  const reserved = new Map<string, string>();
  for (const item of items) {
    for (const segment of item.segments) {
      if (!segment.confirmation) continue;
      const match = existing.find((other) => {
        const key = `${other.tripId}/${other.id}`;
        return other.confirmation && !reserved.has(key) && !consumed.has(key) && sameBooking(other, segment);
      });
      if (match) reserved.set(`${match.tripId}/${match.id}`, item.id);
    }
  }
  return reserved;
}

async function otherSourcesSegments(uid: string, source: Segment["source"], deps: ImportDeps): Promise<Segment[]> {
  return (await deps.store.listUserSegments(uid)).filter((segment) => segment.source !== source);
}

export async function importTripIt(
  uid: string,
  parsed: TripItImport,
  deps: ImportDeps,
  // Called before each item; throwing stops the import there (its finished
  // items stay recorded), as when the upload's lease was lost.
  options: { beforeEach?: () => void } = {},
): Promise<TripItCounts> {
  const counts: TripItCounts = { trips: 0, imported: 0, duplicates: 0, skipped: 0, failed: 0 };
  // Before the records and bookings planned against below: a reset after
  // this makes every item give up, rather than file against what it removed.
  const generation = await deps.store.resetGeneration(uid);
  // Matching against other sources is one to one across the whole export:
  // an existing booking that one item matched cannot stand in for another.
  const consumed = new Set<string>();
  // On a retried upload, what items imported last time matched is reserved
  // before any item is tried again, whatever the order of the export.
  const items = [
    ...parsed.trips.map((t) => ({ id: `tripit-${t.key}`, segments: t.segments })),
    ...parsed.unfiled.map((u) => ({ id: `tripit-unfiled-${u.key}`, segments: u.segments })),
  ];
  // Items this upload will skip (imported before, or being imported) plan
  // nothing: their matches are already in `consumed`, and a reservation for
  // them would only keep a booking from the item that needs it.
  const settled = new Set<string>();
  for (const previous of await Promise.all(items.map((item) => deps.store.getParsed(uid, item.id)))) {
    if (previous?.outcome === "imported") for (const id of previous.matchedSegmentIds ?? []) consumed.add(id);
    if (previous && !reclaimable(previous, deps.now())) settled.add(previous.messageId);
  }
  const toFile = items.filter((item) => !settled.has(item.id));
  let reserved = new Map<string, string>();
  if (toFile.some((item) => item.segments.some((s) => s.confirmation))) {
    try {
      reserved = reserveByReference(toFile, await otherSourcesSegments(uid, "tripit", deps), consumed);
    } catch (error) {
      // Only the matching order depends on it: the import goes ahead, item
      // by item, at worst keeping an extra booking.
      deps.log("reserve_failed", { uid, reason: (error as Error).message });
    }
  }
  const tally = (result: StructuredResult) => {
    for (const id of result.matched) consumed.add(id);
    counts.imported += result.segments;
    counts.duplicates += result.duplicates;
    if (result.outcome === "skipped") counts.skipped += 1;
    if (result.outcome === "failed") counts.failed += 1;
  };
  for (const trip of parsed.trips) {
    options.beforeEach?.();
    const result = await importStructured(
      uid,
      {
        id: `tripit-${trip.key}`,
        source: "tripit",
        title: trip.title,
        segments: trip.segments,
        generation,
        consumed,
        reserved,
        trip: { id: tripItTripId(uid, trip.key), title: trip.title, start: trip.start, end: trip.end, joinOverlapping: true },
      },
      deps,
    );
    if (result.outcome === "imported") counts.trips += 1;
    tally(result);
  }
  for (const item of parsed.unfiled) {
    options.beforeEach?.();
    const range = segmentDateRange(item.segments)!;
    tally(
      await importStructured(
        uid,
        {
          id: `tripit-unfiled-${item.key}`,
          source: "tripit",
          title: item.title,
          segments: item.segments,
          generation,
          consumed,
          reserved,
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
  options: ImportOptions = {},
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
    counts[await importMessage(uid, message, deps, options)] += 1;
  }
  return counts;
}

// A trip is named after where it goes: the city of its first destination
// away from home (or of any destination, while home is unknown), which suits
// flights and stays. A day out, nothing but tickets with no travel or stay
// and all on one day, is named after what it is: the place when the ticket
// is for the place itself, its title starting with the place's name
// (Hampton Court Palace for "Hampton Court Palace Admission", not the town it
// stands in), otherwise the event ("Toy Story 5 at Everyman Muswell Hill",
// The Graham Norton Show, not London or Television Centre). So is a course
// of several days: one ticket that spans them, or one a day whose titles
// differ only in the day ("Holiday Camp - Junior Group (Day 2)"). Dates are
// compared as written, in local time. A trip is named after where its
// journeys and stays go before a car or transfer's drop-off: a car to
// Stansted for a flight to Stockholm makes a Stockholm trip.
export function tripTitle(
  segments: readonly ExtractedSegment[],
  periods: readonly HomePeriod[] = [],
  overrides: readonly HomePeriod[] = [],
): string {
  const first = segments[0];
  // Nothing but a ride, from the airport home say: named by its route, not
  // as a trip to the home town.
  if (first && segments.every(isTransfer)) return transferTitle(first, periods, overrides)!;
  const days = new Set(segments.flatMap((s) => [s.start, s.end].filter((t) => t !== undefined).map((t) => t.slice(0, 10))));
  if (first && segments.every((s) => s.type === "activity")) {
    if (days.size === 1) {
      const venue = first.destination?.name;
      if (venue && first.title.toLowerCase().startsWith(venue.toLowerCase())) return venue;
      if (first.title) return first.title;
    }
    const course = new Set(segments.map((s) => withoutDay(s.title)));
    if (segments.length === 1 || (course.size === 1 && segments.some((s) => s.title !== withoutDay(s.title)))) return withoutDay(first.title);
  }
  // Known home is not where a trip goes: a train out of London to Liverpool
  // makes a Liverpool trip, even booked as its return leg alone.
  const ordered = [...segments.filter((s) => !isTransfer(s)), ...segments.filter(isTransfer)];
  const place = awayPlace(ordered, periods, overrides) ?? ordered.find((s) => s.destination)?.destination;
  return place?.city ?? place?.name ?? segments[0]?.title ?? "Trip";
}

// A title without the day of a course it names: "(Day 2)", "- Day 2".
const withoutDay = (title: string) => title.replace(/\s*(?:\(\s*day\s+\d+\s*\)|[-–:]\s*day\s+\d+)\s*$/i, "").trim() || title;

// How far either side of a booking the importer reads trips to work out
// where home was, in days.
const homeWindowDays = 365;

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

export type CalendarCounts = ImportCounts & {
  recurring: number;
  cancelled: number;
  remaining: number;
  removed: number;
  updated: number;
  // Travelmo's own exported events, met again through a calendar: never
  // read back in, or every trip would come in twice.
  exported: number;
};

// Deletes the bookings an imported calendar event made that are still just
// what it made: one the user edited, or that another email or import has
// since been matched to, is kept. With `allOrNothing`, nothing is deleted
// unless every one can be. `then`, when given, is written in the same
// transaction as the deletion, so a record never stops naming bookings that
// are still there, nor names ones that are gone.
async function removeOwnBookings(
  uid: string,
  record: ParsedMessage & { tripId: string },
  deps: ImportDeps,
  allOrNothing: boolean,
  then?: ParsedMessage,
  // The reset generation the caller read before the record: once trips have
  // been reset since, nothing is removed (ImportSupersededError), since the
  // bookings there now came from a later import.
  generation?: number,
): Promise<{ removed: string[]; kept: string[] }> {
  const tripId = record.tripId;
  const timestamp = deps.now();
  return deps.store.withUserLock(uid, async (tx) => {
    if (generation !== undefined && tx.generation !== generation) throw new ImportSupersededError();
    const segments = await Promise.all(record.segmentIds.map((id) => tx.getSegment(tripId, id)));
    const removable: string[] = [];
    const kept: string[] = [];
    for (const [i, segment] of segments.entries()) {
      if (!segment) {
        // Gone from the trip it was filed in: the user moved it to another
        // trip or deleted it. A replacement must not undo either.
        if (allOrNothing) kept.push(record.segmentIds[i]!);
        continue;
      }
      const others = segmentSources(segment).filter((s) => s.id !== record.messageId);
      if (segment.updatedAt === segment.createdAt && others.length === 0) removable.push(segment.id);
      else kept.push(segment.id);
    }
    if (allOrNothing && kept.length) return { removed: [], kept: [...kept, ...removable] };
    for (const id of removable) tx.deleteSegment(tripId, id);
    if (removable.length) tx.touchTrip(tripId, timestamp);
    if (then) tx.putParsed(then);
    return { removed: removable, kept };
  });
}

// An event cancelled after it was imported takes its booking with it, but
// only a booking that is still just what the calendar made.
export async function cancelImported(uid: string, recordId: string, deps: ImportDeps, generation?: number): Promise<number> {
  const { store, now, log } = deps;
  // Read before the record, so a reset after it keeps its record deleted.
  const current = generation ?? (await store.resetGeneration(uid));
  const record = await store.getParsed(uid, recordId);
  if (record?.outcome !== "imported" || !record.tripId || record.segmentIds.length === 0) return 0;
  const timestamp = now();
  let removed: string[];
  let kept: string[];
  try {
    ({ removed, kept } = await removeOwnBookings(uid, { ...record, tripId: record.tripId }, deps, false, undefined, current));
  } catch (error) {
    if (!(error instanceof ImportSupersededError)) throw error;
    log("import_superseded", { uid, id: recordId });
    return 0;
  }
  const saved = await store.setParsedIfCurrent(
    {
      ...record,
      outcome: "not_booking",
      reason: kept.length ? "cancelled in the calendar; edited or matched bookings kept" : "cancelled in the calendar",
      segmentIds: kept,
      processedAt: timestamp,
    },
    current,
  );
  if (!saved) log("import_superseded", { uid, id: recordId });
  log("cancelled", { uid, id: recordId, removed: removed.length, kept: kept.length });
  return removed.length;
}

const changeKeptReason = "changed in the calendar; edited or matched bookings kept";

// Whether a changed event's bookings may be replaced: none edited, moved or
// deleted by the user and none matched by another source. Checked before
// the model is asked, and again when they are removed.
async function replaceable(uid: string, record: ParsedMessage, deps: ImportDeps): Promise<boolean> {
  const tripId = record.tripId;
  if (!tripId || record.segmentIds.length === 0) return true;
  return deps.store.withUserLock(uid, async (tx) => {
    const segments = await Promise.all(record.segmentIds.map((id) => tx.getSegment(tripId, id)));
    return segments.every(
      (segment) => !!segment && segment.updatedAt === segment.createdAt && segmentSources(segment).every((s) => s.id === record.messageId),
    );
  });
}

export const calendarSender = "Calendar file";

// Each event goes through the email path: the title is the subject, the
// event's text (times already resolved where the file gives a zone) the
// body. Repeating and cancelled events are not bookings. Model calls are
// capped per request; events past the cap are left for the next upload of
// the same file, which skips everything already read.
export async function importCalendar(uid: string, calendar: IcsCalendar, deps: ImportDeps, maxRead: number): Promise<CalendarCounts> {
  const counts: CalendarCounts = { ...emptyCounts(), recurring: 0, cancelled: 0, remaining: 0, removed: 0, updated: 0, exported: 0 };
  // Before the records read below: a reset after this makes every event's
  // import give up rather than act on records it deleted.
  const generation = await deps.store.resetGeneration(uid);
  const travel = isTravelCalendar(calendar);
  let read = 0;
  // One to one across the file, and across uploads of it: what events
  // imported last time matched is reserved before any is read again.
  const consumed = new Set<string>();
  const live = calendar.events.filter((e) => !e.recurring && !e.cancelled && !e.exported);
  const previousRecords = new Map<string, ParsedMessage>();
  for (const previous of await Promise.all(live.map((e) => deps.store.getParsed(uid, `ics-${e.key}`)))) {
    if (!previous) continue;
    previousRecords.set(previous.messageId, previous);
    // A claim mid-change still holds its old matches until its new outcome
    // is written; only the worker that makes the change frees them (below).
    if (previous.outcome === "imported" || previous.outcome === "processing") {
      for (const id of previous.matchedSegmentIds ?? []) consumed.add(id);
    }
  }
  // Changed events go first: one whose earlier match moves elsewhere frees
  // that booking before a new event that describes it is matched, so the
  // result does not depend on the order of the file.
  const changedFirst = (event: IcsEvent) => {
    const previous = previousRecords.get(`ics-${event.key}`);
    return previous !== undefined && previous.revision !== undefined && previous.revision !== stableHash(icsEventText(event));
  };
  const ordered = [...calendar.events.filter(changedFirst), ...calendar.events.filter((e) => !changedFirst(e))];
  for (const event of ordered) {
    if (event.exported) {
      counts.exported += 1;
      continue;
    }
    if (event.recurring) {
      counts.recurring += 1;
      continue;
    }
    if (event.cancelled) {
      counts.cancelled += 1;
      counts.removed += await cancelImported(uid, `ics-${event.key}`, deps, generation);
      continue;
    }
    if (read >= maxRead) {
      counts.remaining += 1;
      continue;
    }
    const message: EmailMessage = {
      id: `ics-${event.key}`,
      threadId: "",
      from: calendarSender,
      subject: event.summary,
      date: event.stamp ?? "",
      listUnsubscribe: false,
      text: icsEventText(event),
    };
    // The text read, not the file's timestamps: some calendars restamp
    // every event on each export, which would read everything daily.
    const revision = stableHash(message.text);
    const previous = previousRecords.get(message.id);
    // Changed since it was read, or a change a dead worker left half done
    // (a claim still naming its bookings or its matches).
    const changed =
      previous !== undefined &&
      previous.outcome !== "failed" &&
      (previous.outcome === "processing"
        ? previous.segmentIds.length > 0 || (previous.matchedSegmentIds?.length ?? 0) > 0
        : previous.revision !== revision);
    if (changed && previous.revision === undefined && previous.outcome !== "processing") {
      // Read before revisions were kept: this text becomes the baseline.
      await deps.store.replaceIfUnchanged(uid, previous, { ...previous, revision }, deps.now(), generation);
      counts.skipped += 1;
      continue;
    }
    if (changed && !(await replaceable(uid, previous, deps))) {
      // Only over the record as read: another read may have changed it since.
      if (previous.revision !== revision) {
        await deps.store.replaceIfUnchanged(uid, previous, { ...previous, revision, reason: changeKeptReason }, deps.now(), generation);
      }
      counts.skipped += 1;
      continue;
    }
    // Its own earlier matches are free for the new read to take again.
    if (changed) for (const id of previous.matchedSegmentIds ?? []) consumed.delete(id);
    // A failed event is read again on the next upload; one already judged
    // is not, unless its text changed, so a re-upload costs only what it has
    // not done yet.
    const outcome = await importMessage(uid, message, deps, {
      source: "ics",
      generation,
      retryFailed: true,
      consumed,
      revision,
      ...(changed ? { replacing: previous } : {}),
      prefilter: (m) => calendarPrefilter(m.subject, travel),
    });
    if (outcome === "imported" || outcome === "not_booking" || outcome === "failed") read += 1;
    counts[outcome] += 1;
    if (changed && outcome !== "skipped" && outcome !== "failed") counts.updated += 1;
    // A change that failed or was not made leaves the old record, and its
    // matches, standing: they stay reserved against the events after it.
    if (changed && (outcome === "skipped" || outcome === "failed")) for (const id of previous.matchedSegmentIds ?? []) consumed.add(id);
  }
  return counts;
}
