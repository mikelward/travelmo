import { daysBetween, eventVerb, findTripForRange, nearbyTrips, newTripTitle, groupTrips, compareMatchRanks, isUntimed, matchRank, mergeDetails, mergePlace, nextEvent, notBookings, overlappingTrips, sameBooking, sameEvent, segmentDateRange, withoutValidityEnds } from "./trips";

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
  it("sets, changes or clears the country only when the form gives one", () => {
    expect(mergePlace(undefined, "Cove", "", "gb")).toEqual({ name: "Cove", country: "GB" });
    expect(mergePlace(imported, "Heathrow", "LHR", "IE")).toMatchObject({ country: "IE", city: "London" });
    expect(mergePlace(imported, "Heathrow", "LHR", "")).toEqual({ name: "Heathrow", code: "LHR", city: "London" });
  });
  it("sets or clears the spot only when an address pick gives or drops it", () => {
    const spot = { lat: 48.5, lon: 2.25 };
    const placed = { name: "Hotel Example", country: "FR", ...spot };
    expect(mergePlace(undefined, "Hotel Example", "", "FR", { location: spot })).toEqual(placed);
    expect(mergePlace(placed, "Hotel Sample", "")).toEqual({ ...placed, name: "Hotel Sample" });
    expect(mergePlace(placed, "Hotel Sample", "", undefined, { location: null })).toEqual({ name: "Hotel Sample", country: "FR" });
    expect(mergePlace(placed, "Hotel Sample", "", undefined, { location: { lat: 1, lon: 2 } })).toEqual({ name: "Hotel Sample", country: "FR", lat: 1, lon: 2 });
  });

  it("sets or clears the city and address only when an address pick gives them", () => {
    const picked = { name: "Hotel Example", city: "Exampleville", address: "1 Example St, Exampleville, Exampleland" };
    expect(mergePlace(undefined, "Hotel Example", "", "FR", { city: "Exampleville", address: "1 Example St, Exampleville, Exampleland" })).toEqual({ ...picked, country: "FR" });
    expect(mergePlace(picked, "Hotel Example", "", undefined, {})).toEqual(picked);
    expect(mergePlace(picked, "Hotel Sample", "", undefined, { city: "", address: "" })).toEqual({ name: "Hotel Sample" });
    expect(mergePlace(picked, "Hotel Example", "", undefined, { address: "  " })).toEqual({ name: "Hotel Example", city: "Exampleville" });
  });
});
import { ExtractedBooking, Trip, type ExtractedSegment } from "./schema";

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

  it("ignores a journey's end more than a week after it leaves, such as a ticket's expiry", () => {
    const express = {
      type: "train" as const,
      title: "Arlanda Express",
      start: "2026-08-15T13:28:00+02:00",
      end: "2026-11-13T23:59:00+01:00",
    };
    expect(segmentDateRange([express])).toEqual({ start: "2026-08-15", end: "2026-08-15" });
    const sleeper = { ...express, title: "Trans-Siberian", end: "2026-08-21T10:00:00+07:00" };
    expect(segmentDateRange([sleeper])).toEqual({ start: "2026-08-15", end: "2026-08-21" });
    const course = { type: "activity" as const, title: "Summer course", start: "2026-07-01T09:00:00+01:00", end: "2026-08-28T16:00:00+01:00" };
    expect(segmentDateRange([course])).toEqual({ start: "2026-07-01", end: "2026-08-28" });
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

describe("nearbyTrips", () => {
  const stay: ExtractedSegment = { type: "lodging", title: "Hotel Example", start: "2026-12-10T15:00:00+01:00", end: "2026-12-12T11:00:00+01:00" };
  const trips = [
    trip("weeks-before", "2026-11-01", "2026-11-20"),
    trip("just-before", "2026-11-20", "2026-11-26"),
    trip("overlapping", "2026-12-11", "2026-12-15"),
    trip("just-after", "2026-12-26", "2026-12-30"),
    trip("next-year", "2027-03-01", "2027-03-05"),
  ];

  it("offers the trips within two weeks of the booking's dates", () => {
    expect(nearbyTrips(trips, stay).map((t) => t.id)).toEqual(["just-before", "overlapping", "just-after"]);
  });

  it("goes by when a cancelled booking was, and the dates the trip is shown with", () => {
    const cancelled = { ...stay, cancelledAt: "2026-11-01T00:00:00Z" };
    const shrunk = { ...trip("shrunk", "2026-11-01", "2026-12-20"), liveStart: "2026-11-01", liveEnd: "2026-11-05" };
    expect(nearbyTrips([shrunk, trip("overlapping", "2026-12-11", "2026-12-15")], cancelled).map((t) => t.id)).toEqual(["overlapping"]);
  });
});

describe("newTripTitle", () => {
  it("names the trip after where the booking goes, else its title", () => {
    expect(newTripTitle({ title: "EK 18 MAN to DXB", destination: { name: "Dubai International", city: "Dubai", code: "DXB" } })).toBe("Dubai");
    expect(newTripTitle({ title: "Stay", destination: { name: "Hotel Example" } })).toBe("Hotel Example");
    expect(newTripTitle({ title: "Toy Story 5" })).toBe("Toy Story 5");
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

describe("mergeDetails", () => {
  const flight = { type: "flight" as const, title: "FR 123 MAN to DUB", start: "2026-12-15T08:00:00+00:00", end: "2026-12-15T09:00:00+00:00" };
  it("takes a newer email's times, moving the arrival with a departure that comes alone", () => {
    expect(mergeDetails(flight, { ...flight, start: "2026-12-15T10:00:00+00:00", end: "2026-12-15T11:30:00+00:00" }, { newer: true })).toMatchObject({ start: "2026-12-15T10:00:00+00:00", end: "2026-12-15T11:30:00+00:00" });
    const { end: _end, ...noArrival } = flight;
    expect(mergeDetails(flight, { ...noArrival, start: "2026-12-15T10:00:00+00:00" }, { newer: true })).toMatchObject({ start: "2026-12-15T10:00:00+00:00", end: "2026-12-15T11:00:00+00:00" });
    // An older email, or one the user edited, changes no times.
    expect(mergeDetails(flight, { ...flight, start: "2026-12-15T10:00:00+00:00" })).toMatchObject({ start: flight.start, end: flight.end });
    expect(mergeDetails(flight, { ...flight, start: "2026-12-15T10:00:00+00:00" }, { newer: true, edited: true })).toMatchObject({ start: flight.start });
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
  it("matches a journey moved by a schedule change: the same reference and service that day", () => {
    const ua = { ...flight, title: "UA122 EWR to LHR", start: "2026-04-11T09:10:00-04:00", confirmation: "B0ECXM", origin: { name: "New York/Newark", code: "EWR" }, destination: { name: "London", code: "LHR" } };
    const moved = { ...ua, title: "UA 122 EWR to LHR", start: "2026-04-11T09:20:00-04:00", origin: { name: "Newark", code: "EWR" } };
    expect(sameBooking(ua, moved)).toBe(true);
    // Another flight on the same booking, or the same flight days later, is not it.
    expect(sameBooking(ua, { ...moved, title: "UA 940 EWR to LHR" })).toBe(false);
    expect(sameBooking(ua, { ...moved, start: "2026-04-13T09:20:00-04:00" })).toBe(false);
    expect(sameBooking(ua, { ...moved, confirmation: undefined })).toBe(false);
    // Another leg of the same flight number is another journey.
    const gum = { ...ua, title: "UA 154 GUM to TKK", start: "2026-04-11T07:00:00+10:00", origin: { name: "Guam", code: "GUM" }, destination: { name: "Chuuk", code: "TKK" } };
    expect(sameBooking(gum, { ...gum, title: "UA 154 TKK to PNI", start: "2026-04-11T09:30:00+10:00", origin: { name: "Chuuk", code: "TKK" }, destination: { name: "Pohnpei", code: "PNI" } })).toBe(false);
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

// Two emails from one cinema about the same showing, under different
// references.
const booked: ExtractedSegment = {
  type: "activity" as const,
  title: "Wild Horse Nine at Muswell Hill",
  provider: "Everyman Cinemas",
  confirmation: "615858",
  start: "2026-11-08T12:00:00+00:00",
  destination: { name: "Everyman Muswell Hill", city: "London", country: "GB" },
  notes: "Screen 3, seats C8 and C7",
};
const reserved: ExtractedSegment = {
  type: "activity" as const,
  title: "Wild Horse Nine at Everyman Muswell Hill",
  provider: "Everyman",
  confirmation: "WQFXR5T",
  start: "2026-11-08T12:00:00+00:00",
  destination: { name: "Everyman", city: "London", country: "GB" },
};

describe("sameEvent", () => {
  it("matches one showing confirmed twice under different references", () => {
    expect(sameBooking(booked, reserved)).toBe(false);
    expect(sameEvent(booked, reserved)).toBe(true);
    expect(sameEvent({ ...booked, provider: undefined }, { ...reserved, provider: undefined }, "everymancinema.com", "everymancinema.com")).toBe(true);
  });

  it("keeps two films at the same cinema and time apart", () => {
    expect(sameEvent(booked, { ...reserved, title: "Toy Story 5 at Everyman Muswell Hill" })).toBe(false);
    expect(sameEvent(booked, { ...booked, title: "Toy Story 5 at Muswell Hill", confirmation: "615859" })).toBe(false);
    const four = { ...reserved, title: "Toy Story 4 at Everyman" };
    expect(sameEvent(four, { ...four, title: "Toy Story 5 at Everyman", confirmation: "XYZ" })).toBe(false);
    expect(sameEvent(four, { ...four, title: "Toy Story 4 (2D) at Everyman", confirmation: "XYZ" })).toBe(true);
    const muswell = { ...reserved, title: "Wild Horse Nine at Everyman Muswell Hill", destination: { name: "Everyman Muswell Hill", city: "London", country: "GB" } };
    const hampstead = { ...reserved, title: "Wild Horse Nine at Everyman Hampstead", confirmation: "XYZ", destination: { name: "Everyman Hampstead", city: "London", country: "GB" } };
    expect(sameEvent(muswell, hampstead)).toBe(false);
    expect(sameEvent(muswell, { ...hampstead, title: "Wild Horse Nine at Everyman", destination: { name: "Everyman", city: "London", country: "GB" } })).toBe(true);
    expect(sameEvent(muswell, { ...hampstead, title: "Wild Horse Nine", destination: { name: "Everyman Hampstead" } })).toBe(false);
    const out = { ...reserved, title: "Inside Out at Everyman" };
    expect(sameEvent(out, { ...out, title: "Inside Man at Everyman", confirmation: "XYZ" })).toBe(false);
    expect(sameEvent(out, { ...out, title: "The Inside Out at Everyman", confirmation: "XYZ" })).toBe(true);
  });

  it("needs the same time, type, seller and town", () => {
    expect(sameEvent(booked, { ...reserved, start: "2026-11-08T15:00:00+00:00" })).toBe(false);
    expect(sameEvent(booked, { ...reserved, type: "other" as const })).toBe(false);
    expect(sameEvent(booked, { ...reserved, provider: "Odeon" })).toBe(false);
    expect(sameEvent({ ...booked, provider: undefined }, { ...reserved, provider: undefined }, "everymancinema.com", "odeon.co.uk")).toBe(false);
    expect(sameEvent(booked, { ...reserved, destination: { name: "Everyman", city: "Leeds", country: "GB" } })).toBe(false);
  });
});

describe("mergeDetails", () => {
  it("keeps what either email said: seats, screen and the other reference", () => {
    const merged = mergeDetails(reserved, booked);
    expect(merged).toMatchObject({ title: reserved.title, confirmation: "WQFXR5T", provider: "Everyman" });
    expect(merged.notes).toBe("Screen 3, seats C8 and C7\nOther reference: 615858");
    expect(mergeDetails(booked, reserved).notes).toBe("Screen 3, seats C8 and C7\nOther reference: WQFXR5T");
  });

  it("fills only what is missing and adds nothing twice", () => {
    const bare: ExtractedSegment = { type: "activity", title: "Wild Horse Nine", start: booked.start };
    expect(mergeDetails(bare, booked)).toEqual({ ...bare, provider: "Everyman Cinemas", confirmation: "615858", destination: booked.destination, notes: booked.notes });
    expect(mergeDetails(booked, booked)).toEqual(booked);
    const twice = mergeDetails(mergeDetails(reserved, booked), booked);
    expect(twice.notes).toBe("Screen 3, seats C8 and C7\nOther reference: 615858");
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

describe("isUntimed", () => {
  it("is an activity at local midnight with no end", () => {
    expect(isUntimed({ type: "activity", start: "2026-05-26T00:00:00+01:00" })).toBe(true);
    expect(isUntimed({ type: "other", start: "2026-05-26T00:00:00+01:00" })).toBe(true);
  });

  it("is not a timed activity, one with an end, or a journey at midnight", () => {
    expect(isUntimed({ type: "activity", start: "2026-12-20T12:00:00+00:00" })).toBe(false);
    expect(isUntimed({ type: "activity", start: "2026-12-31T00:00:00+00:00", end: "2026-12-31T01:00:00+00:00" })).toBe(false);
    expect(isUntimed({ type: "flight", start: "2026-12-20T00:00:00+00:00" })).toBe(false);
  });
});

describe("notBookings", () => {
  const membership = { type: "activity" as const, title: "Family 2 Adults Membership", provider: "Palace Trust", start: "2026-10-28T00:00:00+00:00" };

  it("picks out memberships, passes and vouchers with no time of their own", () => {
    expect(notBookings([membership])).toEqual([membership]);
    for (const title of ["Annual Pass", "Season ticket", "Gift voucher", "Monthly subscription", "Donation"]) {
      expect(notBookings([{ ...membership, title }])).toHaveLength(1);
    }
  });

  it("keeps a timed ticket, and an untimed day out", () => {
    const ticket = { type: "activity" as const, title: "Hampton Court Palace admission", start: "2026-12-20T12:00:00+00:00" };
    const members = { ...ticket, title: "Members' evening", start: "2026-12-20T18:00:00+00:00" };
    const dayOut = { type: "activity" as const, title: "Zoo day tickets", start: "2026-08-01T00:00:00+01:00" };
    expect(notBookings([ticket, members, dayOut])).toEqual([]);
  });
});

describe("sameBooking with an untimed side", () => {
  const club = {
    type: "activity" as const,
    title: "Stage Stars! Holiday Club - Day 1",
    provider: "Example Academy of Performing Arts",
    start: "2026-05-26T09:00:00+01:00",
    end: "2026-05-26T15:00:00+01:00",
    confirmation: "BK-1001",
  };
  const receipt = {
    type: "activity" as const,
    title: "Stage Stars Holiday Club payment",
    provider: "Example Academy of Performing Arts",
    start: "2026-05-20T00:00:00+01:00",
  };

  it("matches a payment receipt to the booking it pays for, weeks apart", () => {
    expect(sameBooking(club, receipt)).toBe(true);
    expect(sameBooking(receipt, club)).toBe(true);
  });

  it("matches by reference when both have one", () => {
    expect(sameBooking(club, { ...receipt, title: "Payment received", confirmation: "bk 1001" })).toBe(true);
    expect(sameBooking(club, { ...receipt, confirmation: "BK-2002" })).toBe(false);
  });

  it("needs the same provider and a shared name", () => {
    expect(sameBooking(club, { ...receipt, provider: "Another Theatre School" })).toBe(false);
    expect(sameBooking(club, { ...receipt, provider: undefined })).toBe(false);
    expect(sameBooking(club, { ...receipt, title: "Ballet Term 3 payment" })).toBe(false);
  });

  it("matches a receipt dated the booking's day with no time", () => {
    expect(sameBooking(club, { ...receipt, start: "2026-05-26T00:00:00+01:00" })).toBe(true);
  });

  it("needs a word naming the thing paid for, not just the payment", () => {
    const ballet = { ...receipt, title: "Ballet payment" };
    expect(sameBooking(ballet, { ...receipt, title: "Swimming payment", start: "2026-05-27T00:00:00+01:00" })).toBe(false);
    expect(sameBooking(ballet, { ...receipt, title: "Ballet payment receipt", start: "2026-05-27T00:00:00+01:00" })).toBe(true);
  });

  it("never matches a receipt for another event, however close its name", () => {
    const film = { ...club, title: "Toy Story 4", provider: "Everyman", confirmation: undefined };
    const paid = { ...receipt, title: "Toy Story 5 payment", provider: "Everyman" };
    expect(sameBooking(film, paid)).toBe(false);
    expect(sameBooking({ ...film, title: "Toy Story 5" }, paid)).toBe(true);
  });

  it("never matches a receipt for another venue named only in its title", () => {
    const film = { ...club, title: "Toy Story 5 at Everyman Muswell Hill", provider: "Everyman", confirmation: undefined };
    const paid = { ...receipt, title: "Toy Story 5 payment at Everyman Hampstead", provider: "Everyman" };
    expect(sameBooking(film, paid)).toBe(false);
    expect(sameBooking(film, { ...paid, title: "Toy Story 5 payment at Everyman Muswell Hill" })).toBe(true);
  });

  it("never matches a receipt for another venue in the same town", () => {
    const film = {
      ...club,
      title: "Toy Story 5 at Everyman Muswell Hill",
      provider: "Everyman",
      destination: { name: "Everyman Muswell Hill", city: "London", country: "GB" },
    };
    const paid = { ...receipt, title: "Toy Story 5 payment", provider: "Everyman", destination: { name: "Everyman Hampstead", city: "London", country: "GB" } };
    expect(sameBooking(film, paid)).toBe(false);
    expect(sameBooking(film, { ...paid, destination: { name: "Everyman", city: "London", country: "GB" } })).toBe(true);
  });

  it("never matches a receipt for somewhere else", () => {
    const berlin = { ...club, title: "Madame Tussauds", provider: "Example Attractions", destination: { name: "Madame Tussauds", city: "Berlin", country: "DE" } };
    const londonPaid = { ...receipt, title: "Madame Tussauds payment", provider: "Example Attractions", destination: { name: "Madame Tussauds", city: "London", country: "GB" } };
    expect(sameBooking(berlin, londonPaid)).toBe(false);
    expect(sameBooking(berlin, { ...londonPaid, destination: { name: "Madame Tussauds", city: "Berlin", country: "DE" } })).toBe(true);
  });

  it("never merges two dated visits, whatever they share", () => {
    const day2 = { ...club, title: "Stage Stars! Holiday Club - Day 2", start: "2026-05-27T00:00:00+01:00", end: undefined };
    expect(sameBooking(club, day2)).toBe(false);
    expect(sameBooking(club, { ...day2, confirmation: "BK-1001" })).toBe(false);
    expect(sameBooking(club, { ...receipt, title: "Stage Stars Holiday Club - Day 2 payment" })).toBe(false);
  });

  it("does not reach more than a month", () => {
    expect(sameBooking(club, { ...receipt, start: "2026-03-01T00:00:00+00:00" })).toBe(false);
  });
});

describe("withoutValidityEnds", () => {
  // Invented, shaped like an airport train's open ticket: a departure, and
  // a date the ticket is valid until.
  const open = {
    type: "train" as const,
    title: "Airport express to the city",
    start: "2026-08-15T13:28:00+02:00",
    end: "2026-11-13T23:59:00+01:00",
  };

  it("drops a ticket's validity read as an arrival", () => {
    expect(withoutValidityEnds([open])[0]).not.toHaveProperty("end");
    expect(withoutValidityEnds([{ ...open, end: "2026-08-16T23:59:00+02:00" }])[0]).not.toHaveProperty("end");
  });

  it("keeps real arrivals, overnight and long ones too", () => {
    const sleeper = { ...open, end: "2026-08-16T07:45:00+02:00" };
    const sameDay = { ...open, end: "2026-08-15T23:59:00+02:00" };
    const stay = { type: "lodging" as const, title: "Cove", start: "2026-08-15T15:00:00+02:00", end: "2026-08-30T11:00:00+02:00" };
    expect(withoutValidityEnds([sleeper, sameDay, stay])).toEqual([sleeper, sameDay, stay]);
  });
});

describe("matchRank", () => {
  const paid = { type: "activity" as const, title: "Ballet payment", provider: "Example Dance", confirmation: "CLASS-21", start: "2026-12-14T00:00:00+00:00" };
  const sameDay = { ...paid, title: "Ballet class", confirmation: undefined, start: "2026-12-14T17:00:00+00:00" };
  const referenced = { ...sameDay, confirmation: "class 21", start: "2026-12-21T17:00:00+00:00" };
  const later = { ...sameDay, start: "2026-12-28T17:00:00+00:00" };

  it("puts the same reference first, then the same day, then the nearest", () => {
    const ranked = [later, sameDay, referenced].sort((a, b) => compareMatchRanks(matchRank(a, paid), matchRank(b, paid)));
    expect(ranked).toEqual([referenced, sameDay, later]);
  });

  it("breaks a tie between bookings with the reference by date", () => {
    const term = { ...paid, title: "Ballet class", confirmation: "TERM3" };
    const week1 = { ...term, start: "2026-12-14T17:00:00+00:00" };
    const week2 = { ...term, start: "2026-12-21T17:00:00+00:00" };
    const termPaid = { ...paid, confirmation: "TERM3" };
    const ranked = [week2, week1].sort((a, b) => compareMatchRanks(matchRank(a, termPaid), matchRank(b, termPaid)));
    expect(ranked).toEqual([week1, week2]);
  });
});

// One stay from two emails, a booking request and its confirmation
// (invented references): the request names the town, the confirmation the
// suburb, its address and the reference.
describe("a stay confirmed twice", () => {
  const listing = "Best balcony in St Kilda & Entire apartment.";
  const requested: ExtractedSegment = {
    type: "lodging",
    title: listing,
    provider: "Airbnb",
    start: "2025-12-26T15:00:00+11:00",
    end: "2025-12-27T10:00:00+11:00",
    destination: { name: listing, city: "Melbourne", country: "AU" },
  };
  const confirmed: ExtractedSegment = {
    ...requested,
    confirmation: "HMEXAMPLE01",
    destination: { name: listing, address: "1 Example Street, St Kilda VIC 3182, Australia", city: "St Kilda", country: "AU" },
  };

  it("is one booking: the same provider, listing and check-in and check-out, whatever town each names", () => {
    expect(sameBooking(requested, confirmed)).toBe(true);
    expect(sameBooking(confirmed, requested)).toBe(true);
    expect(sameBooking(requested, { ...confirmed, title: "best balcony in st kilda & entire apartment" })).toBe(true);
  });

  it("is two when anything else differs", () => {
    expect(sameBooking(requested, { ...confirmed, end: "2025-12-28T10:00:00+11:00" })).toBe(false);
    expect(sameBooking(requested, { ...confirmed, start: "2025-12-26T16:00:00+11:00" })).toBe(false);
    expect(sameBooking(requested, { ...confirmed, provider: "Booking.com" })).toBe(false);
    expect(sameBooking(requested, { ...confirmed, title: "Sunny studio by the beach" })).toBe(false);
    expect(sameBooking({ ...requested, confirmation: "HMEXAMPLE09" }, confirmed)).toBe(false);
    // Names told apart only by letters outside A to Z.
    const tokyo = { ...requested, title: "東京 Apartment 101", destination: { name: "東京 Apartment 101", city: "Tokyo", country: "JP" } };
    const osaka = { ...confirmed, title: "大阪 Apartment 101", destination: { name: "大阪 Apartment 101", city: "Osaka", country: "JP" } };
    expect(sameBooking(tokyo, osaka)).toBe(false);
    expect(sameBooking(tokyo, { ...osaka, title: "東京  apartment 101!" })).toBe(true);
    expect(sameBooking(tokyo, { ...osaka, title: "東京 Apartment 101", destination: { name: "東京 Apartment 101", city: "Tokyo", country: "KR" } })).toBe(false);
    expect(sameBooking({ ...requested, title: "Ｃａｆé Loft" }, { ...confirmed, title: "cafe loft" })).toBe(true);
  });

  it("keeps the reference and the more specific place, whichever came first", () => {
    expect(mergeDetails(requested, confirmed)).toEqual(confirmed);
    expect(mergeDetails(confirmed, requested)).toEqual(confirmed);
  });

  it("keeps what the place it replaces knew and the better one does not", () => {
    const located = { ...requested, destination: { ...requested.destination!, lat: -37.81, lon: 144.96, code: "EX1" } };
    const bare = { ...confirmed, destination: { name: listing, address: "1 Example Street, St Kilda VIC 3182, Australia", city: "St Kilda" } };
    expect(mergeDetails(requested, bare).destination).toEqual({ ...bare.destination, country: "AU" });
    expect(mergeDetails(located, bare).destination).toEqual({ ...bare.destination, country: "AU", code: "EX1", lat: -37.81, lon: 144.96 });
  });

  it("keeps a place the user edited", () => {
    expect(mergeDetails(requested, confirmed, { edited: true })).toEqual({ ...requested, confirmation: "HMEXAMPLE01" });
  });
});
