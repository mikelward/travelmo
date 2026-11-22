import type { Segment } from "@travelmo/core";
import { describe, expect, it, vi } from "vitest";
import { correctionText, deriveHomes, failedReadsText, homeLine, logged, parseCorrection } from "./home";

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
  });

  it("says what is missing", () => {
    expect(parseCorrection("", "GB", "2021-03-12")).toBe("Enter a city.");
    expect(parseCorrection("London", "GBR", "2021-03-12")).toBe("Use a two-letter country code, such as GB.");
    expect(parseCorrection("London", "GB", "")).toBe("Enter a date.");
  });
});

describe("deriveHomes", () => {
  const at = "2026-01-01T00:00:00Z";
  const flight = (id: string, start: string, from: string, to: string): Segment => ({
    id,
    tripId: "t",
    type: "flight",
    title: `${from} to ${to}`,
    start,
    origin: { name: from, city: from },
    destination: { name: to, city: to },
    source: "gmail",
    gmailMessageIds: [],
    createdAt: at,
    updatedAt: at,
  });
  const byTrip = { t: [flight("a", "2025-04-01T09:00:00+00:00", "London", "Rome"), flight("b", "2025-04-05T18:00:00+00:00", "Rome", "London")] };

  it("works out home from the trips read, with corrections over it", () => {
    expect(deriveHomes(byTrip, [], [])).toEqual({ periods: [{ city: "London" }], corrections: [], failed: 0 });
  });

  it("counts the trips that could not be read", () => {
    expect(deriveHomes(byTrip, ["x", "y"], []).failed).toBe(2);
    expect(deriveHomes({}, ["x"], [])).toEqual({ periods: [], corrections: [], failed: 1 });
  });
});

describe("failedReadsText", () => {
  it("says the timeline is missing what those trips would say", () => {
    expect(failedReadsText(1)).toBe("1 trip couldn't be read, so it isn't counted. Reload to try again.");
    expect(failedReadsText(3)).toBe("3 trips couldn't be read, so they aren't counted. Reload to try again.");
  });
});

describe("logged", () => {
  it("logs a failure by what it was doing and passes it on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("permission-denied");
    await expect(logged("adding one", () => Promise.reject(failure))).rejects.toBe(failure);
    expect(error).toHaveBeenCalledWith("Home corrections: adding one failed", failure);
    error.mockRestore();
  });

  it("returns what the change returns", async () => {
    await expect(logged("removing one", async () => 7)).resolves.toBe(7);
  });
});
