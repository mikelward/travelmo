import type { Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { answerOf, answerTo } from "./tripsAnswer";

const trip = (id: string) => ({ id }) as Trip;
const snap = (trips: Trip[], changes: number, fromCache: boolean) => ({
  trips,
  docChanges: () => Array.from({ length: changes }),
  metadata: { fromCache },
});
const parse = (s: ReturnType<typeof snap>) => s.trips;

describe("answerOf", () => {
  it("keeps the trips when only the server's confirmation changed", () => {
    const cached = answerOf(undefined, "a@example.com", snap([trip("t1")], 1, true), parse);
    const confirmed = answerOf(cached, "a@example.com", snap([trip("t1")], 0, false), parse);
    expect(confirmed.trips).toBe(cached.trips);
    expect(confirmed.confirmed).toBe(true);
  });

  it("never keeps another query's trips, even when the new one's first snapshot changes nothing", () => {
    const before = answerOf(undefined, "a@example.com\nb@example.com", snap([trip("shared")], 1, false), parse);
    const after = answerOf(before, "a@example.com", snap([], 0, false), parse);
    expect(after.trips).toEqual([]);
  });
});

describe("answerTo", () => {
  it("is no answer while the current query's own hasn't come", () => {
    const old = answerOf(undefined, "old", snap([trip("t1")], 1, false), parse);
    expect(answerTo(old, "new")).toBeUndefined();
    expect(answerTo(old, "old")).toBe(old);
  });
});
