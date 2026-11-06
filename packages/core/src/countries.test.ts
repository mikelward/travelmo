import { describe, expect, it } from "vitest";
import { countryCodeOf, isCountryCode } from "./countries";

describe("countryCodeOf", () => {
  it("reads a country's English name, however it is cased or spaced", () => {
    expect(countryCodeOf("Australia")).toBe("AU");
    expect(countryCodeOf("  united   kingdom ")).toBe("GB");
    expect(countryCodeOf("Netherlands")).toBe("NL");
    expect(countryCodeOf("The Netherlands")).toBe("NL");
    expect(countryCodeOf("St. Lucia")).toBe("LC");
    expect(countryCodeOf("Saint Lucia")).toBe("LC");
  });

  it("knows the short forms and old names people write", () => {
    expect(countryCodeOf("USA")).toBe("US");
    expect(countryCodeOf("U.S.A.")).toBe("US");
    expect(countryCodeOf("UK")).toBe("GB");
    expect(countryCodeOf("Scotland")).toBe("GB");
    expect(countryCodeOf("Holland")).toBe("NL");
    expect(countryCodeOf("South Korea")).toBe("KR");
  });

  it("gives nothing for a city, a state or a blank", () => {
    expect(countryCodeOf("Paris")).toBeUndefined();
    expect(countryCodeOf("NSW")).toBeUndefined();
    expect(countryCodeOf("America")).toBeUndefined();
    expect(countryCodeOf("")).toBeUndefined();
  });

  it("agrees with the code list", () => {
    expect(isCountryCode("au")).toBe(true);
    expect(countryCodeOf("Kosovo")).toBe("XK");
  });
});
