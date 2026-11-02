import type { BackfillProgress } from "@travelmo/core";
import type { MessagePage } from "./gmail";
import type { ImportCounts } from "./importer";

// Reading a whole mailbox's history, in batches small enough for one
// request: each batch searches on from where the last stopped (Gmail's page
// cursor, kept on the connection), imports what it finds, and records how
// far it got. Every message is claimed once, so a batch read twice, or a
// reading started over, costs Gmail reads but never imports twice.

// Booking-like subjects over the whole mailbox; the pre-filter and the
// model decide the rest.
export const backfillQuery =
  "-in:spam -in:trash {subject:booking subject:reservation subject:confirmation subject:confirmed subject:itinerary subject:ticket subject:tickets subject:flight subject:hotel subject:rental subject:check-in subject:\"boarding pass\"}";
// Messages per batch: enough to make progress, few enough to finish well
// inside a request.
export const backfillBatch = 300;

export type BackfillIo = {
  page: (pageToken: string | undefined) => Promise<MessagePage>;
  importIds: (ids: readonly string[]) => Promise<ImportCounts>;
  isStaleCursor: (error: unknown) => boolean;
  now: () => string;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export type BackfillBatch = { counts: ImportCounts; candidates: number; progress: BackfillProgress };

export async function runBackfillBatch(previous: BackfillProgress | undefined, restart: boolean, io: BackfillIo): Promise<BackfillBatch> {
  const start = restart || !previous || previous.done ? undefined : previous;
  let cursor = start?.cursor;
  let page: MessagePage;
  try {
    page = await io.page(cursor);
  } catch (error) {
    // A cursor Gmail no longer honors: start over. Messages already read
    // are skipped by their claims, so only Gmail reads are repeated.
    if (!cursor || !io.isStaleCursor(error)) throw error;
    io.log("backfill_cursor_expired", {});
    cursor = undefined;
    page = await io.page(undefined);
  }
  const counts = await io.importIds(page.ids);
  const progress: BackfillProgress = {
    ...(page.nextPageToken ? { cursor: page.nextPageToken } : {}),
    scanned: (start && cursor ? start.scanned : 0) + page.ids.length,
    imported: (start && cursor ? start.imported : 0) + counts.imported,
    failed: (start && cursor ? (start.failed ?? 0) : 0) + counts.failed,
    done: !page.nextPageToken,
    updatedAt: io.now(),
  };
  return { counts, candidates: page.ids.length, progress };
}
