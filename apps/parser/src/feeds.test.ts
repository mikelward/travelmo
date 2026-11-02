import type { CalendarFeed } from "@travelmo/core";
import { addFeed, FeedLimitReached, maxFeedsPerUser, pollAllFeeds, type FeedIo, type FeedStore } from "./feeds";
import type { ImportDeps } from "./importer";
import { FeedFetchFailed, FeedUrlRefused } from "./safefetch";
import { memoryStore } from "./testStore";

function memoryFeeds(): FeedStore & { byUser: Map<string, Map<string, CalendarFeed>> } {
  const byUser = new Map<string, Map<string, CalendarFeed>>();
  const of = (uid: string) => byUser.get(uid) ?? byUser.set(uid, new Map()).get(uid)!;
  return {
    byUser,
    list: async (uid) => [...of(uid).values()],
    all: async () => [...byUser.entries()].flatMap(([uid, m]) => [...m.values()].map((feed) => ({ uid, feed }))),
    save: async (uid, feed) => void of(uid).set(feed.id, feed),
    get: async (uid, id) => of(uid).get(id),
    reserve: async (uid, feed, max) => {
      const mine = of(uid);
      if (mine.has(feed.id)) return "existing";
      if (mine.size >= max) throw new FeedLimitReached(`At most ${max} calendar feeds.`);
      mine.set(feed.id, feed);
      return "added";
    },
    releaseIfUnread: async (uid, id) => {
      if (!of(uid).get(id)?.lastFetchedAt) of(uid).delete(id);
    },
    saveResult: async (uid, feed) => {
      if (!of(uid).has(feed.id)) return false;
      of(uid).set(feed.id, feed);
      return true;
    },
    remove: async (uid, id) => void of(uid).delete(id),
  };
}

const flight = {
  isBooking: true,
  segments: [{ type: "flight" as const, title: "XX1 AAA to BBB", start: "2030-01-01T09:00:00+00:00", origin: { name: "A", code: "AAA" }, destination: { name: "B", code: "BBB" } }],
};

const calendar = (events: string[]) =>
  ["BEGIN:VCALENDAR", "PRODID:-//TripIt//EN", ...events, "END:VCALENDAR"].join("\r\n");
const event = (uid: string, extra: string[] = []) =>
  ["BEGIN:VEVENT", `UID:${uid}`, "DTSTART:20300101T090000Z", "SUMMARY:XX1 AAA to BBB", ...extra, "END:VEVENT"].join("\r\n");

function io(fetchText: FeedIo["fetchText"]): FeedIo & { feeds: ReturnType<typeof memoryFeeds>; logs: unknown[][] } {
  const logs: unknown[][] = [];
  const deps: ImportDeps = { store: memoryStore(), extract: async () => flight, now: () => "2030-01-01T00:00:00Z", log: (...a) => void logs.push(a) };
  return { feeds: memoryFeeds(), fetchText, deps, logs };
}

describe("addFeed", () => {
  it("reads a feed at once and stores it under one id per link", async () => {
    const env = io(async () => calendar([event("e1")]));
    const { feed, counts } = await addFeed("u1", "webcal://www.example.com/feed/abc.ics", "TripIt", env);
    expect(counts.imported).toBe(1);
    expect(feed).toMatchObject({ url: "https://www.example.com/feed/abc.ics", label: "TripIt", lastResult: "1 imported" });
    await addFeed("u1", "https://www.example.com/feed/abc.ics", undefined, env);
    expect(env.feeds.byUser.get("u1")?.size).toBe(1);
  });

  it("refuses a private address, a non-calendar and a sixth feed, storing nothing", async () => {
    const env = io(async () => "<html>not a calendar</html>");
    await expect(addFeed("u1", "https://169.254.169.254/latest", undefined, env)).rejects.toThrow(FeedUrlRefused);
    await expect(addFeed("u1", "https://www.example.com/page", undefined, env)).rejects.toThrow("not a calendar");
    expect(env.feeds.byUser.get("u1")?.size ?? 0).toBe(0);
    const ok = io(async () => calendar([]));
    for (let i = 0; i < maxFeedsPerUser; i++) await addFeed("u1", `https://www.example.com/${i}.ics`, undefined, ok);
    await expect(addFeed("u1", "https://www.example.com/extra.ics", undefined, ok)).rejects.toThrow(FeedLimitReached);
  });

  it("keeps a feed another request completed when this one's first read fails", async () => {
    // Two adds of one link: the first reserves it and its read fails late;
    // the second finds it reserved, reads it fine and finishes first.
    let failFirst!: (e: Error) => void;
    let calls = 0;
    const env = io(
      (_url) =>
        ++calls === 1
          ? new Promise<string>((_ok, fail) => {
              failFirst = fail;
            })
          : Promise.resolve(calendar([event("e1")])),
    );
    const first = addFeed("u1", "https://www.example.com/a.ics", undefined, env);
    await Promise.resolve();
    await addFeed("u1", "https://www.example.com/a.ics", undefined, env);
    failFirst(new FeedFetchFailed("The feed answered 503."));
    await expect(first).rejects.toThrow(FeedFetchFailed);
    expect(env.feeds.byUser.get("u1")?.size).toBe(1);
  });

  it("holds the limit when adds race, reading the link only after the slot is taken", async () => {
    const env = io(async () => calendar([]));
    const results = await Promise.allSettled(
      Array.from({ length: maxFeedsPerUser + 3 }, (_, i) => addFeed("u1", `https://www.example.com/${i}.ics`, undefined, env)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(maxFeedsPerUser);
    expect(env.feeds.byUser.get("u1")?.size).toBe(maxFeedsPerUser);
  });

  it("never logs the link, which carries the feed's secret", async () => {
    const env = io(async () => calendar([event("e1")]));
    await addFeed("u1", "https://www.example.com/feed/SECRET-TOKEN.ics", undefined, env);
    expect(JSON.stringify(env.logs)).not.toContain("SECRET-TOKEN");
  });
});

describe("pollAllFeeds", () => {
  it("imports what is new, removes what was cancelled, and records failures per feed", async () => {
    let body = calendar([event("e1")]);
    const env = io(async (url) => {
      if (url.includes("broken")) throw new FeedFetchFailed("The feed answered 404.");
      return body;
    });
    await addFeed("u1", "https://www.example.com/good.ics", undefined, env);
    await env.feeds.save("u2", { id: "x", url: "https://www.example.com/broken.ics", addedAt: "2030-01-01T00:00:00Z" });
    body = calendar([event("e1", ["STATUS:CANCELLED"])]);
    expect(await pollAllFeeds(env)).toEqual({ polled: 1, failed: 1 });
    const good = [...env.feeds.byUser.get("u1")!.values()][0]!;
    expect(good.lastResult).toBe("0 imported, 1 removed as cancelled");
    expect(env.feeds.byUser.get("u2")?.get("x")).toMatchObject({ lastError: "The feed answered 404." });
  });

  it("words an unexpected failure generically for the user but logs it in full", async () => {
    const env = io(async () => {
      throw new Error("socket hang up at 10.0.0.3");
    });
    await env.feeds.save("u1", { id: "f", url: "https://www.example.com/f.ics", addedAt: "2030-01-01T00:00:00Z" });
    await pollAllFeeds(env);
    expect(env.feeds.byUser.get("u1")?.get("f")?.lastError).toBe("The feed could not be read; it will be tried again tomorrow.");
    expect(env.logs).toContainEqual(["feed_poll_failed", expect.objectContaining({ reason: "socket hang up at 10.0.0.3" })]);
  });
});

describe("pollAllFeeds and removal", () => {
  it("does not bring back a feed removed while the poll was running", async () => {
    const env = io(async () => calendar([event("e1")]));
    await env.feeds.save("u1", { id: "a", url: "https://www.example.com/a.ics", addedAt: "2030-01-01T00:00:00Z" });
    await env.feeds.save("u1", { id: "b", url: "https://www.example.com/b.ics", addedAt: "2030-01-01T00:00:00Z" });
    // "b" is removed after the list is taken, while "a" is being read.
    const fetchText = env.fetchText;
    env.fetchText = async (url) => {
      await env.feeds.remove("u1", "b");
      return fetchText(url);
    };
    await pollAllFeeds(env);
    expect([...env.feeds.byUser.get("u1")!.keys()]).toEqual(["a"]);
  });

  it("does not bring back a feed removed while it was itself being read", async () => {
    const env = io(async () => calendar([event("e1")]));
    await env.feeds.save("u1", { id: "a", url: "https://www.example.com/a.ics", addedAt: "2030-01-01T00:00:00Z" });
    const fetchText = env.fetchText;
    env.fetchText = async (url) => {
      await env.feeds.remove("u1", "a");
      return fetchText(url);
    };
    await pollAllFeeds(env);
    expect(env.feeds.byUser.get("u1")?.size).toBe(0);
    expect(env.logs).toContainEqual(["feed_removed_during_poll", { uid: "u1", feedId: "a" }]);
  });
});
