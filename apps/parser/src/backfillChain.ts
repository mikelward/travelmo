import type { BackfillProgress } from "@travelmo/core";
import { z } from "zod";
import type { BackfillBatch } from "./backfill";
import { claimLeaseMs } from "./importer";
import { errorFields } from "./log";
import { BadPushEnvelope, parsePush } from "./pubsub";

// Reading the whole mailbox on the server, batch after batch, whether or not
// the page that started it is still open. Starting queues the first batch
// on a Pub/Sub topic; each batch that ends with more to read, nothing failed
// and nobody pressing Stop queues the next. Pub/Sub may deliver a message
// twice, late, or after a newer start, so each carries the reading's id and
// the batch's step, and only the one the stored progress expects runs:
//
// - a start gives the reading a new id, so every message of an older one
//   finds it out of date;
// - a batch takes a lease while it reads, so a second copy of its message
//   waits rather than reading too, and a batch that failed or that Gmail
//   rate limited holds the next off for a while (`retryAfter`); a message
//   that must wait longer than its request should hands the reading on to
//   a fresh message (`wake`), which from then on is the only one of that
//   step that runs;
// - a batch that saves moves the step on, so copies of its message that
//   arrive afterwards find it out of date and are dropped, unless the next
//   batch was never queued (the worker died, or publishing failed): then a
//   copy queues it, and once it is queued the copies are dropped;
// - "Delete all trips" removes the progress and moves the generation on,
//   so the batch under way cannot save and no later message runs.

// Longer than a batch can run (Cloud Run's five-minute request limit), so a
// lease never lapses under a batch still reading; one whose process died
// frees itself after this. It also outlasts the claim the dead batch may
// hold on the email it was importing (`claimLeaseMs`): a batch read again
// earlier would skip that email as another import's, and pass it by.
export const backfillLeaseMs = claimLeaseMs + 60 * 1000;

// The longest a delivery waits inside its request for a lease or
// `retryAfter` to lapse before it hands the reading on to a fresh message
// (`deferred`). Pub/Sub gives a message ten attempts over about five
// minutes, far less than a failed batch waits, so a delivery that must wait
// never answers with an error, which would spend those attempts and end
// on the dead-letter topic with the reading lost. Short enough that the
// batch after it still fits in Cloud Run's five-minute request.
export const backfillWaitMs = 60 * 1000;

// Batches in a row that may fail (each tried again once `retryAfter`
// lapses) before the reading stops and Settings offers Continue; past that
// the cause (a revoked grant, say) is not passing.
export const maxFailedBatches = 3;

// `wake` marks a message queued to carry a waiting reading on (see
// `deferred`); the first message of each step has none.
export type ContinueMessage = { uid: string; run: string; step: number; wake?: string };

const continueSchema = z.object({
  uid: z.string().min(1),
  run: z.string().min(1),
  step: z.number().int().nonnegative(),
  wake: z.string().min(1).optional(),
});

export function parseContinuePush(body: unknown): ContinueMessage & { pubsubMessageId: string | undefined; deliveryAttempt: number | undefined } {
  const { data, pubsubMessageId, deliveryAttempt } = parsePush(body);
  const message = continueSchema.safeParse(data);
  if (!message.success) throw new BadPushEnvelope("Pub/Sub message is not a backfill batch");
  const { wake, ...rest } = message.data;
  return { ...rest, ...(wake ? { wake } : {}), pubsubMessageId, deliveryAttempt };
}

// A worker is reading a batch.
function leased(progress: BackfillProgress | undefined, now: string): boolean {
  return progress?.leaseUntil !== undefined && Date.parse(progress.leaseUntil) > Date.parse(now);
}

// A failed batch's email claims still hold, or Gmail's quota is used up.
function held(progress: BackfillProgress, now: string): boolean {
  return progress.retryAfter !== undefined && Date.parse(progress.retryAfter) > Date.parse(now);
}

// The place in the mailbox and the totals, without the reading's own fields.
function place(progress: BackfillProgress): BackfillProgress {
  const {
    run: _run,
    step: _step,
    running: _running,
    queued: _queued,
    leaseUntil: _lease,
    lastFailed: _failed,
    wake: _wake,
    handoff: _handoff,
    failures: _failures,
    ...rest
  } = progress;
  return rest;
}

export type StartDecision =
  | { kind: "started"; next: BackfillProgress }
  // A batch is reading right now: it carries on into the next instead.
  | { kind: "joined"; next: BackfillProgress }
  | { kind: "busy" };

export function decideStart(current: BackfillProgress | undefined, run: string, restart: boolean, now: string): StartDecision {
  if (current && leased(current, now)) {
    // Starting over would need the batch under way to stop first.
    if (restart) return { kind: "busy" };
    return { kind: "joined", next: { ...current, running: true } };
  }
  const fresh = restart || !current || current.done;
  const from: BackfillProgress = fresh || !current ? { scanned: 0, imported: 0, failed: 0, done: false, updatedAt: now } : place(current);
  // A failed batch's claims, or Gmail's rate limit, hold whichever reading
  // comes next.
  if (current?.retryAfter) from.retryAfter = current.retryAfter;
  return { kind: "started", next: { ...from, run, step: 0, running: true, queued: false, updatedAt: now } };
}

export type ClaimDecision =
  | { kind: "claimed"; next: BackfillProgress }
  // This batch was read and saved, but the next was never queued.
  | { kind: "requeue" }
  // The message this one handed the step on to may never have been queued.
  | { kind: "rehand"; wake: string }
  | { kind: "stale"; reason: "superseded" | "duplicate" | "stopped" | "done" }
  // Its batch must wait until `until`: a lease, or `retryAfter`.
  | { kind: "busy"; until: string };

export function decideClaim(current: BackfillProgress | undefined, message: ContinueMessage, now: string): ClaimDecision {
  if (!current || current.run !== message.run) return { kind: "stale", reason: "superseded" };
  if (current.step === message.step + 1 && current.queued === false && current.running && !current.done && !leased(current, now)) {
    return { kind: "requeue" };
  }
  if (current.step !== message.step) return { kind: "stale", reason: "duplicate" };
  if (current.done) return { kind: "stale", reason: "done" };
  // Another message was queued to carry this step on while it waits: this
  // one queues it again if that may not have happened (its worker died).
  if (current.wake !== message.wake) {
    if (current.wake && current.handoff && current.handoff.from === message.wake) return { kind: "rehand", wake: current.wake };
    return { kind: "stale", reason: "duplicate" };
  }
  // Kept, not dropped, while a batch reads, even if stopped meanwhile: a
  // Continue before then joins the reading this message carries on.
  if (current.leaseUntil && leased(current, now)) return { kind: "busy", until: current.leaseUntil };
  if (!current.running) return { kind: "stale", reason: "stopped" };
  if (current.retryAfter && held(current, now)) return { kind: "busy", until: current.retryAfter };
  // Running, the message was queued: no need to queue it again.
  const { retryAfter: _retry, handoff: _handoff, ...rest } = current;
  return { kind: "claimed", next: { ...rest, leaseUntil: new Date(Date.parse(now) + backfillLeaseMs).toISOString() } };
}

// Makes the message `wake` (about to be published) the one that carries
// the step on, if `message` was it until now, so only one message ever
// carries a reading; `message` may queue it until that is known done.
export function decideDefer(current: BackfillProgress | undefined, message: ContinueMessage, wake: string): BackfillProgress | undefined {
  if (!current || current.run !== message.run || current.step !== message.step || current.done) return undefined;
  if (current.wake !== message.wake) return undefined;
  return { ...current, wake, handoff: message.wake ? { from: message.wake } : {} };
}

// Records that the message for `wake` is on the topic.
export function decideHandedOn(current: BackfillProgress | undefined, message: ContinueMessage, wake: string): BackfillProgress | undefined {
  if (!current?.handoff || current.run !== message.run || current.step !== message.step || current.wake !== wake) return undefined;
  const { handoff: _handoff, ...rest } = current;
  return rest;
}

// What a batch saves: its place, the next step, and whether to go on, which
// Stop (pressed while it read) or a failed import turns off. A batch Gmail
// rate limited goes on, its place saved and the next held off a minute
// (`retryAfter` in its progress).
export function decideFinish(current: BackfillProgress | undefined, message: ContinueMessage, batch: BackfillBatch): BackfillProgress | undefined {
  if (!current || current.run !== message.run || current.step !== message.step) return undefined;
  const failed = batch.counts.failed;
  return {
    ...batch.progress,
    run: message.run,
    step: message.step + 1,
    running: current.running === true && !batch.progress.done && failed === 0,
    queued: false,
    ...(failed > 0 ? { lastFailed: failed } : {}),
  };
}

// After a batch failed, gives up its lease (no worker reads it now) but
// holds off any batch until the claim it may have left on the email it was
// importing lapses (`claimLeaseMs`): read sooner, that email would be
// skipped as another import's. Pub/Sub's next attempt waits for that, then
// reads it. After `maxFailedBatches` in a row, the reading stops instead.
export function decideRelease(current: BackfillProgress | undefined, message: ContinueMessage, now: string): BackfillProgress | undefined {
  if (!current || current.run !== message.run || current.step !== message.step) return undefined;
  const { leaseUntil: _lease, ...rest } = current;
  const failures = (current.failures ?? 0) + 1;
  return {
    ...rest,
    failures,
    running: current.running === true && failures < maxFailedBatches,
    retryAfter: new Date(Date.parse(now) + claimLeaseMs + 1000).toISOString(),
  };
}

// Records that the message for `message.step` is on the topic.
export function decideQueued(current: BackfillProgress | undefined, message: ContinueMessage): BackfillProgress | undefined {
  if (!current || current.run !== message.run || current.step !== message.step || current.queued !== false) return undefined;
  return { ...current, queued: true };
}

// Ends a reading that cannot go on: the batch under way, if any, saves its
// place, and nothing more is queued.
export function decideStop(current: BackfillProgress | undefined, message?: ContinueMessage): BackfillProgress | undefined {
  if (!current?.running) return undefined;
  if (message && (current.run !== message.run || current.step !== message.step)) return undefined;
  return { ...current, running: false };
}

export type ChainIo<S> = {
  // Changes the stored progress in one transaction, which also reads the
  // trips' reset generation; undefined when Gmail is not connected.
  change: <R>(
    fn: (current: BackfillProgress | undefined, generation: number) => { next?: BackfillProgress | undefined; result: R },
  ) => Promise<{ state: S; generation: number; result: R } | undefined>;
  runBatch: (state: S, from: BackfillProgress, generation: number) => Promise<BackfillBatch>;
  publish: (message: ContinueMessage) => Promise<void>;
  now: () => string;
  log: (severity: "INFO" | "WARNING" | "ERROR", event: string, fields: Record<string, unknown>) => void;
  sleep: (ms: number) => Promise<void>;
  // A fresh id for a message that carries a waiting reading on.
  newWake: () => string;
};

// Queues a batch and records that it is queued. A failure to record it is
// only logged: a redelivered copy of the batch before then queues it again,
// and the copy that arrives is dropped by its step.
async function queue<S>(message: ContinueMessage, io: ChainIo<S>): Promise<void> {
  await io.publish(message);
  try {
    await io.change((current) => ({ next: decideQueued(current, message), result: undefined }));
  } catch (error) {
    io.log("WARNING", "backfill_queued_not_saved", { uid: message.uid, run: message.run, step: message.step, ...errorFields(error) });
  }
}

// Stops a reading whose first batch could not be queued, which nothing
// else would run, so Settings offers to continue it.
async function stopAfterPublishFailed<S>(message: ContinueMessage, error: unknown, io: ChainIo<S>): Promise<never> {
  io.log("ERROR", "backfill_queue_failed", { uid: message.uid, run: message.run, step: message.step, ...errorFields(error) });
  try {
    await io.change((current) => ({ next: decideStop(current, message), result: undefined }));
  } catch (stopError) {
    io.log("ERROR", "backfill_stop_failed", { uid: message.uid, run: message.run, ...errorFields(stopError) });
  }
  throw error;
}

// Hands a reading whose batch must still wait on to a fresh message, with a
// fresh count of Pub/Sub's attempts, and acknowledges this one. The fresh
// one is made the step's carrier first, so it runs however soon Pub/Sub
// delivers it, and only then queued (`handOn`). If another copy became the
// carrier meanwhile, nothing is queued and this one is dropped.
async function defer<S>(message: ContinueMessage, until: string, io: ChainIo<S>): Promise<ContinueResult> {
  const wake = io.newWake();
  const changed = await io.change((current) => {
    const next = decideDefer(current, message, wake);
    return { next, result: next !== undefined };
  });
  if (!changed) return { kind: "disconnected" };
  if (!changed.result) return { kind: "stale", reason: "duplicate" };
  await handOn(message, wake, io);
  return { kind: "deferred", until };
}

// Queues the message for `wake`, then records that it is queued. Until
// then, `message` may queue it again: if publishing fails or the worker
// dies first, Pub/Sub delivers `message` again, which does just that. A
// second copy of the fresh message, at worst, waits and is then dropped.
async function handOn<S>(message: ContinueMessage, wake: string, io: ChainIo<S>): Promise<void> {
  await io.publish({ uid: message.uid, run: message.run, step: message.step, wake });
  try {
    await io.change((current) => ({ next: decideHandedOn(current, message, wake), result: undefined }));
  } catch (error) {
    io.log("WARNING", "backfill_handoff_not_saved", { uid: message.uid, run: message.run, step: message.step, ...errorFields(error) });
  }
}

export type StartResult = { kind: "disconnected" } | { kind: "busy" } | { kind: "started" | "joined"; progress: BackfillProgress };

export async function startBackfill<S>(uid: string, run: string, restart: boolean, io: ChainIo<S>): Promise<StartResult> {
  const now = io.now();
  const changed = await io.change((current) => {
    const decision = decideStart(current, run, restart, now);
    return { next: decision.kind === "busy" ? undefined : decision.next, result: decision };
  });
  if (!changed) return { kind: "disconnected" };
  const decision = changed.result;
  if (decision.kind !== "started") return decision.kind === "busy" ? { kind: "busy" } : { kind: "joined", progress: decision.next };
  const first = { uid, run, step: 0 };
  try {
    await queue(first, io);
  } catch (error) {
    return stopAfterPublishFailed(first, error, io);
  }
  return { kind: "started", progress: decision.next };
}

export type ContinueResult =
  | { kind: "disconnected" }
  | { kind: "stale"; reason: string }
  // Already read; its next batch is queued now.
  | { kind: "requeued" }
  // Its batch must wait longer than a request should: a fresh message,
  // queued now, carries the reading on.
  | { kind: "deferred"; until: string }
  // Read, but a newer start or a reset came in meanwhile, so not saved.
  | { kind: "superseded"; batch: BackfillBatch }
  | { kind: "ran"; batch: BackfillBatch; progress: BackfillProgress };

// Every outcome but an error acknowledges the message. One that must wait
// (a lease, `retryAfter`) waits here up to `backfillWaitMs`, then, if still
// held, hands the reading on to a fresh message rather than failing:
// Pub/Sub's attempts run out long before a failed batch's wait does.
export async function continueBackfill<S>(message: ContinueMessage, io: ChainIo<S>): Promise<ContinueResult> {
  const waitEnd = Date.parse(io.now()) + backfillWaitMs;
  const following: ContinueMessage = { uid: message.uid, run: message.run, step: message.step + 1 };
  let claim: { state: S; generation: number; next: BackfillProgress };
  for (;;) {
    const now = io.now();
    const changed = await io.change((current) => {
      const decision = decideClaim(current, message, now);
      return { next: decision.kind === "claimed" ? decision.next : undefined, result: decision };
    });
    if (!changed) return { kind: "disconnected" };
    const decision = changed.result;
    if (decision.kind === "claimed") {
      claim = { state: changed.state, generation: changed.generation, next: decision.next };
      break;
    }
    if (decision.kind === "stale") return decision;
    if (decision.kind === "rehand") {
      await handOn(message, decision.wake, io);
      return { kind: "requeued" };
    }
    if (decision.kind === "requeue") {
      await queue(following, io);
      return { kind: "requeued" };
    }
    const left = waitEnd - Date.parse(now);
    if (left <= 0) return defer(message, decision.until, io);
    await io.sleep(Math.min(left, Date.parse(decision.until) - Date.parse(now)));
  }
  let batch: BackfillBatch;
  try {
    batch = await io.runBatch(claim.state, claim.next, claim.generation);
  } catch (error) {
    try {
      const released = await io.change((current) => {
        const next = decideRelease(current, message, io.now());
        return { next, result: next };
      });
      if (released?.result?.running === false) {
        io.log("WARNING", "backfill_stopped_after_failures", { uid: message.uid, run: message.run, failures: released.result.failures });
      }
    } catch (releaseError) {
      // The lease lapses on its own; Pub/Sub's retries wait for it.
      io.log("ERROR", "backfill_release_failed", { uid: message.uid, run: message.run, ...errorFields(releaseError) });
    }
    throw error;
  }
  const saved = await io.change((current, generation) => {
    if (generation !== claim.generation) return { result: undefined };
    const next = decideFinish(current, message, batch);
    return { next, result: next };
  });
  const progress = saved?.result;
  if (!progress) return { kind: "superseded", batch };
  // A failure here fails the push, and Pub/Sub's next attempt queues it.
  if (progress.running) await queue(following, io);
  return { kind: "ran", batch, progress };
}

export async function stopBackfill<S>(io: ChainIo<S>): Promise<boolean> {
  const changed = await io.change((current) => {
    const next = decideStop(current);
    return { next, result: next !== undefined };
  });
  return changed?.result ?? false;
}
