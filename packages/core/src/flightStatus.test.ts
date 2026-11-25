import { describe, expect, it } from "vitest";
import {
  flightCheckDue,
  flightCheckInterval,
  flightDesignator,
  flightNextStep,
  flightRefreshDue,
  flightStatusLines,
  flightStatusNews,
  FlightStatus,
  flightStatusKey,
  flightStatusShown,
  keepKnownPlaces,
  noticeDeparture,
} from "./flightStatus";

// An invented flight: leaves at 09:00 in Sydney (22:00Z the day before),
// lands at 15:30 in Singapore (07:30Z).
const flight = { type: "flight" as const, title: "XX 100 SYD to SIN", start: "2026-12-13T09:00:00+11:00", end: "2026-12-13T15:30:00+08:00" };

const status = (fields: Partial<FlightStatus> = {}): FlightStatus =>
  FlightStatus.parse({
    ident: "XX100",
    date: "2026-12-13",
    origin: "SYD",
    found: true,
    scheduledOut: "2026-12-12T22:00:00Z",
    scheduledIn: "2026-12-13T07:30:00Z",
    checkedAt: "2026-12-12T19:00:00Z",
    ...fields,
  });

const min = 60_000;

describe("flightDesignator", () => {
  it("reads the airline code and number from a flight's title", () => {
    expect(flightDesignator(flight)).toBe("XX100");
    expect(flightDesignator({ type: "flight", title: "QF1 SYD to SIN" })).toBe("QF1");
    expect(flightDesignator({ type: "flight", title: "BA 0117 LHR to JFK" })).toBe("BA117");
    expect(flightDesignator({ type: "flight", title: "Flight 9W 7 to BOM" })).toBe("9W7");
  });

  it("finds nothing without a flight number or for anything but a flight", () => {
    expect(flightDesignator({ type: "flight", title: "Flight LHR to JFK" })).toBeUndefined();
    expect(flightDesignator({ type: "flight", title: "Flight" })).toBeUndefined();
    expect(flightDesignator({ type: "train", title: "ES 9014 London to Paris" })).toBeUndefined();
  });
});

describe("flightStatusKey", () => {
  it("names the flight by number, local date of departure and airport", () => {
    expect(flightStatusKey({ ...flight, origin: { name: "Sydney", code: "syd" } })).toBe("XX100_2026-12-13_SYD");
    expect(flightStatusKey(flight)).toBe("XX100_2026-12-13");
    expect(flightStatusKey({ ...flight, title: "Flight to SIN" })).toBeUndefined();
  });
});

describe("flightCheckInterval", () => {
  it("is not watched until two hours before departure", () => {
    expect(flightCheckInterval(flight, undefined, "2026-12-12T19:59:00Z")).toBeUndefined();
    expect(flightCheckInterval(flight, undefined, "2026-12-12T20:00:00Z")).toBe(min);
  });

  it("looks every minute before departure, every quarter hour in the air, every minute around landing", () => {
    expect(flightCheckInterval(flight, status(), "2026-12-12T21:59:00Z")).toBe(min);
    const departed = status({ actualOut: "2026-12-12T22:05:00Z" });
    expect(flightCheckInterval(flight, departed, "2026-12-13T02:00:00Z")).toBe(15 * min);
    expect(flightCheckInterval(flight, departed, "2026-12-13T07:00:00Z")).toBe(min);
    expect(flightCheckInterval(flight, departed, "2026-12-13T08:14:00Z")).toBe(min);
    expect(flightCheckInterval(flight, departed, "2026-12-13T08:15:00Z")).toBeUndefined();
  });

  it("follows the service's estimates and actual landing", () => {
    // Delayed two hours: still before the fast window of the new time.
    const late = status({ estimatedOut: "2026-12-13T00:00:00Z", estimatedIn: "2026-12-13T09:30:00Z" });
    expect(flightCheckInterval(flight, late, "2026-12-12T21:00:00Z")).toBeUndefined();
    expect(flightCheckInterval(flight, late, "2026-12-12T23:00:00Z")).toBe(min);
    expect(flightCheckInterval(flight, late, "2026-12-13T09:45:00Z")).toBe(min);
    // Landed early: done 45 minutes after it did.
    const early = status({ actualOut: "2026-12-12T22:00:00Z", actualIn: "2026-12-13T07:00:00Z" });
    expect(flightCheckInterval(flight, early, "2026-12-13T07:46:00Z")).toBeUndefined();
  });

  it("keeps a quarter-hourly eye on a flight still at the gate half an hour late", () => {
    expect(flightCheckInterval(flight, status(), "2026-12-12T22:31:00Z")).toBe(15 * min);
  });

  it("stops for a cancelled flight, an unknown one an hour after departure, and anything long past", () => {
    expect(flightCheckInterval(flight, status({ cancelled: true }), "2026-12-12T21:00:00Z")).toBeUndefined();
    const unknown = status({ found: false, scheduledOut: undefined, scheduledIn: undefined });
    expect(flightCheckInterval(flight, unknown, "2026-12-12T21:00:00Z")).toBe(15 * min);
    expect(flightCheckInterval(flight, unknown, "2026-12-12T23:01:00Z")).toBeUndefined();
    const stuck = status({ estimatedOut: "2026-12-14T22:00:00Z", estimatedIn: "2026-12-15T07:30:00Z" });
    expect(flightCheckInterval(flight, stuck, "2026-12-14T21:00:00Z")).toBeUndefined();
  });
});

describe("flightCheckDue", () => {
  it("is due once the interval has passed since the last look, give or take the scheduler", () => {
    expect(flightCheckDue(flight, undefined, "2026-12-12T21:00:00Z")).toBe(true);
    const looked = status({ checkedAt: "2026-12-12T21:00:00Z" });
    expect(flightCheckDue(flight, looked, "2026-12-12T21:00:30Z")).toBe(false);
    expect(flightCheckDue(flight, looked, "2026-12-12T21:00:50Z")).toBe(true);
    expect(flightCheckDue(flight, looked, "2026-12-12T19:00:00Z")).toBe(false);
  });
});

describe("flightRefreshDue", () => {
  it("lets an open trip page look from six hours before departure, once a minute", () => {
    expect(flightRefreshDue(flight, undefined, "2026-12-12T15:59:00Z")).toBe(false);
    expect(flightRefreshDue(flight, undefined, "2026-12-12T16:00:00Z")).toBe(true);
    const looked = status({ checkedAt: "2026-12-12T17:00:00Z" });
    expect(flightRefreshDue(flight, looked, "2026-12-12T17:00:30Z")).toBe(false);
    expect(flightRefreshDue(flight, looked, "2026-12-12T17:01:00Z")).toBe(true);
  });

  it("stops when the scheduled looks do", () => {
    const landed = status({ actualOut: "2026-12-12T22:00:00Z", actualIn: "2026-12-13T07:30:00Z" });
    expect(flightRefreshDue(flight, landed, "2026-12-13T08:16:00Z")).toBe(false);
    expect(flightRefreshDue(flight, status({ cancelled: true }), "2026-12-12T21:00:00Z")).toBe(false);
  });
});

describe("flightStatusShown", () => {
  it("shows a flight's status from a day before departure until the looks stop", () => {
    expect(flightStatusShown(flight, "2026-12-11T21:59:00Z")).toBe(false);
    expect(flightStatusShown(flight, "2026-12-11T22:00:00Z")).toBe(true);
    expect(flightStatusShown(flight, "2026-12-14T04:00:00Z")).toBe(true);
    expect(flightStatusShown(flight, "2026-12-14T04:01:00Z")).toBe(false);
    expect(flightStatusShown({ ...flight, type: "train" }, "2026-12-12T21:00:00Z")).toBe(false);
  });

  it("shows none for a cancelled booking", () => {
    expect(flightStatusShown({ ...flight, cancelledAt: "2026-11-01T00:00:00Z" }, "2026-12-12T21:00:00Z")).toBe(false);
  });
});

describe("flightStatusLines", () => {
  it("says before takeoff where the flight leaves from and the arrival terminal, but no arrival gate or carousel", () => {
    const known = status({ departureGate: "8", departureTerminal: "1", arrivalGate: "D46", arrivalTerminal: "3", baggageClaim: "16" });
    expect(flightStatusLines(known)).toEqual(["Departs from terminal 1, gate 8", "Arrives at terminal 3"]);
    expect(flightStatusLines(known, flight, "2026-12-12T21:59:00Z")).toEqual(["Departs from terminal 1, gate 8", "Arrives at terminal 3"]);
    expect(flightStatusLines(status({ arrivalTerminal: "3" }))).toEqual(["Arrives at terminal 3"]);
    expect(flightStatusLines(undefined)).toEqual([]);
    expect(flightStatusLines(status({ found: false, departureGate: "8" }))).toEqual([]);
  });

  it("says after takeoff when it lands, where it arrives and the carousel, but not where it left from", () => {
    const flying = status({ actualOut: "2026-12-12T22:05:00Z", estimatedIn: "2026-12-13T07:10:00Z", departureGate: "8", arrivalGate: "D46", arrivalTerminal: "3", baggageClaim: "16" });
    expect(flightStatusLines(flying, flight, "2026-12-13T01:00:00Z")).toEqual(["Lands 20 min early, at 15:10", "Arrives at terminal 3, gate D46", "Bags on carousel 16"]);
    // The landing time is said on time too, and once it has landed not at all.
    expect(flightStatusLines(status({ actualOut: "2026-12-12T22:05:00Z", estimatedIn: "2026-12-13T07:32:00Z" }), flight, "2026-12-13T01:00:00Z")).toEqual(["Lands on time, at 15:32"]);
    expect(flightStatusLines(status({ actualOut: "2026-12-12T22:05:00Z", estimatedIn: "2026-12-13T07:10:00Z", actualIn: "2026-12-13T07:10:00Z" }), flight, "2026-12-13T08:00:00Z")).toEqual([]);
    // Its expected departure passed with no word: taken off.
    expect(flightStatusLines(status({ departureGate: "8", baggageClaim: "16" }), flight, "2026-12-12T22:01:00Z")).toEqual(["Bags on carousel 16"]);
  });

  it("stops saying where it arrived an hour after it lands", () => {
    const landed = status({ actualOut: "2026-12-12T22:05:00Z", actualIn: "2026-12-13T07:10:00Z", arrivalGate: "D46", arrivalTerminal: "3", baggageClaim: "16" });
    expect(flightStatusLines(landed, flight, "2026-12-13T08:09:00Z")).toEqual(["Arrives at terminal 3, gate D46", "Bags on carousel 16"]);
    expect(flightStatusLines(landed, flight, "2026-12-13T08:10:00Z")).toEqual([]);
    expect(flightNextStep(landed, flight, "2026-12-13T08:09:00Z")).toBe("Terminal 3 · Gate D46 · Bags on carousel 16");
    expect(flightNextStep(landed, flight, "2026-12-13T08:10:00Z")).toBeUndefined();
    // With no landing time from the service, it goes by the booked one (07:30Z).
    const unsure = status({ baggageClaim: "16" });
    expect(flightStatusLines(unsure, flight, "2026-12-13T08:29:00Z")).toEqual(["Bags on carousel 16"]);
    expect(flightStatusLines(unsure, flight, "2026-12-13T08:30:00Z")).toEqual([]);
  });

  it("says how late the flight leaves, by the airport's clock", () => {
    const late = status({ estimatedOut: "2026-12-12T22:40:00Z", estimatedIn: "2026-12-13T07:10:00Z", departureGate: "8" });
    expect(flightStatusLines(late, flight, "2026-12-12T21:00:00Z")).toEqual(["Leaves 40 min late, at 09:40", "Departs from gate 8"]);
    // Without the booking there is no place to read the clock at.
    expect(flightStatusLines(status({ estimatedOut: "2026-12-13T00:05:00Z" }))).toEqual(["Leaves 2 h 5 min late"]);
    // A few minutes either way is on time, and a flight that left or landed has no estimate to give.
    expect(flightStatusLines(status({ estimatedOut: "2026-12-12T22:04:00Z", estimatedIn: "2026-12-13T07:26:00Z" }), flight)).toEqual([]);
    expect(flightStatusLines(status({ estimatedOut: "2026-12-12T22:40:00Z", actualOut: "2026-12-12T22:41:00Z" }), flight)).toEqual([]);
  });

  it("says a flight leaves on time again after news of its delay, so a retry of that news says it too", () => {
    const back = status({ estimatedOut: "2026-12-12T22:00:00Z", noticedOut: "2026-12-12T22:00:00Z" });
    expect(flightStatusLines(back, flight)).toEqual(["Leaves on time, at 09:00"]);
    expect(flightStatusLines(back)).toEqual(["Leaves on time"]);
  });

  it("says only that a cancelled flight is cancelled", () => {
    expect(flightStatusLines(status({ cancelled: true, departureGate: "8", estimatedOut: "2026-12-12T22:40:00Z" }), flight)).toEqual(["Flight cancelled"]);
  });

  it("says where a diverted flight goes when that is not where it was booked to", () => {
    const booked = { ...flight, destination: { name: "Singapore", code: "SIN" } };
    expect(flightStatusLines(status({ diverted: true, divertedTo: "KUL" }), booked)).toEqual(["Diverted to KUL"]);
    expect(flightStatusLines(status({ diverted: true, divertedTo: "SIN" }), booked)).toEqual(["Diverted"]);
    expect(flightStatusLines(status({ diverted: true }), booked)).toEqual(["Diverted"]);
  });
});

describe("keepKnownPlaces", () => {
  it("keeps a gate, terminal or carousel the service has lost, so its return is no news", () => {
    const full = status({ departureTerminal: "1", departureGate: "8", baggageClaim: "16" });
    const lapsed = keepKnownPlaces(full, status({ departureTerminal: "1", checkedAt: "2026-12-12T19:01:00Z" }));
    expect(lapsed).toMatchObject({ departureTerminal: "1", departureGate: "8", baggageClaim: "16", checkedAt: "2026-12-12T19:01:00Z" });
    expect(flightStatusNews(lapsed, keepKnownPlaces(lapsed, full))).toEqual([]);
    // A gate and its terminal go together: a new terminal drops the old gate,
    // a new gate the old terminal.
    const moved = keepKnownPlaces(full, status({ departureTerminal: "2" }));
    expect(moved).toMatchObject({ departureTerminal: "2", baggageClaim: "16" });
    expect(moved).not.toHaveProperty("departureGate");
    expect(flightStatusNews(full, moved)).toEqual(["Now departs from terminal 2 (was terminal 1, gate 8)"]);
    expect(keepKnownPlaces(full, status({ departureGate: "9" }))).not.toHaveProperty("departureTerminal");
    expect(keepKnownPlaces(full, status({ departureTerminal: "1", departureGate: "9" }))).toMatchObject({ departureGate: "9", departureTerminal: "1" });
    expect(keepKnownPlaces(full, status({ departureGate: "8" }))).toMatchObject({ departureGate: "8", departureTerminal: "1" });
    // A look that misses a flight found before keeps the last status: the
    // service stumbled, and the card and Live Update should not go blank.
    expect(keepKnownPlaces(full, status({ found: false, checkedAt: "2026-12-12T19:02:00Z" }))).toEqual({ ...full, checkedAt: "2026-12-12T19:02:00Z" });
    // Never found at all: not found it is.
    expect(keepKnownPlaces(undefined, status({ found: false })).found).toBe(false);
    expect(keepKnownPlaces(undefined, status())).toEqual(status());
  });
});

describe("flightStatusNews", () => {
  it("tells of a gate, terminal or carousel given or changed", () => {
    const first = status({ departureTerminal: "1" });
    expect(flightStatusNews(undefined, first)).toEqual(["Departs from terminal 1"]);
    const gate = status({ departureTerminal: "1", departureGate: "8" });
    expect(flightStatusNews(first, gate)).toEqual(["Departs from terminal 1, gate 8"]);
    const moved = status({ departureTerminal: "1", departureGate: "9" });
    expect(flightStatusNews(gate, moved)).toEqual(["Now departs from terminal 1, gate 9 (was terminal 1, gate 8)"]);
    expect(flightStatusNews(moved, moved)).toEqual([]);
    expect(flightStatusNews(first, status({ departureTerminal: "2" }))).toEqual(["Now departs from terminal 2 (was terminal 1)"]);
    const flying = { actualOut: "2026-12-12T22:00:00Z", checkedAt: "2026-12-12T23:00:00Z" };
    const arrival = status({ ...flying, arrivalGate: "D46", baggageClaim: "16" });
    expect(flightStatusNews(undefined, arrival)).toEqual(["Arrives at gate D46", "Bags on carousel 16"]);
    expect(flightStatusNews(arrival, status({ ...flying, arrivalGate: "D47", baggageClaim: "17" }))).toEqual([
      "Now arrives at gate D47 (was gate D46)",
      "Bags now on carousel 17 (was 16)",
    ]);
  });

  it("says nothing of a gate taken away, or of a departure gate once the flight has left", () => {
    expect(flightStatusNews(status({ departureGate: "8" }), status())).toEqual([]);
    // A gate or terminal dropped while the rest stays is no news either.
    const full = status({ departureTerminal: "1", departureGate: "8", arrivalTerminal: "3", arrivalGate: "D46" });
    expect(flightStatusNews(full, status({ departureTerminal: "1", arrivalTerminal: "3" }))).toEqual([]);
    expect(flightStatusNews(full, status({ departureGate: "8", arrivalGate: "D46" }))).toEqual([]);
    // A gate given where only the terminal was known is news, not a change.
    expect(flightStatusNews(status({ departureTerminal: "1" }), status({ departureTerminal: "1", departureGate: "8" }))).toEqual(["Departs from terminal 1, gate 8"]);
    expect(flightStatusNews(undefined, status({ departureGate: "8", actualOut: "2026-12-12T22:00:00Z" }))).toEqual([]);
  });

  it("tells of the arrival gate and carousel only once the flight has taken off", () => {
    const waiting = status({ departureGate: "8", arrivalTerminal: "3", arrivalGate: "D46", baggageClaim: "16" });
    expect(flightStatusNews(undefined, waiting, flight)).toEqual(["Departs from gate 8", "Arrives at terminal 3"]);
    expect(flightStatusNews(waiting, status({ departureGate: "8", arrivalTerminal: "3", arrivalGate: "D46", baggageClaim: "17" }), flight)).toEqual([]);
    // The first look after takeoff tells of what was held back.
    const flying = status({ departureGate: "8", arrivalTerminal: "3", arrivalGate: "D46", baggageClaim: "16", actualOut: "2026-12-12T22:05:00Z", checkedAt: "2026-12-12T22:06:00Z" });
    expect(flightStatusNews(waiting, flying, flight)).toEqual(["Arrives at terminal 3, gate D46", "Bags on carousel 16"]);
    expect(flightStatusNews(flying, flying, flight)).toEqual([]);
  });

  it("tells of a cancellation once, and nothing else about a cancelled flight", () => {
    const cancelled = status({ cancelled: true, departureGate: "9" });
    expect(flightStatusNews(status({ departureGate: "8" }), cancelled, flight)).toEqual(["Flight cancelled"]);
    expect(flightStatusNews(cancelled, cancelled, flight)).toEqual([]);
  });

  it("tells of a diversion once", () => {
    const diverted = status({ diverted: true, divertedTo: "KUL" });
    expect(flightStatusNews(status(), diverted, flight)).toEqual(["Diverted to KUL"]);
    expect(flightStatusNews(diverted, diverted, flight)).toEqual([]);
  });

  it("tells of a departure moved a quarter of an hour or more from what was last said", () => {
    const look = (estimatedOut: string, before?: FlightStatus) => {
      const after = noticeDeparture(before, status({ estimatedOut }));
      return { after, news: flightStatusNews(before, after, flight) };
    };
    // Ten minutes late is not yet news; 40 is.
    const ten = look("2026-12-12T22:10:00Z", noticeDeparture(undefined, status()));
    expect(ten.news).toEqual([]);
    expect(ten.after).not.toHaveProperty("noticedOut");
    const forty = look("2026-12-12T22:40:00Z", ten.after);
    expect(forty.news).toEqual(["Leaves 40 min late, at 09:40"]);
    expect(forty.after.noticedOut).toBe("2026-12-12T22:40:00Z");
    // Creeping five minutes a look is news once it adds up to 15 more.
    const fortyFive = look("2026-12-12T22:45:00Z", forty.after);
    expect(fortyFive.news).toEqual([]);
    expect(fortyFive.after.noticedOut).toBe("2026-12-12T22:40:00Z");
    const fifty = look("2026-12-12T22:50:00Z", fortyFive.after);
    expect(fifty.news).toEqual([]);
    const fiftyFive = look("2026-12-12T22:55:00Z", fifty.after);
    expect(fiftyFive.news).toEqual(["Now leaves 55 min late, at 09:55"]);
    // Back on schedule is news too.
    expect(look("2026-12-12T22:00:00Z", fiftyFive.after).news).toEqual(["Now leaves on time, at 09:00"]);
    // Once it has left, its departure is no news.
    const gone = noticeDeparture(forty.after, status({ estimatedOut: "2026-12-12T23:30:00Z", actualOut: "2026-12-12T23:30:00Z" }));
    expect(flightStatusNews(forty.after, gone, flight)).toEqual([]);
    expect(gone.noticedOut).toBe("2026-12-12T22:40:00Z");
  });
});
