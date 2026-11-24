import { describe, expect, it } from "vitest";
import { AeroApiError, aeroApiLookup, lookupWindow, matchFlight, statusFromFlight, type AeroFlight } from "./aeroapi";

// Shaped like AeroAPI's answers for an invented flight number, trimmed to
// the fields read.
const outbound: AeroFlight = {
  origin: { code_iata: "SYD" },
  destination: { code_iata: "SIN" },
  scheduled_out: "2026-12-12T22:00:00Z",
  estimated_out: "2026-12-12T22:10:00Z",
  actual_out: null,
  scheduled_in: "2026-12-13T07:30:00Z",
  estimated_in: "2026-12-13T07:35:00Z",
  actual_in: null,
  gate_origin: "8",
  gate_destination: "D46",
  terminal_origin: "1",
  terminal_destination: null,
  baggage_claim: null,
  cancelled: false,
};
const onward: AeroFlight = { ...outbound, origin: { code_iata: "SIN" }, destination: { code_iata: "LHR" }, scheduled_out: "2026-12-13T09:00:00Z" };
const dayBefore: AeroFlight = { ...outbound, scheduled_out: "2026-12-11T22:00:00Z" };

const segment = { start: "2026-12-13T09:00:00+11:00", origin: { name: "Sydney", code: "SYD" } };

describe("aeroApiLookup", () => {
  it("asks for the number around the booked departure, with the key in its header", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const lookup = aeroApiLookup("k", async (url, init) => {
      calls.push([String(url), init]);
      return new Response(JSON.stringify({ flights: [outbound, { nonsense: true, scheduled_out: 5 }] }), { status: 200 });
    });
    const { from, to } = lookupWindow(segment.start);
    expect(await lookup("XX100", from, to)).toEqual([outbound]);
    expect(calls[0]![0]).toBe(
      "https://aeroapi.flightaware.com/aeroapi/flights/XX100?ident_type=designator&start=2026-12-12T10%3A00%3A00Z&end=2026-12-13T10%3A00%3A00Z&max_pages=1",
    );
    expect((calls[0]![1]!.headers as Record<string, string>)["x-apikey"]).toBe("k");
  });

  it("reads 'no data' as no flights, and fails on anything else", async () => {
    expect(await aeroApiLookup("k", async () => new Response("{}", { status: 404 }))("XX9999", "a", "b")).toEqual([]);
    await expect(aeroApiLookup("k", async () => new Response("", { status: 401 }))("XX1", "a", "b")).rejects.toThrow(AeroApiError);
    await expect(aeroApiLookup("k", async () => new Response("[]", { status: 200 }))("XX1", "a", "b")).rejects.toThrow("MALFORMED");
    await expect(
      aeroApiLookup("k", async () => {
        throw new Error("socket hang up");
      })("XX1", "a", "b"),
    ).rejects.toThrow("UNREACHABLE");
  });
});

describe("matchFlight", () => {
  it("takes the leg from the booking's airport leaving closest to the booked time", () => {
    expect(matchFlight([onward, dayBefore, outbound], segment)).toBe(outbound);
    expect(matchFlight([onward], segment)).toBeUndefined();
    expect(matchFlight([dayBefore], segment)).toBeUndefined();
    expect(matchFlight([onward, outbound], { start: segment.start })).toBe(outbound);
  });
});

describe("statusFromFlight", () => {
  it("takes takeoff and touchdown for departure and arrival when the airports report no gate times", () => {
    const flown = { ...outbound, actual_off: "2026-12-12T22:25:00Z", actual_on: "2026-12-13T07:20:00Z" };
    expect(statusFromFlight(flown, { ident: "XX100", date: "2026-12-13" }, "2026-12-13T08:00:00Z")).toMatchObject({
      actualOut: "2026-12-12T22:25:00Z",
      actualIn: "2026-12-13T07:20:00Z",
    });
    // Gate times, when there are any, come first.
    const gated = { ...flown, actual_out: "2026-12-12T22:12:00Z", actual_in: "2026-12-13T07:28:00Z" };
    expect(statusFromFlight(gated, { ident: "XX100", date: "2026-12-13" }, "2026-12-13T08:00:00Z")).toMatchObject({
      actualOut: "2026-12-12T22:12:00Z",
      actualIn: "2026-12-13T07:28:00Z",
    });
  });

  it("keeps the places and times, leaving out what AeroAPI did not say", () => {
    expect(statusFromFlight(outbound, { ident: "XX100", date: "2026-12-13", origin: "SYD" }, "2026-12-12T21:00:00Z")).toEqual({
      ident: "XX100",
      date: "2026-12-13",
      origin: "SYD",
      found: true,
      departureGate: "8",
      departureTerminal: "1",
      arrivalGate: "D46",
      scheduledOut: "2026-12-12T22:00:00Z",
      estimatedOut: "2026-12-12T22:10:00Z",
      scheduledIn: "2026-12-13T07:30:00Z",
      estimatedIn: "2026-12-13T07:35:00Z",
      checkedAt: "2026-12-12T21:00:00Z",
    });
    expect(statusFromFlight({ ...outbound, cancelled: true }, { ident: "XX100", date: "2026-12-13" }, "2026-12-12T21:00:00Z").cancelled).toBe(true);
    const diverted = { ...outbound, diverted: true, destination: { code_iata: "KUL" } };
    expect(statusFromFlight(diverted, { ident: "XX100", date: "2026-12-13" }, "2026-12-12T21:00:00Z")).toMatchObject({ diverted: true, divertedTo: "KUL" });
    expect(statusFromFlight(undefined, { ident: "XX100", date: "2026-12-13" }, "2026-12-12T21:00:00Z")).toEqual({
      ident: "XX100",
      date: "2026-12-13",
      found: false,
      checkedAt: "2026-12-12T21:00:00Z",
    });
  });
});
