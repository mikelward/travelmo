import { describe, expect, it } from "vitest";
import { airportPlace } from "./airportPlaces";
import { placeCountry, travelReport, tripDays, tripPlaces } from "./reports";
import type { ExtractedSegment } from "./schema";

const flight = (from: string, to: string, start: string, end: string): ExtractedSegment => ({
  type: "flight",
  title: `${from} to ${to}`,
  start,
  end,
  origin: { name: from, code: from },
  destination: { name: to, code: to },
});

const stay = (name: string, country: string, start: string, end: string): ExtractedSegment => ({
  type: "lodging",
  title: name,
  start,
  end,
  destination: { name, country },
});

// An invented week in Paris with a day trip by train to Brussels.
const paris = {
  trip: { id: "paris", start: "2025-05-01", end: "2025-05-07" },
  segments: [
    flight("JFK", "CDG", "2025-05-01T18:00:00-04:00", "2025-05-02T07:30:00+02:00"),
    stay("Hotel Example", "FR", "2025-05-02T15:00:00+02:00", "2025-05-07T11:00:00+02:00"),
    {
      type: "train",
      title: "Paris to Brussels",
      start: "2025-05-04T08:00:00+02:00",
      end: "2025-05-04T09:30:00+02:00",
      origin: { name: "Paris Nord", country: "FR" },
      destination: { name: "Bruxelles-Midi", country: "BE" },
    },
    {
      type: "train",
      title: "Brussels to Paris",
      start: "2025-05-04T19:00:00+02:00",
      end: "2025-05-04T20:30:00+02:00",
      origin: { name: "Bruxelles-Midi", country: "BE" },
      destination: { name: "Paris Nord", country: "FR" },
    },
    flight("CDG", "JFK", "2025-05-07T13:00:00+02:00", "2025-05-07T15:30:00-04:00"),
  ] satisfies ExtractedSegment[],
};

const countriesOf = (days: Map<string, Set<string>>) => Object.fromEntries([...days].map(([d, c]) => [d, [...c].sort()]));

describe("placeCountry", () => {
  it("prefers the country the booking names", () => {
    expect(placeCountry({ name: "x", code: "JFK", country: "fr" }, "flight", airportPlace)).toBe("FR");
  });

  it("finds a flight's country from its airport", () => {
    expect(placeCountry({ name: "Heathrow", code: "lhr" }, "flight", airportPlace)).toBe("GB");
  });

  it("does not read a station code as an airport", () => {
    expect(placeCountry({ name: "Station", code: "LHR" }, "train", airportPlace)).toBeUndefined();
  });
});

describe("tripDays", () => {
  it("counts a travel day for both ends and a day in the air for neither", () => {
    expect(countriesOf(tripDays(paris.trip, paris.segments, "2025-12-31", airportPlace))).toEqual({
      "2025-05-01": ["US"],
      "2025-05-02": ["FR"],
      "2025-05-03": ["FR"],
      "2025-05-04": ["BE", "FR"],
      "2025-05-05": ["FR"],
      "2025-05-06": ["FR"],
      "2025-05-07": ["FR", "US"],
    });
  });

  it("stops at today", () => {
    expect([...tripDays(paris.trip, paris.segments, "2025-05-03", airportPlace).keys()]).toEqual([
      "2025-05-01",
      "2025-05-02",
      "2025-05-03",
    ]);
  });

  it("keeps where the traveler is across the date line", () => {
    // Leaves Tokyo early on 2 May and lands in Los Angeles on the evening of 1 May.
    const days = tripDays(
      { start: "2025-05-01", end: "2025-05-03" },
      [
        stay("Tokyo Example Hotel", "JP", "2025-04-28T15:00:00+09:00", "2025-05-01T10:00:00+09:00"),
        flight("HND", "LAX", "2025-05-02T01:00:00+09:00", "2025-05-01T19:00:00-07:00"),
      ],
      "2026-01-01",
      airportPlace,
    );
    expect(countriesOf(days)).toEqual({
      "2025-05-01": ["JP", "US"],
      "2025-05-02": ["JP", "US"],
      "2025-05-03": ["US"],
    });
  });

  it("leaves days no booking places without a country", () => {
    const days = tripDays({ start: "2025-06-01", end: "2025-06-03" }, [stay("Inn", "IT", "2025-06-02T15:00:00+02:00", "2025-06-03T10:00:00+02:00")], "2026-01-01");
    expect(countriesOf(days)).toEqual({ "2025-06-01": [], "2025-06-02": ["IT"], "2025-06-03": ["IT"] });
  });
});

describe("travelReport", () => {
  const tokyo = {
    trip: { id: "tokyo", start: "2024-12-30", end: "2025-01-02" },
    segments: [stay("Ryokan Example", "JP", "2024-12-30T15:00:00+09:00", "2025-01-02T10:00:00+09:00")],
  };
  const later = { trip: { id: "later", start: "2026-03-01", end: "2026-03-05" }, segments: [] };

  it("counts days per country, trips per year and the airports flown", () => {
    const report = travelReport([paris, tokyo, later, paris], "2025-11-01", { lookup: airportPlace });
    expect(report.trips).toBe(2);
    expect(report.upcoming).toBe(1);
    expect(report.days).toBe(11);
    expect(report.countries).toEqual([
      { country: "FR", days: 6, trips: 1 },
      { country: "JP", days: 4, trips: 1 },
      { country: "US", days: 2, trips: 1 },
      { country: "BE", days: 1, trips: 1 },
    ]);
    expect(report.years).toEqual([
      { year: "2025", trips: 1, days: 9, countries: 4 },
      { year: "2024", trips: 1, days: 2, countries: 1 },
    ]);
    expect(report.airports.map((a) => [a.code, a.country])).toEqual([
      ["CDG", "FR"],
      ["JFK", "US"],
    ]);
    expect(report.unknownDays).toBe(0);
    expect(report.unplaced).toBe(0);
  });

  it("narrows to one year by the days spent in it", () => {
    const report = travelReport([paris, tokyo], "2025-11-01", { year: "2024", lookup: airportPlace });
    expect(report.trips).toBe(1);
    expect(report.days).toBe(2);
    expect(report.countries).toEqual([{ country: "JP", days: 2, trips: 1 }]);
    expect(report.airports).toEqual([]);
    expect(report.years).toHaveLength(2);
  });

  it("marks each airport in the year the traveler was there", () => {
    const newYear = {
      trip: { id: "ny", start: "2024-12-31", end: "2025-01-01" },
      segments: [flight("JFK", "CDG", "2024-12-31T22:00:00-05:00", "2025-01-01T11:30:00+01:00")],
    };
    const codes = (year: string) => travelReport([newYear], "2025-11-01", { year, lookup: airportPlace }).airports.map((a) => a.code);
    expect(codes("2024")).toEqual(["JFK"]);
    expect(codes("2025")).toEqual(["CDG"]);
    expect(travelReport([newYear], "2024-12-31", { lookup: airportPlace }).airports.map((a) => a.code)).toEqual(["JFK"]);
  });

  it("counts a day two trips share once", () => {
    const a = { trip: { id: "a", start: "2025-02-01", end: "2025-02-02" }, segments: [stay("A", "ES", "2025-02-01T15:00:00+01:00", "2025-02-02T10:00:00+01:00")] };
    const b = { trip: { id: "b", start: "2025-02-02", end: "2025-02-03" }, segments: [stay("B", "PT", "2025-02-02T15:00:00+00:00", "2025-02-03T10:00:00+00:00")] };
    const report = travelReport([a, b], "2025-12-01");
    expect(report.days).toBe(3);
    expect(report.countries.map((c) => [c.country, c.days])).toEqual([
      ["ES", 2],
      ["PT", 2],
    ]);
  });

  it("says how many bookings and days it could not place", () => {
    const vague = {
      trip: { id: "vague", start: "2025-03-01", end: "2025-03-02" },
      segments: [{ type: "activity", title: "Museum", start: "2025-03-01T10:00:00+01:00", destination: { name: "Museum" } }] satisfies ExtractedSegment[],
    };
    const report = travelReport([vague], "2025-12-01", { lookup: airportPlace });
    expect(report.unplaced).toBe(1);
    expect(report.unknownDays).toBe(2);
    const bare = { trip: { id: "bare", start: "2025-03-05", end: "2025-03-05" }, segments: [{ type: "activity", title: "Tour", start: "2025-03-05T10:00:00+01:00" }] satisfies ExtractedSegment[] };
    expect(travelReport([bare], "2025-12-01").unplaced).toBe(1);
    expect(report.countries).toEqual([]);
  });
});

describe("tripPlaces", () => {
  it("collects the countries and says whether every place had one", () => {
    expect(tripPlaces(paris.segments, airportPlace)).toEqual({ countries: new Set(["US", "FR", "BE"]), complete: true });
    expect(tripPlaces(paris.segments).complete).toBe(false);
    expect(tripPlaces([]).complete).toBe(false);
    const oneWay = { ...flight("LHR", "LIS", "2025-06-10T08:00:00+01:00", "2025-06-10T10:45:00+01:00") };
    delete oneWay.destination;
    expect(tripPlaces([oneWay], airportPlace)).toEqual({ countries: new Set(["GB"]), complete: false });
  });
});
