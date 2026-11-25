import { describe, expect, it } from "vitest";
import { flagsUnknown, hiddenFromList, localOnly, noListFilters, tripFlagsToWrite, tripTravelers, watchedTrip, watching } from "./listFilters";
import type { ExtractedSegment } from "./schema";

// Invented bookings: a show and a class in town, a hire car returned where
// it was picked up, a car to the airport, a flight and a stay.
const show: ExtractedSegment = { type: "activity", title: "Example Theatre", start: "2026-12-12T19:30:00+00:00", destination: { name: "Example Theatre", city: "London", country: "GB" } };
const dinner: ExtractedSegment = { type: "other", title: "Example Bistro", start: "2026-12-12T18:00:00+00:00", destination: { name: "Example Bistro", city: "London" } };
const hire: ExtractedSegment = { type: "car_rental", title: "Example Cars", start: "2026-12-13T09:00:00+00:00", origin: { name: "Example Cars Camden" }, destination: { name: "Example Cars Camden" } };
const transfer: ExtractedSegment = { type: "car_rental", title: "Example Cars", start: "2026-12-13T09:00:00+00:00", origin: { name: "Example Cars Camden" }, destination: { name: "Heathrow", code: "LHR" } };
const flight: ExtractedSegment = { type: "flight", title: "XX 1 LHR to DUB", start: "2026-12-13T09:00:00+00:00", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Dublin", code: "DUB" } };
const stay: ExtractedSegment = { type: "lodging", title: "Example Hotel", start: "2026-12-13T15:00:00+00:00", destination: { name: "Example Hotel", city: "Bath" } };
const cancelled = (s: ExtractedSegment) => ({ ...s, cancelledAt: "2026-11-01T00:00:00Z" });

describe("localOnly", () => {
  it("is a trip of shows, meals and a car returned where it was hired", () => {
    expect(localOnly([show, dinner, hire])).toBe(true);
  });

  it("isn't a trip with any journey, stay or ride to somewhere else", () => {
    expect(localOnly([show, flight])).toBe(false);
    expect(localOnly([show, stay])).toBe(false);
    expect(localOnly([show, transfer])).toBe(false);
  });

  it("goes by what is still booked, and isn't a trip with nothing booked", () => {
    expect(localOnly([show, cancelled(flight)])).toBe(true);
    expect(localOnly([cancelled(show)])).toBe(false);
    expect(localOnly([])).toBe(false);
  });
});

describe("hiddenFromList", () => {
  const trip = {};
  const off = { ...trip, cancelledAt: "2026-11-01T00:00:00Z" };

  it("hides nothing by default", () => {
    expect(hiddenFromList(off, [show], noListFilters)).toBe(false);
    expect(hiddenFromList(trip, [cancelled(flight)], noListFilters)).toBe(false);
  });

  it("hides a trip cancelled by its owner before its bookings are read, and one whose every booking was cancelled", () => {
    const filters = { ...noListFilters, hideCancelled: true };
    expect(hiddenFromList(off, undefined, filters)).toBe(true);
    expect(hiddenFromList(trip, [cancelled(flight)], filters)).toBe(true);
    expect(hiddenFromList(trip, [cancelled(flight), stay], filters)).toBe(false);
    expect(hiddenFromList(trip, undefined, filters)).toBe(false);
    expect(hiddenFromList(trip, [], filters)).toBe(false);
  });

  it("hides local events once the bookings are read", () => {
    const filters = { ...noListFilters, hideLocal: true };
    expect(hiddenFromList(trip, [show, dinner], filters)).toBe(true);
    expect(hiddenFromList(trip, undefined, filters)).toBe(false);
    expect(hiddenFromList(trip, [show, flight], filters)).toBe(false);
    // A cancelled night out is cancelled, not local.
    expect(hiddenFromList(trip, [cancelled(show)], filters)).toBe(false);
  });

  it("goes by the trip's own flags without its bookings, as far as they say", () => {
    const both = { ...noListFilters, hideCancelled: true, hideLocal: true };
    expect(hiddenFromList({ allCancelled: true, localOnly: false }, undefined, both)).toBe(true);
    expect(hiddenFromList({ allCancelled: false, localOnly: true }, undefined, both)).toBe(true);
    expect(hiddenFromList({ allCancelled: false, localOnly: false }, undefined, both)).toBe(false);
  });
});

describe("the trip's flags", () => {
  it("are unknown until both are kept, and written only when the bookings disagree", () => {
    expect(flagsUnknown({})).toBe(true);
    expect(flagsUnknown({ allCancelled: false })).toBe(true);
    expect(flagsUnknown({ allCancelled: false, localOnly: false })).toBe(true);
    expect(flagsUnknown({ allCancelled: false, localOnly: false, travelers: [] })).toBe(false);
    expect(tripFlagsToWrite({}, [show])).toEqual({ allCancelled: false, localOnly: true, travelers: [] });
    expect(tripFlagsToWrite({ allCancelled: false, localOnly: true, travelers: [] }, [show])).toBeUndefined();
    expect(tripFlagsToWrite({ allCancelled: false, localOnly: true, travelers: [] }, [cancelled(show)])).toEqual({ allCancelled: true, localOnly: false, travelers: [] });
    expect(tripFlagsToWrite({ allCancelled: false, localOnly: true, travelers: [] }, [{ ...show, travelers: ["Sam Example"] }])).toEqual({ allCancelled: false, localOnly: true, travelers: ["Sam Example"] });
  });
});

// Invented people: the user, who bookings sent straight to them name most,
// and their mum.
const sam = { id: "sam", name: "Sam Example", aliases: ["EXAMPLE/SAM MR"], bookings: 5, direct: 5 };
const pat = { id: "pat", name: "Pat Example", aliases: [], bookings: 2, direct: 0 };

describe("tripTravelers", () => {
  it("is everyone the trip's bookings name, each once, going by what is still booked", () => {
    expect(tripTravelers([{ ...flight, travelers: ["Sam Example", "Pat Example"] }, { ...stay, travelers: ["EXAMPLE/SAM MR"] }])).toEqual(["Sam Example", "Pat Example"]);
    // Each spelling once, but two that may be two people both kept: the user's people tell them apart.
    expect(tripTravelers([{ ...flight, travelers: ["John Smith"] }, { ...stay, travelers: ["J Smith"] }])).toEqual(["John Smith", "J Smith"]);
    const people = [{ id: "me", name: "J Smith", aliases: ["Jane Smith"], bookings: 3, direct: 3 }, { id: "john", name: "John Smith", aliases: [], bookings: 1, direct: 0 }];
    expect(watching(tripTravelers([{ ...flight, travelers: ["John Smith"] }, { ...stay, travelers: ["J Smith"] }]), people)).toBe(false);
    expect(tripTravelers([cancelled({ ...flight, travelers: ["Pat Example"] }), { ...stay, travelers: ["Sam Example"] }])).toEqual(["Sam Example"]);
    expect(tripTravelers([cancelled({ ...flight, travelers: ["Pat Example"] })])).toEqual(["Pat Example"]);
    expect(tripTravelers([flight])).toEqual([]);
  });

  it("keeps a group's hundred, and more than that as none, never dropping the user's name for want of room", () => {
    const group = (n: number) => Array.from({ length: n }, (_, i) => `Person${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} Example`);
    expect(tripTravelers([{ ...flight, travelers: group(20) }, { ...stay, travelers: ["Sam Example"] }])).toHaveLength(21);
    expect(tripTravelers([{ ...flight, travelers: group(20) }, { ...stay, travelers: ["Sam Example"] }])).toContain("Sam Example");
    expect(tripTravelers([{ ...flight, travelers: group(100) }, { ...stay, travelers: ["Sam Example"] }])).toEqual([]);
    expect(watching(tripTravelers([{ ...flight, travelers: group(100) }, { ...stay, travelers: ["Sam Example"] }]), [sam, pat])).toBe(false);
  });
});

describe("watching", () => {
  it("is a trip whose bookings name travelers, none of them the user", () => {
    expect(watching(["Pat Example"], [sam, pat])).toBe(true);
    expect(watching(["Pat Example", "SAM EXAMPLE"], [sam, pat])).toBe(false);
    expect(watching(["Alex Other"], [sam, pat])).toBe(true);
  });

  it("isn't, while who the user is is unknown or the bookings name no one", () => {
    expect(watching(["Pat Example"], [])).toBe(false);
    expect(watching([], [sam, pat])).toBe(false);
    expect(watching(undefined, [sam, pat])).toBe(false);
  });

  it("follows whom the user said is them", () => {
    expect(watching(["Pat Example"], [sam, { ...pat, me: true }])).toBe(false);
    expect(watching(["Sam Example"], [sam, { ...pat, me: true }])).toBe(true);
  });

  it("hides a trip the user is only watching, by its flag or its bookings", () => {
    const filters = { ...noListFilters, hideWatching: true };
    expect(hiddenFromList({ travelers: ["Pat Example"] }, undefined, filters, [sam, pat])).toBe(true);
    expect(hiddenFromList({ travelers: ["Pat Example"] }, undefined, noListFilters, [sam, pat])).toBe(false);
    expect(hiddenFromList({}, [{ ...flight, travelers: ["Pat Example"] }], filters, [sam, pat])).toBe(true);
    expect(hiddenFromList({}, [{ ...flight, travelers: ["Sam Example"] }], filters, [sam, pat])).toBe(false);
    expect(hiddenFromList({}, undefined, filters, [sam, pat])).toBe(false);
  });
});

describe("watchedTrip", () => {
  it("goes by the trip's bookings once read, else by what the trip keeps", () => {
    expect(watchedTrip({ travelers: ["Sam Example"] }, [{ ...flight, travelers: ["Pat Example"] }], [sam, pat])).toBe(true);
    expect(watchedTrip({ travelers: ["Pat Example"] }, undefined, [sam, pat])).toBe(true);
    expect(watchedTrip({ travelers: ["Pat Example"] }, [{ ...flight, travelers: ["Sam Example"] }], [sam, pat])).toBe(false);
    expect(watchedTrip({}, undefined, [sam, pat])).toBe(false);
  });
});
