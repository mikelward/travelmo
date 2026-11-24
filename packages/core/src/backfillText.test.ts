import { describe, expect, it } from "vitest";
import { describeBackfill, isReading, pausedReason, stalledAfterMs } from "./backfillText";

const now = Date.parse("2026-11-22T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("isReading", () => {
  it("follows the reading the parser runs, until it stops, finishes or stalls", () => {
    const running = { scanned: 300, imported: 1, done: false, running: true, updatedAt: ago(60_000) };
    expect(isReading(running, now)).toBe(true);
    expect(isReading({ ...running, running: false }, now)).toBe(false);
    expect(isReading({ ...running, done: true }, now)).toBe(false);
    expect(isReading(undefined, now)).toBe(false);
    // Nothing saved for half an hour: Pub/Sub gave up on it.
    expect(isReading({ ...running, updatedAt: ago(stalledAfterMs) }, now)).toBe(false);
    // Unless a batch is reading right now.
    expect(isReading({ ...running, updatedAt: ago(stalledAfterMs), leaseUntil: ago(-60_000) }, now)).toBe(true);
    // Nor while it waits out a pause it set, however long.
    expect(isReading({ ...running, updatedAt: ago(stalledAfterMs * 2), retryAfter: ago(-60 * 60_000) }, now)).toBe(true);
    expect(isReading({ ...running, updatedAt: ago(stalledAfterMs * 4), retryAfter: ago(stalledAfterMs) }, now)).toBe(false);
  });
});

describe("describeBackfill", () => {
  it("says how far it got, while running, stopped and done", () => {
    const at = ago(0);
    expect(describeBackfill({ scanned: 600, imported: 1, done: false, updatedAt: at }, true)).toBe(
      "Reading your mailbox… 600 booking-like emails read, 1 booking imported so far. You can close this page.",
    );
    expect(describeBackfill({ scanned: 600, imported: 2, done: false, updatedAt: at }, false)).toBe(
      "Stopped part way: 600 booking-like emails read, 2 bookings imported. Continue to read the rest.",
    );
    expect(describeBackfill({ scanned: 1234, imported: 12, done: true, updatedAt: at }, false)).toBe(
      "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported.",
    );
  });

  it("says what happens to emails that failed, asking nothing of the user until both tries are spent", () => {
    const at = ago(0);
    expect(describeBackfill({ scanned: 600, imported: 2, failed: 6, done: false, updatedAt: at }, true)).toBe(
      "Reading your mailbox… 600 booking-like emails read, 2 bookings imported so far. 6 emails couldn't be read yet; they're tried again at the end. You can close this page.",
    );
    expect(describeBackfill({ scanned: 900, imported: 3, failed: 6, retrying: ["a", "b", "c", "d", "e", "f"], done: false, updatedAt: at }, true)).toBe(
      "Trying 6 emails that failed again… 900 booking-like emails read, 3 bookings imported so far. You can close this page.",
    );
    expect(describeBackfill({ scanned: 1234, imported: 12, failed: 1, done: true, updatedAt: at }, false)).toBe(
      "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported. 1 email couldn't be read, even on a second try. Read again from the start to try it once more.",
    );
  });
});

describe("pausedReason", () => {
  const stopped = { scanned: 600, imported: 0, failures: 6, done: false, running: false, updatedAt: ago(0) };

  it("says why a reading stopped after batch after batch failed", () => {
    expect(pausedReason(stopped, false)).toBe(
      "Reading stopped after repeated errors. Continue to try again; if it stops again, disconnect the mailbox and connect it again.",
    );
  });

  it("gives no reason when the reading did not stop on its own", () => {
    expect(pausedReason(undefined, false)).toBeUndefined();
    expect(pausedReason({ ...stopped, failures: undefined }, false)).toBeUndefined();
    expect(pausedReason({ ...stopped, running: true }, false)).toBeUndefined();
    expect(pausedReason(stopped, true)).toBeUndefined();
    expect(pausedReason({ ...stopped, done: true }, false)).toBeUndefined();
  });
});
