import { describe, expect, it } from "vitest";
import { FlightStatus, flightDeparted, flightNextStep } from "./flightStatus";
import { nextUpFlightKeys, tripNextUp } from "./nextUp";

// An invented flight: leaves London at 17:20 (17:20Z), lands in Boston at
// 20:30 (01:30Z the next day); a stay in Boston after it.
const flight = {
  type: "flight" as const,
  title: "VS 11 LHR to BOS",
  start: "2026-11-24T17:20:00+00:00",
  end: "2026-11-24T20:30:00-05:00",
  origin: { name: "London Heathrow", code: "LHR" },
  destination: { name: "Boston Logan", code: "BOS" },
};
const stay = { type: "lodging" as const, title: "Harbor Hotel", start: "2026-11-25T15:00:00-05:00", end: "2026-11-28T11:00:00-05:00" };
const key = "VS11_2026-11-24_LHR";

const status = (fields: Partial<FlightStatus> = {}): FlightStatus =>
  FlightStatus.parse({
    ident: "VS11",
    date: "2026-11-24",
    origin: "LHR",
    found: true,
    scheduledOut: "2026-11-24T17:20:00Z",
    scheduledIn: "2026-11-25T01:30:00Z",
    checkedAt: "2026-11-24T15:00:00Z",
    ...fields,
  });

const before = "2026-11-24T15:19:00Z";
const after = "2026-11-24T19:20:00Z";

describe("tripNextUp", () => {
  it("names the booking then says what happens and how soon, then when as booked", () => {
    expect(tripNextUp([flight, stay], before)).toEqual({ segment: flight, title: "VS 11 LHR to BOS", when: "Departs in 2 h 1 min · Tue 24 Nov 17:20" });
    expect(tripNextUp([stay], "2026-11-25T17:00:00Z")).toMatchObject({ title: "Harbor Hotel", when: "Check-in in 3 h · Wed 25 Nov 15:00" });
  });

  it("gives only the date and time beyond a week", () => {
    expect(tripNextUp([flight], "2026-11-10T12:00:00Z")?.when).toBe("Departs Tue 24 Nov 17:20");
    // A weekday is in the date already.
    expect(tripNextUp([flight], "2026-11-21T12:00:00Z")?.when).toBe("Departs Tue 24 Nov 17:20");
    expect(tripNextUp([flight], "2026-11-23T12:00:00Z")?.when).toBe("Departs tomorrow · Tue 24 Nov 17:20");
  });

  it("says nothing once everything has happened", () => {
    expect(tripNextUp([flight], "2026-11-26T00:00:00Z")).toBeUndefined();
  });

  it("gives a flight's departure terminal and gate before takeoff, whatever is known", () => {
    expect(tripNextUp([flight], before, { [key]: status({ departureTerminal: "3", departureGate: "12" }) })?.step).toBe("Terminal 3 · Gate 12");
    expect(tripNextUp([flight], before, { [key]: status({ departureTerminal: "3" }) })?.step).toBe("Terminal 3");
    expect(tripNextUp([flight], before, { [key]: status({ departureGate: "12" }) })?.step).toBe("Gate 12");
    // Nothing known, no line; and none before takeoff about the arrival.
    expect(tripNextUp([flight], before, { [key]: status({ arrivalTerminal: "E", baggageClaim: "7" }) })).not.toHaveProperty("step");
    expect(tripNextUp([flight], before, { [key]: status({ found: false, departureGate: "12" }) })).not.toHaveProperty("step");
  });

  it("gives a delay before takeoff in place of the gate, and counts down to the new time", () => {
    const late = status({ estimatedOut: "2026-11-24T17:55:00Z", departureGate: "12" });
    expect(tripNextUp([flight], before, { [key]: late })).toMatchObject({
      when: "Departs in 2 h 36 min · Tue 24 Nov 17:20",
      step: "Leaves 35 min late, at 17:55",
    });
    // Still the departure while it is late leaving, though its booked time has passed.
    expect(tripNextUp([flight], "2026-11-24T17:40:00Z", { [key]: late })).toMatchObject({ when: "Departs in 15 min · Tue 24 Nov 17:20" });
  });

  it("moves to the arrival after takeoff with the arrival terminal and gate and the carousel", () => {
    const flying = status({ actualOut: "2026-11-24T17:30:00Z", estimatedIn: "2026-11-25T01:30:00Z", departureGate: "12", arrivalTerminal: "E", baggageClaim: "7" });
    expect(tripNextUp([flight], after, { [key]: flying })).toMatchObject({ when: "Arrives in 6 h 10 min · Tue 24 Nov 20:30", step: "Terminal E · Bags on carousel 7" });
    // Taken off early by the service's word, before the booked time.
    expect(tripNextUp([flight], "2026-11-24T17:10:00Z", { [key]: status({ actualOut: "2026-11-24T17:05:00Z", arrivalGate: "B5" }) })).toMatchObject({
      when: "Arrives in 8 h 20 min · Tue 24 Nov 20:30",
      step: "Gate B5",
    });
    // The expected time passed with no word: taken off.
    expect(tripNextUp([flight], "2026-11-24T17:21:00Z", { [key]: status({ departureGate: "12" }) })).not.toHaveProperty("step");
  });

  it("keeps a late flight on the card past its booked arrival, by the service's times", () => {
    const now = "2026-11-25T02:00:00Z";
    // Took off three hours late; due in at 04:30Z, booked for 01:30Z.
    const flying = status({ actualOut: "2026-11-24T20:25:00Z", estimatedIn: "2026-11-25T04:30:00Z", baggageClaim: "7" });
    expect(tripNextUp([flight, stay], now, { [key]: flying })).toMatchObject({ segment: flight, when: "Arrives in 2 h 30 min · Tue 24 Nov 20:30", step: "Bags on carousel 7" });
    // Not left yet: still the departure, with the delay.
    const waiting = status({ estimatedOut: "2026-11-25T03:00:00Z", estimatedIn: "2026-11-25T11:10:00Z", departureGate: "12" });
    expect(tripNextUp([flight, stay], now, { [key]: waiting })).toMatchObject({ segment: flight, when: "Departs in 1 h · Tue 24 Nov 17:20" });
    // Landed, or no word of it: the stay is next.
    expect(tripNextUp([flight, stay], now, { [key]: status({ actualOut: "2026-11-24T17:25:00Z", actualIn: "2026-11-25T01:20:00Z" }) })?.segment).toBe(stay);
    expect(tripNextUp([flight, stay], now)?.segment).toBe(stay);
  });

  it("says a flight is cancelled or diverted", () => {
    expect(tripNextUp([flight], before, { [key]: status({ cancelled: true }) })?.step).toBe("Flight cancelled");
    expect(tripNextUp([flight], after, { [key]: status({ actualOut: "2026-11-24T17:30:00Z", diverted: true, divertedTo: "JFK", baggageClaim: "7" }) })?.step).toBe("Diverted to JFK");
  });
});

describe("nextUpFlightKeys", () => {
  it("names the next event's flight while its status is shown", () => {
    expect(nextUpFlightKeys([flight, stay], before)).toEqual([key]);
    expect(nextUpFlightKeys([flight, stay], after)).toEqual([key]);
    expect(nextUpFlightKeys([flight, stay], "2026-11-20T00:00:00Z")).toEqual([]);
    expect(nextUpFlightKeys([stay], before)).toEqual([]);
  });

  it("keeps reading a flight booked to have landed while it may still be late", () => {
    expect(nextUpFlightKeys([flight, stay], "2026-11-25T02:00:00Z")).toEqual([key]);
  });
});
