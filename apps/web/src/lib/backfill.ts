import type { BackfillProgress } from "@travelmo/core";

type Shown = Pick<BackfillProgress, "scanned" | "imported" | "done" | "failed" | "running" | "leaseUntil" | "lastFailed" | "updatedAt">;

// The parser reads the mailbox batch after batch on its own once started,
// recording its progress on the connection. A reading that has saved
// nothing for this long has stalled (Pub/Sub gave up on a batch, say), so
// Settings offers to continue it instead of showing it as running.
export const stalledAfterMs = 30 * 60 * 1000;

export function isReading(progress: Shown | undefined, now: number): boolean {
  if (!progress?.running || progress.done) return false;
  const lease = progress.leaseUntil ? Date.parse(progress.leaseUntil) : 0;
  return now - Math.max(Date.parse(progress.updatedAt), lease) < stalledAfterMs;
}

const n = (x: number) => x.toLocaleString("en-US");

export function describeBackfill(progress: Shown, reading: boolean): string {
  const failed = progress.failed ? `, ${n(progress.failed)} failed` : "";
  const read = `${n(progress.scanned)} booking-like emails read, ${n(progress.imported)} ${progress.imported === 1 ? "booking" : "bookings"} imported${failed}`;
  if (progress.done) return `Whole mailbox read: ${read}.${progress.failed ? " Read again from the start to try the failed ones again." : ""}`;
  return reading ? `Reading your mailbox… ${read} so far. You can close this page.` : `Stopped part way: ${read}. Continue to read the rest.`;
}

// Why a reading paused on its own, if it did.
export function pausedReason(progress: Shown | undefined, reading: boolean): string | undefined {
  if (!progress?.lastFailed || reading || progress.done) return undefined;
  const what = progress.lastFailed === 1 ? "1 email" : `${n(progress.lastFailed)} emails`;
  return `Reading paused: ${what} in the last batch could not be imported. Continue when ready; failed emails are tried again when you read from the start.`;
}
