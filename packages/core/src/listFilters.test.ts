import { describe, expect, it } from "vitest";
import { hiddenFromList, localOnly, noListFilters } from "./listFilters";
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
    const filters = { hideCancelled: true, hideLocal: false };
    expect(hiddenFromList(off, undefined, filters)).toBe(true);
    expect(hiddenFromList(trip, [cancelled(flight)], filters)).toBe(true);
    expect(hiddenFromList(trip, [cancelled(flight), stay], filters)).toBe(false);
    expect(hiddenFromList(trip, undefined, filters)).toBe(false);
    expect(hiddenFromList(trip, [], filters)).toBe(false);
  });

  it("hides local events once the bookings are read", () => {
    const filters = { hideCancelled: false, hideLocal: true };
    expect(hiddenFromList(trip, [show, dinner], filters)).toBe(true);
    expect(hiddenFromList(trip, undefined, filters)).toBe(false);
    expect(hiddenFromList(trip, [show, flight], filters)).toBe(false);
    // A cancelled night out is cancelled, not local.
    expect(hiddenFromList(trip, [cancelled(show)], filters)).toBe(false);
  });
});
