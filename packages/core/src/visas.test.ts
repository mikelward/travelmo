import { describe, expect, it } from "vitest";
import type { TravelDocument } from "./documents";
import { visaTable } from "./visaRules";
import { bestEntry, entryLabel, entryRule, needsAction, passportsOf, travelerEntry, type VisaTable } from "./visas";

// A small invented table in the generated file's shape.
const table: VisaTable = {
  fetched: "2026-11-07",
  destinations: ["AA", "BB", "CC", "DD"],
  days: { c: 90, a: 30 },
  rules: {
    AA: "-cRE",
    BB: "F-T?",
    CC: "aN-A",
  },
};

describe("entryRule", () => {
  it("reads kinds, day counts, home and no data", () => {
    expect(entryRule(table, "AA", "BB")).toEqual({ kind: "free", days: 90 });
    expect(entryRule(table, "aa", "cc")).toEqual({ kind: "required" });
    expect(entryRule(table, "AA", "DD")).toEqual({ kind: "evisa" });
    expect(entryRule(table, "AA", "AA")).toEqual({ kind: "home" });
    expect(entryRule(table, "BB", "AA")).toEqual({ kind: "free" });
    expect(entryRule(table, "BB", "CC")).toEqual({ kind: "eta" });
    expect(entryRule(table, "BB", "DD")).toEqual({ kind: "unknown" });
    expect(entryRule(table, "CC", "BB")).toEqual({ kind: "no-admission" });
    expect(entryRule(table, "CC", "DD")).toEqual({ kind: "arrival" });
    expect(entryRule(table, "ZZ", "AA")).toEqual({ kind: "unknown" });
    expect(entryRule(table, "AA", "ZZ")).toEqual({ kind: "unknown" });
  });
});

describe("bestEntry", () => {
  it("takes the easiest passport, more visa-free days first", () => {
    expect(bestEntry(table, ["AA", "CC"], "BB")).toEqual({ rule: { kind: "free", days: 90 }, passport: "AA" });
    expect(bestEntry(table, ["CC", "AA"], "BB")).toEqual({ rule: { kind: "free", days: 90 }, passport: "AA" });
    expect(bestEntry(table, ["AA", "BB"], "CC")).toEqual({ rule: { kind: "eta" }, passport: "BB" });
    expect(bestEntry(table, ["CC", "AA"], "AA")).toEqual({ rule: { kind: "home" }, passport: "AA" });
    expect(bestEntry(table, [], "AA")).toBeUndefined();
  });
});

describe("labels", () => {
  it("say what to do", () => {
    expect(entryLabel({ kind: "free", days: 90 })).toBe("Visa-free up to 90 days");
    expect(entryLabel({ kind: "free" })).toBe("Visa-free");
    expect(entryLabel({ kind: "eta" })).toBe("Electronic travel authorization needed");
    expect(entryLabel({ kind: "unknown" })).toBe("No data");
    expect(needsAction("evisa")).toBe(true);
    expect(needsAction("arrival")).toBe(false);
  });
});

const passport = (country: string, expires = "2031-01-01"): TravelDocument => ({ title: `Passport ${country}`, kind: "passport", expires, country });
const trip = { start: "2027-05-01", end: "2027-05-10" };

describe("travelerEntry", () => {
  it("lists what each country of the trip needs, home left out, a held visa noted", () => {
    const visa: TravelDocument = { title: "Visa CC", kind: "visa", expires: "2027-12-31", country: "CC" };
    const { passports, needs } = travelerEntry(table, [passport("AA"), visa], new Set(["cc", "AA", "BB"]), trip);
    expect(passports).toEqual(["AA"]);
    expect(needs).toEqual([
      { country: "BB", best: { rule: { kind: "free", days: 90 }, passport: "AA" } },
      { country: "CC", best: { rule: { kind: "required" }, passport: "AA" }, visa },
    ]);
  });

  it("ignores passports expired before the trip and a visa that runs out during it, and says nothing without a passport", () => {
    expect(passportsOf([passport("AA", "2027-04-30"), passport("BB"), passport("BB")], trip.start)).toEqual(["BB"]);
    const expiring: TravelDocument = { title: "Visa CC", kind: "visa", expires: "2027-05-05", country: "CC" };
    const { needs } = travelerEntry(table, [passport("AA"), expiring], new Set(["CC"]), trip);
    expect(needs[0]).toEqual({ country: "CC", best: { rule: { kind: "required" }, passport: "AA" } });
    expect(travelerEntry(table, [expiring], new Set(["CC"]), trip)).toEqual({ passports: [], needs: [] });
  });
});

describe("the generated table", () => {
  it("covers every destination for every passport with a known code", () => {
    expect(visaTable.destinations.length).toBeGreaterThan(150);
    expect(visaTable.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const [passport, row] of Object.entries(visaTable.rules)) {
      expect(row).toHaveLength(visaTable.destinations.length);
      expect(entryRule(visaTable, passport, passport)).toEqual({ kind: "home" });
      for (const ch of row) expect("-FATERN?".includes(ch) || ch in visaTable.days).toBe(true);
    }
  });
});
