import { describe, expect, it } from "vitest";
import { checkedInOf, checkedInParam, checkedInUrl } from "./checkedIn";

describe("checkedInOf", () => {
  it("reads the booking a check-in reminder names, and nothing else", () => {
    expect(checkedInOf({ tripId: "t1", segmentId: "f1" })).toEqual({ tripId: "t1", segmentId: "f1" });
    expect(checkedInOf({ tripId: "t1" })).toBeUndefined();
    expect(checkedInOf({ tripId: "t1", segmentId: 3 })).toBeUndefined();
    expect(checkedInOf({ tripId: "", segmentId: "f1" })).toBeUndefined();
    expect(checkedInOf(undefined)).toBeUndefined();
  });
});

describe("checkedInUrl", () => {
  it("opens the trip with the booking in the query the page reads", () => {
    const url = new URL(checkedInUrl({ tripId: "t 1", segmentId: "f/1" }), "https://travelmo.example");
    expect(url.pathname).toBe("/trips/t%201");
    expect(url.searchParams.get(checkedInParam)).toBe("f/1");
  });
});
