import { describe, expect, it } from "vitest";
import { bookingPlace, favoritePlaces } from "./favorites";
import type { Segment } from "./schema";

// Invented bookings.
const at = "2026-01-01T00:00:00Z";
const booking = (id: string, over: Partial<Segment>): Segment => ({
  id,
  tripId: "t",
  type: "lodging",
  title: id,
  start: "2026-05-01T15:00:00+02:00",
  source: "manual",
  gmailMessageIds: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});
const cove = { name: "Cove Liverpool", city: "Liverpool", country: "GB" };

describe("bookingPlace", () => {
  it("is where a journey ends, where a stay is, or the title", () => {
    expect(bookingPlace({ type: "flight", title: "XX 1", origin: { name: "A" }, destination: { name: "B" } })).toEqual({ name: "B" });
    expect(bookingPlace({ type: "lodging", title: "Stay", destination: cove })).toEqual(cove);
    expect(bookingPlace({ type: "activity", title: "Walking tour" })).toEqual({ name: "Walking tour" });
  });
});

describe("favoritePlaces", () => {
  it("gathers rated and favorite places once each, favorites first, best rating kept, every trip linked, latest first", () => {
    const trips = [
      {
        trip: { id: "t1", title: "Liverpool", start: "2026-05-01" },
        segments: [booking("s1", { destination: cove, rating: 3 }), booking("s2", { title: "Unrated", destination: { name: "Elsewhere" } })],
      },
      // The same hotel again, unrated this time: still one of its trips.
      { trip: { id: "t0", title: "Liverpool first", start: "2025-03-01" }, segments: [booking("s0", { destination: cove })] },
      {
        trip: { id: "t2", title: "Liverpool again", start: "2026-09-01" },
        segments: [
          booking("s3", { destination: { ...cove, name: "cove liverpool" }, rating: 5, favorite: true }),
          booking("s4", { type: "activity", title: "Anfield tour", destination: { name: "Anfield", country: "GB" }, rating: 4 }),
          booking("s5", { type: "flight", title: "XX 2 LHR to JFK", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "JFK", code: "JFK", country: "US" }, favorite: true }),
        ],
      },
      // The same trip listed twice (owned and shared) counts once.
      { trip: { id: "t2", title: "Liverpool again", start: "2026-09-01" }, segments: [booking("s3", { destination: cove, rating: 5, favorite: true })] },
    ];
    expect(favoritePlaces(trips)).toEqual([
      {
        name: "Cove Liverpool",
        city: "Liverpool",
        country: "GB",
        type: "lodging",
        favorite: true,
        rating: 5,
        trips: [
          { id: "t2", title: "Liverpool again", start: "2026-09-01" },
          { id: "t1", title: "Liverpool", start: "2026-05-01" },
          { id: "t0", title: "Liverpool first", start: "2025-03-01" },
        ],
      },
      { name: "JFK", country: "US", type: "flight", favorite: true, trips: [{ id: "t2", title: "Liverpool again", start: "2026-09-01" }] },
      { name: "Anfield", country: "GB", type: "activity", favorite: false, rating: 4, trips: [{ id: "t2", title: "Liverpool again", start: "2026-09-01" }] },
    ]);
    expect(favoritePlaces([])).toEqual([]);
  });
});
