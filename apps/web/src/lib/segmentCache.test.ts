import type { Segment } from "@travelmo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allRead, clearSegmentCache, loadAllSegments, peekAllSegments, peekTripSegments, type SegmentRead, type SegmentReader } from "./segmentCache";

const at = "2026-01-01T00:00:00Z";
const seg = (id: string, tripId: string): Segment => ({
  id,
  tripId,
  type: "lodging",
  title: `Hotel ${id}`,
  start: "2026-01-01T15:00:00Z",
  source: "gmail",
  gmailMessageIds: [],
  createdAt: at,
  updatedAt: at,
});

const storage = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
} as unknown as Storage;

beforeEach(() => {
  storage.clear();
  Object.assign(globalThis, { localStorage: fakeStorage });
  clearSegmentCache();
});

afterEach(() => {
  clearSegmentCache();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("segmentCache", () => {
  it("reuses memory cache when updatedAt matches and re-reads only changed trips", async () => {
    const storeCalls: string[] = [];
    const cacheCalls: string[] = [];
    const byTrip: Record<string, Segment[]> = {
      a: [seg("s1", "a")],
      b: [seg("s2", "b"), seg("s3", "b")],
    };
    const reader: SegmentReader = {
      fromCache: async (id) => {
        cacheCalls.push(id);
        return byTrip[id];
      },
      fromStore: async (id) => {
        storeCalls.push(id);
        return { segments: byTrip[id] ?? [], confirmed: true };
      },
    };
    const trips = [
      { id: "a", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "b", updatedAt: "2026-01-02T00:00:00Z" },
    ];

    const first = await loadAllSegments("u1", trips, reader);
    expect(first).toEqual({ byTrip, failed: [], unconfirmed: [] });
    expect(storeCalls).toEqual(["a", "b"]);
    expect(cacheCalls).toEqual([]);

    // Same versions: peek hits memory immediately and loadAllSegments reads nothing.
    expect(peekAllSegments("u1", trips)).toEqual({ byTrip, failed: [], unconfirmed: [] });
    storeCalls.length = 0;
    const second = await loadAllSegments("u1", trips, reader);
    expect(second).toEqual({ byTrip, failed: [], unconfirmed: [] });
    expect(storeCalls).toEqual([]);
    expect(cacheCalls).toEqual([]);

    // Trip b changes: only b is re-read.
    byTrip.b = [seg("s2", "b")];
    const updated = [trips[0]!, { id: "b", updatedAt: "2026-01-03T00:00:00Z" }];
    expect(peekAllSegments("u1", updated)).toBeUndefined();
    const third = await loadAllSegments("u1", updated, reader);
    expect(third.byTrip.b).toHaveLength(1);
    expect(storeCalls).toEqual(["b"]);
  });

  it("reads unchanged trips from local cache after restart and falls back when evicted", async () => {
    const manifest = {
      uid: "u1",
      trips: {
        a: { updatedAt: "2026-01-01T00:00:00Z", count: 2 },
        b: { updatedAt: "2026-01-02T00:00:00Z", count: 2 },
        c: { updatedAt: "2026-01-03T00:00:00Z", count: 1 },
      },
    };
    storage.set("travelmo.segmentVersions", JSON.stringify(manifest));

    const storeCalls: string[] = [];
    const cacheCalls: string[] = [];
    const reader: SegmentReader = {
      fromCache: async (id) => {
        cacheCalls.push(id);
        if (id === "a") return [seg("a1", "a"), seg("a2", "a")];
        if (id === "b") return [seg("b1", "b")]; // partial eviction: 1 != 2
        return undefined; // cache miss
      },
      fromStore: async (id) => {
        storeCalls.push(id);
        return { segments: [seg(`${id}1`, id), seg(`${id}2`, id)], confirmed: true };
      },
    };

    const result = await loadAllSegments(
      "u1",
      [
        { id: "a", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "b", updatedAt: "2026-01-02T00:00:00Z" },
        { id: "c", updatedAt: "2026-01-03T00:00:00Z" },
      ],
      reader,
    );

    expect(cacheCalls).toEqual(["a", "b", "c"]);
    expect(storeCalls).toEqual(["b", "c"]);
    expect(result.byTrip.a).toHaveLength(2);
    expect(result.byTrip.b).toHaveLength(2);
    expect(result.byTrip.c).toHaveLength(2);
  });

  it("caps concurrent store reads", async () => {
    let inFlight = 0;
    let peak = 0;
    const trips = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, updatedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z` }));
    const reader: SegmentReader = {
      fromCache: async () => undefined,
      fromStore: async (id) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
        return { segments: [seg("s", id)], confirmed: true };
      },
    };

    const result = await loadAllSegments("u1", trips, reader, 4);
    expect(Object.keys(result.byTrip)).toHaveLength(20);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("does not poison cache or manifest when a trip read fails and isolates accounts", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reader: SegmentReader = {
      fromCache: async () => undefined,
      fromStore: async (id) => {
        if (id === "bad") throw new Error("permission-denied");
        return { segments: [seg("ok1", id)], confirmed: true };
      },
    };
    const trips = [
      { id: "ok", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "bad", updatedAt: "2026-01-01T00:00:00Z" },
    ];

    const res = await loadAllSegments("u1", trips, reader);
    expect(res.failed).toEqual(["bad"]);
    expect(Object.keys(res.byTrip)).toEqual(["ok"]);
    expect(peekAllSegments("u1", trips)).toBeUndefined();
    expect(peekAllSegments("u1", [trips[0]!])).toEqual({ byTrip: { ok: [seg("ok1", "ok")] }, failed: [], unconfirmed: [] });
    // Another account cannot see u1's cached trips.
    expect(peekAllSegments("u2", [trips[0]!])).toBeUndefined();

    clearSegmentCache();
    expect(peekAllSegments("u1", [trips[0]!])).toBeUndefined();
    expect(storage.has("travelmo.segmentVersions")).toBe(false);
    errSpy.mockRestore();
  });

  it("ignores stale in-flight results when the cache is cleared mid-load", async () => {
    let resolveRead!: (read: SegmentRead) => void;
    const reader: SegmentReader = {
      fromCache: async () => undefined,
      fromStore: () => new Promise<SegmentRead>((resolve) => { resolveRead = resolve; }),
    };
    const trip = { id: "a", updatedAt: "2026-01-01T00:00:00Z" };
    const pending = loadAllSegments("u1", [trip], reader);
    clearSegmentCache();
    resolveRead({ segments: [seg("s1", "a")], confirmed: true });
    await pending;

    expect(peekAllSegments("u1", [trip])).toBeUndefined();
    expect(storage.has("travelmo.segmentVersions")).toBe(false);
  });

  it("does not cache or persist unconfirmed offline reads and refreshes once confirmed", async () => {
    let online = false;
    const storeCalls: string[] = [];
    const reader: SegmentReader = {
      fromCache: async () => [],
      fromStore: async (id) => {
        storeCalls.push(id);
        return online
          ? { segments: [seg("s1", id), seg("s2", id)], confirmed: true }
          : { segments: [], confirmed: false };
      },
    };
    const trips = [{ id: "a", updatedAt: "2026-01-01T00:00:00Z" }];

    // Offline read returns whatever cache had, but neither memory cache nor manifest persists it.
    const offline = await loadAllSegments("u1", trips, reader);
    expect(offline.byTrip.a).toEqual([]);
    // Named as read from the cache alone, so nothing takes it for all of the trip's bookings.
    expect(offline.unconfirmed).toEqual(["a"]);
    expect(allRead(offline)).toBe(false);
    expect(peekAllSegments("u1", trips)).toBeUndefined();
    expect(storage.has("travelmo.segmentVersions")).toBe(false);

    // Back online: re-reads from store, gets full bookings, and persists the confirmed version.
    online = true;
    const refreshed = await loadAllSegments("u1", trips, reader);
    expect(refreshed.byTrip.a).toHaveLength(2);
    expect(allRead(refreshed)).toBe(true);
    expect(storeCalls).toEqual(["a", "a"]);
    expect(peekAllSegments("u1", trips)?.byTrip.a).toHaveLength(2);
    expect(JSON.parse(storage.get("travelmo.segmentVersions") ?? "{}").trips.a).toEqual({
      updatedAt: "2026-01-01T00:00:00Z",
      count: 2,
    });
  });

  it("peeks a single trip's cached segments only for the matching account and version", async () => {
    const reader: SegmentReader = {
      fromCache: async () => undefined,
      fromStore: async (id) => ({ segments: [seg("s1", id)], confirmed: true }),
    };
    await loadAllSegments("u1", [{ id: "a", updatedAt: "2026-01-01T00:00:00Z" }], reader);

    expect(peekTripSegments("u1", "a", "2026-01-01T00:00:00Z")).toEqual([seg("s1", "a")]);
    expect(peekTripSegments("u1", "a")).toEqual([seg("s1", "a")]);
    expect(peekTripSegments("u1", "a", "2026-01-02T00:00:00Z")).toBeUndefined();
    expect(peekTripSegments("u2", "a", "2026-01-01T00:00:00Z")).toBeUndefined();
  });
});
