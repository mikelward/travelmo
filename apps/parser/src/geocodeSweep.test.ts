import type { GeocodeResult, Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { maxRetryAgeDays, memoryBackfillScan, memoryRetryStore, queueGeocodeBackfill, sweepGeocodeRetries } from "./geocodeSweep";
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

  it("puts right what kind of place the trip goes to once a booking's town is known", async () => {
    const { store, retries, deps } = setup({ "Hotel Example": spot }, stay("s1", { destination: { name: "Hotel Example" } }));
    store.trips.set(trip.id, { ...trip, setting: "none" });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    await sweepGeocodeRetries(deps);
    expect(store.trips.get("t1")?.setting).toBe("town");
  });

  it("keeps the names the trip's owner took off it out of whom the trip is for", async () => {
    const { store, retries, deps } = setup({ "Hotel Example": spot }, stay("s1", { destination: { name: "Hotel Example" }, travelers: ["Sam Example", "Pat Example"] }));
    store.trips.set(trip.id, { ...trip, removedTravelers: ["Sam Example"], travelers: ["Pat Example"] });
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    await sweepGeocodeRetries(deps);
    expect(store.trips.get("t1")?.travelers).toEqual(["Pat Example"]);
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

  it("does nothing without a queue", async () => {
    const { deps, retries } = setup({}, stay("s1"));
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    const { geocodeRetries: _retries, ...withoutQueue } = deps;
    expect(await sweepGeocodeRetries(withoutQueue)).toEqual({ seen: 0, placed: 0, dropped: 0, deferred: 0, failed: 0 });
  });

  it("keeps a country the city table gave when the geocoder fails, and the booking stays queued", async () => {
    const train: Segment = stay("s1", { type: "train", title: "To Liverpool", origin: { name: "London Euston", city: "London" }, destination: { name: "Liverpool Lime Street", city: "Liverpool" } });
    const { deps, retries, store } = setup({ "London Euston, London, GB": new Error("key refused"), "Liverpool Lime Street, Liverpool, GB": new Error("key refused") }, train);
    await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
    expect(await sweepGeocodeRetries(deps)).toMatchObject({ placed: 1, failed: 1, dropped: 0 });
    expect(store.segments.get("s1")).toMatchObject({ origin: { country: "GB" }, destination: { country: "GB" } });
    expect(retries.entries.size).toBe(1);
  });

  it("fills a country from an unambiguous city with no call, and without a geocoder too", async () => {
    const train: Segment = stay("s1", {
      type: "train",
      title: "London Euston to Liverpool Lime Street",
      origin: { name: "London Euston", city: "London" },
      destination: { name: "Liverpool Lime Street", city: "Liverpool" },
    });
    for (const withGeocoder of [true, false]) {
      const { deps, retries, store, asked } = setup({}, train);
      await retries.put({ uid: "u1", tripId: "t1", segmentId: "s1", at });
      const { geocode: _geocode, ...withoutGeocoder } = deps;
      expect(await sweepGeocodeRetries(withGeocoder ? deps : withoutGeocoder)).toMatchObject({ placed: 1, dropped: 1 });
      expect(store.segments.get("s1")).toMatchObject({ origin: { country: "GB" }, destination: { country: "GB" } });
      // Only the spots are asked about, when there is someone to ask.
      expect(asked).toEqual(withGeocoder ? ["London Euston, London, GB", "Liverpool Lime Street, Liverpool, GB"] : []);
      expect(retries.entries.size).toBe(0);
    }
  });
});

describe("queueGeocodeBackfill", () => {
  const placed = stay("placed", { destination: { name: "Hotel Placed", country: "FR", lat: 48.5, lon: 2.25 } });
  const entries = (retries: ReturnType<typeof memoryRetryStore>) => [...retries.entries.values()].map((e) => `${e.tripId}/${e.segmentId}`).sort();

  it("queues older bookings still missing a place, a page of trips at a time, then stops", async () => {
    const scan = memoryBackfillScan([
      { trip: { id: "t1", ownerUid: "u1" }, segments: [stay("s1"), placed, stay("typed", { source: "manual" })] },
      { trip: { id: "t2", ownerUid: "u2" }, segments: [stay("s2", { tripId: "t2" })] },
      { trip: { id: "t3", ownerUid: "u1" }, segments: [stay("s3", { tripId: "t3" })] },
    ]);
    const retries = memoryRetryStore();
    expect(await queueGeocodeBackfill(scan, retries, now, 2)).toEqual({ trips: 2, queued: 2, done: false });
    expect(entries(retries)).toEqual(["t1/s1", "t2/s2"]);
    expect(retries.entries.get("t2/s2")).toEqual({ uid: "u2", tripId: "t2", segmentId: "s2", at: now });
    expect(await queueGeocodeBackfill(scan, retries, now, 2)).toEqual({ trips: 1, queued: 1, done: true });
    expect(entries(retries)).toEqual(["t1/s1", "t2/s2", "t3/s3"]);
    expect(await queueGeocodeBackfill(scan, retries, now, 2)).toEqual({ trips: 0, queued: 0, done: true });
  });

  it("queues no more than the sweep can take, resuming after the last trip queued", async () => {
    const scan = memoryBackfillScan([
      { trip: { id: "t1", ownerUid: "u1" }, segments: [stay("a"), stay("b")] },
      { trip: { id: "t2", ownerUid: "u1" }, segments: [stay("c", { tripId: "t2" }), stay("d", { tripId: "t2" })] },
      { trip: { id: "t3", ownerUid: "u1" }, segments: [stay("e", { tripId: "t3" })] },
    ]);
    const retries = memoryRetryStore();
    // Room for three: the second trip's two would overflow it, so it waits.
    expect(await queueGeocodeBackfill(scan, retries, now, 10, 3)).toEqual({ trips: 1, queued: 2, done: false });
    expect(scan.state.cursor).toBe("t1");
    // A full queue takes nothing more.
    await retries.put({ uid: "u1", tripId: "x", segmentId: "y", at: now });
    expect(await queueGeocodeBackfill(scan, retries, now, 10, 3)).toEqual({ trips: 0, queued: 0, done: false });
    retries.entries.clear();
    // Room again: the other two trips fit, and the walk ends.
    expect(await queueGeocodeBackfill(scan, retries, now, 10, 3)).toEqual({ trips: 2, queued: 3, done: true });
    expect(scan.state.cursor).toBe("done");
    expect([...retries.entries.keys()].sort()).toEqual(["t2/c", "t2/d", "t3/e"]);
  });

  it("queues a trip larger than all the room on its own", async () => {
    const scan = memoryBackfillScan([{ trip: { id: "t1", ownerUid: "u1" }, segments: [stay("a"), stay("b"), stay("c")] }]);
    expect(await queueGeocodeBackfill(scan, memoryRetryStore(), now, 10, 2)).toEqual({ trips: 1, queued: 3, done: true });
  });

  it("hands what it queues to the sweep, which fills in the country", async () => {
    const { store, retries, deps } = setup({ "Hotel Example, Exampleville": spot }, stay("s1"));
    await queueGeocodeBackfill(memoryBackfillScan([{ trip, segments: [stay("s1")] }]), retries, now);
    expect(await sweepGeocodeRetries(deps)).toMatchObject({ placed: 1 });
    expect(store.segments.get("s1")?.destination).toMatchObject({ country: "FR" });
  });
});
