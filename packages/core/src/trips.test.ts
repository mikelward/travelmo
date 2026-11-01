import { daysBetween, findTripForRange, groupTrips, segmentDateRange } from "./trips";
import { ExtractedBooking, Trip } from "./schema";

const trip = (id: string, start: string, end: string): Trip => ({
  id,
  title: id,
  start,
  end,
  ownerUid: "u1",
  sharedWith: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("groupTrips", () => {
  const trips = [
    trip("past-old", "2025-01-10", "2025-01-20"),
    trip("past-recent", "2026-03-01", "2026-03-05"),
    trip("current", "2026-10-30", "2026-11-03"),
    trip("soon", "2026-11-20", "2026-11-25"),
    trip("later", "2027-02-01", "2027-02-10"),
  ];

  it("splits by today and sorts each group", () => {
    const groups = groupTrips(trips, "2026-11-01");
    expect(groups.current.map((t) => t.id)).toEqual(["current"]);
    expect(groups.upcoming.map((t) => t.id)).toEqual(["soon", "later"]);
    expect(groups.past.map((t) => t.id)).toEqual(["past-recent", "past-old"]);
  });

  it("treats the start and end days as current", () => {
    expect(groupTrips(trips, "2026-10-30").current.map((t) => t.id)).toEqual(["current"]);
    expect(groupTrips(trips, "2026-11-03").current.map((t) => t.id)).toEqual(["current"]);
    expect(groupTrips(trips, "2026-11-04").current).toEqual([]);
  });
});

describe("segmentDateRange", () => {
  it("spans the earliest start to the latest end in local dates", () => {
    const range = segmentDateRange([
      { type: "flight", title: "LHR-JFK", start: "2026-12-01T09:00:00+00:00", end: "2026-12-01T12:00:00-05:00" },
      { type: "lodging", title: "Hotel", start: "2026-12-01T15:00:00-05:00", end: "2026-12-05T11:00:00-05:00" },
    ]);
    expect(range).toEqual({ start: "2026-12-01", end: "2026-12-05" });
  });

  it("keeps start before end when a flight lands on an earlier local date", () => {
    const range = segmentDateRange([
      { type: "flight", title: "NRT-HNL", start: "2026-12-02T00:30:00+09:00", end: "2026-12-01T12:30:00-10:00" },
    ]);
    expect(range).toEqual({ start: "2026-12-01", end: "2026-12-02" });
  });

  it("is undefined with no segments", () => {
    expect(segmentDateRange([])).toBeUndefined();
  });
});

describe("daysBetween", () => {
  it("counts calendar days, negative when reversed", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
    expect(daysBetween("2026-03-02", "2026-02-27")).toBe(-3);
  });
});

describe("findTripForRange", () => {
  const trips = [trip("a", "2026-12-01", "2026-12-05"), trip("b", "2026-12-20", "2026-12-28")];

  it("matches a booking inside a trip", () => {
    expect(findTripForRange(trips, { start: "2026-12-02", end: "2026-12-03" })?.id).toBe("a");
  });

  it("matches a booking within the gap after a trip", () => {
    expect(findTripForRange(trips, { start: "2026-12-07", end: "2026-12-07" })?.id).toBe("a");
  });

  it("starts a new trip beyond the gap", () => {
    expect(findTripForRange(trips, { start: "2026-12-10", end: "2026-12-12" })).toBeUndefined();
  });
});

describe("ExtractedBooking schema", () => {
  it("accepts a parsed flight and rejects a naive datetime", () => {
    expect(
      ExtractedBooking.safeParse({
        isBooking: true,
        segments: [{ type: "flight", title: "BA 117", start: "2026-12-01T09:00:00+00:00" }],
      }).success,
    ).toBe(true);
    expect(
      ExtractedBooking.safeParse({
        isBooking: true,
        segments: [{ type: "flight", title: "BA 117", start: "2026-12-01T09:00:00" }],
      }).success,
    ).toBe(false);
  });
});
