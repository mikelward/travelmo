import { describe, expect, it } from "vitest";
import { countryName } from "./countries";
import { localToday } from "./dates";

describe("countryName", () => {
  it("names a country by its code", () => {
    expect(countryName("FR")).toBe("France");
  });

  it("shows a code Intl rejects as it is", () => {
    expect(countryName("1!")).toBe("1!");
  });
});

describe("localToday", () => {
  it("is the local calendar date", () => {
    expect(localToday(new Date(2025, 0, 9, 23, 30))).toBe("2025-01-09");
  });
});
