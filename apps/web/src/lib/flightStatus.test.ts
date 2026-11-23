import type { FlightStatus, Segment } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { flightLinesFor, shownFlightKeys } from "./flightStatus";

// Invented bookings: a flight leaving Sydney at 09:00 local (22:00Z the day
// before), the same flight on someone else's booking, and a stay.
const at = "2026-11-01T00:00:00Z";
const booking = (id: string, over: Partial<Segment> = {}): Segment => ({
  id,
  tripId: "t1",
  type: "flight",
  title: "XX 100 SYD to SIN",
  start: "2026-12-13T09:00:00+11:00",
  origin: { name: "Sydney", code: "SYD" },
  source: "manual",
  gmailMessageIds: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});
const flight = booking("f1");
const stay = booking("h1", { type: "lodging", title: "Hotel 100", origin: undefined });
const status: FlightStatus = { ident: "XX100", date: "2026-12-13", origin: "SYD", found: true, departureGate: "8", baggageClaim: "16", checkedAt: "2026-12-12T21:00:00Z" };

describe("shownFlightKeys", () => {
  it("names each flight near departure once", () => {
    expect(shownFlightKeys([flight, booking("f2"), stay], "2026-12-12T21:00:00Z")).toEqual(["XX100_2026-12-13_SYD"]);
    expect(shownFlightKeys([flight], "2026-12-10T21:00:00Z")).toEqual([]);
    expect(shownFlightKeys(undefined, "2026-12-12T21:00:00Z")).toEqual([]);
  });
});

describe("flightLinesFor", () => {
  it("gives a flight's gates and carousel while they are shown", () => {
    const statuses = { "XX100_2026-12-13_SYD": status };
    expect(flightLinesFor(flight, statuses, "2026-12-12T21:00:00Z")).toEqual(["Departs from gate 8", "Bags on carousel 16"]);
    expect(flightLinesFor(flight, statuses, "2026-12-15T21:00:00Z")).toBeUndefined();
    expect(flightLinesFor(flight, {}, "2026-12-12T21:00:00Z")).toBeUndefined();
    expect(flightLinesFor(stay, statuses, "2026-12-12T21:00:00Z")).toBeUndefined();
  });
});
