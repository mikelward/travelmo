import { describe, expect, it } from "vitest";
import { isEmptyQuery, parseTripQuery, tripMatches, type SearchedSegment } from "./tripSearch";

const lisbon = { start: "2025-03-28", end: "2025-04-02" };
const stay: SearchedSegment = {
  title: "Hotel Avenida",
  provider: "Hilton",
  confirmation: "HX-4410",
  destination: { name: "Hotel Avenida", city: "Lisboa", country: "PT" },
};
const flight: SearchedSegment = {
  title: "BA 500 London to Lisbon",
  provider: "British Airways",
  origin: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
  destination: { name: "Humberto Delgado", code: "LIS", city: "Lisbon", country: "PT" },
};
const matches = (text: string, segments: SearchedSegment[] = [stay, flight], title = "Portugal") => tripMatches(parseTripQuery(text), lisbon, title, segments);

describe("parseTripQuery", () => {
  it("reads words, and a year, month or day in any common form", () => {
    expect(parseTripQuery("Lisbon 2025")).toEqual({ words: ["lisbon"], year: 2025 });
    expect(parseTripQuery("March 2025")).toEqual({ words: [], year: 2025, month: 3 });
    expect(parseTripQuery("12 Dec 2025")).toEqual({ words: [], year: 2025, month: 12, day: 12 });
    expect(parseTripQuery("sept 3rd")).toEqual({ words: [], month: 9, day: 3 });
    expect(parseTripQuery("2025-12-12")).toEqual({ words: [], year: 2025, month: 12, day: 12 });
    // A number with no month beside it is a word.
    expect(parseTripQuery("VS 11")).toEqual({ words: ["vs", "11"] });
    // A month or day that cannot be is no date.
    expect(parseTripQuery("2025-13")).toEqual({ words: ["2025", "13"] });
    expect(parseTripQuery("2025-00-01")).toEqual({ words: ["2025", "00", "01"] });
    expect(isEmptyQuery(parseTripQuery("  "))).toBe(true);
  });
});

describe("tripMatches", () => {
  it("finds a trip by any of its bookings' providers, places, codes and references, not only its title", () => {
    for (const text of ["portugal", "hilton", "lisbon", "Lisboa", "LIS", "heathrow", "british", "hx 4410", "Portugal", "lisb"]) expect(matches(text), text).toBe(true);
    expect(matches("madrid")).toBe(false);
    // Words start where the text's do: "ba" is the airline, not inside "Lisboa".
    expect(matches("ba", [stay])).toBe(false);
    expect(matches("ba", [flight])).toBe(true);
  });

  it("wants every word", () => {
    expect(matches("hilton lisbon")).toBe(true);
    expect(matches("hilton madrid")).toBe(false);
  });

  it("ignores accents and case", () => {
    expect(matches("LISBÓA")).toBe(true);
  });

  it("finds a trip under way during a year, a month of any year, or a day", () => {
    expect(matches("2025")).toBe(true);
    expect(matches("2024")).toBe(false);
    expect(matches("april")).toBe(true);
    expect(matches("march 2025")).toBe(true);
    expect(matches("may")).toBe(false);
    expect(matches("1 April 2025")).toBe(true);
    expect(matches("3 April 2025")).toBe(false);
    expect(matches("lisbon april")).toBe(true);
    expect(matches("madrid april")).toBe(false);
  });

  it("finds a trip spanning New Year in either year", () => {
    const newYear = { start: "2025-12-30", end: "2026-01-02" };
    expect(tripMatches(parseTripQuery("2026"), newYear, "Edinburgh", [])).toBe(true);
    expect(tripMatches(parseTripQuery("december"), newYear, "Edinburgh", [])).toBe(true);
    expect(tripMatches(parseTripQuery("january"), newYear, "Edinburgh", [])).toBe(true);
  });

  it("uses the dates a cancellation left the trip", () => {
    expect(tripMatches(parseTripQuery("march"), { ...lisbon, liveStart: "2025-04-01", liveEnd: "2025-04-02" }, "Portugal", [])).toBe(false);
  });
});
