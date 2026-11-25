import { describe, expect, it } from "vitest";
import { decodeReportSnapshot, encodeReportSnapshot } from "./reportSnapshot";
import type { TravelReport } from "./reports";

// Invented places.
const report: TravelReport = {
  trips: 1,
  days: 5,
  countries: [{ country: "PT", days: 5, trips: 1, tripIds: ["lisbon"] }],
  years: [{ year: "2026", trips: 1, days: 5, countries: 1 }],
  airports: [{ code: "LIS", country: "PT", lat: 38.77, lon: -9.13 }],
  places: [
    { name: "Example Guesthouse", city: "Lisbon", country: "PT", lat: 38.71, lon: -9.14 },
    { name: "Somewhere", lat: 1, lon: 2 },
  ],
  unknownDays: 0,
  unplaced: 0,
  upcoming: 2,
};

describe("report snapshots", () => {
  it("reads back what it wrote for the same account", () => {
    expect(decodeReportSnapshot(encodeReportSnapshot("u1", report), "u1")).toEqual(report);
  });

  it("shows another account's counts to no one", () => {
    expect(decodeReportSnapshot(encodeReportSnapshot("u1", report), "u2")).toBeUndefined();
    expect(decodeReportSnapshot(null, "u1")).toBeUndefined();
  });

  it("refuses text it can't read", () => {
    expect(() => decodeReportSnapshot('{"uid":', "u1")).toThrow();
    expect(() => decodeReportSnapshot('{"uid":"u1","report":{}}', "u1")).toThrow();
  });
});
