import {
  enrichSegments,
  fillAirports,
  fillCities,
  awayPlace,
  isConnection,
  opensTrip,
  compareInstants,
  courseName,
  findTripForBooking,
  outingRuns,
  isTransfer,
  transferTitle,
  cancels,
  stripForwardPrefix,
  unwrapForwarded,
  pendingCancellationExpired,
  stillWaiting,
  canonicalTravelers,
  notePeople,
  type PersonDoc,
  inTrip,
  isCancelled,
  liveBounds,
  tripFlagsToWrite,
  type TripFlags,
  bookedDateRange,
  displayBounds,
  normalizeReference,
  type ExtractedBooking,
  type ExtractedCancellation,
  homeTimeline,
  homesWithAirports,
  rebookedFlights,
  type ChosenHomeAirports,
  type HomePeriod,
  icsEventText,
  isTravelCalendar,
  isPaymentReceipt,
  liveSegments,
  mentionsPayment,
  compareMatchRanks,
  matchRank,
  notBookings,
  oneBookingPerEvent,
  withoutValidityEnds,
  type IcsCalendar,
  type IcsEvent,
  mergeDetails,
  mergedBookingOf,
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
  type PendingCancellation,
  type Segment,
  type SegmentSource,
  type SourceRef,
  type Trip,
  type TripItImport,
  untimedMatchDays,
  foundLoyaltyFrom,
  type ExtractedMembership,
  type FoundLoyalty,
  type NamedBooking,
} from "@travelmo/core";
import { airportPlace } from "@travelmo/core/airportPlaces";
import { cityCountry } from "@travelmo/core/cityCountries";
import { readerVersion, type Extractor } from "./extract";
import { senderCounts } from "./senderStats";
import type { RetryStore } from "./geocodeSweep";
import { isNotFound, type Attachment, type EmailMessage } from "./gmail";
import type { MailProvider } from "./mailSource";
import { calendarPrefilter, isTravelStatement, prefilter, senderDomain, statementReason, type PrefilterResult, type SenderPatterns } from "./prefilter";
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
  // Moves the trip's revision, as any change to its bookings must, and
  // renames it when given a title (settleTitles in fileBooking).
  touchTrip(tripId: string, updatedAt: string, title?: string): void;
  // When the person now travels (liveBounds), or none: beside the trip's
  // own dates, which stay its full span.
  setLiveBounds(tripId: string, bounds: { start: string; end: string } | undefined): void;
  // What the trip list's filters need of its bookings (tripFlags).
  setTripFlags(tripId: string, flags: TripFlags): void;
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
  // How many mailboxes (Gmail's, Fastmail's and IMAP ones) the user connected, whose
  // reading positions a reset clears (a read), and clearing those it found
  // (two writes each), so a reset forgets the places in the same
  // transaction that moves the generation on.
  connectedMailboxes(): Promise<number>;
  clearBackfill(): void;
  // Cancellations not yet matched to a booking (see markCancelled).
  listPendingCancellations(uid: string): Promise<PendingCancellation[]>;
  putPendingCancellation(pending: PendingCancellation): void;
  deletePendingCancellation(uid: string, messageId: string): void;
  // The people the user's bookings name (SPEC "Travelers"), read before any
  // write, and one written as a booking teaches more of them (notePeople).
  listPeople(uid: string): Promise<PersonDoc[]>;
  putPerson(uid: string, person: PersonDoc): void;
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

// The record a claim writes: what the email is (its source, sender,
// subject, date, and the reader that last judged it) is kept, so a claim
// whose worker died is still known for what it was: "Refresh from email"
// reads a stale one from a travel sender again (refresh.ts `readAgain`).
export function claimRecord(existing: ParsedMessage | undefined, uid: string, messageId: string, processedAt: string): ParsedMessage {
  const kept = existing ? { source: existing.source, from: existing.from, subject: existing.subject, sentAt: existing.sentAt, readerVersion: existing.readerVersion } : {};
  const known = Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined));
  return { messageId, uid, ...known, outcome: "processing", segmentIds: [], processedAt };
}

// Whether a claim's lease ran out with no outcome written: its worker died.
export function staleClaim(existing: ParsedMessage, now: string): boolean {
  return existing.outcome === "processing" && leaseExpired(existing, now);
}

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
  // Up to `limit` of the user's import records that made bookings, were
  // found not to be one, failed or are being read (outcome "imported",
  // "not_booking", "failed" or "processing"), in order of
  // id, after the one with id `after`: what "Refresh from email" picks the
  // emails to read again from (refresh.ts).
  refreshRecords(uid: string, after: string | undefined, limit: number): Promise<ParsedMessage[]>;
  // Every booking in the user's own live trips, read outside any lock: a
  // snapshot for planning an import, never for deciding a write.
  listUserSegments(uid: string): Promise<Segment[]>;
  // One booking, read outside any lock.
  readSegment(tripId: string, segmentId: string): Promise<Segment | undefined>;
  // Runs fn serialized per user, so two overlapping imports cannot both
  // decide to create a trip for the same dates.
  withUserLock<T>(uid: string, fn: (tx: TripTx) => Promise<T>): Promise<T>;
  senderPatterns(uid: string): Promise<SenderPatterns>;
  // The name on the user's account (their Google profile's), if known.
  ownerName(uid: string): Promise<string | undefined>;
  // Adds loyalty memberships read from the user's booking emails to their
  // travel profile (withFoundLoyalties), starting the profile if need be;
  // `refused`: new ones left out because the list was full.
  addFoundLoyalty(uid: string, found: readonly FoundLoyalty[]): Promise<{ refused: number }>;
  // Embeddings of emails the model has judged for this user (see similarity.ts).
  examples(uid: string): Promise<Examples>;
  saveExample(uid: string, label: ExampleLabel, example: Example): Promise<void>;
  // Adds to a sender domain's counts (senderStats.ts): no user, no email.
  countSender(domain: string, counts: Readonly<Record<string, number>>): Promise<void>;
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
  // The airports the user chose for their homes (Profile), over those worked out.
  chosenHomeAirports?: (uid: string) => Promise<readonly ChosenHomeAirports[]>;
  now: () => string;
  // At INFO unless said otherwise.
  log: (event: string, fields: Record<string, unknown>, severity?: "WARNING") => void;
};

export type ImportOutcome = Exclude<ParsedMessage["outcome"], "processing"> | "skipped";

// What an import found on its way, filled in for "Import anyway"'s report
// (debugReport.ts): how many PDFs went to the model, what the model
// answered, or why it failed. Never stored or logged: the person reads it.
export type ImportDebug = { attachments?: number; extraction?: ExtractedBooking; error?: string };

export type ImportOptions = {
  // Filled in as the import goes, for a report of it (ImportDebug).
  debug?: ImportDebug;
  // A person's Import anyway (POST /gmail/reimport), counted apart from the
  // other reads that skip the pre-filter (a forward, Refresh from email's
  // reading again): senderStats.ts.
  importAnyway?: boolean;
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
  source?: EmailSource;
  prefilter?: (message: EmailMessage) => PrefilterResult;
};

// Where a message read like an email came from: a mailbox (Gmail,
// Fastmail, IMAP), the forwarding address, or a calendar event.
export type EmailSource = "gmail" | "fastmail" | "imap" | "ics" | "forward";

// Whether an email was forwarded to the user rather than sent to them: its
// subject says so ("Fwd:", "FW:"), or its body carries a forwarded message's
// header, as mail clients write one.
export function forwarded(message: Pick<EmailMessage, "subject" | "text">): boolean {
  if (/^\s*(fwd?|fw)\s*:/i.test(message.subject)) return true;
  return /-{3,} ?Forwarded message ?-{3,}|Begin forwarded message:|-{3,} ?Original Message ?-{3,}/i.test(message.text);
}

export async function importMessage(
  uid: string,
  message: EmailMessage,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const outcome = await importOnce(uid, message, deps, options);
  await countOutcome(message, outcome, deps, options);
  return outcome;
}

// Adds what came of an email to its sender domain's counts (senderStats.ts),
// for tuning the reader across everyone: the domain and counts alone. A
// count that fails is logged and the import stands.
async function countOutcome(message: EmailMessage, outcome: ImportOutcome, deps: ImportDeps, options: ImportOptions): Promise<void> {
  const source = options.source ?? "gmail";
  if (source === "ics" || outcome === "skipped") return;
  const domain = senderDomain((source === "forward" ? unwrapForwarded(message) : message).from);
  if (!domain) return;
  try {
    await deps.store.countSender(domain, senderCounts(outcome, !!options.importAnyway));
  } catch (error) {
    deps.log("sender_count_failed", { domain, outcome, reason: (error as Error).message }, "WARNING");
  }
}

async function importOnce(
  uid: string,
  message: EmailMessage,
  deps: ImportDeps,
  options: ImportOptions,
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
  // When what the email carries was sent (the original's, for a forward).
  const sent = originalSentAt(message, source);
  // When it was sent, for the review list's dates: a forward's original,
  // else its own Date line.
  const sentOn = sent ?? sentAt(message.date);
  const base = {
    messageId: message.id,
    uid,
    ...(source === "gmail" ? {} : { source }),
    from: message.from,
    subject: message.subject,
    ...(options.revision ? { revision: options.revision } : {}),
    ...(sentOn ? { sentAt: sentOn } : {}),
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
    // Only a recent statement says what the balance is now; reading a whole
    // mailbox would otherwise send every old one to the model.
    if (reason === statementReason && sent && Date.parse(now()) - Date.parse(sent) > statementDays * 86_400_000) {
      if (!(await releaseReplaced())) return "skipped";
      await save(record("filtered", { reason: "old loyalty statement" }));
      log("filtered", { uid, messageId: message.id, reason: "old loyalty statement" });
      return "filtered";
    }
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

  const attachments = await attachmentsOf(message, (error) => log("attachments_failed", { uid, messageId: message.id, reason: error.message }));
  if (options.debug) options.debug.attachments = attachments.length;
  let booking;
  try {
    booking = await deps.extract(message, attachments);
    if (options.debug) options.debug.extraction = booking;
  } catch (error) {
    const failure = (error as Error).message;
    if (options.debug) options.debug.error = failure;
    // A changed event's old record comes back whole, its old revision
    // included, so the change is tried again next time.
    await save(replacing ?? record("failed", { reason: failure }));
    log("extract_failed", { uid, messageId: message.id, reason: failure });
    return "failed";
  }

  // A membership, pass or voucher the model took for a dated visit is no
  // trip; what else the email books still is.
  booking = { ...booking, segments: oneBookingPerEvent(withoutValidityEnds(booking.segments)) };
  const bought = notBookings(booking.segments);
  if (bought.length) {
    booking = { ...booking, segments: booking.segments.filter((segment) => !bought.includes(segment)) };
    if (booking.segments.length === 0) reason = "membership, pass or voucher";
    log("not_booking_segments", { uid, messageId: message.id, dropped: bought.length });
  }
  const range = segmentDateRange(booking.segments);
  if (!(await releaseReplaced())) return "skipped";
  // A cancellation is read from email only: a calendar's own cancelled
  // events are handled by `cancelImported`.
  if (booking.cancellations?.length && booking.segments.length === 0 && source !== "ics") {
    let marked;
    try {
      marked = await markCancelled(uid, message.id, booking.cancellations, deps, sent, generation);
    } catch (error) {
      // The user deleted all their trips while this ran: nothing is marked
      // or recorded, and the next import reads the email again.
      if (!(error instanceof ImportSupersededError)) throw error;
      log("import_superseded", { uid, messageId: message.id });
      return "skipped";
    }
    await save(record("cancellation", { reason: cancellationReason(marked.length), segmentIds: marked.map((m) => m.segmentId) }));
    await learn("bookings");
    log("cancellation", { uid, messageId: message.id, cancelled: marked.length });
    return "cancellation";
  }
  // A travel statement, whether the pre-filter passed it as one or it was
  // forwarded or read again on request, which skip the pre-filter: as there,
  // by its (original) sender and subject.
  const fromEmail = source !== "ics";
  const original = source === "forward" ? unwrapForwarded(message) : message;
  const statement =
    fromEmail &&
    (reason === statementReason || (!!options.force && (booking.memberships?.length ?? 0) > 0 && isTravelStatement(original, await store.senderPatterns(uid))));
  if (!booking.isBooking || booking.segments.length === 0 || !range) {
    // A travel loyalty statement (the pre-filter let it through for its
    // sender) is no booking, but its balance and status are kept; any other
    // email that is no booking keeps nothing.
    if (statement && booking.memberships?.length) await keepMemberships(uid, message, booking.memberships, booking.segments, now(), deps, sent);
    await save(record("not_booking", { reason, readerVersion }));
    await learn("others");
    log("not_booking", { uid, messageId: message.id });
    return "not_booking";
  }

  // A forwarded email is an email: its sender (the original one, read out of
  // the forwarding block) is learnable, and two alike may be one booking.
  const isEmail = source !== "ics";
  const sender = isEmail ? senderDomain(message.from) : undefined;
  // Outings on days apart (a weekly class booked for a term) are filed run
  // by run, each a day out of its own (outingRuns); their ids stay those of
  // the email's whole list, so a re-import finds them again. Only an
  // email's: a calendar event's record names the one trip its bookings are
  // in, for the change or cancellation that replaces or removes them.
  const runs = isEmail ? outingRuns(booking.segments) : [booking.segments];
  const filings: Filed[] = [];
  try {
    for (const run of runs) {
      filings.push(
        await fileBooking(
          uid,
          {
            generation,
            sourceId: message.id,
            source,
            label: message.subject,
            segments: run,
            ...(runs.length > 1 ? { indexes: run.map((s) => booking.segments.indexOf(s)) } : {}),
            ...(source === "gmail" ? { gmailMessageIds: [message.id] } : {}),
            ...(sender ? { sender } : {}),
            ...(isEmail && sent ? { sentAt: sent } : {}),
            // From the user's own mailbox and not forwarded: its travelers
            // are likely them (guessMe). One forwarded to the import address
            // says nothing either way.
            ...(source === "gmail" || source === "fastmail" || source === "imap" ? { direct: !forwarded(message) } : {}),
            // Events of a calendar are one list with an id each: two alike
            // are two reservations. Emails are not; one booking is often
            // confirmed twice.
            ...(isEmail ? {} : { distinctWithinSource: true }),
            ...(options.consumed ? { consumed: options.consumed } : {}),
          },
          deps,
        ),
      );
    }
  } catch (error) {
    // The user deleted all their trips while this ran: nothing is filed
    // or recorded, and the next import reads the email again.
    if (!(error instanceof ImportSupersededError)) throw error;
    log("import_superseded", { uid, messageId: message.id });
    return "skipped";
  }
  const tripId = filings.find((f) => f.tripId)?.tripId;
  const segmentIds = filings.flatMap((f) => f.segmentIds);
  const duplicates = filings.reduce((n, f) => n + f.duplicates, 0);
  const matched = filings.flatMap((f) => f.matched);
  const timestamp = filings[filings.length - 1]!.timestamp;
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
  // Only from an email that books travel: a ticket or an appointment that
  // shows a member number (a clinic's, a party's) keeps nothing.
  const booksTravel = booking.segments.some((segment) => travelTypes.has(segment.type));
  if (isEmail && booksTravel && booking.memberships?.length) await keepMemberships(uid, message, booking.memberships, booking.segments, timestamp, deps, sent);
  log("imported", { uid, messageId: message.id, tripId, segments: segmentIds.length, duplicates });
  return "imported";
}

// Loyalty numbers a booking email showed, kept on the user's travel profile
// (SPEC "Loyalty from emails"). Only the user's own: a fellow traveler's
// number on the same booking is theirs. Nothing here fails the import; the
// numbers never reach the logs, only counts.
async function keepMemberships(
  uid: string,
  message: EmailMessage,
  memberships: readonly ExtractedMembership[],
  segments: readonly ExtractedSegment[],
  at: string,
  deps: ImportDeps,
  sent: string | undefined,
): Promise<void> {
  try {
    const owner = await deps.store.ownerName(uid);
    // A balance and a status are as of when the email was sent, so an older
    // one never replaces a newer (withFoundLoyalty). How each is filed:
    // foundLoyaltyFrom.
    const kept = foundLoyaltyFrom(memberships, segments, owner, { messageId: message.id, label: message.subject, at, ...(sent ? { sent } : {}) });
    if (kept.length) {
      const { refused } = await deps.store.addFoundLoyalty(uid, kept);
      // Never reached in practice (maxFoundLoyalty); counts only.
      if (refused) deps.log("found_loyalty_full", { uid, messageId: message.id, refused }, "WARNING");
    }
    deps.log("memberships", { uid, messageId: message.id, found: memberships.length, kept: kept.length });
  } catch (error) {
    deps.log("memberships_failed", { uid, messageId: message.id, reason: (error as Error).message });
  }
}

// What a membership number is kept from: an email booking one of these.
const travelTypes = new Set<string>(["flight", "train", "bus", "ferry", "lodging", "car_rental"]);

// How old a loyalty statement may be and still be read.
const statementDays = 60;

const duplicateReason = (n: number) => `${n} already imported from elsewhere`;

function groupBy<T>(items: readonly T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k !== undefined) out.set(k, [...(out.get(k) ?? []), item]);
  }
  return out;
}

// An email's Date header as an instant, or undefined when it doesn't parse.
function sentAt(date: string | undefined): string | undefined {
  const ms = date ? Date.parse(date) : NaN;
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

// When the booking or cancellation an email carries was sent. A forward
// (by the forwarding address, or a Gmail message whose subject says so) is
// dated by its original's Date line, never the forward's: an old
// confirmation forwarded today is still old. Unknown when that line is
// missing or unreadable, which orders it against nothing.
export function originalSentAt(message: EmailMessage, source: string): string | undefined {
  const forwarded = source === "forward" || stripForwardPrefix(message.subject) !== message.subject.trim();
  return forwarded ? unwrapForwarded(message).date : sentAt(message.date);
}

// Whether an email carries only payments (a receipt, an invoice, a refund)
// and so books nothing: every segment is a payment receipt or says it is one,
// or the subject does.
// Timed or not: a "Payment confirmation" for a stay still books nothing.
function paymentOnly(segments: readonly ExtractedSegment[], subject?: string): boolean {
  if (mentionsPayment(subject)) return true;
  return segments.length > 0 && segments.every((s) => mentionsPayment(s.title));
}

// A cancellation email as the importer weighs it: when it was sent, if
// known, and what it names.
type CancellationSignal = Pick<PendingCancellation, "messageId" | "sentAt" | "cancellations" | "at">;

// Which cancellation stands for a booking, if any, from every email about it
// by the date it was sent, whichever order they were read in. The booking was
// confirmed by the emails it was read from (`confirmations`: their send times;
// receipts carry none); a cancellation that names it (`cancels`) and wasn't
// taken back (Restore) stands unless a confirmation was sent after it, and one
// sent at the same time as the latest confirmation still stands. Of those
// that stand, the latest wins; one of unknown date always stands but wins
// only when none is dated. The one the booking already records stays while
// it still stands and none later does, so reading an email again changes
// nothing. `waiting` are the cancellations still waiting for bookings;
// `all` also has the expired ones, for the date of the one recorded.
//
// The recorded one's date comes from the booking (`cancelledSentAt`), so
// cleanup deleting its waiting record changes nothing; a booking cancelled
// before that field existed falls back to the record while it remains, and
// is undated after.
type Standing = { messageId: string; sentAt?: string | undefined };
// Whether a cancellation names a booking (cancels), or one the user merged
// into it (mergedBookings): cancelling either cancels the one booking.
function cancelsBooking(c: ExtractedCancellation, segment: ExtractedSegment & Pick<Partial<Segment>, "mergedBookings">, sent?: string): boolean {
  return cancels(c, segment, sent) || (segment.mergedBookings ?? []).some((merged) => cancels(c, { ...segment, ...merged }, sent));
}
function standingCancellation(
  segment: ExtractedSegment & Pick<Partial<Segment>, "cancelledBy" | "cancelledSentAt" | "restoredFrom" | "restoredAt" | "mergedBookings">,
  confirmations: readonly (string | undefined)[],
  waiting: readonly CancellationSignal[],
  all: readonly CancellationSignal[],
): Standing | undefined {
  const restored = segment.restoredFrom ?? [];
  // Restore overrides every cancellation sent, or (undated) read, by then.
  const restoredAt = segment.restoredAt ? Date.parse(segment.restoredAt) : undefined;
  const overridden = (when: string | undefined) => restoredAt !== undefined && when !== undefined && Date.parse(when) <= restoredAt;
  const candidates = waiting
    .filter((p) => !restored.includes(p.messageId) && !overridden(p.sentAt ?? p.at) && p.cancellations.some((c) => cancelsBooking(c, segment, p.sentAt ?? p.at)))
    .map((p) => ({ messageId: p.messageId, sentAt: p.sentAt }));
  const recorded = segment.cancelledBy;
  if (recorded && !restored.includes(recorded) && !candidates.some((c) => c.messageId === recorded)) {
    const sentAt = segment.cancelledSentAt ?? all.find((p) => p.messageId === recorded)?.sentAt;
    if (!overridden(sentAt)) candidates.push({ messageId: recorded, sentAt });
  }
  const dated = confirmations.filter((t): t is string => t !== undefined).map((t) => Date.parse(t));
  const latest = dated.length > 0 ? Math.max(...dated) : undefined;
  const standing = candidates.filter((c) => latest === undefined || c.sentAt === undefined || Date.parse(c.sentAt) >= latest);
  if (standing.length === 0) return undefined;
  const when = (c: { sentAt?: string | undefined }) => (c.sentAt === undefined ? -Infinity : Date.parse(c.sentAt));
  const best = Math.max(...standing.map(when));
  const winners = standing.filter((c) => when(c) === best);
  return winners.find((c) => c.messageId === recorded) ?? winners[0]!;
}

// The booking as `standingCancellation` leaves it: cancelled by the one that
// stands (from `timestamp`, unless it already was by that one), else live.
function settled<S extends ExtractedSegment & Pick<Partial<Segment>, "cancelledAt" | "cancelledBy" | "cancelledSentAt" | "userCancelled">>(
  segment: S,
  by: Standing | undefined,
  timestamp: string,
): S {
  // The person's own word that it didn't happen outlasts every email; only
  // Restore takes it back.
  if (segment.userCancelled) return segment;
  if (by) {
    // Its date kept with it (filled in for one recorded before the field).
    if (segment.cancelledBy === by.messageId) return by.sentAt && !segment.cancelledSentAt ? { ...segment, cancelledSentAt: by.sentAt } : segment;
    const { cancelledSentAt: _old, ...rest } = segment;
    return { ...rest, cancelledAt: timestamp, cancelledBy: by.messageId, ...(by.sentAt ? { cancelledSentAt: by.sentAt } : {}) } as S;
  }
  if (!isCancelled(segment)) return segment;
  const { cancelledAt: _at, cancelledBy: _by, cancelledSentAt: _sent, ...live } = segment;
  return live as S;
}

// A booking as the cancellations waiting for bookings leave it, against the
// emails that confirmed it (`confirmations`, when each was sent), as an
// import files a new one: cancelled by one that stands, else live. For a
// booking another path adds (a refresh finding one the first reading missed).
export function withWaitingCancellations<S extends Segment>(segment: S, confirmations: readonly (string | undefined)[], pending: readonly PendingCancellation[], timestamp: string): S {
  const waiting = pending.filter((p) => !pendingCancellationExpired(p, timestamp)).map((p) => ({ ...p, cancellations: stillWaiting(p, timestamp) }));
  return settled(segment, standingCancellation(segment, confirmations, waiting, pending), timestamp);
}

// A rebooking: the flights of older emails under a reference of this one
// (`email`, sent at `sentAt`, finding `segments`), which it flies another way
// between the same cities (rebookedFlights), as filed cancelled by it, so the
// flight home that was never flown stops holding the trip open. Whole
// journeys are compared; a leg is cancelled only when this email is the
// newer word on it, it didn't come from this email, and the user hasn't
// restored it since (as standingCancellation honours Restore). One
// cancelled before this email was sent (an earlier rebooking) is compared
// too, so a later rebooking dates its cancellation afresh and an older
// confirmation can't revive it. Journeys are built from every flight under
// the reference before any is ruled out, so a leg this email kept still
// joins the original's journey. An email of payments only (a refund
// repeating an old itinerary) rebooks nothing. The caller leaves out the
// legs this email confirmed again (sameBooking). Shared by imports and
// Refresh from email.
export function rebookedByEmail(
  existing: readonly Segment[],
  segments: readonly ExtractedSegment[],
  email: { id: string; sentAt: string; subject?: string | undefined },
  timestamp: string,
): Segment[] {
  const { id, sentAt } = email;
  if (paymentOnly(segments, email.subject)) return [];
  const references = new Set(segments.flatMap((s) => (s.type === "flight" && s.confirmation ? [normalizeReference(s.confirmation)] : [])));
  const underReference = (other: Segment) => other.type === "flight" && other.confirmation !== undefined && references.has(normalizeReference(other.confirmation));
  const replaceable = (other: Segment) =>
    (!isCancelled(other) || (other.cancelledSentAt !== undefined && compareInstants(other.cancelledSentAt, sentAt) < 0)) &&
    segmentSources(other).every((s) => s.id !== id && (s.sentAt === undefined || compareInstants(s.sentAt, sentAt) < 0)) &&
    !(other.restoredFrom ?? []).includes(id) &&
    !(other.restoredAt !== undefined && compareInstants(sentAt, other.restoredAt) <= 0);
  return rebookedFlights(existing.filter(underReference), segments)
    .map(({ flight }) => flight)
    .filter(replaceable)
    .map((old) => {
      // Still unedited stays so (updatedAt its createdAt), as merges do.
      const unedited = old.updatedAt === old.createdAt;
      return { ...settled(old, { messageId: id, sentAt }, timestamp), ...(unedited ? { createdAt: timestamp } : {}), updatedAt: timestamp };
    });
}

export const cancellationReason = (n: number) =>
  n === 0 ? "no matching booking found" : n === 1 ? "cancelled 1 booking" : `cancelled ${n} bookings`;

// Marks the user's own bookings a cancellation email names (see `cancels`)
// as cancelled, keeping them on their trips. A booking already cancelled is
// left as it was, so reading the email again changes nothing.
export async function markCancelled(
  uid: string,
  messageId: string,
  cancellations: readonly ExtractedCancellation[],
  deps: ImportDeps,
  sent?: string,
  // The reset generation the import began under: once trips have been
  // reset since, nothing is marked or kept waiting (ImportSupersededError).
  generation?: number,
): Promise<{ tripId: string; segmentId: string }[]> {
  const timestamp = deps.now();
  return deps.store.withUserLock(uid, async (lockTx) => {
    const tx = settlingTripDates(lockTx, timestamp);
    if (generation !== undefined && tx.generation !== generation) throw new ImportSupersededError();
    // Only the user's own trips: a trip shared with them is someone else's
    // booking, which their email can't cancel.
    const trips = (await tx.listTrips()).filter((t) => t.ownerUid === uid && !t.deleting);
    // This email beside every other cancellation read: which one stands for
    // a booking is weighed from all of them by date (standingCancellation).
    const self: CancellationSignal = { messageId, cancellations: [...cancellations], at: timestamp, ...(sent ? { sentAt: sent } : {}) };
    const others = (await tx.listPendingCancellations(uid)).filter((p) => p.messageId !== messageId);
    const all = [...others, self];
    const waiting = [
      ...others.filter((p) => !pendingCancellationExpired(p, timestamp)).map((p) => ({ ...p, cancellations: stillWaiting(p, timestamp) })),
      self,
    ];
    const found: Segment[] = [];
    const changed: Segment[] = [];
    const segmentsOf = new Map<string, Segment[]>();
    for (const trip of trips) {
      const segments = await tx.listSegments(trip.id);
      segmentsOf.set(trip.id, segments);
      for (const segment of segments) {
        const named = cancellations.some((c) => cancelsBooking(c, segment, sent ?? timestamp));
        if (!named && segment.cancelledBy !== messageId) continue;
        const confirmations = (segment.sources ?? []).map((r) => r.sentAt);
        const after = settled(segment, standingCancellation(segment, confirmations, waiting, all), timestamp);
        if (named && isCancelled(after)) found.push(after);
        if (after !== segment) changed.push(after);
      }
    }
    for (const segment of changed) {
      // An import's mark, not the user's edit: an unedited booking stays so.
      const unedited = segment.updatedAt === segment.createdAt;
      tx.putSegment({ ...segment, ...(unedited ? { createdAt: timestamp } : {}), updatedAt: timestamp });
    }
    // A booking booked again widens its trip, as filing it would; when the
    // person now travels is settled once everything is written.
    for (const tripId of new Set(changed.map((s) => s.tripId))) {
      const trip = trips.find((t) => t.id === tripId)!;
      const live = segmentDateRange((segmentsOf.get(tripId) ?? []).map((s) => changed.find((c) => c.id === s.id) ?? s));
      if (live && (live.start < trip.start || live.end > trip.end)) {
        tx.extendTrip(tripId, { start: min(trip.start, live.start), end: max(trip.end, live.end), updatedAt: timestamp });
      } else tx.touchTrip(tripId, timestamp);
    }
    tx.settle(trips, (tripId) => segmentsOf.get(tripId) ?? []);
    // Every cancellation also waits for bookings imported later
    // (fileBooking): the mailbox is read newest first, and another leg under
    // the same reference may not have been read yet.
    tx.putPendingCancellation({ messageId, uid, cancellations: [...cancellations], at: timestamp, ...(sent ? { sentAt: sent } : {}) });
    return found.map((s) => ({ tripId: s.tripId, segmentId: s.id }));
  });
}

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
  // Each segment's place in the source's whole list, when this is only part
  // of it (outingRuns), for its id; its place here otherwise.
  indexes?: readonly number[];
  gmailMessageIds?: string[];
  sender?: string;
  // Whether the email came straight to the user rather than forwarded,
  // when that is known: it says the travelers it names are likely them.
  direct?: boolean;
  // When the source was sent (an email's Date), if known.
  sentAt?: string;
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
// from its airport code, a place in an unambiguous city from its name (both
// tables, no call), anything else's from the geocoder when there is one. Network calls stay outside the transaction,
// which Firestore may run more than once. A geocoder failure costs the
// country, never the booking.
export async function placeSegments(uid: string, booking: BookingToFile, deps: ImportDeps): Promise<{ segments: readonly ExtractedSegment[]; deferred: number }> {
  const fromAirports = booking.segments.map((segment) => fillCities(fillAirports(segment, airportPlace), cityCountry));
  if (!deps.geocode) return { segments: fromAirports, deferred: 0 };
  const { segments, filled, failed, deferred } = await enrichSegments(fromAirports, deps.geocode);
  if (filled || failed || deferred) deps.log("geocoded", { uid, source: booking.source, sourceId: booking.sourceId, filled, failed, deferred });
  return { segments, deferred };
}

// A transaction that remembers the trip dates and bookings it writes, so
// that once an import has written everything for an email (new, merged and
// upgraded bookings, and the cancellations they meet), `settle` records on
// each trip it touched when the person now travels (liveBounds), whichever
// path cancelled or revived a booking, and clears it once nothing is
// cancelled; and what the trip list's filters need (tripFlags). The trip's own dates are never narrowed: they stay the span its
// bookings are found again by.
export function settlingTripDates(tx: TripTx, timestamp: string): TripTx & { settle(trips: readonly Trip[], segmentsOf: (tripId: string) => readonly Segment[]): void } {
  const bounds = new Map<string, { start: string; end: string }>();
  const written = new Map<string, Map<string, Segment | undefined>>();
  const touched = new Set<string>();
  const gone = new Set<string>();
  const segmentWrites = (tripId: string) => written.get(tripId) ?? written.set(tripId, new Map()).get(tripId)!;
  const overrides: Partial<TripTx> = {
    createTrip(trip) {
      tx.createTrip(trip);
      bounds.set(trip.id, { start: trip.start, end: trip.end });
      touched.add(trip.id);
    },
    extendTrip(tripId, next) {
      tx.extendTrip(tripId, next);
      bounds.set(tripId, { start: next.start, end: next.end });
      touched.add(tripId);
    },
    updateTrip(tripId, fields) {
      tx.updateTrip(tripId, fields);
      bounds.set(tripId, { start: fields.start, end: fields.end });
      touched.add(tripId);
    },
    putSegment(segment) {
      tx.putSegment(segment);
      segmentWrites(segment.tripId).set(segment.id, segment);
      touched.add(segment.tripId);
    },
    deleteSegment(tripId, segmentId) {
      tx.deleteSegment(tripId, segmentId);
      segmentWrites(tripId).set(segmentId, undefined);
      touched.add(tripId);
    },
    deleteTrip(tripId) {
      tx.deleteTrip(tripId);
      gone.add(tripId);
    },
  };
  const settle = (trips: readonly Trip[], segmentsOf: (tripId: string) => readonly Segment[]) => {
    for (const tripId of touched) {
      if (gone.has(tripId)) continue;
      const trip = trips.find((t) => t.id === tripId);
      const now = bounds.get(tripId) ?? (trip ? { start: trip.start, end: trip.end } : undefined);
      if (!now) continue;
      const writes = written.get(tripId) ?? new Map<string, Segment | undefined>();
      const after = [
        ...segmentsOf(tripId).flatMap((s) => (writes.has(s.id) ? (writes.get(s.id) ?? []) : [s])),
        ...[...writes.entries()].flatMap(([id, s]) => (s && !segmentsOf(tripId).some((o) => o.id === id) ? [s] : [])),
      ];
      const next = liveBounds(now, after);
      if (next?.start !== trip?.liveStart || next?.end !== trip?.liveEnd) tx.setLiveBounds(tripId, next);
      const flags = tripFlagsToWrite(trip ?? {}, after);
      if (flags) tx.setTripFlags(tripId, flags);
    }
  };
  return new Proxy(tx, {
    get(target, key, receiver) {
      if (key === "settle") return settle;
      if (typeof key === "string" && key in overrides) return overrides[key as keyof TripTx];
      return Reflect.get(target, key, receiver);
    },
  }) as TripTx & { settle: typeof settle };
}

// The part of every import after the booking is known, whatever it came
// from: trip assignment, duplicate detection against bookings already on the
// user's trips, and the segment writes, in one transaction serialized per
// user. A booking that matches one already imported from elsewhere (same
// type, time and route: sameBooking) is left out; when every one does,
// nothing is written.
export async function fileBooking(uid: string, incoming: BookingToFile, deps: ImportDeps): Promise<Filed> {
  const { store, log } = deps;
  const placed = await placeSegments(uid, incoming, deps);
  // Each traveler as people write them, once (SPEC "Travelers").
  const booking = {
    ...incoming,
    segments: placed.segments.map((s) => {
      const { travelers: raw, ...rest } = s;
      const travelers = canonicalTravelers(raw);
      return travelers ? { ...rest, travelers } : rest;
    }),
  };
  const range = segmentDateRange(booking.segments);
  if (!range) throw new Error(`booking ${booking.sourceId} has no segments`);
  const timestamp = deps.now();
  const corrections = (await deps.homeOverrides?.(uid)) ?? [];
  const chosen = (await deps.chosenHomeAirports?.(uid)) ?? [];
  const result = await store.withUserLock(uid, async (lockTx) => {
    const tx = settlingTripDates(lockTx, timestamp);
    if (booking.generation !== undefined && tx.generation !== booking.generation) throw new ImportSupersededError();
    const trips = await tx.listTrips();
    const live = trips.filter((trip) => !trip.deleting);
    // The bookings of the year either side, for where home was around this
    // one (homeTimeline): enough round trips to tell, without reading every
    // trip the user ever took on every import.
    const nearby = overlappingTrips(live, { start: shiftDate(range.start, -homeWindowDays), end: shiftDate(range.end, homeWindowDays) });
    const segmentsByTrip = new Map(await Promise.all(nearby.map(async (trip) => [trip.id, await tx.listSegments(trip.id)] as const)));
    const segmentsOf = (tripId: string) => segmentsByTrip.get(tripId) ?? [];
    // Home as worked out and as corrected, each with the airports its round
    // trips leave from (withHomeAirports).
    const homes = (segments: readonly ExtractedSegment[]) => homesWithAirports(segments, corrections, chosen);
    let { periods, overrides } = homes([...[...segmentsByTrip.values()].flat(), ...booking.segments]);
    // Cancellations read before this booking was (the mailbox is read newest
    // first); read here, before any write, as a transaction requires.
    const pending = await tx.listPendingCancellations(uid);
    const people = await tx.listPeople(uid);
    // Who the bookings this email writes are for, matched to the user's
    // people or added: once for each booking that newly names them.
    const notePeopleIn = (bookings: NamedBooking[]) => {
      for (const person of notePeople(people, bookings, { direct: booking.direct === true, timestamp, newId: () => store.newId() })) {
        tx.putPerson(uid, person);
      }
    };
    // A source that is already one deduplicated list (a TripIt export) is
    // checked only against other sources: two alike reservations in it are
    // two rooms, not one booking seen twice.
    // A payment receipt with no time of its own may be dated weeks from the
    // booking it pays for (sameBooking), whichever came first.
    // Found by date in the trips around this booking, and by reference in
    // every trip read for the year either side, so no trip's dates can hide
    // a booking from its own confirmation sent again (sameBooking still
    // decides).
    const references = new Set(booking.segments.flatMap((s) => (s.confirmation ? [normalizeReference(s.confirmation)] : [])));
    const byDate = overlappingTrips(live, { start: shiftDate(range.start, -untimedMatchDays), end: shiftDate(range.end, untimedMatchDays) }).flatMap((trip) => segmentsOf(trip.id));
    const byReference = [...segmentsByTrip.values()]
      .flat()
      .filter((other) => other.confirmation && references.has(normalizeReference(other.confirmation)) && !byDate.includes(other));
    const existing = [...byDate, ...byReference].filter((other) => !booking.distinctWithinSource || other.source !== booking.source);
    const matched: string[] = [];
    const matchedSegments: { segment: Segment; found: ExtractedSegment }[] = [];
    // A receipt filed first, found to be this booking: it takes this
    // booking's date, time and details.
    const upgrades = new Map<string, ExtractedSegment>();
    // When this email booked what it carries. A receipt, an invoice or a
    // refund sent after a cancellation (a hotel's refund receipt often is)
    // books nothing, so it dates nothing: it neither revives a cancelled
    // booking nor shields one from an older cancellation.
    const bookedAt = booking.sentAt && !paymentOnly(booking.segments, booking.label) ? booking.sentAt : undefined;
    const ref: SourceRef = {
      kind: booking.source,
      id: booking.sourceId,
      ...(booking.label ? { label: booking.label } : {}),
      uid,
      at: timestamp,
      ...(bookedAt ? { sentAt: bookedAt } : {}),
    };
    // A booking found again keeps this source too, so nothing dropped as a
    // duplicate is lost from view, and whatever this one adds to it (seats
    // only the second email gives, its own reference: mergeDetails).
    // A booking it fills out (an end it lacked) can outgrow its trip, which
    // then widens to hold it, in this transaction, with the trip this
    // booking files into (`target`) widened once for both. A receipt this
    // booking upgrades is replaced instead, and its trip settled last
    // (settleUpgradedTrips).
    // Cancellations read before this booking (see markCancelled), less those
    // past waiting for, which go below.
    const expired = pending.filter((p) => pendingCancellationExpired(p, timestamp));
    // Each with only the bookings it still waits for (stillWaiting).
    const waiting = pending.filter((p) => !expired.includes(p)).map((p) => ({ ...p, cancellations: stillWaiting(p, timestamp) }));
    // A booking as this email leaves it: cancelled or live by every
    // cancellation read and every email that confirmed it, by date
    // (standingCancellation), this one included unless it books nothing.
    const withCancellation = (merged: Segment, segment: Segment): Segment =>
      settled(merged, standingCancellation(merged, [...(segment.sources ?? []).map((r) => r.sentAt), bookedAt], waiting, pending), timestamp);
    // A place the user corrected by hand stays (mergeDetails).
    // This email is the newest word on a booking when it was sent after every
    // email behind it that dates the booking. A receipt or a TripIt export
    // says nothing of when (no sentAt), so it neither blocks nor counts.
    const newerThan = (segment: Segment) =>
      !!bookedAt && (segment.sources ?? []).every((s) => s.sentAt === undefined || compareInstants(s.sentAt, bookedAt) < 0);
    const mergedOf = (segment: Segment, found: ExtractedSegment): Segment =>
      withCancellation(mergeDetails(segment, found, { edited: segment.updatedAt !== segment.createdAt, newer: newerThan(segment) }), segment);
    const merges: Segment[] = [];
    // Trips whose flights a rebooking filed cancelled: each gets a fresh
    // revision with the others this email changed (recordSources).
    const rebookedTrips = new Set<string>();
    // Whom the bookings this email filled out name now and named before.
    const learned: NamedBooking[] = [];
    const recordSources = (target?: string) => {
      const changedTrips = new Set<string>(rebookedTrips);
      for (const { segment, found } of matchedSegments) {
        if (upgrades.has(`${segment.tripId}/${segment.id}`)) {
          const sources = segmentSources(segment).some((s) => s.kind === ref.kind && s.id === ref.id) ? segmentSources(segment) : [...segmentSources(segment), ref];
          // Filed anew as the booking: a fresh revision, and still unedited
          // (updatedAt its createdAt), as a booking written now would be, so a
          // sweep or a merge that read the receipt before this one retries.
          const upgraded: Segment = withCancellation(
            { ...segment, ...found, id: segment.id, tripId: segment.tripId, sources, createdAt: timestamp, updatedAt: timestamp },
            segment,
          );
          tx.putSegment(upgraded);
          learned.push({ travelers: upgraded.travelers ?? [], before: segment.travelers });
          upgradedSegments.set(`${segment.tripId}/${segment.id}`, upgraded);
          continue;
        }
        const merged = mergedOf(segment, found);
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
        learned.push({ travelers: written.travelers ?? [], before: segment.travelers });
        merges.push(written);
        changedTrips.add(segment.tripId);
      }
      for (const tripId of changedTrips) {
        if (tripId === target) continue;
        const trip = live.find((t) => t.id === tripId);
        const want = growth(tripId);
        if (!trip) {
          tx.touchTrip(tripId, timestamp);
          continue;
        }
        if (want && (want.start < trip.start || want.end > trip.end)) {
          tx.extendTrip(tripId, { start: min(trip.start, want.start), end: max(trip.end, want.end), updatedAt: timestamp });
        } else tx.touchTrip(tripId, timestamp);
      }
    };
    // Each existing trip this email changed, while still named as an
    // import named it (importGaveTitle, judged by its bookings as they were
    // before this email), is named again from its bookings as they end up:
    // those it held, as this email filled them out or upgraded them, and
    // those it adds (`written`). One path whatever the email brought: a
    // flight joining a trip a stay with no town started, or a stay's
    // confirmation giving the town its request lacked, with or without new
    // bookings. Written last, over the bounds already set.
    const settleTitles = (written: readonly Segment[]) => {
      const changed = [...merges, ...upgradedSegments.values()];
      for (const tripId of new Set([...changed, ...written].map((segment) => segment.tripId))) {
        const trip = live.find((t) => t.id === tripId);
        const before = segmentsOf(tripId);
        if (!trip || tripId.startsWith(sourceTripPrefix) || before.length === 0) continue;
        if (!importGaveTitle(trip.title, before, periods, overrides)) continue;
        const final = [
          ...before.map((segment) => changed.find((c) => c.tripId === tripId && c.id === segment.id) ?? segment),
          ...written.filter((segment) => segment.tripId === tripId),
        ].sort((a, b) => compareInstants(a.start, b.start));
        const title = tripTitle(final, periods, overrides);
        if (title !== trip.title) tx.touchTrip(tripId, timestamp, title);
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
        const dates = bookedDateRange(final);
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
    // Every booking's dates, cancelled ones too (bookedDateRange).
    const growth = (tripId: string) =>
      bookedDateRange(
        matchedSegments
          .filter((m) => m.segment.tripId === tripId)
          .map((m) => (upgrades.has(`${m.segment.tripId}/${m.segment.id}`) ? withCancellation({ ...m.segment, ...m.found }, m.segment) : mergedOf(m.segment, m.found))),
      );
    const taken = (other: Segment) => {
      const key = `${other.tripId}/${other.id}`;
      const owner = booking.reserved?.get(key);
      return booking.consumed?.has(key) || matched.includes(key) || (owner !== undefined && owner !== booking.sourceId);
    };
    // A cancelled booking alike in all but its number is a new booking for
    // the same stay or journey (made again after cancelling), not this one
    // read again: it's this one only when the confirmation numbers agree
    // (sameBooking decides by them when both have one) or this very source
    // is being read again.
    // Two references that disagree are two bookings, however alike the
    // event (sameEvent matches without them): the same show booked again.
    const reference = (r: string) => r.toUpperCase().replace(/[^A-Z0-9]/g, "");
    // A receipt or refund with no reference books nothing, so it may join
    // the cancelled booking it is about (and stays cancelled with it: it
    // dates nothing, bookedAt).
    const payment = paymentOnly(booking.segments, booking.label);
    const rebooked = (other: Segment, segment: ExtractedSegment) =>
      isCancelled(other) &&
      (other.confirmation && segment.confirmation
        ? reference(other.confirmation) !== reference(segment.confirmation)
        : !payment &&
          !(other.sources ?? []).some((r) => r.kind === ref.kind && r.id === ref.id) &&
          !(booking.gmailMessageIds ?? []).some((m) => other.gmailMessageIds.includes(m)));
    // The booking an item is one of the bookings the user merged into
    // (mergedBookingOf), whatever that booking now says, unless it was
    // cancelled and this books it again: one item for each booking merged
    // in, so several merged together share it and two alike rooms stay two.
    const claimed = new Map<string, Set<number>>();
    const absorbedBy = (segment: ExtractedSegment): Segment | undefined => {
      for (const other of existing) {
        const key = `${other.tripId}/${other.id}`;
        // Not one an earlier item of the same upload used (a TripIt export or
        // a calendar files each item on its own), nor one set aside for another.
        const owner = booking.reserved?.get(key);
        if (booking.consumed?.has(key) || (owner !== undefined && owner !== booking.sourceId)) continue;
        const used = claimed.get(key) ?? new Set<number>();
        const merged = mergedBookingOf(other, segment, used);
        // Booked again after cancelling, judged by the booking merged in (its reference), not the keeper's.
        if (merged === undefined || rebooked({ ...other, ...other.mergedBookings![merged] }, segment)) continue;
        used.add(merged);
        claimed.set(key, used);
        return other;
      }
      return undefined;
    };
    const fresh = booking.segments
      .map((segment, index) => ({ segment, id: `${booking.sourceId}-${booking.indexes?.[index] ?? index}` }))
      .filter(({ segment, id }) => {
        // One event confirmed by two emails under two references is one
        // booking too (sameEvent).
        const candidate = (other: Segment) =>
          other.id !== id &&
          !taken(other) &&
          (sameBooking(other, segment) || sameEvent(other, segment, other.sender, booking.sender)) &&
          !rebooked(other, segment);
        // A booking set aside for this item comes first: matching a lookalike
        // instead would strand it, reserved for an item already done. Of the
        // rest, the likeliest (matchRank): a receipt goes to the booking with
        // its reference before one that merely shares a name.
        const best = (others: Segment[]) =>
          others.reduce<Segment | undefined>((top, other) => (top && compareMatchRanks(matchRank(top, segment), matchRank(other, segment)) <= 0 ? top : other), undefined);
        const match =
          absorbedBy(segment) ??
          existing.find((other) => booking.reserved?.get(`${other.tripId}/${other.id}`) === booking.sourceId && candidate(other)) ??
          best(existing.filter(candidate));
        if (match) {
          // Only a receipt nobody edited: one the user corrected by hand
          // keeps what they wrote, and gains this source.
          if (isPaymentReceipt(match) && !isPaymentReceipt(segment) && match.updatedAt === match.createdAt) upgrades.set(`${match.tripId}/${match.id}`, segment);
          matched.push(`${match.tripId}/${match.id}`);
          matchedSegments.push({ segment: match, found: segment });
        }
        return !match;
      });
    // A rebooking (rebookedByEmail): flights of an older email this one
    // flies another way are filed cancelled by it.
    if (bookedAt) {
      for (const written of rebookedByEmail(existing, booking.segments, { id: booking.sourceId, sentAt: bookedAt }, timestamp)) {
        if (matched.includes(`${written.tripId}/${written.id}`)) continue;
        tx.putSegment(written);
        merges.push(written);
        rebookedTrips.add(written.tripId);
        log("booking_rebooked", { uid, tripId: written.tripId, segmentId: written.id, messageId: booking.sourceId });
      }
    }
    const duplicates = booking.segments.length - fresh.length;
    const freshRange = segmentDateRange(fresh.map((f) => f.segment));
    if (!freshRange) {
      recordSources();
      notePeopleIn(learned);
      settleUpgradedTrips([]);
      settleTitles([]);
      tx.settle(live, segmentsOf);
      return { segmentIds: [], duplicates, matched, written: [...merges, ...upgradedSegments.values()] };
    }

    // A booking a cancellation already read names is filed cancelled. The
    // cancellation keeps waiting for any other leg it names, until it expires.
    const cancelledBy = new Map<string, Standing>();
    for (const { segment, id } of fresh) {
      const by = standingCancellation(segment, [bookedAt], waiting, pending);
      if (by) cancelledBy.set(id, by);
    }
    // The other way round, as a mailbox is read newest first: flights of
    // this older email that a newer one already filed flies another way
    // (rebookedFlights) are filed cancelled by the newest email behind the
    // journey that replaced them, dated by it. A replacing flight cancelled
    // since still replaced them: its own cancellation doesn't revive them.
    if (bookedAt) {
      const newest = (other: Segment) =>
        segmentSources(other)
          .filter((s) => s.sentAt !== undefined && compareInstants(s.sentAt, bookedAt) > 0)
          .sort((a, b) => compareInstants(b.sentAt!, a.sentAt!))[0];
      const newer = existing.filter(
        (other) => other.type === "flight" && other.confirmation !== undefined && references.has(normalizeReference(other.confirmation)) && newest(other),
      );
      for (const { flight, by } of rebookedFlights(booking.segments, newer)) {
        const item = fresh.find((f) => f.segment === flight);
        if (!item) continue;
        // The newest email confirming a replacing journey whole: one that
        // confirmed only a leg of it (a seat change) dates nothing.
        const whole = (journey: Segment[]) =>
          segmentSources(journey[0]!).filter(
            (s) => s.sentAt !== undefined && compareInstants(s.sentAt, bookedAt) > 0 && journey.every((leg) => segmentSources(leg).some((o) => o.kind === s.kind && o.id === s.id)),
          );
        const source = by
          .flatMap(whole)
          .sort((a, b) => compareInstants(b.sentAt!, a.sentAt!))[0];
        if (!source) continue;
        // The later of this and a cancellation already standing, as
        // standingCancellation keeps the latest: one of unknown date stays.
        const standing = cancelledBy.get(item.id);
        if (standing && (standing.sentAt === undefined || compareInstants(standing.sentAt, source.sentAt!) >= 0)) continue;
        cancelledBy.set(item.id, { messageId: source.id, sentAt: source.sentAt });
        log("booking_rebooked", { uid, segmentId: item.id, messageId: source.id });
      }
    }
    // Live first, wherever a trip is chosen, named or widened: what this
    // booking still books (new bookings not filed cancelled, and those it
    // found again that stay live) decides, and its cancelled parts only
    // when nothing in it is live. A cancelled stay never pulls a live one
    // into its trip, nor names it.
    const matchedAs = (m: { segment: Segment; found: ExtractedSegment }) =>
      upgrades.has(`${m.segment.tripId}/${m.segment.id}`) ? withCancellation({ ...m.segment, ...m.found }, m.segment) : mergedOf(m.segment, m.found);
    const liveMatches = matchedSegments.filter((m) => !isCancelled(matchedAs(m)));
    const stillBooked = [...fresh.filter(({ id }) => !cancelledBy.has(id)).map(({ segment }) => segment), ...liveMatches.map((m) => m.found)];
    const anyLive = stillBooked.length > 0;
    const deciding = anyLive ? stillBooked : booking.segments;
    const preferred = new Set((anyLive ? liveMatches : matchedSegments).map((m) => m.segment.tripId));
    // A trip's own bookings, live first, for what they connect to and where
    // home is.
    const liveSegmentsOf = (tripId: string) => {
      const all = segmentsOf(tripId);
      const live = liveSegments(all);
      return live.length > 0 ? live : all;
    };
    // Where home was, by what this booking still books (a journey filed
    // cancelled was never travelled).
    ({ periods, overrides } = homes([...[...segmentsByTrip.values()].flat(), ...deciding]));
    const journey = (s: ExtractedSegment) => journeyTypes.has(s.type);
    const earliest = <S extends ExtractedSegment>(segments: readonly S[]) => segments.reduce((a, b) => (compareInstants(b.start, a.start) < 0 ? b : a));
    const latest = <S extends ExtractedSegment>(segments: readonly S[]) => segments.reduce((a, b) => (compareInstants(b.start, a.start) > 0 ? b : a));
    // The later trip this booking opens, if it is nothing but journeys that
    // land away where that trip's first journey leaves from (opensTrip):
    // Zagreb to New York joins the week there ending in the flight home from
    // Newark, not the Zagreb trip before it.
    // Only the very next trip, so a flight never skips a visit and a
    // return home in between to join a later one; and only for what is
    // still booked.
    const opened = (trips: readonly Trip[]) => {
      if (!anyLive || !deciding.every(journey)) return undefined;
      const landing = latest(deciding);
      const next = trips
        .flatMap((trip) => {
          const theirs = liveSegmentsOf(trip.id).filter((s) => !isCancelled(s));
          return theirs.length > 0 ? [{ trip, first: earliest(theirs) }] : [];
        })
        .filter(({ first }) => compareInstants(first.start, landing.start) > 0)
        .sort((a, b) => compareInstants(a.first.start, b.first.start))[0];
      return next && next.trip.sharedWith.length === 0 && opensTrip(landing, next.first, periods, overrides) ? next.trip : undefined;
    };
    // The bookings of earlier trips that this one opens instead: each
    // trip's last booking (its segments sharing a first source), when it is
    // nothing but unedited journeys landing where this booking first leaves
    // from, and nothing else in that trip starts after it.
    // Only from the very trip before, for the same reason, and only when
    // this booking still books travel.
    const adoptable = (trips: readonly Trip[]): Segment[] => {
      if (!anyLive) return [];
      const leaving = earliest(deciding);
      if (!journey(leaving) || (target && target.sharedWith.length > 0)) return [];
      const before = trips
        .flatMap((trip) => {
          const theirs = segmentsOf(trip.id).filter((s) => compareInstants(s.start, leaving.start) < 0);
          return theirs.length > 0 ? [{ trip, last: latest(theirs) }] : [];
        })
        .sort((a, b) => compareInstants(b.last.start, a.last.start))[0];
      // Joining that very trip already, there is nothing to bring over.
      return (before && before.trip.id !== target?.id ? [before.trip] : []).flatMap((trip) => {
        const theirs = segmentsOf(trip.id);
        if (trip.sharedWith.length > 0 || theirs.length === 0) return [];
        // Its last booking: the latest segment and every one linked to it by
        // any shared source, however indirectly, as Regroup groups them (a
        // first leg confirmed alone, then with its connection by a later email).
        const keys = (s: Segment) => segmentSources(s).map((ref) => `${ref.kind}:${ref.id}`);
        const unit = [latest(theirs)];
        const linked = new Set(keys(unit[0]!));
        for (let grew = true; grew; ) {
          grew = false;
          for (const s of theirs) {
            if (unit.includes(s) || !keys(s).some((k) => linked.has(k))) continue;
            unit.push(s);
            for (const k of keys(s)) linked.add(k);
            grew = true;
          }
        }
        if (!unit.every(journey) || unit.some((s) => s.updatedAt !== s.createdAt)) return [];
        if (theirs.some((s) => !unit.includes(s) && compareInstants(s.start, earliest(unit).start) > 0)) return [];
        const going = liveSegments(unit);
        return going.length > 0 && opensTrip(latest(going), leaving, periods, overrides) ? unit : [];
      });
    };

    const hint = booking.trip;
    let target: Trip | undefined;
    if (hint) {
      target = live.find((trip) => trip.id === hint.id);
      // A trip already holding part of this booking comes before any that
      // merely overlaps its dates.
      if (!target && hint.joinOverlapping) target = live.find((trip) => preferred.has(trip.id) && !trip.id.startsWith(holdingTripPrefix));
      if (!target && hint.joinOverlapping) {
        // The whole of the source's trip, not just its new bookings: a
        // return leg is in the same journey as the outbound already filed.
        const span = segmentDateRange(deciding) ?? range;
        const whole = { start: min(hint.start, span.start), end: max(hint.end, span.end) };
        // Joined by when the person travels on it (displayBounds), not a
        // cancelled booking's dates.
        target = live.find((trip) => {
          const shown = displayBounds(trip);
          return !trip.id.startsWith(sourceTripPrefix) && shown.start <= whole.end && shown.end >= whole.start;
        });
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
      target = assignable.find((trip) => preferred.has(trip.id)) ?? opened(assignable) ?? findTripForBooking(assignable, liveSegmentsOf, deciding, periods, overrides);
    }
    // Booked the other way round: a journey that ended an earlier trip by
    // landing where this booking leaves from comes over to open its trip,
    // as Regroup files it, unless the user edited it or either trip is
    // shared (bookings never move between trips shared differently).
    const adopted = hint ? [] : adoptable(live.filter((trip) => !trip.id.startsWith(holdingTripPrefix) && !trip.id.startsWith(sourceTripPrefix)));
    // The trip's own dates cover them as booked, cancelled legs too, so each
    // is found again by date; when the person travels is settled after.
    const adoptedRange = bookedDateRange(adopted);
    const filedRange = adoptedRange ? { start: min(freshRange.start, adoptedRange.start), end: max(freshRange.end, adoptedRange.end) } : freshRange;
    let tripId: string;
    if (target) {
      tripId = target.id;
      // Only the bounds: sharing belongs to the owner, who may be editing
      // it right now, and so does the title once they renamed the trip (one
      // an import gave it is settled last, settleTitles).
      // A source's own trip dates (a TripIt itinerary) widen it too, so a
      // later booking within them finds this trip.
      // Its own dates cover every booking in it, cancelled ones too, so
      // each is found again by date; when the person now travels is
      // settled once everything is written (settle).
      const own = hint ? { start: min(hint.start, filedRange.start), end: max(hint.end, filedRange.end) } : filedRange;
      const filled = growth(tripId);
      const want = filled ? { start: min(own.start, filled.start), end: max(own.end, filled.end) } : own;
      wanted.set(tripId, want);
      tx.extendTrip(tripId, { start: min(target.start, want.start), end: max(target.end, want.end), updatedAt: timestamp });
    } else {
      // A hinted id still taken by a trip being deleted cannot be reused.
      tripId = hint && !trips.some((trip) => trip.id === hint.id) ? hint.id : store.newId();
      tx.createTrip({
        id: tripId,
        title: hint?.title ?? tripTitle([...liveSegments(adopted), ...deciding], periods, overrides),
        start: hint ? min(hint.start, filedRange.start) : filedRange.start,
        end: hint ? max(hint.end, filedRange.end) : filedRange.end,
        ownerUid: uid,
        sharedWith: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    recordSources(target ? tripId : undefined);
    for (const p of expired) tx.deletePendingCancellation(uid, p.messageId);
    const written: Segment[] = fresh.map(({ segment, id }) => {
      const by = cancelledBy.get(id);
      return {
        ...segment,
        id,
        tripId,
        source: booking.source,
        gmailMessageIds: booking.gmailMessageIds ?? [],
        sources: [ref],
        ...(booking.sender ? { sender: booking.sender } : {}),
        ...(by ? { cancelledAt: timestamp, cancelledBy: by.messageId, ...(by.sentAt ? { cancelledSentAt: by.sentAt } : {}) } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }).map((segment) => (target ? inTrip(segment, target, timestamp) : segment));
    for (const segment of written) tx.putSegment(segment);
    notePeopleIn([...learned, ...written.map((s) => ({ travelers: s.travelers ?? [] }))]);
    // Moved as they are, revision and all, as Regroup moves bookings; a trip
    // left with none of its bookings goes.
    // Cancelled with the trip they join, or live again leaving a cancelled one.
    const moved = adopted.map((segment) => inTrip({ ...segment, tripId }, target ?? {}, timestamp));
    for (const segment of adopted) tx.deleteSegment(segment.tripId, segment.id);
    for (const segment of moved) tx.putSegment(segment);
    for (const from of new Set(adopted.map((segment) => segment.tripId))) {
      if (segmentsOf(from).every((segment) => adopted.includes(segment))) tx.deleteTrip(from);
      else tx.touchTrip(from, timestamp);
    }
    settleUpgradedTrips(written);
    settleTitles([...written, ...moved]);
    tx.settle(live, segmentsOf);
    return { tripId, segmentIds: written.map((s) => s.id), duplicates, matched, written: [...written, ...merges, ...upgradedSegments.values()] };
  });
  // The cancellation emails that just found their bookings say so in the
  // import review.
  for (const [messageId, ids] of groupBy(result.written ?? [], (s) => s.cancelledBy)) {
    const record = await store.getParsed(uid, messageId);
    if (record?.outcome !== "cancellation") continue;
    const segmentIds = [...new Set([...record.segmentIds, ...ids.map((s) => s.id)])];
    const next = { ...record, segmentIds, reason: cancellationReason(segmentIds.length) };
    // Only while no reset has removed the bookings it would name.
    if (booking.generation === undefined) await store.setParsed(next);
    else if (!(await store.setParsedIfCurrent(next, booking.generation))) log("import_superseded", { uid, messageId });
  }
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

export const emptyCounts = (): ImportCounts => ({ skipped: 0, filtered: 0, not_booking: 0, imported: 0, failed: 0, cancellation: 0 });

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
// of several days (courseTitle). Dates are compared as written, in local
// time. A trip is named after where its journeys and stays go before a car
// or transfer's drop-off: a car to Stansted for a flight to Stockholm makes
// a Stockholm trip.
export function tripTitle(
  unordered: readonly ExtractedSegment[],
  periods: readonly HomePeriod[] = [],
  overrides: readonly HomePeriod[] = [],
): string {
  const segments = byStart(unordered);
  const first = segments[0];
  // Nothing but a ride, from the airport home say: named by its route, not
  // as a trip to the home town.
  if (first && segments.every(isTransfer)) return transferTitle(first, periods, overrides)!;
  const days = new Set(segments.flatMap((s) => [s.start, s.end].filter((t) => t !== undefined).map((t) => t.slice(0, 10))));
  if (first && days.size === 1 && segments.every((s) => s.type === "activity")) {
    const venue = first.destination?.name;
    if (venue && first.title.toLowerCase().startsWith(venue.toLowerCase())) return venue;
    if (first.title) return first.title;
  }
  return courseTitle(segments) ?? placeTitle(segments, periods, overrides);
}

// The course a trip of nothing but tickets is: one ticket, which may span
// several days, or one a day with the same title, or titles that differ
// only in the day or date ("Holiday Camp - Junior Group (Day 2)", "Debutots
// Camp - 12th Aug 2025"), named without it. Otherwise undefined: tickets
// for different things are named for where they are.
export function courseTitle(segments: readonly ExtractedSegment[]): string | undefined {
  const first = segments[0];
  if (!first || !segments.every((s) => s.type === "activity")) return undefined;
  const names = new Set(segments.map((s) => courseName(s.title).trim().toLowerCase()));
  if (segments.length === 1 || names.size === 1) return courseName(first.title);
  return undefined;
}

// Where a trip goes, as tripTitle names one that is not a day out or a
// course. Known home is not where a trip goes: a train out of London to
// Liverpool makes a Liverpool trip, even booked as its return leg alone.
// Journeys come first, then stays and the rest, then a car or transfer's
// drop-off: a flight to Melbourne makes a Melbourne trip whichever suburb
// the stays are in. Only a town names a trip: a place's city (the
// geocoder's, when the source gave none), or for a journey an airport or
// station named without one. A place that is only its own name ("Designer
// Collingwood Terrace", a stay's listing) names the trip only when nothing
// else does.
export function placeTitle(
  unordered: readonly ExtractedSegment[],
  periods: readonly HomePeriod[] = [],
  overrides: readonly HomePeriod[] = [],
): string {
  const segments = byStart(unordered);
  const rank = (s: ExtractedSegment) => (journeyTypes.has(s.type) ? 0 : isTransfer(s) ? 2 : 1);
  const ordered = segments
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => rank(a.segment) - rank(b.segment) || a.index - b.index)
    .map(({ segment }) => segment);
  const asTown = (s: ExtractedSegment, place: ExtractedSegment["origin"]) => (place && (place.city || journeyTypes.has(s.type)) ? place : undefined);
  // A connection's stop (Paris between Zagreb and New York) is on the way, not where the trip goes.
  const via = (s: ExtractedSegment) => segments.some((t) => isConnection(s, t));
  const towns = ordered.map((s) => ({ start: s.start, origin: asTown(s, s.origin), destination: via(s) ? undefined : asTown(s, s.destination) }));
  const place = awayPlace(towns, periods, overrides) ?? towns.find((s) => s.destination)?.destination;
  return place?.city ?? place?.name ?? legacyPlaceTitle(segments, periods, overrides);
}

// placeTitle as imports named trips before only a town could name one: the
// first place away (or any), journeys and stays before transfers, by its
// city or else its name. Still the last resort, and how importGaveTitle
// recognizes a trip named that way.
function legacyPlaceTitle(
  unordered: readonly ExtractedSegment[],
  periods: readonly HomePeriod[] = [],
  overrides: readonly HomePeriod[] = [],
): string {
  const segments = byStart(unordered);
  const ordered = [...segments.filter((s) => !isTransfer(s)), ...segments.filter(isTransfer)];
  const place = awayPlace(ordered, periods, overrides) ?? ordered.find((s) => s.destination)?.destination;
  return place?.city ?? place?.name ?? segments[0]?.title ?? "Trip";
}

// Bookings in the order they happen: the titles above read "first" by
// date, whatever order a caller holds them in (Regroup holds them by
// import).
const byStart = <S extends ExtractedSegment>(segments: readonly S[]): S[] => [...segments].sort((a, b) => compareInstants(a.start, b.start));

const journeyTypes: ReadonlySet<ExtractedSegment["type"]> = new Set(["flight", "train", "bus", "ferry"]);

// Whether a trip's title is still one an import gave it, not one the user
// chose: what tripTitle or placeTitle names its bookings, or the bookings
// of any one source (the email that started the trip, named before the rest
// joined), by today's rules or those before them (legacyPlaceTitle), with
// home known or not. Such a trip is renamed from all its bookings when more
// join it, and by Regroup; one the user renamed keeps its name.
export function importGaveTitle(
  title: string,
  segments: readonly Segment[],
  periods: readonly HomePeriod[] = [],
  overrides: readonly HomePeriod[] = [],
): boolean {
  const bySource = new Map<string, Segment[]>();
  for (const segment of segments) {
    const first = segmentSources(segment)[0];
    const key = first ? `${first.kind}:${first.id}` : `${segment.tripId}/${segment.id}`;
    bySource.set(key, [...(bySource.get(key) ?? []), segment]);
  }
  // A booking's own name or its place's, as a trip named before that place
  // gained a town: "Designer Collingwood Terrace" once the stay is known to
  // be in Collingwood.
  const names = segments.flatMap((s) => [s.title, s.origin?.name, s.destination?.name]);
  if (names.includes(title)) return true;
  return [segments, ...bySource.values()].some((set) => {
    const sorted = [...set].sort((a, b) => compareInstants(a.start, b.start));
    return [
      tripTitle(sorted, periods, overrides),
      tripTitle(sorted),
      placeTitle(sorted, periods, overrides),
      legacyPlaceTitle(sorted, periods, overrides),
      legacyPlaceTitle(sorted),
    ].includes(title);
  });
}

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
    if (outcome === "imported" || outcome === "not_booking" || outcome === "failed" || outcome === "cancellation") read += 1;
    counts[outcome] += 1;
    if (changed && outcome !== "skipped" && outcome !== "failed") counts.updated += 1;
    // A change that failed or was not made leaves the old record, and its
    // matches, standing: they stay reserved against the events after it.
    if (changed && (outcome === "skipped" || outcome === "failed")) for (const id of previous.matchedSegmentIds ?? []) consumed.add(id);
  }
  return counts;
}

// An email's attached PDFs, fetched only now it is to be read, by every
// reader of emails (an import, Refresh, a loyalty re-read), so each sees what
// the others do: a ticket may carry the journey alone. A failure to fetch
// them is reported and the email read without them.
export async function attachmentsOf(message: EmailMessage, failed: (error: Error) => void): Promise<Attachment[]> {
  if (!message.attachments) return [];
  try {
    return await message.attachments();
  } catch (error) {
    failed(error as Error);
    return [];
  }
}
