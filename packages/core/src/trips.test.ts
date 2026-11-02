import { daysBetween, eventVerb, findTripForRange, groupTrips, mergePlace, nextEvent, overlappingTrips, sameBooking, segmentDateRange } from "./trips";

describe("nextEvent", () => {
  const stay = { type: "lodging" as const, title: "Cove Liverpool", start: "2026-12-12T15:00:00+00:00", end: "2026-12-14T11:00:00+00:00" };
  const flightOut = { type: "flight" as const, title: "BA 117", start: "2026-12-12T09:00:00+00:00", end: "2026-12-12T12:00:00-05:00" };
  const flightHome = { type: "flight" as const, title: "BA 118", start: "2026-12-14T18:00:00+00:00" };

  it("picks the soonest start still ahead", () => {
    const event = nextEvent([stay, flightOut, flightHome], "2026-12-11T20:00:00Z");
    expect(event).toMatchObject({ segment: flightOut, kind: "start" });
    expect(eventVerb(event!)).toBe("Departs");
  });

  it("prefers the end of a booking under way when that comes first", () => {
    const event = nextEvent([stay, flightOut, flightHome], "2026-12-13T08:00:00Z");
    expect(event).toMatchObject({ segment: stay, kind: "end", at: stay.end });
    expect(eventVerb(event!)).toBe("Check-out");
  });

  it("compares by instant across offsets", () => {
    const event = nextEvent([flightOut, stay], "2026-12-12T10:00:00Z");
    expect(event).toMatchObject({ segment: stay, kind: "start" });
  });

  it("is undefined once everything is over", () => {
    expect(nextEvent([stay, flightOut, flightHome], "2026-12-15T00:00:00Z")).toBeUndefined();
    expect(nextEvent([], "2026-12-15T00:00:00Z")).toBeUndefined();
  });
});

describe("mergePlace", () => {
  const imported = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
  it("keeps city and country when only the name or code changes", () => {
    expect(mergePlace(imported, "Heathrow", "lhr")).toEqual({ name: "Heathrow", code: "LHR", city: "London", country: "GB" });
  });
  it("drops the code when cleared but keeps the rest", () => {
    expect(mergePlace(imported, "Heathrow", "")).toEqual({ name: "Heathrow", city: "London", country: "GB" });
  });
  it("is undefined when the name is cleared, and minimal when new", () => {
    expect(mergePlace(imported, "  ", "LHR")).toBeUndefined();
    expect(mergePlace(undefined, "Cove", "")).toEqual({ name: "Cove" });
  });
});
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

describe("sameBooking", () => {
  const flight = {
    type: "flight" as const,
    title: "XX 1 LHR to CDG",
    start: "2030-05-01T08:15:00+01:00",
    origin: { name: "London", code: "LHR" },
    destination: { name: "Paris", code: "CDG" },
  };
  it("matches a journey at the same local minute and route, whatever the offset or title", () => {
    expect(sameBooking(flight, { ...flight, title: "Flight to Paris", start: "2030-05-01T08:15:00+00:00" })).toBe(true);
    expect(sameBooking(flight, { ...flight, destination: { name: "Paris", code: "cdg" } })).toBe(true);
  });
  it("tells apart other times, routes and types", () => {
    expect(sameBooking(flight, { ...flight, start: "2030-05-01T18:15:00+01:00" })).toBe(false);
    expect(sameBooking(flight, { ...flight, destination: { name: "Orly", code: "ORY" } })).toBe(false);
    expect(sameBooking(flight, { ...flight, type: "train" })).toBe(false);
  });
  it("needs more than the time when a route is only partly known", () => {
    expect(sameBooking(flight, { type: "flight", title: "Example Air", start: flight.start })).toBe(false);
    expect(sameBooking(flight, { ...flight, destination: undefined })).toBe(true);
  });

  const stay = {
    type: "lodging" as const,
    title: "Cove Liverpool",
    start: "2030-05-01T15:00:00+01:00",
    end: "2030-05-08T11:00:00+01:00",
    destination: { name: "Cove Liverpool", city: "Liverpool" },
  };
  it("matches a stay on the same dates under the same name, accents and guessed hours aside", () => {
    expect(sameBooking(stay, { ...stay, title: "The Cove Apartments", start: "2030-05-01T14:00:00+01:00", destination: undefined })).toBe(true);
    expect(sameBooking({ ...stay, title: "Hôtel Élysée" }, { ...stay, title: "Hotel Elysee Paris" })).toBe(true);
    expect(sameBooking(stay, { ...stay, end: "2030-05-07T11:00:00+01:00" })).toBe(false);
  });
  it("keeps two stays of one chain apart, whether their cities are known or only named", () => {
    const hilton = (title: string, city?: string) => ({
      ...stay,
      title,
      provider: "Hilton",
      destination: { name: title, ...(city ? { city } : {}) },
    });
    expect(sameBooking(hilton("Hilton London Paddington", "London"), hilton("Hilton Manchester Deansgate", "Manchester"))).toBe(false);
    expect(sameBooking(hilton("Hilton London Paddington"), hilton("Hilton Manchester Deansgate"))).toBe(false);
    expect(sameBooking(hilton("Hilton London Paddington", "London"), hilton("Hilton Paddington"))).toBe(true);
  });

  it("keeps two stays in one city on the same nights apart", () => {
    expect(sameBooking(stay, { ...stay, title: "Hilton Liverpool", destination: { name: "Hilton Liverpool" } })).toBe(false);
    expect(sameBooking(stay, { ...stay, title: "Grand Hotel", destination: undefined })).toBe(false);
  });
  it("lets confirmation numbers decide when both have one", () => {
    expect(sameBooking({ ...stay, confirmation: "ab-123" }, { ...stay, confirmation: "AB123" })).toBe(true);
    expect(sameBooking({ ...stay, confirmation: "AB123" }, { ...stay, confirmation: "XY999" })).toBe(false);
  });
});

describe("overlappingTrips", () => {
  it("keeps trips that share at least a day with the range", () => {
    const trip = (id: string, start: string, end: string) =>
      ({ id, title: id, start, end, ownerUid: "u", sharedWith: [], createdAt: "2030-01-01T00:00:00Z", updatedAt: "2030-01-01T00:00:00Z" });
    const trips = [trip("a", "2030-05-01", "2030-05-03"), trip("b", "2030-05-04", "2030-05-06"), trip("c", "2030-05-10", "2030-05-12")];
    expect(overlappingTrips(trips, { start: "2030-05-03", end: "2030-05-04" }).map((t) => t.id)).toEqual(["a", "b"]);
  });
});
