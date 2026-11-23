import { describe, expect, it } from "vitest";
import { airportPlace } from "./airportPlaces";
import type { HomePeriod } from "./home";
import type { TripWithSegments } from "./reports";
import {
  evaluateRule,
  presenceTimeline,
  residenceReport,
  residenceRuleSets,
  schengenCountries,
  shiftDate,
  type ResidenceRule,
} from "./residence";
import type { ExtractedSegment } from "./schema";

// Invented trips; every name and booking is made up.
const flight = (from: string, to: string, start: string, end: string): ExtractedSegment => ({
  type: "flight",
  title: `${from} to ${to}`,
  start,
  end,
  origin: { name: from, code: from },
  destination: { name: to, code: to },
});

const train = (from: [string, string], to: [string, string], start: string, end: string): ExtractedSegment => ({
  type: "train",
  title: `${from[0]} to ${to[0]}`,
  start,
  end,
  origin: { name: from[0], country: from[1] },
  destination: { name: to[0], country: to[1] },
});

const stay = (name: string, country: string, start: string, end: string): ExtractedSegment => ({
  type: "lodging",
  title: name,
  start,
  end,
  destination: { name, country },
});

const trip = (id: string, start: string, end: string, segments: ExtractedSegment[]): TripWithSegments => ({
  trip: { id, start, end },
  segments,
});

// Out on the morning of the first, back on the evening of the last.
const roundTrip = (id: string, out: string, back: string, from = "LHR", to = "CDG"): TripWithSegments =>
  trip(id, out, back, [flight(from, to, `${out}T09:00:00+00:00`, `${out}T11:20:00+01:00`), flight(to, from, `${back}T18:00:00+01:00`, `${back}T18:20:00+00:00`)]);

const london: HomePeriod[] = [{ city: "London", country: "GB" }];
const boston: HomePeriod[] = [{ city: "Boston", country: "US" }];

const rule = (setId: string, ruleId: string): ResidenceRule => {
  const found = residenceRuleSets.find((s) => s.id === setId)?.rules.find((r) => r.id === ruleId);
  if (!found) throw new Error(`no rule ${setId}/${ruleId}`);
  return found;
};

const evaluate = (r: ResidenceRule, trips: TripWithSegments[], homes: HomePeriod[], date: string) =>
  evaluateRule(r, presenceTimeline(trips, homes, shiftDate(date, { years: -8 }), date, airportPlace), date);

const countries = (timeline: ReturnType<typeof presenceTimeline>, from: string, to: string) =>
  Object.fromEntries([...timeline].filter(([d]) => d >= from && d <= to).map(([d, p]) => [d, [...p.countries].sort()]));

describe("shiftDate", () => {
  it("moves by years, months and days, keeping to the end of a shorter month", () => {
    expect(shiftDate("2024-02-29", { years: 1 })).toBe("2025-02-28");
    expect(shiftDate("2026-03-31", { months: -1 })).toBe("2026-02-28");
    expect(shiftDate("2026-01-01", { days: -1 })).toBe("2025-12-31");
    expect(shiftDate("2026-11-23", { years: -5, days: 1 })).toBe("2021-11-24");
  });
});

describe("presenceTimeline", () => {
  it("puts a travel day in both countries and the days with no trip at home", () => {
    const timeline = presenceTimeline([roundTrip("paris", "2026-03-02", "2026-03-05")], london, "2026-03-01", "2026-03-06", airportPlace);
    expect(countries(timeline, "2026-03-01", "2026-03-06")).toEqual({
      "2026-03-01": ["GB"],
      "2026-03-02": ["FR", "GB"],
      "2026-03-03": ["FR"],
      "2026-03-04": ["FR"],
      "2026-03-05": ["FR", "GB"],
      "2026-03-06": ["GB"],
    });
    expect(timeline.get("2026-03-01")?.assumedHome).toBe(true);
    expect(timeline.get("2026-03-03")?.assumedHome).toBe(false);
    expect([...(timeline.get("2026-03-03")?.tripIds ?? [])]).toEqual(["paris"]);
  });

  it("counts an overnight flight's departure day only where it left", () => {
    const singapore = trip("sg", "2026-04-10", "2026-04-11", [flight("LHR", "SIN", "2026-04-10T21:00:00+01:00", "2026-04-11T17:00:00+08:00")]);
    const timeline = presenceTimeline([singapore], london, "2026-04-10", "2026-04-11", airportPlace);
    expect(countries(timeline, "2026-04-10", "2026-04-11")).toEqual({ "2026-04-10": ["GB"], "2026-04-11": ["SG"] });
  });

  it("puts a day skipped across the date line in no country, and does not call it unknown", () => {
    const sydney = trip("syd", "2026-01-05", "2026-01-07", [flight("LAX", "SYD", "2026-01-05T23:00:00-08:00", "2026-01-07T07:00:00+11:00")]);
    const timeline = presenceTimeline([sydney], boston, "2026-01-05", "2026-01-07", airportPlace);
    expect(countries(timeline, "2026-01-05", "2026-01-07")).toEqual({ "2026-01-05": ["US"], "2026-01-06": [], "2026-01-07": ["AU"] });
    expect(timeline.get("2026-01-06")?.inTransit).toBe(true);
  });

  it("follows a trip through several countries", () => {
    const tour = trip("tour", "2026-06-01", "2026-06-06", [
      train(["London St Pancras", "GB"], ["Paris Nord", "FR"], "2026-06-01T09:00:00+01:00", "2026-06-01T12:30:00+02:00"),
      flight("ORY", "MAD", "2026-06-03T10:00:00+02:00", "2026-06-03T12:00:00+02:00"),
      flight("MAD", "LHR", "2026-06-06T15:00:00+02:00", "2026-06-06T16:30:00+01:00"),
    ]);
    const timeline = presenceTimeline([tour], london, "2026-06-01", "2026-06-07", airportPlace);
    expect(countries(timeline, "2026-06-01", "2026-06-07")).toEqual({
      "2026-06-01": ["FR", "GB"],
      "2026-06-02": ["FR"],
      "2026-06-03": ["ES", "FR"],
      "2026-06-04": ["ES"],
      "2026-06-05": ["ES"],
      "2026-06-06": ["ES", "GB"],
      "2026-06-07": ["GB"],
    });
  });

  it("takes a trip's days before its first booking as at home", () => {
    const early = trip("early", "2026-05-01", "2026-05-04", [flight("LHR", "CDG", "2026-05-03T09:00:00+00:00", "2026-05-03T11:20:00+01:00")]);
    const timeline = presenceTimeline([early], london, "2026-05-01", "2026-05-04", airportPlace);
    expect(countries(timeline, "2026-05-01", "2026-05-04")).toEqual({ "2026-05-01": ["GB"], "2026-05-02": ["GB"], "2026-05-03": ["FR", "GB"], "2026-05-04": ["FR"] });
    expect(timeline.get("2026-05-01")?.assumedHome).toBe(true);
  });

  it("follows home as it moves, and knows no country with no home", () => {
    const moved: HomePeriod[] = [
      { city: "London", country: "GB", until: "2026-02-28" },
      { city: "Toronto", country: "ca", from: "2026-03-01" },
    ];
    expect(countries(presenceTimeline([], moved, "2026-02-28", "2026-03-01"), "2026-02-28", "2026-03-01")).toEqual({ "2026-02-28": ["GB"], "2026-03-01": ["CA"] });
    expect(countries(presenceTimeline([], [], "2026-02-28", "2026-02-28"), "2026-02-28", "2026-02-28")).toEqual({ "2026-02-28": [] });
  });

  it("counts a day two trips share once, in every country either puts it in", () => {
    const a = roundTrip("a", "2026-03-02", "2026-03-05");
    const b = trip("b", "2026-03-05", "2026-03-06", [train(["Paris Nord", "FR"], ["Bruxelles-Midi", "BE"], "2026-03-05T08:00:00+01:00", "2026-03-05T09:30:00+01:00")]);
    const timeline = presenceTimeline([a, b, a], london, "2026-03-05", "2026-03-05", airportPlace);
    expect(countries(timeline, "2026-03-05", "2026-03-05")).toEqual({ "2026-03-05": ["BE", "FR", "GB"] });
    expect([...(timeline.get("2026-03-05")?.tripIds ?? [])].sort()).toEqual(["a", "b"]);
  });
});

describe("UK settlement", () => {
  const ilr = rule("uk-settlement", "uk-settlement-absences");

  it("does not count the days of leaving and coming back as absences", () => {
    const result = evaluate(ilr, [roundTrip("paris", "2026-01-01", "2026-01-10")], london, "2026-11-23");
    expect(result.used).toBe(8);
    expect(result.limit).toBe(180);
    expect(result.remaining).toBe(172);
    expect(result.status).toBe("ok");
    expect(result.stretches).toEqual([{ start: "2026-01-02", end: "2026-01-09", days: 8, countries: ["FR"], tripIds: ["paris"] }]);
  });

  it("finds the worst 12 months over the five years before applying", () => {
    // 199 days away in 2023, then short trips.
    const long = roundTrip("long", "2023-02-01", "2023-08-19", "LHR", "JFK");
    const result = evaluate(ilr, [long, roundTrip("short", "2026-01-01", "2026-01-10")], london, "2026-11-23");
    expect(result.used).toBe(198);
    expect(result.status).toBe("over");
    expect(result.window.end >= "2023-08-18").toBe(true);
    expect(result.window.start <= "2023-02-02").toBe(true);
    expect(result.window.start).toBe(shiftDate(result.window.end, { months: -12, days: 1 }));
    expect(result.current?.used).toBe(8);
  });

  it("counts only days within the five years, not the year before them", () => {
    // Home known from the first day of the five years, and nothing before.
    const result = evaluate(ilr, [], [{ city: "London", country: "GB", from: "2021-11-24" }], "2026-11-23");
    expect(result.unknownDays).toBe(0);
    expect(result.used).toBe(0);
    expect(result.status).toBe("ok");
  });

  it("keeps the first window inside five years that start on 29 February", () => {
    // 180 days in France from the period's first day, then the UK.
    const homes = [
      { city: "Paris", country: "FR", from: "2024-02-29", until: "2024-08-26" },
      { city: "London", country: "GB", from: "2024-08-27" },
    ];
    const result = evaluate(ilr, [], homes, "2029-02-28");
    expect(result.used).toBe(180);
    expect(result.unknownDays).toBe(0);
    expect(result.window.start >= "2024-02-29").toBe(true);
  });

  it("is near the limit within a tenth of it", () => {
    const result = evaluate(ilr, [roundTrip("long", "2026-01-01", "2026-06-20", "LHR", "JFK")], london, "2026-11-23");
    expect(result.used).toBe(169);
    expect(result.status).toBe("near");
  });

  it("counts a day no booking places as an absence, and says how many there were", () => {
    const lost = trip("lost", "2026-04-01", "2026-04-05", [
      { type: "flight", title: "Out", start: "2026-04-01T09:00:00+00:00", end: "2026-04-01T12:00:00+00:00", origin: { name: "Somewhere" }, destination: { name: "Elsewhere" } },
    ]);
    const result = evaluate(ilr, [lost], london, "2026-11-23");
    expect(result.used).toBe(5);
    expect(result.unknownDays).toBe(5);
  });
});

describe("UK citizenship", () => {
  it("counts absences in the five years and in the last 12 months before applying", () => {
    const trips = [roundTrip("old", "2022-03-01", "2022-03-31"), roundTrip("recent", "2026-05-01", "2026-08-01")];
    const five = evaluate(rule("uk-citizenship", "uk-citizenship-five-years"), trips, london, "2026-11-23");
    const last = evaluate(rule("uk-citizenship", "uk-citizenship-last-year"), trips, london, "2026-11-23");
    expect([five.used, five.limit, five.status]).toEqual([29 + 91, 450, "ok"]);
    expect(five.window).toEqual({ start: "2021-11-24", end: "2026-11-23" });
    expect([last.used, last.limit, last.status]).toEqual([91, 90, "over"]);
    expect(last.window).toEqual({ start: "2025-11-24", end: "2026-11-23" });
  });
});

describe("Schengen", () => {
  const schengen = rule("schengen", "schengen-90-180");

  it("counts the days of entering and leaving as days in the area", () => {
    const result = evaluate(schengen, [roundTrip("paris", "2026-11-01", "2026-11-10")], london, "2026-11-23");
    expect(result.used).toBe(10);
    expect(result.current).toEqual({ used: 10, window: { start: "2026-05-28", end: "2026-11-23" } });
    expect(result.remaining).toBe(80);
  });

  it("counts every member, Bulgaria, Romania and Croatia included, and not Ireland or Cyprus", () => {
    for (const code of ["BG", "RO", "HR", "CH", "NO", "IS", "LI"]) expect(schengenCountries).toContain(code);
    for (const code of ["IE", "CY", "GB"]) expect(schengenCountries).not.toContain(code);
    expect(schengenCountries).toHaveLength(29);
    const trips = [roundTrip("sofia", "2026-10-01", "2026-10-03", "LHR", "SOF"), roundTrip("dublin", "2026-10-10", "2026-10-12", "LHR", "DUB")];
    expect(evaluate(schengen, trips, london, "2026-11-23").used).toBe(3);
  });

  it("finds a stay over 90 days in 180 and the stays that made it", () => {
    const trips = [roundTrip("spring", "2026-03-01", "2026-04-30"), roundTrip("summer", "2026-06-01", "2026-07-15", "LHR", "MAD")];
    const result = evaluate(schengen, trips, london, "2026-11-23");
    expect(result.used).toBe(61 + 45);
    expect(result.status).toBe("over");
    expect(result.stretches.map((s) => [s.start, s.end, s.days, s.countries, s.tripIds])).toEqual([
      ["2026-03-01", "2026-04-30", 61, ["FR"], ["spring"]],
      ["2026-06-01", "2026-07-15", 45, ["ES"], ["summer"]],
    ]);
  });

  it("checks every 180 days ending in the last year, even those that start before it", () => {
    const result = evaluate(schengen, [roundTrip("winter", "2025-10-01", "2026-01-10")], london, "2026-11-23");
    expect(result.used).toBe(102);
    expect(result.status).toBe("over");
    // The latest window holding the whole stay.
    expect(result.window.start <= "2025-10-01" && result.window.end >= "2026-01-10").toBe(true);
  });

  it("counts the days of a drive between countries as unknown, and so as days in the area", () => {
    // A car from Paris to Berlin for three months: where it was each day
    // is not known, so none of those days may drop out of the count.
    const drive: ExtractedSegment = {
      type: "car_rental",
      title: "Car from Paris to Berlin",
      start: "2026-01-01T10:00:00+01:00",
      end: "2026-04-01T10:00:00+02:00",
      origin: { name: "Paris", country: "FR" },
      destination: { name: "Berlin", country: "DE" },
    };
    const result = evaluate(schengen, [trip("drive", "2026-01-01", "2026-04-01", [drive])], london, "2026-11-23");
    expect(result.used).toBe(91);
    expect(result.unknownDays).toBe(89);
    expect(result.status).toBe("over");
  });

  it("counts a day no booking places as a day in the area, to be safe", () => {
    const lost = trip("lost", "2026-11-01", "2026-11-03", [
      { type: "flight", title: "Out", start: "2026-11-01T09:00:00+00:00", end: "2026-11-01T12:00:00+00:00", origin: { name: "Somewhere" }, destination: { name: "Elsewhere" } },
    ]);
    expect(evaluate(schengen, [lost], london, "2026-11-23").used).toBe(3);
  });
});

describe("US", () => {
  it("counts days present for citizenship, the days of leaving and coming back included", () => {
    const result = evaluate(rule("us-citizenship", "us-citizenship-presence"), [roundTrip("london", "2026-01-01", "2026-01-10", "BOS", "LHR")], boston, "2026-11-23");
    expect(result.limit).toBe(913);
    expect(result.used).toBe(1826 - 8);
    expect(result.status).toBe("ok");
    expect(result.stretches.map((s) => [s.start, s.end])).toEqual([["2026-01-02", "2026-01-09"]]);
  });

  it("asks for 548 days in three years when married to a US citizen", () => {
    const result = evaluate(rule("us-citizenship-spouse", "us-citizenship-spouse-presence"), [], [{ city: "London", country: "GB" }], "2026-11-23");
    expect([result.used, result.limit, result.status]).toEqual([0, 548, "over"]);
  });

  it("counts Puerto Rico as the US for citizenship but not for tax", () => {
    const pr = [roundTrip("pr", "2026-10-01", "2026-10-31", "LHR", "SJU")];
    expect(evaluate(rule("us-citizenship", "us-citizenship-presence"), pr, london, "2026-11-23").used).toBe(31);
    expect(evaluate(rule("us-tax", "us-substantial-presence"), pr, london, "2026-11-23").current?.used).toBe(0);
  });

  it("flags a single absence of over six months, and one of a year or more as breaking residence", () => {
    const residence = rule("us-citizenship", "us-citizenship-continuous");
    const seven = evaluate(residence, [roundTrip("seven", "2025-01-10", "2025-08-20", "BOS", "LHR")], boston, "2026-11-23");
    expect(seven.status).toBe("near");
    expect(seven.window).toEqual({ start: "2025-01-10", end: "2025-08-20" });
    expect(seven.used).toBe(222);
    const year = evaluate(residence, [roundTrip("year", "2025-01-10", "2026-01-10", "BOS", "LHR")], boston, "2026-11-23");
    expect(year.status).toBe("over");
    const short = evaluate(residence, [roundTrip("short", "2025-01-10", "2025-07-10", "BOS", "LHR")], boston, "2026-11-23");
    expect(short.status).toBe("ok");
  });

  it("warns of a six-month absence even when a longer one, by days, is not one", () => {
    // 184 days but not over six calendar months, then 183 days that are.
    const residence = rule("us-citizenship", "us-citizenship-continuous");
    const trips = [roundTrip("spring", "2024-03-01", "2024-09-01", "BOS", "LHR"), roundTrip("winter", "2025-01-01", "2025-07-03", "BOS", "LHR")];
    const result = evaluate(residence, trips, boston, "2026-11-23");
    expect(result.status).toBe("near");
    expect(result.window).toEqual({ start: "2025-01-01", end: "2025-07-03" });
  });

  it("counts an absence still going on up to the date", () => {
    const away = trip("away", "2025-10-01", "2025-10-01", [flight("BOS", "LHR", "2025-10-01T20:00:00-04:00", "2025-10-02T07:00:00+01:00")]);
    const result = evaluate(rule("us-green-card", "us-green-card-absence"), [away], [{ city: "Boston", country: "US", until: "2025-10-01" }, { city: "London", country: "GB", from: "2025-10-02" }], "2026-11-23");
    expect(result.status).toBe("over");
    expect(result.window).toEqual({ start: "2025-10-01", end: "2026-11-23" });
  });

  it("weighs this year's days in full, last year's by a third and the year before's by a sixth", () => {
    const tax = rule("us-tax", "us-substantial-presence");
    const visits = [
      roundTrip("y0", "2026-01-01", "2026-04-30", "LHR", "JFK"),
      roundTrip("y1", "2025-01-01", "2025-04-30", "LHR", "JFK"),
      roundTrip("y2", "2024-01-01", "2024-04-29", "LHR", "JFK"),
    ];
    const result = evaluate(tax, visits, london, "2026-11-23");
    expect(result.current?.used).toBe(120);
    expect(result.used).toBeCloseTo(120 + 120 / 3 + 120 / 6);
    expect(result.status).toBe("near");
    const more = evaluate(tax, [...visits, roundTrip("y0b", "2026-06-01", "2026-06-10", "LHR", "JFK")], london, "2026-11-23");
    expect(more.status).toBe("over");
  });

  it("meets the test at exactly 183 days, with no rounding short of it", () => {
    // 31 + 292/3 + 328/6 is 183 exactly, which floating point puts just under.
    const timeline = new Map<string, { countries: Set<string>; tripIds: Set<string>; assumedHome: boolean; inTransit: boolean }>();
    const fill = (year: number, inUs: number) => {
      for (let d = new Date(Date.UTC(year, 0, 1)), i = 0; d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1), i++) {
        timeline.set(d.toISOString().slice(0, 10), { countries: new Set([i < inUs ? "US" : "GB"]), tripIds: new Set(), assumedHome: false, inTransit: false });
      }
    };
    fill(2024, 328);
    fill(2025, 292);
    fill(2026, 31);
    const result = evaluateRule(rule("us-tax", "us-substantial-presence"), timeline, "2026-11-23");
    expect(result.used).toBeCloseTo(183);
    expect(result.status).toBe("over");
  });

  it("keeps a traveler in the country through a long train ride within it", () => {
    // Two nights on a train from Chicago to Los Angeles never leave the US.
    const homes = [
      { city: "London", country: "GB", until: "2025-12-31" },
      { city: "Boston", country: "US", from: "2026-01-01" },
    ];
    const ride = trip("ride", "2026-06-01", "2026-06-03", [train(["Chicago", "US"], ["Los Angeles", "US"], "2026-06-01T14:00:00-05:00", "2026-06-03T15:00:00-07:00")]);
    const without = evaluate(rule("us-tax", "us-substantial-presence"), [], homes, "2026-07-02");
    const result = evaluate(rule("us-tax", "us-substantial-presence"), [ride], homes, "2026-07-02");
    expect(result.used).toBe(without.used);
    expect(result.status).toBe("over");
  });

  it("does not meet the test with under 31 days this year", () => {
    const visits = [
      roundTrip("y0", "2026-01-01", "2026-01-30", "LHR", "JFK"),
      roundTrip("y1", "2025-01-01", "2025-12-31", "LHR", "JFK"),
      roundTrip("y2", "2024-01-01", "2024-12-31", "LHR", "JFK"),
    ];
    const result = evaluate(rule("us-tax", "us-substantial-presence"), visits, london, "2026-11-23");
    expect(result.used).toBeGreaterThan(183);
    expect(result.status).toBe("near");
  });
});

describe("Canada", () => {
  const toronto: HomePeriod[] = [{ city: "Toronto", country: "CA" }];

  it("counts 1,095 days present for citizenship and 730 for permanent residence", () => {
    const away = [roundTrip("away", "2023-01-01", "2024-12-31", "YYZ", "LHR")];
    const citizenship = evaluate(rule("ca-citizenship", "ca-citizenship-presence"), away, toronto, "2026-11-23");
    const pr = evaluate(rule("ca-permanent-residence", "ca-pr-presence"), away, toronto, "2026-11-23");
    expect(citizenship.limit).toBe(1095);
    expect(pr.limit).toBe(730);
    expect(citizenship.used).toBe(1826 - 729);
    expect(citizenship.status).toBe("near");
    expect(pr.status).toBe("ok");
  });
});

describe("Australia", () => {
  const melbourne: HomePeriod[] = [{ city: "Melbourne", country: "AU" }];

  it("allows a year away in four years and 90 days in the last year", () => {
    const trips = [roundTrip("old", "2023-01-01", "2023-06-30", "MEL", "LHR"), roundTrip("recent", "2026-06-01", "2026-09-15", "MEL", "LHR")];
    const four = evaluate(rule("au-citizenship", "au-citizenship-four-years"), trips, melbourne, "2026-11-23");
    const last = evaluate(rule("au-citizenship", "au-citizenship-last-year"), trips, melbourne, "2026-11-23");
    expect([four.used, four.limit, four.status]).toEqual([179 + 105, 365, "ok"]);
    expect([last.used, last.limit, last.status]).toEqual([105, 90, "over"]);
  });
});

describe("residenceReport", () => {
  it("evaluates every rule in a set and says whether home has a country", () => {
    const set = residenceRuleSets.find((s) => s.id === "uk-citizenship")!;
    const report = residenceReport([roundTrip("paris", "2026-01-01", "2026-01-10")], london, set, "2026-11-23", airportPlace);
    expect(report.results.map((r) => [r.rule.id, r.used])).toEqual([
      ["uk-citizenship-five-years", 8],
      ["uk-citizenship-last-year", 8],
    ]);
    expect(report.homeCountryKnown).toBe(true);
    expect(residenceReport([], [{ city: "London" }], set, "2026-11-23").homeCountryKnown).toBe(false);
  });

  it("counts a trip booked up to the date, for planning ahead", () => {
    const set = residenceRuleSets.find((s) => s.id === "schengen")!;
    const report = residenceReport([roundTrip("ahead", "2027-01-05", "2027-01-08")], london, set, "2027-01-31", airportPlace);
    expect(report.results[0]!.used).toBe(4);
  });

  it("cites an official source for every rule, as the Android app does", () => {
    expect(residenceRuleSets.map((s) => s.id)).toEqual([
      "uk-settlement", "uk-citizenship", "schengen", "us-citizenship", "us-citizenship-spouse", "us-green-card", "us-tax", "ca-permanent-residence", "ca-citizenship", "au-citizenship",
    ]);
    for (const set of residenceRuleSets) {
      expect(set.rules.length).toBeGreaterThan(0);
      for (const r of set.rules) expect(r.source).toMatch(/^https:\/\/(www\.gov\.uk|home-affairs\.ec\.europa\.eu|www\.uscis\.gov|www\.irs\.gov|www\.canada\.ca|immi\.homeaffairs\.gov\.au)\//);
    }
  });
});
