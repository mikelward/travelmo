import { describe, expect, it } from "vitest";
import { gmailSearchUrl, journeyGapHomes, journeyGaps, journeyGapSearch, journeyGapText, withOneWay } from "./journeyGap";
import type { ExtractedSegment } from "./schema";

// Invented, shaped like a London–Boston trip.
const out: ExtractedSegment = {
  type: "flight",
  title: "XX 11 LHR to BOS",
  start: "2026-11-24T17:20:00+00:00",
  end: "2026-11-24T20:15:00-05:00",
  origin: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
  destination: { name: "Logan", code: "BOS", city: "Boston", country: "US" },
};
const back: ExtractedSegment = {
  type: "flight",
  title: "XX 4012 BOS to LHR",
  start: "2026-11-29T19:15:00-05:00",
  end: "2026-11-30T06:50:00+00:00",
  origin: { name: "Logan", code: "BOS", city: "Boston", country: "US" },
  destination: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
};
const hotel: ExtractedSegment = { type: "lodging", title: "Example Hotel", start: "2026-11-24T22:00:00-05:00", destination: { name: "Example Hotel", city: "Boston", country: "US" } };
const london = [{ city: "London", country: "GB" }];

const melbourne: ExtractedSegment = {
  type: "flight",
  title: "XX 800 MEL to SYD",
  start: "2026-01-02T09:00:00+11:00",
  end: "2026-01-02T10:30:00+11:00",
  origin: { name: "Melbourne", code: "MEL", city: "Melbourne", country: "AU" },
  destination: { name: "Sydney", code: "SYD", city: "Sydney", country: "AU" },
};
const adelaide: ExtractedSegment = {
  ...melbourne,
  title: "XX 801 SYD to ADL",
  start: "2026-01-08T09:00:00+11:00",
  end: "2026-01-08T10:30:00+10:30",
  origin: melbourne.destination!,
  destination: { name: "Adelaide", code: "ADL", city: "Adelaide", country: "AU" },
};
const egypt: ExtractedSegment = {
  ...melbourne,
  title: "XX 440 LGW to HRG",
  start: "2026-02-15T08:00:00+00:00",
  end: "2026-02-15T15:00:00+02:00",
  origin: { name: "Gatwick", code: "LGW", city: "London", country: "GB" },
  destination: { name: "Hurghada", code: "HRG", city: "Hurghada", country: "EG" },
};
const egyptBack: ExtractedSegment = { ...egypt, title: "XX 441 HRG to LGW", start: "2026-02-22T16:00:00+02:00", end: "2026-02-22T20:00:00+00:00", origin: egypt.destination!, destination: egypt.origin! };

describe("journeyGaps", () => {
  it("finds the flight back a trip that only goes out is missing", () => {
    expect(journeyGaps([out, hotel])).toEqual([
      { direction: "back", from: "Boston", fromCode: "BOS", to: "London", toCode: "LHR", mode: "flight", date: "2026-11-24" },
    ]);
  });

  it("finds nothing missing on a trip that comes back, to any of the city's airports", () => {
    expect(journeyGaps([out, hotel, back])).toEqual([]);
    const gatwick = { ...back, destination: { name: "Gatwick", code: "LGW", city: "London", country: "GB" } };
    expect(journeyGaps([out, gatwick])).toEqual([]);
  });

  it("takes two travelers' bookings on one flight as one journey", () => {
    expect(journeyGaps([out, { ...out, confirmation: "ZZ99" }, back])).toEqual([]);
  });

  it("goes by what is still booked", () => {
    expect(journeyGaps([out, { ...back, cancelledAt: "2026-11-01T00:00:00Z" }]).map((g) => g.direction)).toEqual(["back"]);
  });

  it("says journey when not every journey flies", () => {
    const train = { ...out, type: "train" as const, title: "Train" };
    expect(journeyGaps([train])[0]?.mode).toBe("journey");
  });

  it("finds the journey out a trip that only comes home is missing, once home is known", () => {
    expect(journeyGaps([back], london)).toEqual([
      { direction: "out", from: "London", fromCode: "LHR", to: "Boston", toCode: "BOS", mode: "flight", date: "2026-11-29" },
    ]);
    // Without home, a trip is taken to start at home.
    expect(journeyGaps([back])[0]?.direction).toBe("back");
  });

  it("counts landing at a home's chosen airport as coming home", () => {
    const toSfo = { ...back, destination: { name: "San Francisco", code: "SFO", city: "San Francisco", country: "US" } };
    const homes = journeyGapHomes([{ city: "Mountain View", country: "US", from: "2020-01-01" }], [{ city: "Mountain View", country: "US", airports: ["SFO"] }]);
    expect(journeyGaps([toSfo], homes)[0]?.direction).toBe("out");
    expect(journeyGaps([toSfo], journeyGapHomes([{ city: "Mountain View", country: "US", from: "2020-01-01" }], []))[0]?.direction).toBe("back");
  });

  it("finds a journey missing between two, in order with the trip's ends", () => {
    // Melbourne, Sydney, Adelaide, then nothing until Gatwick to Egypt and back.
    expect(journeyGaps([egyptBack, adelaide, egypt, melbourne], london)).toEqual([
      { direction: "out", from: "London", fromCode: "LGW", to: "Melbourne", toCode: "MEL", mode: "flight", date: "2026-01-02" },
      { direction: "between", from: "Adelaide", fromCode: "ADL", to: "London", toCode: "LGW", mode: "flight", date: "2026-01-08", until: "2026-02-15" },
    ]);
  });

  it("takes a drive between journeys as no gap", () => {
    // Landing at Heathrow, flying out of Birmingham; landing in Sydney, flying out of Canberra.
    const birmingham = { name: "Birmingham", code: "BHX", city: "Birmingham", country: "GB" };
    const fromBirmingham = { ...out, origin: birmingham, start: "2026-12-01T10:00:00+00:00", end: "2026-12-01T13:00:00-05:00" };
    expect(journeyGaps([back, fromBirmingham])).toEqual([]);
    const canberra = { name: "Canberra", code: "CBR", city: "Canberra", country: "AU" };
    expect(journeyGaps([melbourne, { ...adelaide, origin: canberra }]).map((g) => g.direction)).toEqual(["back"]);
  });

  it("leaves out the trip's ends once it is one way, not the gaps between", () => {
    expect(journeyGaps([out], [], true)).toEqual([]);
    expect(journeyGaps([adelaide, egypt], [], true).map((g) => g.direction)).toEqual(["between"]);
  });

  it("finds nothing on a trip with no journeys", () => {
    expect(journeyGaps([hotel])).toEqual([]);
    expect(journeyGaps([])).toEqual([]);
  });
});

describe("journeyGapText", () => {
  const base = { from: "Boston", to: "London", mode: "flight", date: "2026-11-24" } as const;
  it("names where the missing journey goes from and to", () => {
    expect(journeyGapText({ ...base, direction: "back" })).toBe("No flight from Boston back to London found");
    expect(journeyGapText({ ...base, direction: "out", from: "London", to: "Boston", mode: "journey" })).toBe("No journey from London to Boston found");
  });

  it("says when one between journeys could be", () => {
    expect(journeyGapText({ ...base, direction: "between", from: "Adelaide", date: "2026-01-08", until: "2026-02-15" })).toBe(
      "No flight from Adelaide to London found between 8 Jan and 15 Feb",
    );
    expect(journeyGapText({ ...base, direction: "between", until: "2026-11-24" })).toBe("No flight from Boston to London found on 24 Nov");
    expect(journeyGapText({ ...base, direction: "between", date: "2026-09-01", until: "2026-09-02" })).toBe("No flight from Boston to London found between 1 Sept and 2 Sept");
  });
});

describe("journeyGapSearch", () => {
  it("searches for both ends, by city or code", () => {
    expect(journeyGapSearch({ direction: "back", from: "Adelaide", fromCode: "ADL", to: "London", toCode: "LHR", mode: "flight", date: "2026-01-10" })).toBe(
      '("Adelaide" OR ADL) ("London" OR LHR)',
    );
    expect(journeyGapSearch({ direction: "back", from: "Bath", to: 'Say "Hi"', mode: "journey", date: "2026-01-10" })).toBe('"Bath" "Say  Hi "');
    expect(gmailSearchUrl('"Bath" "London"')).toBe("https://mail.google.com/mail/u/0/#search/%22Bath%22%20%22London%22");
  });
});

describe("withOneWay", () => {
  it("adds a trip once, keeping the newest when full", () => {
    expect(withOneWay(["t1"], "t2")).toEqual(["t1", "t2"]);
    expect(withOneWay(["t1", "t2"], "t1")).toEqual(["t2", "t1"]);
    expect(withOneWay(Array.from({ length: 200 }, (_, i) => `t${i}`), "new")).toHaveLength(200);
  });
});
