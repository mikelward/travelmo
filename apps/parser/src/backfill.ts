import type { BackfillProgress } from "@travelmo/core";
import { GmailRateLimited, withRateLimitRetry, type MessagePage } from "./gmail";
import { emptyCounts, type ImportCounts } from "./importer";
import { travelLoyaltyDomains } from "./prefilter";

// Reading a whole mailbox's history, in batches small enough for one
// request: each batch searches on from where the last stopped (Gmail's page
// cursor, kept on the connection), imports what it finds, and records how
// far it got. Every message is claimed once, so a batch read twice, or a
// reading started over, costs Gmail reads but never imports twice.

// Booking-like subjects over the whole mailbox, and travel programs' recent
// statements (the pre-filter reads only those under 60 days old); the
// pre-filter and the model decide the rest.
// The same search for every provider, in its own query language.
export const backfillSubjects = [
  "booking", "reservation", "confirmation", "confirmed", "itinerary", "ticket", "tickets", "flight", "hotel", "rental",
  "check-in", "boarding pass", "cancellation", "cancelation", "cancelled", "canceled",
] as const;
export const statementSubjects = ["statement", "estatement", "account summary", "balance"] as const;
export const statementDays = 60;
const gmailTerm = (term: string) => (term.includes(" ") ? `"${term}"` : term);
const statements = `(subject:(${statementSubjects.map(gmailTerm).join(" OR ")}) newer_than:${statementDays}d from:(${travelLoyaltyDomains.join(" OR ")}))`;
export const backfillQuery =
  `-in:spam -in:trash {${backfillSubjects.map((s) => `subject:${gmailTerm(s)}`).join(" ")} ${statements}}`;
// Messages per batch: enough to make progress, in one search call. A batch
// that runs short of time stops early (see `timeLeftMs`), so it always ends
// inside a request.
export const backfillBatch = 300;
// Messages imported between checks of the time left. Messages are imported
// one after another anyway, so checking before each costs nothing and keeps
// the overrun to one slow message.
export const backfillChunk = 1;
// How long a batch that Gmail kept rate limiting has the next one wait:
// Gmail's quota is per minute.
export const rateLimitPauseMs = 60 * 1000;
// Failed emails remembered to try again at the end; past this many, the
// rest are counted but left for "Read again from the start".
export const maxFailedIds = 1000;

export type BackfillIo = {
  page: (pageToken: string | undefined) => Promise<MessagePage>;
  importIds: (ids: readonly string[]) => Promise<ImportCounts>;
  // How long the batch may still run; it stops between messages once this
  // falls to zero, so the request never outlives the server's time limit.
  // Waits for Gmail's rate limits come out of it too; without it, a rate
  // limit ends the batch at once.
  timeLeftMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isStaleCursor: (error: unknown) => boolean;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

// `rateLimited`: Gmail still refused for rate when the batch ran out of
// time; it saved its place, and `progress.retryAfter` holds the next off.
export type BackfillBatch = { counts: ImportCounts; candidates: number; progress: BackfillProgress; rateLimited?: boolean };

export async function runBackfillBatch(previous: BackfillProgress | undefined, restart: boolean, io: BackfillIo): Promise<BackfillBatch> {
  const start = restart || !previous || previous.done ? undefined : previous;
  if (start?.retrying) return retryFailed(start, io);
  const retry = {
    timeLeftMs: io.timeLeftMs ?? (() => 0),
    sleep: io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    log: io.log,
  };
  const page = (token: string | undefined) => withRateLimitRetry(() => io.page(token), retry);
  // Gmail limited the batch for longer than it could wait: nothing more is
  // read, and the place reached is kept for the next batch, a minute on.
  const limited = (error: GmailRateLimited) => {
    io.log("backfill_rate_limited", { error: error.message });
    return new Date(Date.parse(io.now()) + rateLimitPauseMs).toISOString();
  };
  let cursor = start?.cursor;
  // Totals carry on from the last batch unless the reading starts over.
  let carryOn = start !== undefined;
  let found: MessagePage;
  try {
    try {
      found = await page(cursor);
    } catch (error) {
      // A cursor Gmail no longer honors: start over. Messages already read
      // are skipped by their claims, so only Gmail reads are repeated.
      if (!cursor || error instanceof GmailRateLimited || !io.isStaleCursor(error)) throw error;
      io.log("backfill_cursor_expired", {});
      cursor = undefined;
      carryOn = false;
      found = await page(undefined);
    }
  } catch (error) {
    if (!(error instanceof GmailRateLimited)) throw error;
    const retryAfter = limited(error);
    const kept: BackfillProgress = start
      ? { ...placeOf(start), updatedAt: io.now(), retryAfter }
      : { scanned: 0, imported: 0, failed: 0, done: false, updatedAt: io.now(), retryAfter };
    return { counts: emptyCounts(), candidates: 0, progress: kept, rateLimited: true };
  }
  // Import in chunks, stopping early when time runs short. A batch cut short
  // keeps the cursor it started from and how far into that page it got, so
  // the next batch carries on after the messages it read, even ones whose
  // import failed and would otherwise be tried again first.
  // Found by id, not position, as messages may leave the search between
  // batches. If that message has gone too, the page is read from its start:
  // messages read already are skipped, and only failed ones are tried again.
  const from = carryOn && start?.after && start.cursor === cursor ? found.ids.indexOf(start.after) + 1 : 0;
  let counts = emptyCounts();
  const failedIds: string[] = [];
  let read = from;
  let retryAfter: string | undefined;
  while (read < found.ids.length) {
    if (read > from && io.timeLeftMs && io.timeLeftMs() <= 0) break;
    const chunk = found.ids.slice(read, read + backfillChunk);
    let chunkCounts: ImportCounts;
    try {
      chunkCounts = await withRateLimitRetry(() => io.importIds(chunk), retry);
    } catch (error) {
      if (!(error instanceof GmailRateLimited)) throw error;
      retryAfter = limited(error);
      break;
    }
    counts = addCounts(counts, chunkCounts);
    // A chunk is one email (`backfillChunk`), so a failure is that email's.
    if (chunkCounts.failed) failedIds.push(...chunk);
    read += chunk.length;
  }
  const finished = read >= found.ids.length;
  if (!finished && !retryAfter) io.log("backfill_cut_short", { read, of: found.ids.length });
  const next = finished ? found.nextPageToken : cursor;
  // The last message read: on this page, or, when the batch read none of
  // it, the one the last batch stopped after.
  const after = finished ? undefined : read > 0 ? found.ids[read - 1] : undefined;
  const progress: BackfillProgress = {
    ...(next ? { cursor: next } : {}),
    ...(after ? { after } : {}),
    scanned: (carryOn && start ? start.scanned : 0) + (finished ? found.ids.length : 0),
    imported: (carryOn && start ? start.imported : 0) + counts.imported,
    failed: (carryOn && start ? (start.failed ?? 0) : 0) + counts.failed,
    done: finished && !found.nextPageToken,
    updatedAt: io.now(),
    ...(retryAfter ? { retryAfter } : {}),
  };
  const remembered = [...(carryOn && start ? (start.failedIds ?? []) : []), ...failedIds].slice(0, maxFailedIds);
  // Read through with failures: not done yet, the failed emails are tried
  // again by id first.
  if (progress.done && remembered.length) {
    const { cursor: _cursor, after: _after, ...rest } = progress;
    return { counts, candidates: found.ids.length, progress: { ...rest, done: false, retrying: remembered } };
  }
  if (remembered.length) progress.failedIds = remembered;
  return { counts, candidates: found.ids.length, progress, ...(retryAfter ? { rateLimited: true } : {}) };
}

// The emails that failed to import during the reading, tried again by id,
// as many as time allows; each that succeeds no longer counts as failed.
// The reading is done once each has had its second try.
async function retryFailed(start: BackfillProgress, io: BackfillIo): Promise<BackfillBatch> {
  const retry = {
    timeLeftMs: io.timeLeftMs ?? (() => 0),
    sleep: io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    log: io.log,
  };
  const ids = start.retrying ?? [];
  let counts = emptyCounts();
  let read = 0;
  let retryAfter: string | undefined;
  while (read < ids.length) {
    if (read > 0 && io.timeLeftMs && io.timeLeftMs() <= 0) break;
    const chunk = ids.slice(read, read + backfillChunk);
    try {
      counts = addCounts(counts, await withRateLimitRetry(() => io.importIds(chunk), retry));
    } catch (error) {
      if (!(error instanceof GmailRateLimited)) throw error;
      io.log("backfill_rate_limited", { error: error.message });
      retryAfter = new Date(Date.parse(io.now()) + rateLimitPauseMs).toISOString();
      break;
    }
    read += chunk.length;
  }
  const left = ids.slice(read);
  const { retrying: _retrying, failedIds: _failedIds, ...rest } = placeOf(start);
  const progress: BackfillProgress = {
    ...rest,
    imported: start.imported + counts.imported,
    // Every email tried that did not fail again is no longer a failure.
    failed: Math.max(0, (start.failed ?? 0) - (read - counts.failed)),
    done: left.length === 0,
    updatedAt: io.now(),
    ...(left.length ? { retrying: left } : {}),
    ...(retryAfter ? { retryAfter } : {}),
  };
  return { counts, candidates: read, progress, ...(retryAfter ? { rateLimited: true } : {}) };
}

// Where a reading had got to, and its totals.
function placeOf(progress: BackfillProgress): BackfillProgress {
  return {
    ...(progress.cursor ? { cursor: progress.cursor } : {}),
    ...(progress.after ? { after: progress.after } : {}),
    scanned: progress.scanned,
    imported: progress.imported,
    failed: progress.failed ?? 0,
    ...(progress.failedIds?.length ? { failedIds: progress.failedIds } : {}),
    ...(progress.retrying?.length ? { retrying: progress.retrying } : {}),
    done: false,
    updatedAt: progress.updatedAt,
  };
}

function addCounts(a: ImportCounts, b: ImportCounts): ImportCounts {
  const sum = { ...a };
  for (const key of Object.keys(sum) as (keyof ImportCounts)[]) sum[key] += b[key];
  return sum;
}
