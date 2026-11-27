import { describe, expect, it } from "vitest";
import { mixedTrip } from "./mixedTrip";
import type { ExtractedSegment } from "./schema";

// Invented flights: the user's out and back, and a relative's from the other
// side of the world in the same weeks.
const flight = (title: string, from: string, to: string, start: string, end: string, travelers?: string[]): ExtractedSegment => ({
  type: "flight",
  title,
  start,
  end,
  origin: { name: from, code: from },
  destination: { name: to, code: to },
  ...(travelers ? { travelers } : {}),
});
const out = flight("XX 1 LHR to DXB", "LHR", "DXB", "2026-12-12T09:00:00+00:00", "2026-12-12T19:00:00+04:00");
const back = flight("XX 2 DXB to LHR", "DXB", "LHR", "2026-12-20T09:00:00+04:00", "2026-12-20T13:00:00+00:00");
const stay: ExtractedSegment = { type: "lodging", title: "Example Hotel", start: "2026-12-12T20:00:00+04:00", end: "2026-12-20T07:00:00+04:00", destination: { name: "Example Hotel", city: "Dubai", country: "AE" } };

describe("mixedTrip", () => {
  it("is nothing for one traveler's journey, with a connection and a flight booked twice", () => {
    const onward = flight("XX 3 DXB to SYD", "DXB", "SYD", "2026-12-12T22:00:00+04:00", "2026-12-13T18:00:00+11:00");
    expect(mixedTrip([out, stay, back])).toBeUndefined();
    expect(mixedTrip([out, onward])).toBeUndefined();
    expect(mixedTrip([out, { ...out, title: "XX 1" }, back])).toBeUndefined();
    // Nor when the bookings don't say when it lands.
    const { end: _end, ...untimed } = out;
    expect(mixedTrip([untimed, { ...untimed, title: "XX 1" }])).toBeUndefined();
    expect(mixedTrip([])).toBeUndefined();
    // One flight, one booking naming its cities and the other its airports.
    const named: ExtractedSegment = { ...out, title: "XX London to Dubai", origin: { name: "London" }, destination: { name: "Dubai" } };
    expect(mixedTrip([out, named])).toBeUndefined();
    expect(mixedTrip([{ ...out, travelers: ["Sam Example"] }, { ...named, travelers: ["Pat Example"] }])).toBeUndefined();
    // One booking's through flight beside another's legs of it.
    const through = flight("XX 9 ADL to LHR", "ADL", "LHR", "2026-12-12T21:00:00+10:30", "2026-12-13T13:00:00+00:00");
    const first = flight("XX 9 ADL to DOH", "ADL", "DOH", "2026-12-12T21:00:00+10:30", "2026-12-13T05:00:00+03:00");
    const second = flight("XX 7 DOH to LHR", "DOH", "LHR", "2026-12-13T07:30:00+03:00", "2026-12-13T13:00:00+00:00");
    expect(mixedTrip([through, first, second])).toBeUndefined();
    // So two people on it, one booked through and one by its legs, fly together.
    expect(mixedTrip([{ ...through, travelers: ["Sam Example"] }, { ...first, travelers: ["Pat Example"] }, { ...second, travelers: ["Pat Example"] }])).toBeUndefined();
  });

  it("is two flights in the air at once", () => {
    // 04:00 to 13:00 UTC, while XX 1 flies 09:00 to 15:00.
    const theirs = flight("YY 9 SYD to SIN", "SYD", "SIN", "2026-12-12T15:00:00+11:00", "2026-12-12T21:00:00+08:00");
    expect(mixedTrip([out, theirs, back])).toMatchObject({ kind: "overlap", first: theirs, second: out });
    // Two airports in one city are two places.
    expect(mixedTrip([out, flight("XX 5 LGW to AUH", "LGW", "AUH", "2026-12-12T09:30:00+00:00", "2026-12-12T19:30:00+04:00")])).toMatchObject({ kind: "overlap" });
    // Leaving from the same airport hours later is another flight.
    const later = flight("YY 3 LHR to CDG", "LHR", "CDG", "2026-12-12T12:00:00+00:00", "2026-12-12T14:30:00+01:00");
    expect(mixedTrip([out, later])).toMatchObject({ kind: "overlap" });
    // Neither saying where it leaves from is no sign they're one journey.
    // (10:00 to 14:00 UTC, within XX 1's 09:00 to 15:00.)
    const { origin: _a, ...outNowhere } = out;
    const { origin: _b, ...inside } = flight("YY 5 KUL to SIN", "KUL", "SIN", "2026-12-12T18:00:00+08:00", "2026-12-12T22:00:00+08:00");
    expect(mixedTrip([outNowhere, inside])).toMatchObject({ kind: "overlap" });
  });

  it("is a flight leaving from another country hours after the last landed, but not days after", () => {
    // Six hours after XX 1 lands in Dubai (15:00 UTC).
    const theirs = flight("YY 8 SYD to AKL", "SYD", "AKL", "2026-12-13T08:00:00+11:00", "2026-12-13T13:00:00+13:00");
    expect(mixedTrip([out, theirs])).toMatchObject({ kind: "elsewhere", first: out, second: theirs });
    const later = { ...theirs, start: "2026-12-16T08:00:00+11:00", end: "2026-12-16T13:00:00+13:00" };
    expect(mixedTrip([out, later])).toBeUndefined();
  });

  it("is bookings for two groups of people who share no flight", () => {
    const ours = [{ ...out, travelers: ["Sam Example"] }, { ...back, travelers: ["SAM EXAMPLE"] }, { ...stay, travelers: ["Sam Example"] }];
    const theirs = flight("YY 7 LHR to DXB", "LHR", "DXB", "2026-12-14T09:00:00+00:00", "2026-12-14T19:00:00+04:00", ["Pat Example"]);
    expect(mixedTrip([...ours, theirs])).toEqual({ kind: "travelers", groups: [["Sam Example"], ["Pat Example"]] });
    // A party booked apart on the same flight is one trip.
    expect(mixedTrip([...ours, { ...out, travelers: ["Pat Example"] }])).toBeUndefined();
    // Names on one booking travel together.
    expect(mixedTrip([...ours, { ...theirs, travelers: ["Pat Example", "Sam Example"] }])).toBeUndefined();
    // A party joined by one who flies out with some and back with others.
    expect(mixedTrip([{ ...out, travelers: ["Alice Example"] }, { ...out, travelers: ["Bob Example"] }, { ...back, travelers: ["Bob Example"] }, { ...back, travelers: ["Carol Example"] }])).toBeUndefined();
    // Another spelling of one person is that person.
    expect(mixedTrip([{ ...out, travelers: ["John Smith"] }, { ...back, travelers: ["John Andrew Smith"] }, { ...theirs, travelers: ["J Smith"] }])).toBeUndefined();
    // One the owner took off the trip doesn't count.
    expect(mixedTrip([...ours, theirs], ["Pat Example"])).toBeUndefined();
  });

  it("goes by what is still booked", () => {
    const theirs = flight("YY 9 SYD to SIN", "SYD", "SIN", "2026-12-12T15:00:00+11:00", "2026-12-12T21:00:00+08:00");
    expect(mixedTrip([out, theirs])).toBeDefined();
    expect(mixedTrip([out, { ...theirs, cancelledAt: "2026-11-01T00:00:00Z" }])).toBeUndefined();
  });
});
