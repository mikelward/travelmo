import {
  bookedDateRange,
  findTripForBooking,
  homeTimeline,
  isCancelled,
  mergeDetails,
  normalizeReference,
  notBookings,
  overlappingTrips,
  sameBooking,
  sameEvent,
  segmentDateRange,
  segmentSources,
  untimedMatchDays,
  withoutValidityEnds,
  type ExtractedSegment,
  type ParsedMessage,
  type Place,
  type RefreshProgress,
  type Segment,
  type SourceRef,
  type Trip,
} from "@travelmo/core";
import type { BackfillBatch } from "./backfill";
import { isModelRateLimit } from "./extract";
import { GmailRateLimited, type EmailMessage } from "./gmail";
import {
  ImportSupersededError,
  attachmentsOf,
  emptyCounts,
  originalSentAt,
  placeSegments,
  settlingTripDates,
  sourceTripPrefix,
  tripTitle,
  withWaitingCancellations,
  type ImportDeps,
} from "./importer";
import { senderDomain } from "./prefilter";

// "Refresh from email" (SPEC "Refresh from email"): the emails the user's
// bookings came from, and only those, read again by today's extraction and
// filed by today's matching, so a fix to either reaches bookings imported
// before it without deleting every trip. Each email's bookings are updated
// in place: their ids, trips, ratings and favorite marks stay, as do the
// trips' names, sharing and checklists; a booking the user edited by hand
// is left as they left it.

// The sources that are emails: a booking from anything else (a calendar
// event, a TripIt item, the booking form) is its own reservation.
const emailKinds: ReadonlySet<string> = new Set(["gmail", "fastmail", "imap", "forward"]);

// From when every hand edit of a booking's details records `editedAt`
// (the booking form on the web and Android, and the rules, which refuse an
// edit without it). A booking created before then may have been edited by
// a client that did not yet record it.
export const editedAtSince = "2026-12-15T00:00:00Z";

// Whether the user changed a booking's details by hand. `editedAt` says so
// from `editedAtSince` on. A booking untouched since it was filed (its
// `updatedAt` its `createdAt`, as imports keep an unedited one) is not. One
// touched since then that is older than `editedAtSince` may have been
// rated, marked, moved or edited, which nothing recorded apart, so it
// counts as edited; a newer one was only rated, marked or moved.
export function handEdited(segment: Pick<Segment, "editedAt" | "createdAt" | "updatedAt">): boolean {
  if (segment.editedAt) return true;
  if (segment.updatedAt === segment.createdAt) return false;
  return Date.parse(segment.createdAt) < Date.parse(editedAtSince);
}

// The fields extraction gives a booking.
const detailKeys = ["type", "title", "provider", "confirmation", "start", "end", "origin", "destination", "notes"] as const;

// A value with its objects' keys in order, for comparing two documents.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const detailsOf = (segment: ExtractedSegment) => Object.fromEntries(detailKeys.map((key) => [key, segment[key]]));
const sameDetails = (a: ExtractedSegment, b: ExtractedSegment) => same(detailsOf(a), detailsOf(b));

// The place a fresh extraction gives, with what the stored one knew besides
// (its spot on the map, its country) while the name holds.
function freshPlace(found: Place | undefined, stored: Place | undefined): Place | undefined {
  if (!found || !stored || found.name.trim().toLowerCase() !== stored.name.trim().toLowerCase()) return found;
  const filled: Place = { ...found };
  for (const key of ["code", "city", "country", "address"] as const) {
    if (filled[key] === undefined && stored[key] !== undefined) filled[key] = stored[key];
  }
  if (filled.lat === undefined && filled.lon === undefined && stored.lat !== undefined && stored.lon !== undefined) {
    filled.lat = stored.lat;
    filled.lon = stored.lon;
  }
  return filled;
}

// A booking with its details as `found` gives them, and everything else
// (its id, trip, sources, rating, favorite mark, cancellation) as it was.
export function withDetails(segment: Segment, found: ExtractedSegment): Segment {
  const out: Record<string, unknown> = { ...segment };
  for (const key of detailKeys) delete out[key];
  for (const key of detailKeys) {
    const value = key === "origin" || key === "destination" ? freshPlace(found[key], segment[key]) : found[key];
    if (value !== undefined) out[key] = value;
  }
  return out as Segment;
}

// Who a trip is shared with, as one key (regroup.ts's): a booking never
// merges into one shared with other people.
const shareKey = (trip: Pick<Trip, "sharedWith">) => [...new Set(trip.sharedWith.map((e) => e.trim().toLowerCase()))].sort().join(",");

const segmentKey = (segment: Pick<Segment, "tripId" | "id">) => `${segment.tripId}/${segment.id}`;

// Two references that disagree are two bookings, however alike the rest.
const twoReferences = (a: ExtractedSegment, b: ExtractedSegment) =>
  !!a.confirmation && !!b.confirmation && normalizeReference(a.confirmation) !== normalizeReference(b.confirmation);

// What refreshing one email did to the user's bookings.
export type EmailRefresh = { updated: number; added: number; removed: number; merged: number; kept: number };
const nothingChanged = (): EmailRefresh => ({ updated: 0, added: 0, removed: 0, merged: 0, kept: 0 });

// The model failed on the email (`cause`): its bookings stay as they are.
export class ExtractionFailed extends Error {
  constructor(readonly cause: unknown) {
    super(`extraction failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ExtractionFailed";
  }
}

// Every source of `segments`, and `ref` unless one of them already has it.
function joinedSources(segments: readonly Segment[], ref: SourceRef): SourceRef[] {
  const out: SourceRef[] = [];
  for (const source of segments.flatMap((s) => segmentSources(s))) {
    if (!out.some((o) => o.kind === source.kind && o.id === source.id)) out.push(source);
  }
  if (!out.some((o) => o.id === ref.id)) out.push(ref);
  return out;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

// Reads one email again and brings its bookings up to date, in one
// transaction under the import's per-user lock. `snapshot` is the user's
// bookings as read outside the lock (once a batch), which says only which
// trips to read: every decision is made on what the transaction reads.
//
// Each booking the email gives now is paired with the one it gave before
// (by the booking it is, else by its place in the email and its type) and
// with any other booking that today's matching takes for the same one, an
// older import's duplicate. Of those, one stays (one the user edited, else
// one they rated, else one they marked, else the email's own), gaining the others'
// sources, rating and favorite mark, and the others go, unless edited or on
// a trip shared otherwise. The one that stays takes the new details when
// the user never edited it: all of them when this email is its only source,
// else what it lacked (mergeDetails, as an import fills a booking found
// again). A booking it gives now that matches none is added, beside its
// email's others; one it gave before that it no longer gives goes when the
// user never edited it and no other source gave it. An email the model now
// finds no booking in changes nothing: a passing model failure never
// empties a trip.
export async function refreshEmail(
  uid: string,
  record: ParsedMessage,
  message: EmailMessage,
  deps: ImportDeps,
  options: { generation: number; snapshot: readonly Segment[] },
): Promise<EmailRefresh> {
  let booking;
  try {
    booking = await deps.extract(message, await attachmentsOf(message, (error) => deps.log("attachments_failed", { uid, messageId: record.messageId, reason: error.message })));
  } catch (error) {
    throw new ExtractionFailed(error);
  }
  const dated = withoutValidityEnds(booking.segments);
  const bought = notBookings(dated);
  const found = dated.filter((segment) => !bought.includes(segment));
  if (!booking.isBooking || found.length === 0 || !segmentDateRange(found)) {
    deps.log("refresh_found_nothing", { uid, messageId: record.messageId }, "WARNING");
    return nothingChanged();
  }
  const source = record.source === "fastmail" || record.source === "imap" ? record.source : "gmail";
  const placed = (await placeSegments(uid, { sourceId: record.messageId, source, segments: found }, deps)).segments;
  const range = segmentDateRange(placed)!;
  const sender = senderDomain(message.from);
  const sent = originalSentAt(message, source);
  const overrides = (await deps.homeOverrides?.(uid)) ?? [];
  const timestamp = deps.now();
  const ref: SourceRef = {
    kind: source,
    id: record.messageId,
    ...(message.subject ? { label: message.subject } : {}),
    uid,
    at: timestamp,
    ...(sent ? { sentAt: sent } : {}),
  };
  const isOwn = (segment: Segment) => segmentSources(segment).some((r) => r.id === record.messageId);
  const ownTrips = new Set(options.snapshot.filter(isOwn).map((s) => s.tripId));
  if (record.tripId) ownTrips.add(record.tripId);

  return deps.store.withUserLock(uid, async (lockTx) => {
    const tx = settlingTripDates(lockTx, timestamp);
    if (tx.generation !== options.generation) throw new ImportSupersededError();
    // Reads, all of them before any write, as Firestore requires: the
    // trips holding this email's bookings, and those around its dates for
    // the duplicates.
    const trips = (await tx.listTrips()).filter((trip) => trip.ownerUid === uid && !trip.deleting);
    const around = { start: shiftDate(range.start, -untimedMatchDays), end: shiftDate(range.end, untimedMatchDays) };
    const near = new Set(overlappingTrips(trips, around).map((t) => t.id));
    const read = trips.filter((trip) => ownTrips.has(trip.id) || near.has(trip.id));
    const segmentsByTrip = new Map(await Promise.all(read.map(async (trip) => [trip.id, await tx.listSegments(trip.id)] as const)));
    // Cancellations still waiting for bookings, for any this adds.
    const pending = await tx.listPendingCancellations(uid);

    const tripOf = new Map(read.map((trip) => [trip.id, trip]));
    const all = [...segmentsByTrip.values()].flat();
    const own = all.filter(isOwn);
    const counts = nothingChanged();
    const used = new Set<string>();
    const writes = new Map<string, Segment>();
    const deletes = new Map<string, Segment>();
    // The bookings that carry this email once it is refreshed.
    const carrying: Segment[] = [];
    const unmatched: { segment: ExtractedSegment; index: number }[] = [];

    // Each item's own booking, chosen for all of them before any is filed,
    // so no item takes another's: first the booking filed for that very
    // item that still looks like it, then any of the email's bookings that
    // does, then (the fix this refresh is for: the old reading got it wrong
    // enough that it no longer looks like itself) the one filed for it.
    const alikeOf = (segment: ExtractedSegment) => (other: Segment) => sameBooking(other, segment) || sameEvent(other, segment, other.sender, sender);
    const ownIdOf = (index: number) => `${record.messageId}-${index}`;
    const mineOf = new Map<number, Segment>();
    const reserved = new Set<string>();
    const reserve = (index: number, o: Segment | undefined) => {
      if (!o) return;
      mineOf.set(index, o);
      reserved.add(segmentKey(o));
    };
    const open = (o: Segment) => !reserved.has(segmentKey(o));
    placed.forEach((segment, index) => reserve(index, own.find((o) => open(o) && o.id === ownIdOf(index) && alikeOf(segment)(o))));
    placed.forEach((segment, index) => {
      if (!mineOf.has(index)) reserve(index, own.find((o) => open(o) && alikeOf(segment)(o)));
    });
    placed.forEach((segment, index) => {
      if (!mineOf.has(index)) reserve(index, own.find((o) => open(o) && o.id === ownIdOf(index) && o.type === segment.type));
    });

    placed.forEach((segment, index) => {
      const alike = alikeOf(segment);
      const free = (other: Segment) => !used.has(segmentKey(other));
      const mine = mineOf.get(index);
      // Duplicates only among trips shared as this email's own booking's is:
      // merging never crosses sharing, and one shared otherwise must not
      // take its place (and leave it to be removed as no longer found).
      const shared = (o: Segment) => !mine || shareKey(tripOf.get(o.tripId)!) === shareKey(tripOf.get(mine.tripId)!);
      // As an import keeps them apart: a booking from a calendar event, a
      // TripIt item or by hand is its own reservation, however alike (two
      // rooms booked alike), and a cancelled booking is not one booked again
      // in its place (`rebooked` in importer.ts), so only bookings as
      // cancelled or live as this email's own (live, for one it adds) merge.
      const distinct = (o: Segment) => segmentSources(o).some((r) => !emailKinds.has(r.kind)) || !emailKinds.has(o.source);
      const cancelled = mine ? isCancelled(mine) : false;
      const twins = all.filter(
        // The email's own bookings are its items', one each, never another's
        // duplicate: two rooms one email booked alike stay two.
        (o) => o !== mine && !isOwn(o) && free(o) && alike(o) && !twoReferences(o, segment) && shared(o) && !distinct(o) && isCancelled(o) === cancelled,
      );
      // One booking per email in a group: two bookings an email gave are two
      // reservations (two rooms booked alike), whichever email this is, so a
      // twin sharing an email with one already in the group stays apart.
      const group: Segment[] = mine ? [mine] : [];
      const emails = new Set(group.flatMap((o) => segmentSources(o).map((r) => `${r.kind}:${r.id}`)));
      for (const o of twins) {
        const its = segmentSources(o).map((r) => `${r.kind}:${r.id}`);
        if (its.some((k) => emails.has(k))) continue;
        // Nor two under different references, whatever this email says.
        if (group.some((g) => twoReferences(o, g))) continue;
        group.push(o);
        for (const k of its) emails.add(k);
      }
      if (group.length === 0) {
        unmatched.push({ segment, index });
        return;
      }
      // Edited, unless what the user has is just what this email says now:
      // then nothing of theirs is lost (a booking from before `editedAt`
      // that was only rated, say).
      const edited = (o: Segment) => handEdited(o) && (!!o.editedAt || !sameDetails(o, withDetails(o, segment)));
      const keeper = group.find(edited) ?? group.find((o) => o.rating !== undefined) ?? group.find((o) => o.favorite === true) ?? group[0]!;
      const merging = group.filter((o) => o !== keeper && !edited(o) && shareKey(tripOf.get(o.tripId)!) === shareKey(tripOf.get(keeper.tripId)!));
      for (const o of [keeper, ...merging]) used.add(segmentKey(o));
      const sources = joinedSources([keeper, ...merging], ref);
      let next: Segment = { ...keeper, sources, gmailMessageIds: [...new Set([keeper, ...merging].flatMap((o) => o.gmailMessageIds))] };
      const rating = keeper.rating ?? merging.find((o) => o.rating !== undefined)?.rating;
      if (rating !== undefined) next.rating = rating;
      if (keeper.favorite !== true && merging.some((o) => o.favorite === true)) next.favorite = true;
      if (edited(keeper)) {
        if (!sameDetails(keeper, withDetails(keeper, segment))) counts.kept += 1;
      } else {
        next = sources.every((r) => r.id === record.messageId) ? withDetails(next, segment) : mergeDetails(next, segment);
        // Corrected, it may now be what a cancellation waiting for a booking
        // names, as an import weighs one it finds again.
        next = withWaitingCancellations(next, sources.map((r) => r.sentAt), pending, timestamp);
      }
      // What only a duplicate knew (its reference, a provider, a time) goes
      // to the one that stays before the duplicate does: it fills only what
      // that one lacks, so a hand edit stands.
      for (const o of merging) next = mergeDetails(next, o, { edited: edited(keeper) });
      if (!edited(keeper) && !sameDetails(keeper, next)) counts.updated += 1;
      for (const o of merging) deletes.set(segmentKey(o), o);
      counts.merged += merging.length;
      if (!same(next, keeper)) {
        // Still unedited, as an import leaves a booking it fills out, unless
        // it was touched since it was filed: rated, marked or edited.
        next = keeper.updatedAt === keeper.createdAt ? { ...next, createdAt: timestamp, updatedAt: timestamp } : { ...next, updatedAt: timestamp };
        writes.set(segmentKey(next), next);
      }
      carrying.push(next);
    });

    // What the email gave before and no longer does.
    for (const o of own) {
      if (used.has(segmentKey(o))) continue;
      if (!handEdited(o) && segmentSources(o).every((r) => r.id === record.messageId)) {
        deletes.set(segmentKey(o), o);
        counts.removed += 1;
        continue;
      }
      if (handEdited(o)) counts.kept += 1;
      carrying.push(o);
    }

    // What it gives that is new: beside the email's other bookings, else
    // where an import would file it; regrouping settles it afterwards.
    let created: Trip | undefined;
    const added: Segment[] = [];
    if (unmatched.length) {
      const segments = unmatched.map((u) => u.segment);
      const periods = homeTimeline([...all, ...segments]);
      const remaining = (tripId: string) => (segmentsByTrip.get(tripId) ?? []).filter((s) => !deletes.has(segmentKey(s)));
      const filable = read.filter((trip) => !trip.id.startsWith(sourceTripPrefix));
      let tripId =
        carrying[0]?.tripId ??
        (record.tripId && tripOf.has(record.tripId) ? record.tripId : undefined) ??
        findTripForBooking(filable, remaining, segments, periods, overrides)?.id;
      if (!tripId) {
        const dates = bookedDateRange(segments)!;
        created = {
          id: deps.store.newId(),
          title: tripTitle(segments, periods, overrides),
          start: dates.start,
          end: dates.end,
          ownerUid: uid,
          sharedWith: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        tripId = created.id;
      }
      const taken = new Set([...options.snapshot, ...all].map((s) => s.id));
      for (const { segment, index } of unmatched) {
        let id = `${record.messageId}-${index}`;
        for (let n = 1; taken.has(id); n++) id = `${record.messageId}-${index}-${n}`;
        taken.add(id);
        const fresh: Segment = withWaitingCancellations({
          ...segment,
          id,
          tripId,
          source,
          gmailMessageIds: source === "gmail" ? [record.messageId] : [],
          sources: [ref],
          ...(sender ? { sender } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        }, [ref.sentAt], pending, timestamp);
        writes.set(segmentKey(fresh), fresh);
        added.push(fresh);
        carrying.push(fresh);
      }
      counts.added = added.length;
    }

    const first = carrying[0];
    const nextRecord: ParsedMessage = {
      ...record,
      segmentIds: carrying.filter((s) => s.tripId === first?.tripId).map((s) => s.id),
      processedAt: timestamp,
    };
    delete nextRecord.matchedSegmentIds;
    if (first) nextRecord.tripId = first.tripId;
    else delete nextRecord.tripId;
    if (writes.size === 0 && deletes.size === 0) return counts;

    // Then the writes.
    if (created) tx.createTrip(created);
    for (const segment of deletes.values()) tx.deleteSegment(segment.tripId, segment.id);
    for (const segment of writes.values()) tx.putSegment(segment);
    const touched = new Set([...deletes.values(), ...writes.values()].map((s) => s.tripId));
    for (const tripId of touched) {
      const trip = tripOf.get(tripId);
      if (!trip) continue;
      const before = segmentsByTrip.get(tripId) ?? [];
      const after = [
        ...before.filter((s) => !deletes.has(segmentKey(s))).map((s) => writes.get(segmentKey(s)) ?? s),
        ...[...writes.values()].filter((w) => w.tripId === tripId && !before.some((s) => s.id === w.id)),
      ];
      // A trip this emptied goes, unless it is shared: the people it is
      // shared with keep it until its owner deletes it.
      if (after.length === 0 && trip.sharedWith.length === 0) {
        tx.deleteTrip(tripId);
        continue;
      }
      const dates = bookedDateRange(after);
      if (dates && (dates.start < trip.start || dates.end > trip.end)) {
        tx.extendTrip(tripId, { start: min(trip.start, dates.start), end: max(trip.end, dates.end), updatedAt: timestamp });
      } else tx.touchTrip(tripId, timestamp);
    }
    tx.putParsed(nextRecord);
    tx.settle(read, (tripId) => segmentsByTrip.get(tripId) ?? []);
    return counts;
  });
}

// An import record whose email is in a mailbox (Gmail, Fastmail, IMAP), so
// it can be read again: not a TripIt item, a calendar event or a forward.
export function isMailboxRecord(record: ParsedMessage): boolean {
  return record.source === undefined || record.source === "gmail" || record.source === "fastmail" || record.source === "imap";
}

export type RecordOutcome =
  | { kind: "refreshed"; counts: EmailRefresh }
  // The email is gone from its mailbox, or the mailbox is not connected.
  | { kind: "missing" }
  | { kind: "failed" }
  // Gmail or the model refused for rate; the email is read again later.
  | { kind: "rateLimited"; by: "gmail" | "model" }
  // The user deleted all their trips meanwhile.
  | { kind: "superseded" };

// Reads one record's email from its mailbox and refreshes its bookings.
// `fetch` gives undefined for an email that is gone or whose mailbox is not
// connected, and throws GmailRateLimited once Gmail refused for longer than
// the batch can wait.
export async function refreshRecord(
  uid: string,
  record: ParsedMessage,
  deps: ImportDeps,
  options: { generation: number; snapshot: readonly Segment[]; fetch: (record: ParsedMessage) => Promise<EmailMessage | undefined> },
): Promise<RecordOutcome> {
  let message: EmailMessage | undefined;
  try {
    message = await options.fetch(record);
  } catch (error) {
    if (error instanceof GmailRateLimited) return { kind: "rateLimited", by: "gmail" };
    throw error;
  }
  if (!message) {
    deps.log("refresh_email_missing", { uid, messageId: record.messageId });
    return { kind: "missing" };
  }
  try {
    const counts = await refreshEmail(uid, record, message, deps, options);
    deps.log("refreshed", { uid, messageId: record.messageId, ...counts });
    return { kind: "refreshed", counts };
  } catch (error) {
    if (error instanceof ImportSupersededError) {
      deps.log("import_superseded", { uid, messageId: record.messageId });
      return { kind: "superseded" };
    }
    if (!(error instanceof ExtractionFailed)) throw error;
    if (isModelRateLimit(error.cause)) {
      deps.log("refresh_model_rate_limited", { uid, messageId: record.messageId }, "WARNING");
      return { kind: "rateLimited", by: "model" };
    }
    deps.log("refresh_extract_failed", { uid, messageId: record.messageId, reason: (error.cause as Error)?.message }, "WARNING");
    return { kind: "failed" };
  }
}

// Records read per batch: more than a batch gets through in its time.
export const refreshPage = 100;
// How long a refresh that Gmail or the model rate limited waits before
// reading on: both quotas are per minute.
export const refreshPauseMs = 60 * 1000;

export type RefreshBatchIo = {
  records: (after: string | undefined, limit: number) => Promise<ParsedMessage[]>;
  // The user's bookings, read once a batch (refreshEmail's `snapshot`).
  snapshot: () => Promise<Segment[]>;
  refresh: (record: ParsedMessage, snapshot: readonly Segment[]) => Promise<RecordOutcome>;
  // The batch stops between emails once this reaches zero.
  timeLeftMs: () => number;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

// The emails a refresh will read, counted once when it starts.
async function countEmails(io: RefreshBatchIo): Promise<number> {
  let after: string | undefined;
  let total = 0;
  for (;;) {
    const page = await io.records(after, 500);
    total += page.filter(isMailboxRecord).length;
    if (page.length < 500) return total;
    after = page[page.length - 1]!.messageId;
  }
}

// One batch of a refresh: the import records after `from.cursor`, an
// email at a time while time allows (backfillChain.ts runs batch after
// batch). An email the model failed on is passed and counted, and the
// refresh stops there, for Settings to offer Continue. One that Gmail or
// the model rate limited is read again by the next batch, a minute on:
// after Gmail's limit the refresh goes on by itself, after the model's it
// stops for Continue, since the model's quota is the whole project's.
export async function runRefreshBatch(from: RefreshProgress, io: RefreshBatchIo): Promise<BackfillBatch> {
  const total = from.total ?? (await countEmails(io));
  const tally = {
    scanned: from.scanned,
    failed: from.failed ?? 0,
    updated: from.updated ?? 0,
    added: from.added ?? 0,
    removed: from.removed ?? 0,
    merged: from.merged ?? 0,
    kept: from.kept ?? 0,
    missing: from.missing ?? 0,
  };
  let cursor = from.cursor;
  const page = await io.records(cursor, refreshPage);
  const snapshot = page.some(isMailboxRecord) ? await io.snapshot() : [];
  const counts = emptyCounts();
  let retryAfter: string | undefined;
  let rateLimited = false;
  let read = 0;
  for (const record of page) {
    if (read > 0 && io.timeLeftMs() <= 0) break;
    if (!isMailboxRecord(record)) {
      cursor = record.messageId;
      continue;
    }
    const outcome = await io.refresh(record, snapshot);
    if (outcome.kind === "superseded") break;
    if (outcome.kind === "rateLimited") {
      io.log("refresh_rate_limited", { by: outcome.by });
      retryAfter = new Date(Date.parse(io.now()) + refreshPauseMs).toISOString();
      rateLimited = true;
      if (outcome.by === "model") counts.failed = 1;
      break;
    }
    read += 1;
    tally.scanned += 1;
    cursor = record.messageId;
    if (outcome.kind === "missing") tally.missing += 1;
    if (outcome.kind === "failed") {
      tally.failed += 1;
      counts.failed = 1;
      break;
    }
    if (outcome.kind === "refreshed") {
      for (const key of ["updated", "added", "removed", "merged", "kept"] as const) tally[key] += outcome.counts[key];
      if (outcome.counts.updated + outcome.counts.added + outcome.counts.removed + outcome.counts.merged > 0) counts.imported += 1;
    }
  }
  const allRead = page.length === 0 || cursor === page[page.length - 1]!.messageId;
  const progress: RefreshProgress = {
    ...(cursor !== undefined ? { cursor } : {}),
    scanned: tally.scanned,
    imported: tally.updated + tally.added + tally.removed + tally.merged,
    failed: tally.failed,
    done: allRead && page.length < refreshPage,
    updatedAt: io.now(),
    total,
    updated: tally.updated,
    added: tally.added,
    removed: tally.removed,
    merged: tally.merged,
    kept: tally.kept,
    missing: tally.missing,
    ...(retryAfter ? { retryAfter } : {}),
  };
  return { counts, candidates: page.length, progress, ...(rateLimited ? { rateLimited: true } : {}) };
}
