import { describe, expect, it } from "vitest";
import { duplicateFlightCancel, duplicateFlightKey, duplicateFlights, duplicateFlightText } from "./duplicateFlights";
import type { ExtractedSegment } from "./schema";

// Invented, shaped like a December trip whose first booking was made again two days earlier elsewhere.
const lgw = { name: "Gatwick", code: "LGW", city: "London", country: "GB" };
const dxb = { name: "Dubai", code: "DXB", city: "Dubai", country: "AE" };
const flight = (id: string, start: string, extra: Partial<ExtractedSegment> = {}) => ({
  id,
  type: "flight" as const,
  title: "XX 10 LGW to DXB",
  start,
  origin: lgw,
  destination: dxb,
  ...extra,
});

describe("duplicateFlights", () => {
  const taken = flight("a", "2022-12-15T20:25:00+00:00");
  const old = flight("b", "2022-12-17T21:45:00+00:00");

  it("finds one flight booked on two days near each other", () => {
    const pairs = duplicateFlights([old, taken]);
    expect(pairs.map((p) => [p.first.id, p.second.id])).toEqual([["a", "b"]]);
    expect(duplicateFlightText(pairs[0]!)).toBe("XX 10 LGW to DXB is booked on 15 Dec and 17 Dec.");
    expect(duplicateFlightCancel(old)).toBe("Mark 17 Dec cancelled");
  });

  it("leaves alone what isn't one flight booked twice", () => {
    // Once cancelled, it's settled.
    expect(duplicateFlights([taken, { ...old, cancelledAt: "2022-12-01T00:00:00Z" }])).toEqual([]);
    // Another flight, another route, the same day, or weeks apart.
    expect(duplicateFlights([taken, { ...old, title: "XX 12 LGW to DXB" }])).toEqual([]);
    expect(duplicateFlights([taken, { ...old, destination: { ...dxb, code: "DWC" } }])).toEqual([]);
    expect(duplicateFlights([taken, { ...old, start: "2022-12-15T22:00:00+00:00" }])).toEqual([]);
    expect(duplicateFlights([taken, { ...old, start: "2023-01-17T21:45:00+00:00" }])).toEqual([]);
  });

  it("asks no more once the owner says both were taken", () => {
    expect(duplicateFlights([taken, old], [duplicateFlightKey(old, taken)])).toEqual([]);
  });
});
