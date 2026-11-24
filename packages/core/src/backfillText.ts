import type { BackfillProgress } from "./schema";

type Shown = Pick<BackfillProgress, "scanned" | "imported" | "done" | "failed" | "running" | "leaseUntil" | "retryAfter" | "failures" | "retrying" | "updatedAt">;

// What Settings says about "Import past bookings" on the web and Android
// (BackfillText.kt is the Kotlin twin), and the parser's paths for it.
export const gmailConnectPath = "/gmail/connect";
export const gmailDisconnectPath = "/gmail/disconnect";
export const backfillStartPath = "/gmail/backfill";
export const backfillStopPath = "/gmail/backfill/stop";
export const fastmailConnectPath = "/fastmail/connect";
export const fastmailDisconnectPath = "/fastmail/disconnect";
export const fastmailBackfillStartPath = "/fastmail/backfill";
export const fastmailBackfillStopPath = "/fastmail/backfill/stop";
export const imapConnectPath = "/imap/connect";
export const imapDisconnectPath = "/imap/disconnect";
export const imapBackfillStartPath = "/imap/backfill";
export const imapBackfillStopPath = "/imap/backfill/stop";

// The parser reads the mailbox batch after batch on its own once started,
// recording its progress on the connection. A reading that has saved
// nothing for this long has stalled (Pub/Sub gave up on a batch, say), so
// Settings offers to continue it instead of showing it as running.
export const stalledAfterMs = 30 * 60 * 1000;

// A reading waiting out a pause it set itself (`retryAfter`: Gmail's rate
// limit, failed emails or a failed batch, up to two hours) is still reading.
export function isReading(progress: Shown | undefined, now: number): boolean {
  if (!progress?.running || progress.done) return false;
  const lease = progress.leaseUntil ? Date.parse(progress.leaseUntil) : 0;
  const resumes = progress.retryAfter ? Date.parse(progress.retryAfter) : 0;
  return now - Math.max(Date.parse(progress.updatedAt), lease, resumes) < stalledAfterMs;
}

const n = (x: number) => x.toLocaleString("en-US");
const emails = (x: number) => (x === 1 ? "1 email" : `${n(x)} emails`);

// The reading goes on by itself past emails that fail to import (the model
// was down, say) and tries them again once the rest are read, so the count
// says what happens to them rather than asking anything of the user.
export function describeBackfill(progress: Shown, reading: boolean): string {
  const read = `${n(progress.scanned)} booking-like emails read, ${n(progress.imported)} ${progress.imported === 1 ? "booking" : "bookings"} imported`;
  const failed = progress.failed ?? 0;
  if (progress.done) {
    const left = failed ? ` ${emails(failed)} couldn't be read, even on a second try. Read again from the start to try ${failed === 1 ? "it" : "them"} once more.` : "";
    return `Whole mailbox read: ${read}.${left}`;
  }
  const retrying = progress.retrying?.length ?? 0;
  if (reading && retrying) return `Trying ${emails(retrying)} that failed again… ${read} so far. You can close this page.`;
  const later = failed ? ` ${emails(failed)} couldn't be read yet; ${failed === 1 ? "it's" : "they're"} tried again at the end.` : "";
  return reading ? `Reading your mailbox… ${read} so far.${later} You can close this page.` : `Stopped part way: ${read}.${later} Continue to read the rest.`;
}

// Why a reading stopped on its own, if it did: batch after batch failed for
// hours (a revoked grant, say).
export function pausedReason(progress: Shown | undefined, reading: boolean): string | undefined {
  if (!progress?.failures || progress.running || reading || progress.done) return undefined;
  return "Reading stopped after repeated errors. Continue to try again; if it stops again, disconnect the mailbox and connect it again.";
}
