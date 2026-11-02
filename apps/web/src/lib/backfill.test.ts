import { describe, expect, it } from "vitest";
import { describeBackfill, pausedReason, readWholeMailbox } from "./backfill";

describe("readWholeMailbox", () => {
  const batches = (n: number, failing = new Set<number>()) => {
    const calls: boolean[] = [];
    let i = 0;
    const batch = async (restart: boolean) => {
      calls.push(restart);
      i += 1;
      return { failed: failing.has(i) ? 2 : 0, progress: { scanned: i * 300, imported: i, done: i >= n } };
    };
    return { batch, calls };
  };

  it("keeps reading batches until the mailbox is done, restarting only the first if asked", async () => {
    const { batch, calls } = batches(3);
    const seen: number[] = [];
    const last = await readWholeMailbox(batch, { restart: true, onBatch: (b) => seen.push(b.progress.scanned), stopped: () => false });
    expect(last?.progress.done).toBe(true);
    expect(seen).toEqual([300, 600, 900]);
    expect(calls).toEqual([true, false, false]);
  });

  it("stops between batches when the user stops it", async () => {
    const { batch } = batches(10);
    let stop = false;
    const last = await readWholeMailbox(batch, { restart: false, onBatch: (b) => (stop = b.progress.scanned >= 600), stopped: () => stop });
    expect(last?.progress).toMatchObject({ scanned: 600, done: false });
  });

  it("pauses after a batch whose imports failed, and says why", async () => {
    const { batch, calls } = batches(10, new Set([2]));
    const last = await readWholeMailbox(batch, { restart: false, onBatch: () => {}, stopped: () => false });
    expect(calls).toHaveLength(2);
    expect(last?.progress).toMatchObject({ scanned: 600, done: false });
    expect(pausedReason(last)).toBe(
      "Reading paused: 2 emails in the last batch could not be imported. Continue when ready; failed emails are tried again when you read from the start.",
    );
  });

  it("gives no reason when the reading ended on its own", () => {
    expect(pausedReason(undefined)).toBeUndefined();
    expect(pausedReason({ failed: 0, progress: { scanned: 300, imported: 1, done: true } })).toBeUndefined();
  });
});

describe("describeBackfill", () => {
  it("says how far it got, while running, stopped and done", () => {
    expect(describeBackfill({ scanned: 600, imported: 1, done: false }, true)).toBe(
      "Reading your mailbox… 600 booking-like emails read, 1 booking imported so far.",
    );
    expect(describeBackfill({ scanned: 600, imported: 2, done: false }, false)).toBe(
      "Stopped part way: 600 booking-like emails read, 2 bookings imported. Continue to read the rest.",
    );
    expect(describeBackfill({ scanned: 1234, imported: 12, done: true }, false)).toBe(
      "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported.",
    );
    expect(describeBackfill({ scanned: 1234, imported: 12, failed: 3, done: true }, false)).toBe(
      "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported, 3 failed. Read again from the start to try the failed ones again.",
    );
  });
});
