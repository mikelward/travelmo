import { describe, expect, it } from "vitest";
import { describeBackfill, isReading, pausedReason, stalledAfterMs } from "./backfill";

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
    expect(describeBackfill({ scanned: 1234, imported: 12, failed: 3, done: true, updatedAt: at }, false)).toBe(
      "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported, 3 failed. Read again from the start to try the failed ones again.",
    );
  });
});

describe("pausedReason", () => {
  const paused = { scanned: 600, imported: 0, failed: 2, lastFailed: 2, done: false, running: false, updatedAt: ago(0) };

  it("says why a batch with failed imports paused the reading", () => {
    expect(pausedReason(paused, false)).toBe(
      "Reading paused: 2 emails in the last batch could not be imported. Continue when ready; failed emails are tried again when you read from the start.",
    );
    expect(pausedReason({ ...paused, lastFailed: 1 }, false)).toContain("1 email in the last batch");
  });

  it("gives no reason when the reading did not pause on its own", () => {
    expect(pausedReason(undefined, false)).toBeUndefined();
    expect(pausedReason({ ...paused, lastFailed: undefined }, false)).toBeUndefined();
    expect(pausedReason(paused, true)).toBeUndefined();
    expect(pausedReason({ ...paused, done: true }, false)).toBeUndefined();
  });
});
