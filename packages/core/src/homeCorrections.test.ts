import { describe, expect, it } from "vitest";
import { correctionText, homeLine, parseCorrection } from "./home";

describe("homeLine", () => {
  it("says where home has been, newest first", () => {
    expect(
      homeLine([
        { city: "Boston", from: "2018-09-01", until: "2021-03-11" },
        { city: "London", from: "2021-03-12" },
      ]),
    ).toBe("Home: London since Mar 2021 · Boston 2018–2021");
  });

  it("says nothing when home is unknown", () => {
    expect(homeLine([])).toBeUndefined();
  });
});

describe("correctionText", () => {
  it("names the town and the date", () => {
    expect(correctionText({ city: "London", country: "GB", from: "2021-03-12" })).toBe("London, GB from 12 Mar 2021");
    expect(correctionText({ city: "London", from: "2021-03-12" })).toBe("London from 12 Mar 2021");
  });
});

describe("parseCorrection", () => {
  it("takes a city, an optional country code and a date", () => {
    expect(parseCorrection(" London ", "gb", "2021-03-12")).toEqual({ city: "London", country: "GB", from: "2021-03-12" });
    expect(parseCorrection("London", "", "2021-03-12")).toEqual({ city: "London", from: "2021-03-12" });
    // A short form or a name is saved as its code.
    expect(parseCorrection("London", "UK", "2021-03-12")).toEqual({ city: "London", country: "GB", from: "2021-03-12" });
    expect(parseCorrection("Boston", "United States", "2021-03-12")).toEqual({ city: "Boston", country: "US", from: "2021-03-12" });
  });

  it("says what is missing", () => {
    expect(parseCorrection("", "GB", "2021-03-12")).toBe("Enter a city.");
    expect(parseCorrection("x".repeat(100), "", "2021-03-12")).toEqual({ city: "x".repeat(100), from: "2021-03-12" });
    expect(parseCorrection("x".repeat(101), "", "2021-03-12")).toBe("Use a city name of at most 100 characters.");
    expect(parseCorrection("London", "GBR", "2021-03-12")).toBe("Use a two-letter country code, such as GB.");
    expect(parseCorrection("London", "ZZ", "2021-03-12")).toBe("Use a two-letter country code, such as GB.");
    expect(parseCorrection("London", "GB", "")).toBe("Enter a date.");
  });
});
