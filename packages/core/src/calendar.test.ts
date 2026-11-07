import { describe, expect, it } from "vitest";
import { addMonths, monthLabel, monthOf, monthWeeks, tripMonths, weekBars } from "./calendar";
import type { Trip } from "./schema";

const trip = (id: string, start: string, end: string): Trip => ({
  id,
  title: id,
  start,
  end,
  ownerUid: "u",
  sharedWith: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("months", () => {
  it("steps across years and names a month", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-03", -15)).toBe("2024-12");
    expect(monthOf("2026-11-07")).toBe("2026-11");
    expect(monthLabel("2026-11")).toBe("November 2026");
  });
});

describe("monthWeeks", () => {
  it("starts each week on Monday and pads with the months around", () => {
    // 1 November 2026 is a Sunday.
    const weeks = monthWeeks("2026-11");
    expect(weeks).toHaveLength(6);
    expect(weeks[0]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(weeks[5]![0]).toBe("2026-11-30");
    expect(weeks[5]![6]).toBe("2026-12-06");
  });

  it("needs only four rows for a February starting on Monday", () => {
    // February 2027 starts on a Monday and has 28 days.
    const weeks = monthWeeks("2027-02");
    expect(weeks).toHaveLength(4);
    expect(weeks[0]![0]).toBe("2027-02-01");
    expect(weeks[3]![6]).toBe("2027-02-28");
  });
});

describe("weekBars", () => {
  const week = monthWeeks("2026-12")[2]!; // 14–20 December 2026
  it("clips a trip to the week and says which way it carries on", () => {
    const bars = weekBars(week, [trip("long", "2026-12-10", "2026-12-25"), trip("short", "2026-12-16", "2026-12-17")]);
    expect(bars.map((b) => [b.trip.id, b.from, b.to, b.continuesBefore, b.continuesAfter, b.lane])).toEqual([
      ["long", 0, 6, true, true, 0],
      ["short", 2, 3, false, false, 1],
    ]);
  });

  it("gives each trip the lowest free lane, and leaves out trips not touching the week", () => {
    const bars = weekBars(week, [
      trip("a", "2026-12-14", "2026-12-15"),
      trip("b", "2026-12-15", "2026-12-16"),
      trip("c", "2026-12-17", "2026-12-18"),
      trip("elsewhere", "2026-12-21", "2026-12-22"),
    ]);
    expect(bars.map((b) => [b.trip.id, b.lane])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ]);
  });

  it("orders by start, then the longer first", () => {
    const bars = weekBars(week, [trip("one day", "2026-12-15", "2026-12-15"), trip("two days", "2026-12-15", "2026-12-16")]);
    expect(bars.map((b) => b.trip.id)).toEqual(["two days", "one day"]);
  });
});

describe("tripMonths", () => {
  it("lists every month a trip touches, once, in order", () => {
    expect(tripMonths([trip("a", "2026-12-28", "2027-01-03"), trip("b", "2025-06-10", "2025-06-14"), trip("c", "2026-12-01", "2026-12-02")])).toEqual([
      "2025-06",
      "2026-12",
      "2027-01",
    ]);
  });
});
