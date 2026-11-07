import type { GeocodeResult, Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { maxRetryAgeDays, memoryRetryStore, sweepGeocodeRetries } from "./geocodeSweep";
import type { ImportDeps } from "./importer";
import { memoryStore, type Memory } from "./testStore";

// Invented bookings; no real place.
const now = "2026-11-08T01:11:00Z";
const at = "2026-11-07T12:00:00Z";
const trip: Trip = { id: "t1", title: "Exampleville", start: "2026-12-01", end: "2026-12-03", ownerUid: "u1", sharedWith: [], createdAt: at, updatedAt: at };
const stay = (id: string, over: Partial<Segment> = {}): Segment => ({
  id,
  tripId: "t1",
  type: "lodging",
  title: "Hotel Example",
  start: "2026-12-01T15:00:00+01:00",
  end: "2026-12-03T11:00:00+01:00",
  destination: { name: "Hotel Example", city: "Exampleville" },
  source: "gmail",
  gmailMessageIds: ["m1"],
  createdAt: at,
  updatedAt: at,
  ...over,
});

type Answer = GeocodeResult | "none" | "later" | Error;

function setup(answers: Record<string, Answer>, ...segments: Segment[]) {
  const store: Memory = memoryStore();
  store.trips.set(trip.id, trip);
  for (const s of segments) store.segments.set(s.id, s);
  const retries = memoryRetryStore();
  const asked: string[] = [];
  const logs: string[] = [];
  const deps: ImportDeps = {
    store,
    extract: async () => {
      throw new Error("not used");
    },
    geocode: async (query) => {
      asked.push(query);
      const answer = answers[query] ?? "none";
      if (answer instanceof Error) throw answer;
      return answer;
    },
    geocodeRetries: retries,
    now: () => now,
    log: (event) => logs.push(event),
  };
  return { store, retries, asked, logs, deps };
}

const spot = { country: "FR", city: "Exampleville", lat: 48.5, lon: 2.25 };

describe("sweepGeocodeRetries", () => {
  it("asks again for a queued booking, writes what it learns and drops the entry", async () => {
    const { store, retries, deps, asked, logs } = setup({ "Hotel Example, Exampleville": spot }, stay("s1"));
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    expect(await sweepGeocodeRetries(deps)).toEqual({ seen: 1, placed: 1, dropped: 1, deferred: 0, failed: 0 });
    expect(asked).toEqual(["Hotel Example, Exampleville"]);
    // The booking's own revision stays: it is still unedited, so a calendar
    // change can still replace it; the trip's moves, as for any change.
    expect(store.segments.get("s1")).toMatchObject({ destination: { name: "Hotel Example", ...spot }, updatedAt: at });
    expect(store.trips.get("t1")?.updatedAt).toBe(now);
    expect(retries.entries.size).toBe(0);
    expect(logs).toEqual(["geocode_swept"]);
  });

  it("drops an entry whose booking is gone, already placed, or answered with nothing", async () => {
    const placed = stay("s2", { destination: { name: "Hotel Sample", country: "FR", lat: 1, lon: 2 } });
    const { store, retries, deps, asked } = setup({}, placed, stay("s3", { destination: { name: "Nowhere Special" } }));
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "gone", at });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s2", at });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s3", at });
    expect(await sweepGeocodeRetries(deps)).toEqual({ seen: 3, placed: 0, dropped: 3, deferred: 0, failed: 0 });
    expect(asked).toEqual(["Nowhere Special"]);
    expect(store.segments.get("s3")?.destination).toEqual({ name: "Nowhere Special" });
    expect(retries.entries.size).toBe(0);
  });

  it("stops when the budget is spent again, keeping the rest of the queue, and drops entries too old", async () => {
    const { retries, deps, asked } = setup({ "Hotel Example, Exampleville": "later" }, stay("s1"), stay("s2"));
    const old = new Date(Date.parse(now) - (maxRetryAgeDays + 1) * 86_400_000).toISOString();
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "stale", at: old });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s2", at: "2026-11-07T13:00:00Z" });
    expect(await sweepGeocodeRetries(deps)).toEqual({ seen: 2, placed: 0, dropped: 1, deferred: 1, failed: 0 });
    expect(asked).toEqual(["Hotel Example, Exampleville"]);
    expect([...retries.entries.keys()]).toEqual(["t1/s1", "t1/s2"]);
  });

  it("goes on past a booking refused only its spot, so bookings lacking a country still get their turn", async () => {
    const withCountry = stay("s1", { destination: { name: "Hotel Sample", country: "FR" } });
    const { store, retries, deps, asked } = setup({ "Hotel Sample, FR": "later", "Hotel Example, Exampleville": spot }, withCountry, stay("s2"));
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s2", at: "2026-11-07T13:00:00Z" });
    expect(await sweepGeocodeRetries(deps)).toEqual({ seen: 2, placed: 1, dropped: 1, deferred: 1, failed: 0 });
    expect(asked).toEqual(["Hotel Sample, FR", "Hotel Example, Exampleville"]);
    expect(store.segments.get("s2")?.destination).toMatchObject(spot);
    expect([...retries.entries.keys()]).toEqual(["t1/s1"]);
  });

  it("finds a booking moved to another trip by its id, and places it there", async () => {
    const moved = stay("s1", { tripId: "t2", updatedAt: "2026-11-07T15:00:00Z" });
    const { store, retries, deps } = setup({ "Hotel Example, Exampleville": spot }, moved);
    store.trips.set("t2", { ...trip, id: "t2", title: "Sampleton" });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    expect(await sweepGeocodeRetries(deps)).toEqual({ seen: 1, placed: 1, dropped: 1, deferred: 0, failed: 0 });
    expect(store.segments.get("s1")).toMatchObject({ tripId: "t2", destination: { name: "Hotel Example", ...spot } });
    expect(store.trips.get("t2")?.updatedAt).toBe(now);
    expect(store.trips.get("t1")?.updatedAt).toBe(at);
    expect(retries.entries.size).toBe(0);
  });

  it("moves the trip's revision afresh for each booking it writes", async () => {
    const { store, retries, deps } = setup({ "Hotel Example, Exampleville": spot }, stay("s1"), stay("s2"));
    let tick = 0;
    const ticking: ImportDeps = { ...deps, now: () => `2026-11-08T01:11:${String(tick++).padStart(2, "0")}Z` };
    const seen: string[] = [];
    const touch = store.withUserLock.bind(store);
    store.withUserLock = async (uid, fn) => {
      const out = await touch(uid, fn);
      seen.push(store.trips.get("t1")!.updatedAt);
      return out;
    };
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s2", at: "2026-11-07T13:00:00Z" });
    expect((await sweepGeocodeRetries(ticking)).placed).toBe(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("keeps an entry whose lookup failed, and one whose booking was edited meanwhile", async () => {
    const failing = setup({ "Hotel Example, Exampleville": new Error("REQUEST_DENIED") }, stay("s1"));
    await failing.retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    expect(await sweepGeocodeRetries(failing.deps)).toEqual({ seen: 1, placed: 0, dropped: 0, deferred: 0, failed: 1 });
    expect(failing.retries.entries.size).toBe(1);

    const edited = setup({ "Hotel Example, Exampleville": spot }, stay("s1"));
    // The booking changes between the read and the write.
    const read = edited.store.readSegment.bind(edited.store);
    edited.store.readSegment = async (tripId, id) => {
      const segment = await read(tripId, id);
      if (segment) edited.store.segments.set(id, { ...segment, updatedAt: "2026-11-08T01:11:30Z" });
      return segment;
    };
    await edited.retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    expect(await sweepGeocodeRetries(edited.deps)).toEqual({ seen: 1, placed: 0, dropped: 0, deferred: 0, failed: 0 });
    expect(edited.store.segments.get("s1")?.destination).toEqual({ name: "Hotel Example", city: "Exampleville" });
    expect(edited.retries.entries.size).toBe(1);
  });

  it("does nothing without a geocoder or a queue", async () => {
    const { deps, retries } = setup({}, stay("s1"));
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    const { geocode: _geocode, ...withoutGeocoder } = deps;
    const { geocodeRetries: _retries, ...withoutQueue } = deps;
    expect(await sweepGeocodeRetries(withoutGeocoder)).toEqual({ seen: 0, placed: 0, dropped: 0, deferred: 0, failed: 0 });
    expect(await sweepGeocodeRetries(withoutQueue)).toEqual({ seen: 0, placed: 0, dropped: 0, deferred: 0, failed: 0 });
  });
});
