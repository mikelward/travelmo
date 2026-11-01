import { describe, expect, it } from "vitest";
import { airportZone } from "./airports";
import zones from "./airports.json";

describe("airportZone", () => {
  it("knows the zone of major airports", () => {
    expect(airportZone("LHR")).toBe("Europe/London");
    expect(airportZone("JFK")).toBe("America/New_York");
    expect(airportZone("SYD")).toBe("Australia/Sydney");
    expect(airportZone("HND")).toBe("Asia/Tokyo");
  });

  it("is forgiving about case and spaces, and silent about anything else", () => {
    expect(airportZone(" lhr ")).toBe("Europe/London");
    expect(airportZone("")).toBeUndefined();
    expect(airportZone("LHRX")).toBeUndefined();
    expect(airportZone("ZZZ")).toBeUndefined();
  });

  it("holds only zones this runtime can use", () => {
    const distinct = new Set(Object.values(zones));
    expect(distinct.size).toBeGreaterThan(300);
    for (const zone of distinct) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: zone })).not.toThrow();
    }
    expect(Object.keys(zones).length).toBeGreaterThan(5000);
  });
});
