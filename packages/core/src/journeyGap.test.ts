import { describe, expect, it } from "vitest";
import { gmailSearchUrl, journeyGap, journeyGapHomes, journeyGapSearch, journeyGapText, withOneWay } from "./journeyGap";
import type { ExtractedSegment } from "./schema";

// Invented, shaped like a London–Boston trip.
const out: ExtractedSegment = {
  type: "flight",
  title: "XX 11 LHR to BOS",
  start: "2026-11-24T17:20:00+00:00",
  end: "2026-11-24T20:15:00-05:00",
  confirmation: "AB12CD",
  origin: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
  destination: { name: "Logan", code: "BOS", city: "Boston", country: "US" },
};
const back: ExtractedSegment = {
  type: "flight",
  title: "XX 4012 BOS to LHR",
  start: "2026-11-29T19:15:00-05:00",
  end: "2026-11-30T06:50:00+00:00",
  confirmation: "AB12CD",
  origin: { name: "Logan", code: "BOS", city: "Boston", country: "US" },
  destination: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
};
const hotel: ExtractedSegment = { type: "lodging", title: "Example Hotel", start: "2026-11-24T22:00:00-05:00", destination: { name: "Example Hotel", city: "Boston", country: "US" } };
const london = [{ city: "London", country: "GB" }];

describe("journeyGap", () => {
  it("finds the flight back a trip that only goes out is missing", () => {
    expect(journeyGap([out, hotel])).toEqual({ direction: "back", to: "London", mode: "flight", date: "2026-11-24", references: ["AB12CD"] });
  });

  it("finds nothing missing on a trip that comes back, to any of the city's airports", () => {
    expect(journeyGap([out, hotel, back])).toBeUndefined();
    const gatwick = { ...back, destination: { name: "Gatwick", code: "LGW", city: "London", country: "GB" } };
    expect(journeyGap([out, gatwick])).toBeUndefined();
  });

  it("goes by what is still booked", () => {
    expect(journeyGap([out, { ...back, cancelledAt: "2026-11-01T00:00:00Z" }])?.direction).toBe("back");
  });

  it("says journey when not every journey flies", () => {
    const train = { ...out, type: "train" as const, title: "Train" };
    expect(journeyGap([train])?.mode).toBe("journey");
  });

  it("finds the journey out a trip that only comes home is missing, once home is known", () => {
    expect(journeyGap([back], london)).toEqual({ direction: "out", to: "Boston", mode: "flight", date: "2026-11-29", references: ["AB12CD"] });
    // Without home, a trip is taken to start at home.
    expect(journeyGap([back])?.direction).toBe("back");
  });

  it("counts landing at a home's chosen airport as coming home", () => {
    const toSfo = { ...back, destination: { name: "San Francisco", code: "SFO", city: "San Francisco", country: "US" } };
    const homes = journeyGapHomes([{ city: "Mountain View", country: "US", from: "2020-01-01" }], [{ city: "Mountain View", country: "US", airports: ["SFO"] }]);
    expect(journeyGap([toSfo], homes)?.direction).toBe("out");
    expect(journeyGap([toSfo], journeyGapHomes([{ city: "Mountain View", country: "US", from: "2020-01-01" }], []))?.direction).toBe("back");
  });

  it("finds nothing on a trip with no journeys", () => {
    expect(journeyGap([hotel])).toBeUndefined();
    expect(journeyGap([])).toBeUndefined();
  });
});

describe("journeyGapText", () => {
  it("names the city the missing journey goes to", () => {
    expect(journeyGapText({ direction: "back", to: "London", mode: "flight", date: "2026-11-24", references: [] })).toBe("No flight back to London found");
    expect(journeyGapText({ direction: "out", to: "Boston", mode: "journey", date: "2026-11-29", references: [] })).toBe("No journey to Boston found");
  });
});

describe("journeyGapSearch", () => {
  it("searches by the trip's booking references, else the city", () => {
    expect(journeyGapSearch({ direction: "back", to: "London", mode: "flight", date: "2026-11-24", references: ["AB12CD", "EF34"] })).toBe("AB12CD OR EF34");
    expect(journeyGapSearch({ direction: "back", to: "London", mode: "flight", date: "2026-11-24", references: [] })).toBe('"London"');
    expect(gmailSearchUrl("AB12CD OR EF34")).toBe("https://mail.google.com/mail/u/0/#search/AB12CD%20OR%20EF34");
  });
});

describe("withOneWay", () => {
  it("adds a trip once, keeping the newest when full", () => {
    expect(withOneWay(["t1"], "t2")).toEqual(["t1", "t2"]);
    expect(withOneWay(["t1", "t2"], "t1")).toEqual(["t2", "t1"]);
    expect(withOneWay(Array.from({ length: 200 }, (_, i) => `t${i}`), "new")).toHaveLength(200);
  });
});
