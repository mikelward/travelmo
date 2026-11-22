import { backfillRequest, runBackfillBatch, type BackfillIo } from "./backfill";
import { searchMessagePage, type Gmail, type MessagePage } from "./gmail";
import { emptyCounts } from "./importer";

// A mailbox of pages: "p0" → ids a,b and next "p1"; "p1" → c and done.
function mailbox(pages: Record<string, MessagePage>, opts: { stale?: Set<string> } = {}) {
  const seen: (string | undefined)[] = [];
  const io: BackfillIo = {
    page: async (token) => {
      seen.push(token);
      if (token && opts.stale?.has(token)) throw Object.assign(new Error("Invalid pageToken"), { code: 400 });
      return pages[token ?? "start"]!;
    },
    importIds: async (ids) => ({ ...emptyCounts(), imported: ids.length }),
    isStaleCursor: (e) => (e as { code?: number }).code === 400,
    now: () => "2030-01-01T00:00:00Z",
    log: () => {},
  };
  return { io, seen };
}

const pages = {
  start: { ids: ["a", "b"], nextPageToken: "p1" },
  p1: { ids: ["c"] },
};

describe("runBackfillBatch", () => {
  it("reads the mailbox batch by batch, carrying on from the cursor, until it is done", async () => {
    const { io, seen } = mailbox(pages);
    const first = await runBackfillBatch(undefined, false, io);
    expect(first.progress).toEqual({ cursor: "p1", scanned: 2, imported: 2, failed: 0, done: false, updatedAt: "2030-01-01T00:00:00Z" });
    const second = await runBackfillBatch(first.progress, false, io);
    expect(second.progress).toMatchObject({ scanned: 3, imported: 3, done: true });
    expect(second.progress.cursor).toBeUndefined();
    expect(seen).toEqual([undefined, "p1"]);
  });

  it("starts over when asked, or when the last reading had finished", async () => {
    const { io, seen } = mailbox(pages);
    const done = { scanned: 3, imported: 3, done: true, updatedAt: "2030-01-01T00:00:00Z" };
    expect((await runBackfillBatch(done, false, io)).progress.scanned).toBe(2);
    const midway = { cursor: "p1", scanned: 2, imported: 2, done: false, updatedAt: "2030-01-01T00:00:00Z" };
    expect((await runBackfillBatch(midway, true, io)).progress.scanned).toBe(2);
    expect(seen).toEqual([undefined, undefined]);
  });

  it("starts over when Gmail no longer accepts the cursor, and only then", async () => {
    const { io, seen } = mailbox(pages, { stale: new Set(["p1"]) });
    const midway = { cursor: "p1", scanned: 2, imported: 2, done: false, updatedAt: "2030-01-01T00:00:00Z" };
    const batch = await runBackfillBatch(midway, false, io);
    expect(seen).toEqual(["p1", undefined]);
    expect(batch.progress).toMatchObject({ cursor: "p1", scanned: 2, done: false });
    const failing = { ...io, page: async () => Promise.reject(Object.assign(new Error("Backend Error"), { code: 503 })) };
    await expect(runBackfillBatch(midway, false, failing)).rejects.toThrow("Backend Error");
  });
});

describe("runBackfillBatch failures", () => {
  it("counts failed imports across batches, and starts the count over with the reading", async () => {
    const { io } = mailbox(pages);
    const failing: BackfillIo = { ...io, importIds: async (ids) => {
      const failed = ids.filter((id) => id === "b" || id === "c").length;
      return { ...emptyCounts(), imported: ids.length - failed, failed };
    } };
    const first = await runBackfillBatch(undefined, false, failing);
    expect(first.progress).toMatchObject({ imported: 1, failed: 1 });
    const second = await runBackfillBatch(first.progress, false, failing);
    expect(second.progress).toMatchObject({ imported: 1, failed: 2, done: true });
    expect((await runBackfillBatch(second.progress, false, io)).progress).toMatchObject({ imported: 2, failed: 0 });
  });
});

describe("searchMessagePage", () => {
  // Gmail answers 100 at most per call.
  const fakeGmail = (total: number) => {
    const calls: (string | undefined)[] = [];
    const gmail = {
      users: {
        messages: {
          list: async ({ pageToken, maxResults }: { pageToken?: string; maxResults: number }) => {
            calls.push(pageToken);
            const from = pageToken ? Number(pageToken) : 0;
            const n = Math.min(maxResults, 100, total - from);
            const next = from + n < total ? String(from + n) : undefined;
            return { data: { messages: Array.from({ length: n }, (_, i) => ({ id: `m${from + i}` })), nextPageToken: next } };
          },
        },
      },
    } as unknown as Gmail;
    return { gmail, calls };
  };

  it("collects up to the batch size across Gmail's pages and says where to carry on", async () => {
    const { gmail, calls } = fakeGmail(450);
    const first = await searchMessagePage(gmail, "q", 300);
    expect(first.ids).toHaveLength(300);
    expect(first.nextPageToken).toBe("300");
    const rest = await searchMessagePage(gmail, "q", 300, first.nextPageToken);
    expect(rest.ids).toHaveLength(150);
    expect(rest.nextPageToken).toBeUndefined();
    expect(calls).toEqual([undefined, "100", "200", "300", "400"]);
  });

  it("stops early when time runs short and carries on from the same page next time", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
    const imported = new Set<string>();
    let left = 20; // time for 20 messages
    const io: BackfillIo = {
      page: async (token) => (token ? { ids: ["late"] } : { ids, nextPageToken: "p1" }),
      importIds: async (batch) => {
        const fresh = batch.filter((id) => !imported.has(id));
        fresh.forEach((id) => imported.add(id));
        left -= 1;
        return { ...emptyCounts(), imported: fresh.length, skipped: batch.length - fresh.length };
      },
      timeLeftMs: () => left,
      isStaleCursor: () => false,
      now: () => "2030-01-01T00:00:00Z",
      log: () => {},
    };
    const first = await runBackfillBatch(undefined, false, io);
    expect(first.counts.imported).toBe(20);
    expect(first.progress).toMatchObject({ scanned: 0, imported: 20, after: "m19", done: false });
    expect(first.progress.cursor).toBeUndefined();

    left = 100;
    const second = await runBackfillBatch(first.progress, false, io);
    expect(second.counts).toMatchObject({ imported: 5, skipped: 0 });
    expect(second.progress).toMatchObject({ cursor: "p1", scanned: 25, imported: 25, done: false });
    expect(second.progress.after).toBeUndefined();
    expect(imported.size).toBe(25);
  });

  it("gets past slow failing messages instead of retrying them every batch", async () => {
    const ids = ["bad1", "bad2", "good1", "good2"];
    const attempts: string[] = [];
    let left = 0;
    const io: BackfillIo = {
      page: async () => ({ ids }),
      importIds: async (batch) => {
        attempts.push(...batch);
        left -= 1;
        const failed = batch.filter((id) => id.startsWith("bad")).length;
        return { ...emptyCounts(), imported: batch.length - failed, failed };
      },
      timeLeftMs: () => left,
      isStaleCursor: () => false,
      now: () => "2030-01-01T00:00:00Z",
      log: () => {},
    };
    // Each failing message uses up the whole budget.
    let progress = (await runBackfillBatch(undefined, false, io)).progress;
    progress = (await runBackfillBatch(progress, false, io)).progress;
    left = 100;
    progress = (await runBackfillBatch(progress, false, io)).progress;
    expect(attempts).toEqual(["bad1", "bad2", "good1", "good2"]);
    expect(progress).toMatchObject({ imported: 2, failed: 2, scanned: 4, done: true });
  });

  it("carries on after the last message read even when earlier ones leave the search", async () => {
    let ids = ["a", "b", "c", "d"];
    const attempts: string[] = [];
    let left = 2;
    const io: BackfillIo = {
      page: async () => ({ ids }),
      importIds: async (batch) => {
        attempts.push(...batch);
        left -= 1;
        return { ...emptyCounts(), imported: batch.length };
      },
      timeLeftMs: () => left,
      isStaleCursor: () => false,
      now: () => "2030-01-01T00:00:00Z",
      log: () => {},
    };
    const first = await runBackfillBatch(undefined, false, io);
    expect(first.progress).toMatchObject({ after: "b", done: false });
    ids = ["b", "c", "d"]; // "a" was deleted
    left = 100;
    const second = await runBackfillBatch(first.progress, false, io);
    expect(attempts).toEqual(["a", "b", "c", "d"]);
    expect(second.progress.done).toBe(true);
  });
});

describe("backfillRequest", () => {
  const io = (): BackfillIo => ({
    page: async () => ({ ids: ["m1"], nextPageToken: "next" }),
    importIds: async (ids) => ({ ...emptyCounts(), imported: ids.length }),
    isStaleCursor: () => false,
    now: () => "2026-11-22T12:00:00Z",
    log: () => {},
  });

  it("saves under the generation read before the connection, so a reset between them refuses the save", async () => {
    // A reset ("Delete all trips") lands while the connection, with its
    // place from before the reset, is being read.
    let generation = 0;
    const before = { backfill: { cursor: "old-place", scanned: 300, imported: 4, done: false, updatedAt: "2026-11-22T11:00:00Z" } };
    const result = await backfillRequest(false, {
      resetGeneration: async () => generation,
      loadState: async () => {
        generation += 1;
        return before;
      },
      io,
      // As updateBackfill does: only while the generation is unchanged.
      save: async (_state, _progress, read) => read === generation,
    });
    expect(result?.saved).toBe(false);
  });

  it("saves when nothing was reset", async () => {
    const result = await backfillRequest(false, {
      resetGeneration: async () => 3,
      loadState: async () => ({}),
      io,
      save: async (_state, progress, read) => read === 3 && progress.cursor === "next",
    });
    expect(result?.saved).toBe(true);
  });

  it("does nothing without a connection", async () => {
    const save = vi.fn(async () => true);
    expect(await backfillRequest(false, { resetGeneration: async () => 0, loadState: async () => undefined, io, save })).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });
});
