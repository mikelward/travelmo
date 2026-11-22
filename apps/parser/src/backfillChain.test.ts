import type { BackfillProgress } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import type { BackfillBatch } from "./backfill";
import {
  backfillLeaseMs,
  continueBackfill,
  parseContinuePush,
  startBackfill,
  stopBackfill,
  type ChainIo,
  type ContinueMessage,
} from "./backfillChain";
import { claimLeaseMs, emptyCounts } from "./importer";
import { BadPushEnvelope } from "./pubsub";

const t0 = Date.parse("2026-11-22T12:00:00Z");

// One user's connection in memory: the stored progress, the reset
// generation, the messages queued, and batches that each read 300 emails
// until the mailbox is done after `pages` of them.
function world(options: { pages?: number; failOn?: Set<number> } = {}) {
  const pages = options.pages ?? 3;
  let stored: BackfillProgress | undefined;
  let connected = true;
  let generation = 0;
  let clock = t0;
  const queued: ContinueMessage[] = [];
  const logged: string[] = [];
  const read: { from: BackfillProgress; generation: number }[] = [];
  let duringBatch: () => Promise<void> = async () => {};
  let throwOnBatch: Error | undefined;
  let throwOnPublish: Error | undefined;
  const io: ChainIo<{ uid: string }> = {
    change: async (fn) => {
      if (!connected) return undefined;
      const { next, result } = fn(stored, generation);
      if (next) stored = next;
      return { state: { uid: "u1" }, generation, result };
    },
    runBatch: async (_state, from, at): Promise<BackfillBatch> => {
      read.push({ from, generation: at });
      await duringBatch();
      if (throwOnBatch) throw throwOnBatch;
      const page = from.cursor ? Number(from.cursor) : 0;
      const failed = options.failOn?.has(page + 1) ? 2 : 0;
      const done = page + 1 >= pages;
      return {
        counts: { ...emptyCounts(), imported: 1, failed },
        candidates: 300,
        progress: {
          ...(done ? {} : { cursor: String(page + 1) }),
          scanned: from.scanned + 300,
          imported: from.imported + 1,
          failed: (from.failed ?? 0) + failed,
          done,
          updatedAt: new Date(clock).toISOString(),
        },
      };
    },
    publish: async (message) => {
      if (throwOnPublish) throw throwOnPublish;
      queued.push(message);
    },
    now: () => new Date(clock).toISOString(),
    log: (_severity, event) => logged.push(event),
  };
  // Delivers queued messages, oldest first, until none is left.
  const drain = async () => {
    const results = [];
    while (queued.length) results.push(await continueBackfill(queued.shift()!, io));
    return results;
  };
  return {
    io,
    queued,
    logged,
    read,
    drain,
    get stored() {
      return stored;
    },
    set stored(value) {
      stored = value;
    },
    disconnect: () => (connected = false),
    reset: () => {
      generation += 1;
      stored = undefined;
    },
    tick: (ms: number) => (clock += ms),
    during: (fn: () => Promise<void>) => (duringBatch = fn),
    failBatch: (error: Error | undefined) => (throwOnBatch = error),
    failPublish: (error: Error | undefined) => (throwOnPublish = error),
  };
}

describe("startBackfill", () => {
  it("queues the first batch and returns at once, without reading anything itself", async () => {
    const w = world();
    const result = await startBackfill("u1", "r1", false, w.io);
    expect(result).toMatchObject({ kind: "started", progress: { run: "r1", step: 0, running: true, scanned: 0, done: false } });
    expect(w.queued).toEqual([{ uid: "u1", run: "r1", step: 0 }]);
    expect(w.read).toEqual([]);
  });

  it("carries on from the stored place, or starts over when asked or when the last reading had finished", async () => {
    const w = world();
    w.stored = { cursor: "4", scanned: 1200, imported: 9, failed: 1, lastFailed: 1, done: false, updatedAt: "2026-11-01T00:00:00Z" };
    await startBackfill("u1", "r1", false, w.io);
    expect(w.stored).toMatchObject({ cursor: "4", scanned: 1200, imported: 9, failed: 1, run: "r1", step: 0, running: true });
    expect(w.stored?.lastFailed).toBeUndefined();
    await startBackfill("u1", "r2", true, w.io);
    expect(w.stored).toEqual({ scanned: 0, imported: 0, failed: 0, done: false, run: "r2", step: 0, running: true, queued: true, updatedAt: "2026-11-22T12:00:00.000Z" });
    w.stored = { scanned: 900, imported: 3, done: true, updatedAt: "2026-11-01T00:00:00Z" };
    await startBackfill("u1", "r3", false, w.io);
    expect(w.stored).toMatchObject({ scanned: 0, imported: 0, run: "r3" });
  });

  it("does nothing without a connection", async () => {
    const w = world();
    w.disconnect();
    expect(await startBackfill("u1", "r1", false, w.io)).toEqual({ kind: "disconnected" });
    expect(w.queued).toEqual([]);
  });

  it("joins a batch that is reading right now rather than reading alongside it", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    w.during(async () => {
      w.during(async () => {});
      await stopBackfill(w.io);
      // Pressed again while the batch still reads: no second reading starts.
      expect((await startBackfill("u1", "r2", false, w.io)).kind).toBe("joined");
      expect((await startBackfill("u1", "r3", true, w.io)).kind).toBe("busy");
    });
    const [first] = await w.drain().then((r) => r.slice(0, 1));
    expect(first).toMatchObject({ kind: "ran" });
    expect(w.stored).toMatchObject({ run: "r1", done: true });
    // The joined reading went on to the end after the batch it joined.
    expect(w.read).toHaveLength(3);
  });

  it("stops the reading when the first batch cannot be queued, and says so", async () => {
    const w = world();
    w.failPublish(new Error("Pub/Sub down"));
    await expect(startBackfill("u1", "r1", false, w.io)).rejects.toThrow("Pub/Sub down");
    expect(w.stored).toMatchObject({ run: "r1", running: false });
    expect(w.logged).toContain("backfill_queue_failed");
  });

  it("records the first batch as queued", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    expect(w.stored).toMatchObject({ step: 0, queued: true });
  });
});

describe("continueBackfill", () => {
  it("reads batch after batch, each queueing the next, until the mailbox is done", async () => {
    const w = world({ pages: 3 });
    await startBackfill("u1", "r1", false, w.io);
    const results = await w.drain();
    expect(results.map((r) => r.kind)).toEqual(["ran", "ran", "ran"]);
    expect(w.read.map((r) => r.from.cursor)).toEqual([undefined, "1", "2"]);
    expect(w.stored).toMatchObject({ scanned: 900, imported: 3, done: true, running: false, run: "r1", step: 3 });
    expect(w.stored?.leaseUntil).toBeUndefined();
  });

  it("drops a second copy of a batch already read", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued[0]!;
    await continueBackfill(first, w.io);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "duplicate" });
    expect(w.read).toHaveLength(1);
  });

  it("makes a copy delivered while its batch still reads wait, then drops it", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    let copy: unknown;
    w.during(async () => {
      w.during(async () => {});
      copy = await continueBackfill(first, w.io);
    });
    await continueBackfill(first, w.io);
    // Failing makes Pub/Sub try it again later, by when it is out of date.
    expect(copy).toEqual({ kind: "busy" });
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "duplicate" });
    expect(w.read).toHaveLength(1);
  });

  it("drops the batches of an older reading once a newer one starts", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    const old = w.queued.shift()!;
    await startBackfill("u1", "r2", true, w.io);
    expect(await continueBackfill(old, w.io)).toEqual({ kind: "stale", reason: "superseded" });
    expect(w.read).toEqual([]);
  });

  it("drops a batch that arrives after the reading was stopped, keeping its place", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    await continueBackfill(w.queued.shift()!, w.io);
    expect(await stopBackfill(w.io)).toBe(true);
    expect(await continueBackfill(w.queued.shift()!, w.io)).toEqual({ kind: "stale", reason: "stopped" });
    expect(w.stored).toMatchObject({ cursor: "1", scanned: 300, running: false });
  });

  it("saves the place of a batch stopped while it read, and queues no more", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    w.during(async () => {
      await stopBackfill(w.io);
    });
    expect((await continueBackfill(w.queued.shift()!, w.io)).kind).toBe("ran");
    expect(w.stored).toMatchObject({ cursor: "1", scanned: 300, running: false });
    expect(w.queued).toEqual([]);
  });

  it("pauses after a batch with failed imports, which Settings shows", async () => {
    const w = world({ pages: 5, failOn: new Set([2]) });
    await startBackfill("u1", "r1", false, w.io);
    await w.drain();
    expect(w.read).toHaveLength(2);
    expect(w.stored).toMatchObject({ scanned: 600, failed: 2, lastFailed: 2, running: false, done: false });
    // Continue carries on from there and clears the pause.
    await startBackfill("u1", "r2", false, w.io);
    expect(w.stored?.lastFailed).toBeUndefined();
    await w.drain();
    expect(w.stored).toMatchObject({ scanned: 1500, done: true });
  });

  it("stops when the trips are reset: the batch under way does not save, and no more run", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    w.during(async () => w.reset());
    expect((await continueBackfill(first, w.io)).kind).toBe("superseded");
    expect(w.stored).toBeUndefined();
    expect(w.queued).toEqual([]);
    w.during(async () => {});
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "superseded" });
  });

  it("reads with the generation it claimed under", async () => {
    const w = world();
    w.reset();
    w.reset();
    await startBackfill("u1", "r1", false, w.io);
    await continueBackfill(w.queued.shift()!, w.io);
    expect(w.read[0]?.generation).toBe(2);
  });

  it("reads a failed batch again only once the email it was importing can be claimed again", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    w.failBatch(new Error("Gmail down"));
    await expect(continueBackfill(first, w.io)).rejects.toThrow("Gmail down");
    expect(w.stored).toMatchObject({ step: 0, running: true });
    w.failBatch(undefined);
    // Sooner, the importer would skip that email as another import's, and
    // the batch would pass it by.
    w.tick(claimLeaseMs);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "busy" });
    w.tick(2000);
    expect((await continueBackfill(first, w.io)).kind).toBe("ran");
    expect(w.read).toHaveLength(2);
  });

  it("reads a batch whose process died again only once the email it was importing can be claimed again", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    // Claimed, then the process died mid-batch: the lease is never given back.
    w.during(async () => {
      throw new Error("process died");
    });
    await expect(continueBackfill(first, w.io)).rejects.toThrow();
    w.stored = { ...w.stored!, leaseUntil: new Date(t0 + backfillLeaseMs).toISOString() };
    w.during(async () => {});
    w.tick(claimLeaseMs + 1);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "busy" });
    w.tick(backfillLeaseMs);
    expect((await continueBackfill(first, w.io)).kind).toBe("ran");
  });

  it("queues the next batch from a redelivery when the worker died after saving, and only once", async () => {
    const w = world({ pages: 3 });
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    // Saved, then the process died before the next batch was queued.
    w.failPublish(new Error("process died"));
    await expect(continueBackfill(first, w.io)).rejects.toThrow("process died");
    expect(w.stored).toMatchObject({ cursor: "1", step: 1, running: true, queued: false });
    expect(w.queued).toEqual([]);
    w.failPublish(undefined);
    // Pub/Sub delivers the batch again, since its push failed.
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "requeued" });
    expect(w.queued).toEqual([{ uid: "u1", run: "r1", step: 1 }]);
    expect(w.stored).toMatchObject({ step: 1, queued: true });
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "duplicate" });
    expect(w.queued).toHaveLength(1);
    // The reading goes on to the end, each batch read once.
    await w.drain();
    expect(w.stored).toMatchObject({ scanned: 900, done: true });
    expect(w.read).toHaveLength(3);
  });

  it("carries on when Continue is pressed after Stop while a failed batch waits to be read again", async () => {
    const w = world({ pages: 2 });
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    w.failBatch(new Error("Gmail down"));
    await expect(continueBackfill(first, w.io)).rejects.toThrow("Gmail down");
    w.failBatch(undefined);
    await stopBackfill(w.io);
    // Pub/Sub's next attempt comes while the batch waits: kept, not dropped.
    w.tick(60_000);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "busy" });
    expect((await startBackfill("u1", "r2", false, w.io)).kind).toBe("started");
    // The new reading's first batch also waits out the failed one's claims.
    const resumed = w.queued.shift()!;
    expect(await continueBackfill(resumed, w.io)).toEqual({ kind: "busy" });
    w.tick(claimLeaseMs);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "superseded" });
    expect((await continueBackfill(resumed, w.io)).kind).toBe("ran");
    await w.drain();
    expect(w.stored).toMatchObject({ run: "r2", done: true });
  });

  it("carries on when Continue is pressed after Stop while a dead worker's lease holds", async () => {
    const w = world({ pages: 2 });
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    // Claimed, then the process died: its push fails and Pub/Sub retries it.
    w.stored = { ...w.stored!, leaseUntil: new Date(t0 + backfillLeaseMs).toISOString() };
    await stopBackfill(w.io);
    w.tick(60_000);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "busy" });
    expect((await startBackfill("u1", "r2", false, w.io)).kind).toBe("joined");
    w.tick(backfillLeaseMs);
    expect((await continueBackfill(first, w.io)).kind).toBe("ran");
    await w.drain();
    expect(w.stored).toMatchObject({ run: "r1", done: true });
  });

  it("drops a dead worker's batch once its lease lapses if the reading was stopped", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    w.stored = { ...w.stored!, leaseUntil: new Date(t0 + backfillLeaseMs).toISOString() };
    await stopBackfill(w.io);
    w.tick(backfillLeaseMs + 1);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "stopped" });
    expect(w.read).toEqual([]);
  });

  it("queues no batch from a redelivery once the reading was stopped", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    w.failPublish(new Error("process died"));
    await expect(continueBackfill(first, w.io)).rejects.toThrow();
    w.failPublish(undefined);
    await stopBackfill(w.io);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "duplicate" });
    expect(w.queued).toEqual([]);
  });

  it("does nothing for a user no longer connected", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    w.disconnect();
    expect(await continueBackfill(w.queued.shift()!, w.io)).toEqual({ kind: "disconnected" });
    expect(w.read).toEqual([]);
  });
});

describe("parseContinuePush", () => {
  const envelope = (data: unknown) => ({
    message: { data: Buffer.from(JSON.stringify(data)).toString("base64"), messageId: "m-1" },
    deliveryAttempt: 2,
  });

  it("decodes the batch to read", () => {
    expect(parseContinuePush(envelope({ uid: "u1", run: "r1", step: 4 }))).toEqual({
      uid: "u1",
      run: "r1",
      step: 4,
      pubsubMessageId: "m-1",
      deliveryAttempt: 2,
    });
  });

  it("rejects anything else", () => {
    expect(() => parseContinuePush(envelope({ uid: "u1", run: "r1" }))).toThrow(BadPushEnvelope);
    expect(() => parseContinuePush(envelope({ emailAddress: "a@example.com", historyId: 1 }))).toThrow(BadPushEnvelope);
    expect(() => parseContinuePush({})).toThrow(BadPushEnvelope);
  });
});
