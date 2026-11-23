import type { ExtractedSegment, Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { forgetSender } from "./forgetSender";
import { memoryStore, type Memory } from "./testStore";

const at = "2026-11-01T12:00:00Z";
const deps = (store: Memory) => ({ store, now: () => "2026-11-22T12:00:00Z", log: () => {} });
const trip = (id: string, start: string, end: string, ownerUid = "u1"): Trip => ({ id, title: id, start, end, ownerUid, sharedWith: [], createdAt: at, updatedAt: at });
const school = { name: "Example School", city: "London", country: "GB" };
const session = (date: string): ExtractedSegment => ({ type: "activity", title: "Saturday Drama Club", start: `${date}T12:30:00+00:00`, end: `${date}T13:30:00+00:00`, destination: school });
const segment = (tripId: string, id: string, extracted: ExtractedSegment, sender?: string): Segment => ({
  ...extracted,
  id,
  tripId,
  source: "gmail",
  gmailMessageIds: [id],
  sources: [{ kind: "gmail", id, uid: "u1", at }],
  ...(sender ? { sender } : {}),
  createdAt: at,
  updatedAt: at,
});

function seed(store: Memory) {
  const put = (s: Segment) => store.segments.set(s.id, s);
  store.trips.set("a", trip("a", "2025-09-11", "2025-09-11"));
  put(segment("a", "a1", session("2025-09-11"), "drama.example"));
  store.trips.set("b", trip("b", "2025-09-18", "2025-09-18"));
  put(segment("b", "b1", session("2025-09-18"), "mail.drama.example"));
  // A trip with another sender's booking too keeps that one.
  store.trips.set("c", trip("c", "2025-09-25", "2025-09-26"));
  put(segment("c", "c1", session("2025-09-25"), "drama.example"));
  put(segment("c", "c2", { type: "lodging", title: "Hotel", start: "2025-09-25T15:00:00+00:00", end: "2025-09-26T11:00:00+00:00", destination: school }, "hotel.example"));
  // Someone else's trip is not this user's to clean up.
  store.trips.set("d", trip("d", "2025-10-02", "2025-10-02", "u2"));
  put(segment("d", "d1", session("2025-10-02"), "drama.example"));
  // An empty trip stays.
  store.trips.set("e", trip("e", "2025-12-01", "2025-12-02"));
}

const left = (store: Memory) => ({
  trips: [...store.trips.keys()].sort(),
  segments: [...store.segments.values()].map((s) => `${s.tripId}/${s.id}`).sort(),
});

describe("forgetSender", () => {
  it("deletes the sender's bookings and the trips they leave empty", async () => {
    const store = memoryStore();
    seed(store);
    expect(await forgetSender("u1", "Drama.Example", deps(store))).toEqual({ bookings: 3, trips: 2 });
    expect(left(store)).toEqual({ trips: ["c", "d", "e"], segments: ["c/c2", "d/d1"] });
    expect(await forgetSender("u1", "drama.example", deps(store))).toEqual({ bookings: 0, trips: 0 });
  });

  it("goes in passes when one would write too much", async () => {
    const store = memoryStore();
    seed(store);
    expect(await forgetSender("u1", "drama.example", deps(store), 2)).toEqual({ bookings: 3, trips: 2 });
    expect(left(store)).toEqual({ trips: ["c", "d", "e"], segments: ["c/c2", "d/d1"] });
  });
});
