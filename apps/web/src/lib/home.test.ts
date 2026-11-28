import type { Segment, Trip } from "@travelmo/core";
import { describe, expect, it, vi } from "vitest";
import { deriveHomes, failedReadsText, homesFrom, logged } from "./home";

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
    expect(deriveHomes(byTrip, [], [])).toEqual({ periods: [{ city: "London" }], corrections: [], chosen: [], notHome: [], failed: 0 });
  });

  it("lists a month of stays as home, but one said not to be", () => {
    const flat = (id: string, start: string, end: string): Segment => ({
      ...flight(id, `${start}T15:00:00+00:00`, "London", "London"),
      type: "lodging",
      title: "Flat",
      end: `${end}T11:00:00+00:00`,
      origin: undefined,
      destination: { name: "Flat", city: "Paris" },
    });
    const stays = { ...byTrip, s: [flat("f1", "2025-06-01", "2025-06-15"), flat("f2", "2025-06-15", "2025-07-01")] };
    expect(deriveHomes(stays, [], []).periods.filter((p) => p.stay).map((p) => [p.city, p.from, p.until])).toEqual([["Paris", "2025-06-01", "2025-07-01"]]);
    expect(deriveHomes(stays, [], [], [], [{ city: "Paris", from: "2025-06-01" }]).periods.some((p) => p.stay)).toBe(false);
  });

  it("counts the trips that could not be read", () => {
    expect(deriveHomes(byTrip, ["x", "y"], []).failed).toBe(2);
    expect(deriveHomes({}, ["x"], [])).toEqual({ periods: [], corrections: [], chosen: [], notHome: [], failed: 1 });
  });
});

describe("homesFrom", () => {
  const at = "2026-01-01T00:00:00Z";
  const trip = (id: string) => ({ id, ownerUid: "u1", title: id, start: "2025-04-01", end: "2025-04-05", sharedWith: [], createdAt: at, updatedAt: at }) as unknown as Trip;
  const flight = (id: string, start: string, from: string, to: string): Segment => ({
    id, tripId: "t", type: "flight", title: `${from} to ${to}`, start,
    origin: { name: from, city: from }, destination: { name: to, city: to },
    source: "gmail", gmailMessageIds: [], createdAt: at, updatedAt: at,
  });
  const byTrip = { t: [flight("a", "2025-04-01T09:00:00+00:00", "London", "Rome"), flight("b", "2025-04-05T18:00:00+00:00", "Rome", "London")] };
  const corrections = [{ city: "Paris", country: "FR", from: "2026-01-01" }];

  it("works out nothing while a trip's bookings came from the cache alone", () => {
    expect(homesFrom([trip("t")], { byTrip, failed: [], unconfirmed: ["t"] }, "u1", [], {})).toBeUndefined();
  });

  it("works out no home from the other trips while one couldn't be read, keeping the corrections", () => {
    expect(homesFrom([trip("t"), trip("x")], { byTrip, failed: ["x"], unconfirmed: [] }, "u1", [], { homes: corrections })).toEqual({
      periods: [], corrections, chosen: [], notHome: [], failed: 1,
    });
  });

  it("works out home once every trip is read", () => {
    expect(homesFrom([trip("t")], { byTrip, failed: [], unconfirmed: [] }, "u1", [], {})?.periods).toEqual([{ city: "London" }]);
  });
});

describe("failedReadsText", () => {
  it("says home waits for those trips", () => {
    expect(failedReadsText(1)).toBe("1 trip couldn't be read, so home can't be worked out yet. Reload to try again.");
    expect(failedReadsText(3)).toBe("3 trips couldn't be read, so home can't be worked out yet. Reload to try again.");
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
