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
// A car at Boston booked for the scheduled landing, before the booked arrival.
const car = { type: "car_rental" as const, title: "Hertz at Boston Logan", start: "2026-11-24T20:15:00-05:00", end: "2026-11-28T10:00:00-05:00" };
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
    // Landed an hour ago, or no word of it: the stay is next.
    expect(tripNextUp([flight, stay], now, { [key]: status({ actualOut: "2026-11-24T17:25:00Z", actualIn: "2026-11-25T01:00:00Z" }) })?.segment).toBe(stay);
    expect(tripNextUp([flight, stay], now)?.segment).toBe(stay);
  });

  it("stays on a flight in the air past anything booked before it lands", () => {
    // 01:00Z is 20:00 in Boston: the car's 20:15 comes before the 20:30 landing.
    const flying = status({ actualOut: "2026-11-24T17:30:00Z", estimatedIn: "2026-11-25T01:40:00Z", arrivalGate: "B5" });
    expect(tripNextUp([flight, car, stay], "2026-11-25T01:00:00Z", { [key]: flying })).toMatchObject({ segment: flight, when: "Arrives in 40 min · Tue 24 Nov 20:30", step: "Gate B5" });
    // With no live status, by the booking.
    expect(tripNextUp([flight, car, stay], "2026-11-25T01:00:00Z")).toMatchObject({ segment: flight, when: "Arrives in 30 min · Tue 24 Nov 20:30" });
  });

  it("stays on a landed flight for an hour with its gate and carousel, then what was booked during the flight", () => {
    const down = status({ actualOut: "2026-11-24T17:30:00Z", actualIn: "2026-11-25T01:40:00Z", arrivalTerminal: "E", arrivalGate: "B5", baggageClaim: "7" });
    expect(tripNextUp([flight, car, stay], "2026-11-25T01:52:00Z", { [key]: down })).toEqual({
      segment: flight,
      title: "VS 11 LHR to BOS",
      when: "Landed 12 min ago · Tue 24 Nov 20:30",
      step: "Terminal E · Gate B5 · Bags on carousel 7",
      then: "Then Hertz at Boston Logan · Pick up Tue 24 Nov 20:15",
    });
    // An hour on, the next booking.
    expect(tripNextUp([flight, car, stay], "2026-11-25T02:41:00Z", { [key]: down })).toEqual({ segment: stay, title: "Harbor Hotel", when: "Check-in in 17 h 19 min · Wed 25 Nov 15:00" });
    // Booked to land, no word of it: the car from the scheduled landing.
    expect(tripNextUp([flight, car, stay], "2026-11-25T01:31:00Z")).toEqual({ segment: car, title: "Hertz at Boston Logan", when: "Pick up Tue 24 Nov 20:15" });
  });

  it("gives the next booking after a landed flight, or nothing when it was the last", () => {
    const down = status({ actualOut: "2026-11-24T17:30:00Z", actualIn: "2026-11-25T01:40:00Z", arrivalGate: "B5", baggageClaim: "7" });
    expect(tripNextUp([flight, stay], "2026-11-25T01:52:00Z", { [key]: down })).toMatchObject({
      segment: flight,
      step: "Gate B5 · Bags on carousel 7",
      then: "Then Harbor Hotel · Check-in in 18 h 8 min · Wed 25 Nov 15:00",
    });
    expect(tripNextUp([flight], "2026-11-25T01:52:00Z", { [key]: down })).toEqual({
      segment: flight,
      title: "VS 11 LHR to BOS",
      when: "Landed 12 min ago · Tue 24 Nov 20:30",
      step: "Gate B5 · Bags on carousel 7",
    });
    expect(tripNextUp([flight], "2026-11-25T02:41:00Z", { [key]: down })).toBeUndefined();
  });

  it("gives the arrival gate and a connection's departure gate after landing", () => {
    const onward = { type: "flight" as const, title: "B6 1 BOS to JFK", start: "2026-11-24T21:30:00-05:00", end: "2026-11-24T22:45:00-05:00", origin: { name: "Boston Logan", code: "BOS" }, destination: { name: "New York JFK", code: "JFK" } };
    const onwardKey = "B61_2026-11-24_BOS";
    const down = status({ actualOut: "2026-11-24T17:30:00Z", actualIn: "2026-11-25T01:40:00Z", arrivalGate: "B5" });
    const boarding = status({ ident: "B61", origin: "BOS", scheduledOut: "2026-11-25T02:30:00Z", scheduledIn: "2026-11-25T03:45:00Z", departureGate: "C22" });
    expect(tripNextUp([flight, onward], "2026-11-25T01:52:00Z", { [key]: down, [onwardKey]: boarding })).toMatchObject({
      segment: flight,
      step: "Gate B5",
      then: "Then B6 1 BOS to JFK · Departs in 38 min · Tue 24 Nov 21:30 · Gate C22",
    });
  });

  it("holds a flight with no arrival time no longer than its departure", () => {
    const { end: _end, ...open } = flight;
    expect(tripNextUp([open, stay], "2026-11-24T18:00:00Z")?.segment).toBe(stay);
  });

  it("leaves a cancelled booking out of what comes after a landing", () => {
    const down = status({ actualOut: "2026-11-24T17:30:00Z", actualIn: "2026-11-25T01:40:00Z", baggageClaim: "7" });
    const cancelled = { ...car, cancelledAt: "2026-11-20T10:00:00Z" };
    expect(tripNextUp([flight, cancelled, stay], "2026-11-25T01:52:00Z", { [key]: down })?.then).toBe("Then Harbor Hotel · Check-in in 18 h 8 min · Wed 25 Nov 15:00");
    expect(tripNextUp([flight, cancelled, stay], "2026-11-25T01:31:00Z")?.segment).toBe(stay);
  });

  it("never names a flight landed early as what follows it", () => {
    const early = status({ actualOut: "2026-11-24T17:10:00Z", actualIn: "2026-11-25T01:10:00Z", baggageClaim: "7" });
    expect(tripNextUp([flight], "2026-11-25T01:20:00Z", { [key]: early })).toEqual({
      segment: flight,
      title: "VS 11 LHR to BOS",
      when: "Landed 10 min ago · Tue 24 Nov 20:30",
      step: "Bags on carousel 7",
    });
  });

  it("puts a pick-up booked for the very landing after it", () => {
    const atLanding = { ...car, start: "2026-11-24T20:30:00-05:00" };
    const down = status({ actualOut: "2026-11-24T17:20:00Z", actualIn: "2026-11-25T01:30:00Z", baggageClaim: "7" });
    expect(tripNextUp([flight, atLanding, stay], "2026-11-25T01:40:00Z", { [key]: down })?.then).toBe("Then Hertz at Boston Logan · Pick up Tue 24 Nov 20:30");
    expect(tripNextUp([flight, atLanding, stay], "2026-11-25T01:40:00Z")?.segment).toBe(atLanding);
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

  it("reads a connection while an early landing is on the card", () => {
    const onward = { type: "flight" as const, title: "B6 1 BOS to JFK", start: "2026-11-24T21:30:00-05:00", end: "2026-11-24T22:45:00-05:00", origin: { name: "Boston Logan", code: "BOS" }, destination: { name: "New York JFK", code: "JFK" } };
    // 01:20Z: landed early, the booked 01:30Z arrival still to come.
    expect(nextUpFlightKeys([flight, onward], "2026-11-25T01:20:00Z")).toEqual([key, "B61_2026-11-24_BOS"]);
  });

  it("reads a flight in the air when something else is booked before it lands", () => {
    expect(nextUpFlightKeys([flight, car, stay], "2026-11-25T01:00:00Z")).toEqual([key]);
  });
});
