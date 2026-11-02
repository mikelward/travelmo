import { runBackfillBatch, type BackfillIo } from "./backfill";
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
    const failing: BackfillIo = { ...io, importIds: async (ids) => ({ ...emptyCounts(), imported: ids.length - 1, failed: 1 }) };
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
});
