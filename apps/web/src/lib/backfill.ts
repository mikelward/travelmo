import type { BackfillProgress } from "@travelmo/core";

type Shown = Pick<BackfillProgress, "scanned" | "imported" | "done" | "failed">;
type Batch = { failed: number; progress: Shown };

// Reads the mailbox batch after batch until it is done or the user stops;
// each batch records its own progress, so stopping (or closing the page)
// loses nothing and the next run carries on. A batch with failed imports
// pauses it: the model or Gmail may be down, and carrying on would only
// fail the rest of the mailbox too.
export async function readWholeMailbox<T extends Batch>(
  batch: (restart: boolean) => Promise<T>,
  options: { restart: boolean; onBatch: (result: T) => void; stopped: () => boolean },
): Promise<T | undefined> {
  let restart = options.restart;
  let last: T | undefined;
  while (!options.stopped()) {
    last = await batch(restart);
    restart = false;
    options.onBatch(last);
    if (last.progress.done || last.failed > 0) break;
  }
  return last;
}

const n = (x: number) => x.toLocaleString("en-US");

export function describeBackfill(progress: Shown, running: boolean): string {
  const failed = progress.failed ? `, ${n(progress.failed)} failed` : "";
  const read = `${n(progress.scanned)} booking-like emails read, ${n(progress.imported)} ${progress.imported === 1 ? "booking" : "bookings"} imported${failed}`;
  if (progress.done) return `Whole mailbox read: ${read}.${progress.failed ? " Read again from the start to try the failed ones again." : ""}`;
  return running ? `Reading your mailbox… ${read} so far.` : `Stopped part way: ${read}. Continue to read the rest.`;
}

// Why a reading paused on its own, if it did.
export function pausedReason(last: { failed: number; progress: Shown } | undefined): string | undefined {
  if (!last || last.failed === 0) return undefined;
  const what = last.failed === 1 ? "1 email" : `${n(last.failed)} emails`;
  return `Reading paused: ${what} in the last batch could not be imported. Continue when ready; failed emails are tried again when you read from the start.`;
}
