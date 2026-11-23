import type { BackfillProgress } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import type { BackfillBatch } from "./backfill";
import {
  backfillLeaseMs,
  continueBackfill,
  maxFailedBatches,
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
// Waiting (`sleep`) moves the clock on.
function world(options: { pages?: number; failOn?: Set<number>; rateLimitOn?: Set<number> } = {}) {
  const pages = options.pages ?? 3;
  let stored: BackfillProgress | undefined;
  let connected = true;
  let generation = 0;
  let clock = t0;
  let wakes = 0;
  const queued: ContinueMessage[] = [];
  const logged: string[] = [];
  const read: { from: BackfillProgress; generation: number; at: number }[] = [];
  let duringBatch: () => Promise<void> = async () => {};
  let throwOnBatch: Error | undefined;
  let throwOnPublish: Error | undefined;
  let deliverAtOnce = false;
  const deliveredAtOnce: unknown[] = [];
  const io: ChainIo<{ uid: string }> = {
    change: async (fn) => {
      if (!connected) return undefined;
      const { next, result } = fn(stored, generation);
      if (next) stored = next;
      return { state: { uid: "u1" }, generation, result };
    },
    runBatch: async (_state, from, at): Promise<BackfillBatch> => {
      read.push({ from, generation: at, at: clock });
      await duringBatch();
      if (throwOnBatch) throw throwOnBatch;
      // Gmail's quota ran out for the whole batch, once on this page.
      const here = from.cursor ? Number(from.cursor) : 0;
      if (options.rateLimitOn?.delete(here + 1)) {
        const { run: _r, step: _s, running: _g, queued: _q, leaseUntil: _l, wake: _w, ...place } = from;
        return {
          counts: emptyCounts(),
          candidates: 300,
          rateLimited: true,
          progress: { ...place, updatedAt: new Date(clock).toISOString(), retryAfter: new Date(clock + 60_000).toISOString() },
        };
      }
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
      // Pub/Sub may deliver it before publish returns.
      if (deliverAtOnce) {
        deliveredAtOnce.push(await continueBackfill(message, io));
        return;
      }
      queued.push(message);
    },
    now: () => new Date(clock).toISOString(),
    log: (_severity, event) => logged.push(event),
    sleep: async (ms) => {
      clock += ms;
    },
    newWake: () => `w${++wakes}`,
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
    get clock() {
      return clock;
    },
    during: (fn: () => Promise<void>) => (duringBatch = fn),
    failBatch: (error: Error | undefined) => (throwOnBatch = error),
    failPublish: (error: Error | undefined) => (throwOnPublish = error),
    deliverAtOnce: (on: boolean) => (deliverAtOnce = on),
    deliveredAtOnce,
  };
}

// The gaps between Pub/Sub's attempts to deliver a message the parser
// failed, as seen in production (minimum backoff 10 s, maximum 600 s): ten
// attempts within about five minutes.
const attemptGapsMs = [12, 14, 16, 26, 26, 31, 40, 53, 73].map((s) => s * 1000);
const maxDeliveryAttempts = 10;

// Delivers what is queued as Pub/Sub's push subscription does: an error
// answer makes it deliver the message again after the next gap, and the
// tenth failed attempt sends it to the dead-letter topic instead.
async function pubsub(w: ReturnType<typeof world>) {
  type Pending = { message: ContinueMessage; attempts: number; at: number };
  const pending: Pending[] = [];
  const take = () => pending.push(...w.queued.splice(0).map((message) => ({ message, attempts: 0, at: w.clock })));
  const deadLettered: ContinueMessage[] = [];
  const failures: string[] = [];
  take();
  for (let deliveries = 0; pending.length; deliveries++) {
    if (deliveries > 500) throw new Error("the reading never settles");
    pending.sort((a, b) => a.at - b.at);
    const next = pending.shift()!;
    if (next.at > w.clock) w.tick(next.at - w.clock);
    next.attempts += 1;
    let failed = false;
    try {
      await continueBackfill(next.message, w.io);
    } catch (error) {
      failed = true;
      failures.push((error as Error).message);
    }
    take();
    if (!failed) continue;
    if (next.attempts >= maxDeliveryAttempts) deadLettered.push(next.message);
    else pending.push({ ...next, at: w.clock + attemptGapsMs[next.attempts - 1]! });
  }
  return { deadLettered, failures };
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
    // It waited a minute, then handed on to a fresh message, which finds
    // the batch read by then.
    expect(copy).toMatchObject({ kind: "deferred" });
    expect(w.queued.map((m) => m.wake)).toEqual(["w1", undefined]);
    expect(await continueBackfill(w.queued.shift()!, w.io)).toEqual({ kind: "stale", reason: "duplicate" });
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
    expect(w.stored).toMatchObject({ step: 0, running: true, failures: 1 });
    w.failBatch(undefined);
    // Sooner, the importer would skip that email as another import's, and
    // the batch would pass it by. Pub/Sub's next attempt waits for it.
    w.tick(claimLeaseMs - 30_000);
    expect((await continueBackfill(first, w.io)).kind).toBe("ran");
    expect(w.read[1]!.at).toBeGreaterThan(t0 + claimLeaseMs);
    expect(w.read).toHaveLength(2);
    expect(w.stored?.failures).toBeUndefined();
  });

  it("hands a batch that must wait longer than a request on to one fresh message, which alone carries the reading", async () => {
    const w = world({ pages: 2 });
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    w.failBatch(new Error("Gmail down"));
    await expect(continueBackfill(first, w.io)).rejects.toThrow("Gmail down");
    w.failBatch(undefined);
    // Two copies of the failed batch's message come back while it waits.
    expect(await continueBackfill(first, w.io)).toMatchObject({ kind: "deferred" });
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "duplicate" });
    expect(w.queued.map((m) => m.wake)).toEqual(["w1"]);
    await w.drain();
    expect(w.stored).toMatchObject({ done: true, scanned: 600 });
    expect(w.read).toHaveLength(3);
    expect(w.read[1]!.at).toBeGreaterThan(t0 + claimLeaseMs);
  });

  it("runs a fresh message that Pub/Sub delivers before handing on finishes", async () => {
    const w = world({ pages: 1 });
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    w.failBatch(new Error("Gmail down"));
    await expect(continueBackfill(first, w.io)).rejects.toThrow("Gmail down");
    w.failBatch(undefined);
    w.tick(claimLeaseMs - 90_000);
    w.deliverAtOnce(true);
    expect(await continueBackfill(first, w.io)).toMatchObject({ kind: "deferred" });
    // Delivered inside publish, it waited out the rest and read the batch.
    expect(w.deliveredAtOnce).toEqual([expect.objectContaining({ kind: "ran" })]);
    expect(w.stored).toMatchObject({ done: true });
  });

  it("queues the fresh message again from the old one when the worker died before queueing it", async () => {
    const w = world({ pages: 1 });
    await startBackfill("u1", "r1", false, w.io);
    const first = w.queued.shift()!;
    w.failBatch(new Error("Gmail down"));
    await expect(continueBackfill(first, w.io)).rejects.toThrow("Gmail down");
    w.failBatch(undefined);
    // The fresh message is stored as the carrier, then the process dies
    // before publishing it.
    w.failPublish(new Error("process died"));
    await expect(continueBackfill(first, w.io)).rejects.toThrow("process died");
    expect(w.stored).toMatchObject({ wake: "w1", handoff: {} });
    w.failPublish(undefined);
    // Pub/Sub delivers the old one again: it queues the fresh one.
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "requeued" });
    expect(w.queued).toEqual([{ uid: "u1", run: "r1", step: 0, wake: "w1" }]);
    expect(w.stored?.handoff).toBeUndefined();
    // Once that is queued, the old one is a duplicate.
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "duplicate" });
    await w.drain();
    expect(w.stored).toMatchObject({ done: true });
    expect(w.read).toHaveLength(2);
  });

  it("survives the worker dying between storing and queueing a fresh message, against Pub/Sub's attempts", async () => {
    const w = world({ pages: 2 });
    let failOnce = true;
    w.during(async () => {
      if (!failOnce) return;
      failOnce = false;
      throw new Error("Gmail down");
    });
    // The first fresh message's publish dies with its process.
    let dieOnce = true;
    const publish = w.io.publish;
    w.io.publish = async (message) => {
      if (message.wake && dieOnce) {
        dieOnce = false;
        throw new Error("process died");
      }
      return publish(message);
    };
    await startBackfill("u1", "r1", false, w.io);
    const { deadLettered } = await pubsub(w);
    expect(deadLettered).toEqual([]);
    expect(w.stored).toMatchObject({ done: true, scanned: 600 });
  });

  it("stops after failing several batches in a row, so Settings offers Continue", async () => {
    const w = world();
    await startBackfill("u1", "r1", false, w.io);
    w.failBatch(new Error("invalid_grant"));
    const { deadLettered } = await pubsub(w);
    expect(w.read).toHaveLength(maxFailedBatches);
    expect(w.stored).toMatchObject({ running: false, failures: maxFailedBatches });
    expect(w.logged).toContain("backfill_stopped_after_failures");
    expect(deadLettered).toEqual([]);
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
    w.tick(claimLeaseMs - 60_000);
    expect(await continueBackfill(first, w.io)).toMatchObject({ kind: "deferred" });
    expect((await continueBackfill(w.queued.shift()!, w.io)).kind).toBe("ran");
    expect(w.read[1]!.at).toBeGreaterThanOrEqual(t0 + backfillLeaseMs);
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
    // Pub/Sub's next attempt comes while the batch waits: nothing reads
    // it now, so it is dropped.
    w.tick(10_000);
    expect(await continueBackfill(first, w.io)).toEqual({ kind: "stale", reason: "stopped" });
    expect((await startBackfill("u1", "r2", false, w.io)).kind).toBe("started");
    // The new reading's first batch waits out the failed one's claims.
    await w.drain();
    expect(w.read[1]!.at).toBeGreaterThan(t0 + claimLeaseMs);
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
    // Kept while the lease holds, handed on to a fresh message.
    expect(await continueBackfill(first, w.io)).toMatchObject({ kind: "deferred" });
    expect((await startBackfill("u1", "r2", false, w.io)).kind).toBe("joined");
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

describe("continueBackfill against Pub/Sub's attempts", () => {
  it("survives a failed batch whose fifteen-minute wait outlasts all ten attempts, and reads on", async () => {
    const w = world({ pages: 3 });
    let failOnce = true;
    w.during(async () => {
      if (!failOnce) return;
      failOnce = false;
      throw new Error("Quota exceeded for quota metric 'Total Query Cost'");
    });
    // All ten attempts fall inside the wait, so answering each with an
    // error, as the parser once did, dead-letters the reading.
    expect(attemptGapsMs.reduce((a, b) => a + b, 0)).toBeLessThan(claimLeaseMs);
    await startBackfill("u1", "r1", false, w.io);
    const { deadLettered, failures } = await pubsub(w);
    expect(failures).toHaveLength(1);
    expect(deadLettered).toEqual([]);
    expect(w.stored).toMatchObject({ run: "r1", done: true, scanned: 900, running: false });
    // Read again only once the failed batch's claims lapsed.
    expect(w.read[1]!.at).toBeGreaterThan(t0 + claimLeaseMs);
    expect(w.read).toHaveLength(4);
  });

  it("goes on through Gmail's rate limit, never as a failure, resuming a minute later", async () => {
    const w = world({ pages: 3, rateLimitOn: new Set([1, 2]) });
    await startBackfill("u1", "r1", false, w.io);
    const { deadLettered, failures } = await pubsub(w);
    expect(failures).toEqual([]);
    expect(deadLettered).toEqual([]);
    expect(w.stored).toMatchObject({ done: true, scanned: 900, failed: 0 });
    expect(w.stored?.lastFailed).toBeUndefined();
    // Each limited batch was read again from the same place, a minute on.
    expect(w.read.map((r) => r.from.cursor)).toEqual([undefined, undefined, "1", "1", "2"]);
    expect(w.read[1]!.at - w.read[0]!.at).toBeGreaterThanOrEqual(60_000);
  });

  it("keeps a rate-limited reading running and queues its next batch with retryAfter", async () => {
    const w = world({ pages: 2, rateLimitOn: new Set([1]) });
    await startBackfill("u1", "r1", false, w.io);
    const result = await continueBackfill(w.queued.shift()!, w.io);
    expect(result).toMatchObject({ kind: "ran", batch: { rateLimited: true } });
    expect(w.stored).toMatchObject({ running: true, step: 1, queued: true, retryAfter: new Date(t0 + 60_000).toISOString() });
    expect(w.queued).toEqual([{ uid: "u1", run: "r1", step: 1 }]);
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
    expect(parseContinuePush(envelope({ uid: "u1", run: "r1", step: 4, wake: "w1" }))).toMatchObject({ step: 4, wake: "w1" });
  });

  it("rejects anything else", () => {
    expect(() => parseContinuePush(envelope({ uid: "u1", run: "r1" }))).toThrow(BadPushEnvelope);
    expect(() => parseContinuePush(envelope({ emailAddress: "a@example.com", historyId: 1 }))).toThrow(BadPushEnvelope);
    expect(() => parseContinuePush({})).toThrow(BadPushEnvelope);
  });
});
