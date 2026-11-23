import { backfillBatch, backfillQuery, rateLimitPauseMs, runBackfillBatch, type BackfillIo } from "./backfill";
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

describe("runBackfillBatch under Gmail's rate limit", () => {
  // Gmail's answer once a user's per-minute quota is spent.
  const quota = () =>
    Object.assign(new Error("Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'"), {
      status: 429,
    });
  // A clock that waiting moves on, and a budget of `budgetMs` from now.
  const timed = (budgetMs: number) => {
    let clock = 0;
    const waits: number[] = [];
    return {
      waits,
      timeLeftMs: () => budgetMs - clock,
      sleep: async (ms: number) => {
        waits.push(ms);
        clock += ms;
      },
    };
  };

  it("waits out a rate limit with growing waits and carries on", async () => {
    const { io } = mailbox(pages);
    const t = timed(180_000);
    let refusals = 2;
    const batch = await runBackfillBatch(undefined, false, {
      ...io,
      ...t,
      importIds: async (ids) => {
        if (ids[0] === "b" && refusals-- > 0) throw quota();
        return { ...emptyCounts(), imported: ids.length };
      },
    });
    expect(t.waits).toEqual([2000, 4000]);
    expect(batch.rateLimited).toBeUndefined();
    expect(batch.progress).toMatchObject({ cursor: "p1", scanned: 2, imported: 2, failed: 0 });
    expect(batch.progress.retryAfter).toBeUndefined();
  });

  it("waits as long as Gmail asks", async () => {
    const { io } = mailbox(pages);
    const t = timed(180_000);
    let refused = false;
    await runBackfillBatch(undefined, false, {
      ...io,
      ...t,
      page: async (token) => {
        if (!refused) {
          refused = true;
          throw Object.assign(new Error("Rate Limit Exceeded"), {
            status: 403,
            response: { status: 403, headers: { "retry-after": "30" }, data: { error: { errors: [{ reason: "userRateLimitExceeded" }] } } },
          });
        }
        return io.page(token);
      },
    });
    expect(t.waits).toEqual([30_000]);
  });

  it("saves its place, not a failure, when limited for the rest of its time, and holds the next batch off a minute", async () => {
    const { io } = mailbox(pages);
    const t = timed(10_000);
    const batch = await runBackfillBatch(undefined, false, {
      ...io,
      ...t,
      importIds: async (ids) => {
        if (ids[0] === "b") throw quota();
        return { ...emptyCounts(), imported: ids.length };
      },
    });
    expect(batch.rateLimited).toBe(true);
    expect(batch.counts).toMatchObject({ imported: 1, failed: 0 });
    expect(batch.progress).toEqual({
      after: "a",
      scanned: 0,
      imported: 1,
      failed: 0,
      done: false,
      updatedAt: "2030-01-01T00:00:00Z",
      retryAfter: new Date(Date.parse("2030-01-01T00:00:00Z") + rateLimitPauseMs).toISOString(),
    });
    // The next batch carries on with "b".
    const seen: string[] = [];
    const next = await runBackfillBatch(batch.progress, false, {
      ...io,
      importIds: async (ids) => {
        seen.push(...ids);
        return { ...emptyCounts(), imported: ids.length };
      },
    });
    expect(seen).toEqual(["b"]);
    expect(next.progress).toMatchObject({ cursor: "p1", scanned: 2, imported: 2 });
  });

  it("keeps the place it started from when even the search is limited", async () => {
    const { io } = mailbox(pages);
    const midway = { cursor: "p1", after: "x", scanned: 2, imported: 2, failed: 1, done: false, updatedAt: "2029-01-01T00:00:00Z" };
    const batch = await runBackfillBatch(midway, false, { ...io, ...timed(0), page: async () => Promise.reject(quota()) });
    expect(batch.rateLimited).toBe(true);
    expect(batch.progress).toMatchObject({ cursor: "p1", after: "x", scanned: 2, imported: 2, failed: 1, done: false });
    expect(batch.progress.retryAfter).toBeDefined();
  });

  it("still fails on other errors", async () => {
    const { io } = mailbox(pages);
    const failing = { ...io, ...timed(180_000), importIds: async () => Promise.reject(Object.assign(new Error("Backend Error"), { status: 500 })) };
    await expect(runBackfillBatch(undefined, false, failing)).rejects.toThrow("Backend Error");
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
  // Gmail answers 500 at most per call.
  const fakeGmail = (total: number) => {
    const calls: (string | undefined)[] = [];
    const gmail = {
      users: {
        messages: {
          list: async ({ pageToken, maxResults }: { pageToken?: string; maxResults: number }) => {
            calls.push(pageToken);
            const from = pageToken ? Number(pageToken) : 0;
            const n = Math.min(maxResults, 500, total - from);
            const next = from + n < total ? String(from + n) : undefined;
            return { data: { messages: Array.from({ length: n }, (_, i) => ({ id: `m${from + i}` })), nextPageToken: next } };
          },
        },
      },
    } as unknown as Gmail;
    return { gmail, calls };
  };

  it("finds a whole batch with one search call and says where to carry on", async () => {
    const { gmail, calls } = fakeGmail(450);
    const first = await searchMessagePage(gmail, "q", backfillBatch);
    expect(first.ids).toHaveLength(300);
    expect(first.nextPageToken).toBe("300");
    const rest = await searchMessagePage(gmail, "q", backfillBatch, first.nextPageToken);
    expect(rest.ids).toHaveLength(150);
    expect(rest.nextPageToken).toBeUndefined();
    // Each search is charged against the user's per-minute quota.
    expect(calls).toEqual([undefined, "300"]);
  });

  it("searches once per batch, and not again for a batch carrying on partway through its page", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `m${i}`);
    const searches: (string | undefined)[] = [];
    let left = 10;
    const io: BackfillIo = {
      page: async (token) => {
        searches.push(token);
        return token ? { ids: [] } : { ids, nextPageToken: "p1" };
      },
      importIds: async (batch) => {
        fetched.push(...batch);
        left -= 1;
        return { ...emptyCounts(), imported: batch.length };
      },
      timeLeftMs: () => left,
      isStaleCursor: () => false,
      now: () => "2030-01-01T00:00:00Z",
      log: () => {},
    };
    const fetched: string[] = [];
    const first = await runBackfillBatch(undefined, false, io);
    expect(searches).toEqual([undefined]);
    left = 1000;
    await runBackfillBatch(first.progress, false, io);
    // The second batch searched the same page once more and read on from
    // where the first stopped, fetching no message twice.
    expect(searches).toEqual([undefined, undefined]);
    expect(new Set(fetched).size).toBe(300);
    expect(fetched).toHaveLength(300);
    expect(backfillQuery.match(/\{/g)).toHaveLength(1);
  });

  it("searches travel programs' recent statements as well as bookings", () => {
    expect(backfillQuery).toContain("newer_than:60d from:(emeraldclub.com OR");
    expect(backfillQuery).toContain("united.com");
    expect(backfillQuery).toMatch(/subject:\(statement OR estatement/);
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
