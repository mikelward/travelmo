import type { Segment } from "@travelmo/core";
import { describe, expect, it, vi } from "vitest";
import { deriveHomes, failedReadsText, logged } from "./home";

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
    expect(deriveHomes(byTrip, [], [])).toEqual({ periods: [{ city: "London" }], corrections: [], chosen: [], failed: 0 });
  });

  it("counts the trips that could not be read", () => {
    expect(deriveHomes(byTrip, ["x", "y"], []).failed).toBe(2);
    expect(deriveHomes({}, ["x"], [])).toEqual({ periods: [], corrections: [], chosen: [], failed: 1 });
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
