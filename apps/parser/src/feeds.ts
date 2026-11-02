import { CalendarFeed, NotACalendar, parseIcs, paths, stableHash } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { importCalendar, type CalendarCounts, type ImportDeps } from "./importer";
import { FeedFetchFailed, FeedUrlRefused, normalizeFeedUrl } from "./safefetch";

// Calendar feeds a user subscribed to (TripIt's, or any calendar's public
// link), polled daily and read like an uploaded calendar file. The URL is
// the secret here: it is stored for its owner and the parser only, and
// never logged; logs carry the feed's id.

export const maxFeedsPerUser = 5;
// Model reads per feed per poll, as for an upload; a backlog clears over
// the following days.
export const feedMaxRead = 100;

export type FeedStore = {
  list(uid: string): Promise<CalendarFeed[]>;
  all(): Promise<{ uid: string; feed: CalendarFeed }[]>;
  save(uid: string, feed: CalendarFeed): Promise<void>;
  get(uid: string, feedId: string): Promise<CalendarFeed | undefined>;
  // Adds a feed unless the user already has `max` others, checked and
  // written together so concurrent adds cannot pass the limit. "existing"
  // when the same link was already there (nothing is written).
  reserve(uid: string, feed: CalendarFeed, max: number): Promise<"added" | "existing">;
  // Undoes a reservation whose first read failed, unless another request
  // has since completed the same feed (it has been read: lastFetchedAt).
  releaseIfUnread(uid: string, feedId: string): Promise<void>;
  // Records a poll's outcome only if the feed still exists: a feed the user
  // removed mid-poll must not come back. False when it was gone.
  saveResult(uid: string, feed: CalendarFeed): Promise<boolean>;
  remove(uid: string, feedId: string): Promise<void>;
};

export type FeedIo = {
  feeds: FeedStore;
  fetchText: (url: string) => Promise<string>;
  deps: ImportDeps;
};

export class FeedLimitReached extends Error {}

// What a user is told about a failure: only the kinds we know how to word.
// Anything else is ours, logged and reported generically.
export function feedFailure(error: unknown): string | undefined {
  if (error instanceof FeedUrlRefused || error instanceof FeedFetchFailed || error instanceof NotACalendar) return error.message;
  return undefined;
}

export function describeFeedResult(counts: CalendarCounts): string {
  const parts = [`${counts.imported} imported`];
  if (counts.removed) parts.push(`${counts.removed} removed as cancelled`);
  if (counts.remaining) parts.push(`${counts.remaining} left for the next poll`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  return parts.join(", ");
}

async function poll(uid: string, feed: CalendarFeed, io: FeedIo): Promise<CalendarCounts> {
  const calendar = parseIcs(await io.fetchText(feed.url));
  return importCalendar(uid, calendar, io.deps, feedMaxRead);
}

// Adds a feed and reads it at once, so a wrong link is refused while the
// user is still looking. The same link twice is one feed.
export async function addFeed(uid: string, input: string, label: string | undefined, io: FeedIo): Promise<{ feed: CalendarFeed; counts: CalendarCounts }> {
  const url = normalizeFeedUrl(input).toString();
  const id = stableHash(url);
  const now = io.deps.now();
  const draft: CalendarFeed = { id, url, ...(label?.trim() ? { label: label.trim() } : {}), addedAt: now };
  const reserved = await io.feeds.reserve(uid, draft, maxFeedsPerUser);
  let counts: CalendarCounts;
  try {
    counts = await poll(uid, draft, io);
  } catch (error) {
    // A link that cannot be read is not kept; one the user had already is.
    if (reserved === "added") await io.feeds.releaseIfUnread(uid, id);
    throw error;
  }
  const feed: CalendarFeed = { ...draft, lastFetchedAt: io.deps.now(), lastResult: describeFeedResult(counts) };
  await io.feeds.saveResult(uid, feed);
  io.deps.log("feed_added", { uid, feedId: id, ...counts });
  return { feed, counts };
}

// The daily poll: every feed of every user, one at a time. A feed that
// fails records why for its owner to see and the rest carry on.
export async function pollAllFeeds(io: FeedIo): Promise<{ polled: number; failed: number }> {
  let polled = 0;
  let failed = 0;
  for (const { uid, feed: listed } of await io.feeds.all()) {
    // Re-read: the user may have removed or replaced it while earlier feeds
    // were being polled.
    const feed = await io.feeds.get(uid, listed.id);
    if (!feed) continue;
    const at = io.deps.now();
    let next: CalendarFeed;
    try {
      const counts = await poll(uid, feed, io);
      const { lastError: _cleared, ...rest } = feed;
      next = { ...rest, lastFetchedAt: at, lastResult: describeFeedResult(counts) };
      io.deps.log("feed_polled", { uid, feedId: feed.id, ...counts });
      polled += 1;
    } catch (error) {
      failed += 1;
      const message = feedFailure(error);
      io.deps.log("feed_poll_failed", { uid, feedId: feed.id, reason: message ?? (error as Error).message });
      next = { ...feed, lastFetchedAt: at, lastError: message ?? "The feed could not be read; it will be tried again tomorrow." };
    }
    if (!(await io.feeds.saveResult(uid, next))) io.deps.log("feed_removed_during_poll", { uid, feedId: feed.id });
  }
  return { polled, failed };
}

export function firestoreFeeds(db: Firestore): FeedStore {
  return {
    async list(uid) {
      const snap = await db.collection(paths.feeds(uid)).get();
      return snap.docs.map((d) => CalendarFeed.parse(d.data()));
    },
    async all() {
      const snap = await db.collectionGroup("feeds").get();
      return snap.docs.flatMap((d) => {
        const uid = d.ref.parent.parent?.id;
        const parsed = CalendarFeed.safeParse(d.data());
        if (uid && parsed.success) return [{ uid, feed: parsed.data }];
        // One malformed document must not stop every other user's poll.
        console.error(JSON.stringify({ severity: "ERROR", event: "feed_malformed", path: d.ref.path }));
        return [];
      });
    },
    async save(uid, feed) {
      await db.doc(paths.feed(uid, feed.id)).set(feed);
    },
    async get(uid, feedId) {
      const snap = await db.doc(paths.feed(uid, feedId)).get();
      return snap.exists ? CalendarFeed.parse(snap.data()) : undefined;
    },
    reserve(uid, feed, max) {
      const ref = db.doc(paths.feed(uid, feed.id));
      return db.runTransaction(async (t) => {
        const all = await t.get(db.collection(paths.feeds(uid)));
        if (all.docs.some((d) => d.id === feed.id)) return "existing";
        if (all.size >= max) throw new FeedLimitReached(`At most ${max} calendar feeds.`);
        t.create(ref, feed);
        return "added";
      });
    },
    async releaseIfUnread(uid, feedId) {
      const ref = db.doc(paths.feed(uid, feedId));
      await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (snap.exists && !(snap.data() as Partial<CalendarFeed>).lastFetchedAt) t.delete(ref);
      });
    },
    saveResult(uid, feed) {
      const ref = db.doc(paths.feed(uid, feed.id));
      return db.runTransaction(async (t) => {
        if (!(await t.get(ref)).exists) return false;
        t.set(ref, feed);
        return true;
      });
    },
    async remove(uid, feedId) {
      await db.doc(paths.feed(uid, feedId)).delete();
    },
  };
}
