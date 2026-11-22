import type { BackfillProgress } from "@travelmo/core";
import type { MessagePage } from "./gmail";
import { emptyCounts, type ImportCounts } from "./importer";

// Reading a whole mailbox's history, in batches small enough for one
// request: each batch searches on from where the last stopped (Gmail's page
// cursor, kept on the connection), imports what it finds, and records how
// far it got. Every message is claimed once, so a batch read twice, or a
// reading started over, costs Gmail reads but never imports twice.

// Booking-like subjects over the whole mailbox; the pre-filter and the
// model decide the rest.
export const backfillQuery =
  "-in:spam -in:trash {subject:booking subject:reservation subject:confirmation subject:confirmed subject:itinerary subject:ticket subject:tickets subject:flight subject:hotel subject:rental subject:check-in subject:\"boarding pass\"}";
// Messages per batch: enough to make progress. A batch that runs short of
// time stops early (see `timeLeftMs`), so it always ends inside a request.
export const backfillBatch = 300;
// Messages imported between checks of the time left. Messages are imported
// one after another anyway, so checking before each costs nothing and keeps
// the overrun to one slow message.
export const backfillChunk = 1;

export type BackfillIo = {
  page: (pageToken: string | undefined) => Promise<MessagePage>;
  importIds: (ids: readonly string[]) => Promise<ImportCounts>;
  // How long the batch may still run; it stops between messages once this
  // falls to zero, so the request never outlives the server's time limit.
  timeLeftMs?: () => number;
  isStaleCursor: (error: unknown) => boolean;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export type BackfillBatch = { counts: ImportCounts; candidates: number; progress: BackfillProgress };

export async function runBackfillBatch(previous: BackfillProgress | undefined, restart: boolean, io: BackfillIo): Promise<BackfillBatch> {
  const start = restart || !previous || previous.done ? undefined : previous;
  let cursor = start?.cursor;
  // Totals carry on from the last batch unless the reading starts over.
  let carryOn = start !== undefined;
  let page: MessagePage;
  try {
    page = await io.page(cursor);
  } catch (error) {
    // A cursor Gmail no longer honors: start over. Messages already read
    // are skipped by their claims, so only Gmail reads are repeated.
    if (!cursor || !io.isStaleCursor(error)) throw error;
    io.log("backfill_cursor_expired", {});
    cursor = undefined;
    carryOn = false;
    page = await io.page(undefined);
  }
  // Import in chunks, stopping early when time runs short. A batch cut short
  // keeps the cursor it started from and how far into that page it got, so
  // the next batch carries on after the messages it read, even ones whose
  // import failed and would otherwise be tried again first.
  // Found by id, not position, as messages may leave the search between
  // batches. If that message has gone too, the page is read from its start:
  // messages read already are skipped, and only failed ones are tried again.
  const from = carryOn && start?.after && start.cursor === cursor ? page.ids.indexOf(start.after) + 1 : 0;
  let counts = emptyCounts();
  let read = from;
  while (read < page.ids.length) {
    if (read > from && io.timeLeftMs && io.timeLeftMs() <= 0) break;
    const chunk = page.ids.slice(read, read + backfillChunk);
    const chunkCounts = await io.importIds(chunk);
    counts = addCounts(counts, chunkCounts);
    read += chunk.length;
  }
  const finished = read >= page.ids.length;
  if (!finished) io.log("backfill_cut_short", { read, of: page.ids.length });
  const next = finished ? page.nextPageToken : cursor;
  const progress: BackfillProgress = {
    ...(next ? { cursor: next } : {}),
    ...(finished ? {} : { after: page.ids[read - 1] }),
    scanned: (carryOn && start ? start.scanned : 0) + (finished ? page.ids.length : 0),
    imported: (carryOn && start ? start.imported : 0) + counts.imported,
    failed: (carryOn && start ? (start.failed ?? 0) : 0) + counts.failed,
    done: finished && !page.nextPageToken,
    updatedAt: io.now(),
  };
  return { counts, candidates: page.ids.length, progress };
}

function addCounts(a: ImportCounts, b: ImportCounts): ImportCounts {
  const sum = { ...a };
  for (const key of Object.keys(sum) as (keyof ImportCounts)[]) sum[key] += b[key];
  return sum;
}
