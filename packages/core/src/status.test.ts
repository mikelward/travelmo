import { describe, expect, it } from "vitest";
import { currentStay, flightCheckIn, localDateAt, relativeTime, shiftInstant, tripStatus } from "./status";

// Invented bookings: a stay in Liverpool and a flight out, in their own offsets.
const stay = { type: "lodging" as const, title: "Cove Liverpool", start: "2026-12-12T15:00:00+00:00", end: "2026-12-14T11:00:00+00:00" };
const flight = { type: "flight" as const, title: "XX 100 MAN to DXB", start: "2026-12-13T09:00:00+05:00", end: "2026-12-13T19:00:00+04:00", confirmation: "XX1234" };
const later = { type: "flight" as const, title: "XX 101 DXB to MAN", start: "2026-12-20T09:00:00+04:00" };

describe("relativeTime", () => {
  it("counts minutes, then hours, then days in the place's own calendar, up to a week", () => {
    expect(relativeTime("2026-12-13T03:35:00Z", flight.start)).toBe("in 25 min");
    expect(relativeTime("2026-12-13T00:40:00Z", flight.start)).toBe("in 3 h 20 min");
    expect(relativeTime("2026-12-13T01:00:00Z", flight.start)).toBe("in 3 h");
    expect(relativeTime("2026-12-12T20:00:20Z", flight.start)).toBe("in 8 h");
    expect(relativeTime("2026-12-13T03:00:40Z", flight.start)).toBe("in 59 min");
    // 04:00Z on the 13th is 09:00 on the 13th in Dubai: 20:00Z on the 11th
    // is already the 12th there, so "tomorrow"; 16:00Z is still the 11th.
    expect(relativeTime("2026-12-11T20:00:00Z", flight.start)).toBe("tomorrow");
    expect(relativeTime("2026-12-11T16:00:00Z", flight.start)).toBe("on Sun");
    expect(relativeTime("2026-12-08T12:00:00Z", flight.start)).toBe("on Sun");
    expect(relativeTime("2026-12-01T12:00:00Z", flight.start)).toBeUndefined();
    expect(relativeTime("2026-12-13T05:00:00Z", flight.start)).toBeUndefined();
  });

  it("reads the calendar in the instant's offset", () => {
    expect(localDateAt("2026-12-12T22:00:00Z", "+05:00")).toBe("2026-12-13");
    expect(localDateAt("2026-12-13T03:00:00Z", "-05:00")).toBe("2026-12-12");
    expect(shiftInstant(flight.start, -24 * 60 * 60_000)).toBe("2026-12-12T09:00:00+05:00");
    expect(shiftInstant("2026-12-13T00:30:00-05:00", 60 * 60_000)).toBe("2026-12-13T01:30:00-05:00");
  });
});

describe("flightCheckIn", () => {
  it("names the next flight's window from a day before it opens, open once it has", () => {
    expect(flightCheckIn([stay, flight, later], "2026-12-11T03:00:00Z")).toBeUndefined();
    expect(flightCheckIn([stay, flight, later], "2026-12-11T05:00:00Z")).toEqual({ segment: flight, opensAt: "2026-12-12T09:00:00+05:00", open: false });
    expect(flightCheckIn([stay, flight, later], "2026-12-12T20:00:00Z")).toEqual({ segment: flight, opensAt: "2026-12-12T09:00:00+05:00", open: true });
    // Departed: the next flight's window is what counts, a week off.
    expect(flightCheckIn([stay, flight, later], "2026-12-13T05:00:00Z")).toBeUndefined();
    expect(flightCheckIn([stay], "2026-12-12T20:00:00Z")).toBeUndefined();
  });
});

describe("tripStatus", () => {
  it("knows the stay under way, the next event and the check-in together", () => {
    expect(currentStay([stay, flight], "2026-12-12T14:00:00Z")).toBeUndefined();
    expect(currentStay([stay, flight], "2026-12-12T20:00:00Z")).toBe(stay);
    expect(currentStay([stay, flight], "2026-12-14T11:00:00Z")).toBeUndefined();
    const status = tripStatus([stay, flight, later], "2026-12-12T20:00:00Z");
    expect(status.stay).toBe(stay);
    expect(status.next).toMatchObject({ segment: flight, kind: "start" });
    expect(status.checkIn).toMatchObject({ segment: flight, open: true });
    expect(tripStatus([], "2026-12-12T20:00:00Z")).toEqual({});
  });
});
