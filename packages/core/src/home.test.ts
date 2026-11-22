import { describe, expect, it } from "vitest";
import {
  awayPlace,
  connects,
  describeHomes,
  effectiveHomes,
  findTripForBooking,
  homeAt,
  homeCorrections,
  homeTimeline,
  isAtHome,
  isHomeTrip,
  isTransfer,
  transferTitle,
} from "./home";
import type { ExtractedSegment, Place, Trip } from "./schema";

const london: Place = { name: "London Euston", code: "EUS", city: "London", country: "GB" };
const liverpool: Place = { name: "Liverpool Lime Street", code: "LIV", city: "Liverpool", country: "GB" };

const train = (title: string, start: string, origin: Place, destination: Place): ExtractedSegment => ({
  type: "train",
  title,
  start,
  origin,
  destination,
});
const flight = (start: string, from: string, to: string): ExtractedSegment => ({
  type: "flight",
  title: `${from} to ${to}`,
  start,
  origin: { name: `${from} airport`, city: from },
  destination: { name: `${to} airport`, city: to },
});
const roundTrip = (from: string, to: string, out: string, back: string) => [
  flight(`${out}T09:00:00+00:00`, from, to),
  flight(`${back}T18:00:00+00:00`, to, from),
];

// The bookings that came in as one "London" trip: a holiday club at home on
// either side of a weekend in Liverpool.
const club = (title: string, start: string): ExtractedSegment => ({
  type: "activity",
  title,
  start,
  destination: { name: "Fixation Academy of Performing Arts", city: "London", country: "GB" },
});
const may = [
  club("Eva Ward's Stage Stars! Holiday Club", "2026-05-22T00:00:00+01:00"),
  train("Avanti West Coast London Euston to Liverpool Lime Street", "2026-05-23T12:07:00+01:00", london, liverpool),
  train("Avanti West Coast Liverpool Lime Street to London Euston", "2026-05-25T11:43:00+01:00", liverpool, london),
  club("Stage Stars! Holiday Club - Day 1", "2026-05-26T09:00:00+01:00"),
];

describe("homeTimeline", () => {
  it("takes home from where a round trip leaves and comes back to", () => {
    expect(homeTimeline(may)).toEqual([{ city: "London", country: "GB" }]);
  });

  it("dates a move from the first of two round trips from the new base", () => {
    const bookings = [
      ...roundTrip("Boston", "Chicago", "2019-03-01", "2019-03-05"),
      ...roundTrip("Boston", "Denver", "2019-08-10", "2019-08-14"),
      ...roundTrip("Boston", "Miami", "2020-01-02", "2020-01-06"),
      ...roundTrip("London", "Paris", "2021-03-12", "2021-03-15"),
      ...roundTrip("London", "Rome", "2021-06-01", "2021-06-05"),
      ...roundTrip("London", "Lisbon", "2022-02-10", "2022-02-14"),
    ];
    expect(homeTimeline(bookings)).toEqual([
      { city: "Boston", until: "2021-03-11" },
      { city: "London", from: "2021-03-12" },
    ]);
  });

  it("does not count one trip from somewhere else as a move", () => {
    const bookings = [
      ...roundTrip("London", "Paris", "2025-03-12", "2025-03-15"),
      ...roundTrip("Sydney", "Melbourne", "2025-07-01", "2025-07-04"),
      ...roundTrip("London", "Rome", "2025-09-01", "2025-09-05"),
    ];
    expect(homeTimeline(bookings)).toEqual([{ city: "London" }]);
  });

  it("follows a trip of several legs back to where it started", () => {
    const bookings = [
      flight("2025-04-01T09:00:00+00:00", "London", "Dubai"),
      flight("2025-04-02T03:00:00+04:00", "Dubai", "Sydney"),
      flight("2025-04-20T10:00:00+10:00", "Sydney", "London"),
    ];
    expect(homeTimeline(bookings)).toEqual([{ city: "London" }]);
  });

  it("orders legs by the instant they leave, across the date line", () => {
    const bookings: ExtractedSegment[] = [
      { type: "flight", title: "Tokyo to Honolulu", start: "2026-01-02T01:00:00+09:00", origin: { name: "Haneda", city: "Tokyo" }, destination: { name: "Honolulu", city: "Honolulu" } },
      { type: "flight", title: "Honolulu to Tokyo", start: "2026-01-01T22:00:00-10:00", origin: { name: "Honolulu", city: "Honolulu" }, destination: { name: "Haneda", city: "Tokyo" } },
    ];
    expect(homeTimeline(bookings)).toEqual([{ city: "Tokyo" }]);
  });

  it("takes no home from a journey within one town", () => {
    const crossing: ExtractedSegment = {
      type: "ferry",
      title: "Thames Clipper",
      start: "2025-02-01T10:00:00+00:00",
      origin: { name: "Westminster Pier", city: "London" },
      destination: { name: "Greenwich Pier", city: "London" },
    };
    expect(homeTimeline([crossing])).toEqual([]);
    expect(homeTimeline([crossing, ...roundTrip("London", "Rome", "2025-03-01", "2025-03-05")])).toEqual([{ city: "London" }]);
  });

  it("knows no home without a round trip", () => {
    expect(homeTimeline([flight("2025-04-01T09:00:00+00:00", "London", "Boston")])).toEqual([]);
    expect(homeTimeline([club("Holiday Club", "2026-05-22T09:00:00+01:00")])).toEqual([]);
  });
});

describe("homeAt", () => {
  const periods = [
    { city: "Boston", until: "2021-03-11" },
    { city: "London", from: "2021-03-12" },
  ];

  it("finds the home of a date", () => {
    expect(homeAt(periods, "2020-06-01")?.city).toBe("Boston");
    expect(homeAt(periods, "2021-03-12")?.city).toBe("London");
    expect(homeAt([], "2021-03-12")).toBeUndefined();
  });

  it("lets a correction win for the dates it covers", () => {
    const overrides = [{ city: "Cambridge", from: "2020-09-01", until: "2021-03-11" }];
    expect(homeAt(periods, "2020-10-01", overrides)?.city).toBe("Cambridge");
    expect(homeAt(periods, "2020-06-01", overrides)?.city).toBe("Boston");
  });
});

describe("isAtHome", () => {
  const periods = homeTimeline(may);

  it("puts the holiday club at home and the trains away", () => {
    expect(may.map((s) => isAtHome(s, periods))).toEqual([true, false, false, true]);
  });

  it("puts a stay in another city away", () => {
    const stay: ExtractedSegment = {
      type: "lodging",
      title: "Hotel",
      start: "2026-05-23T15:00:00+01:00",
      destination: { name: "Hotel", city: "Liverpool", country: "GB" },
    };
    expect(isAtHome(stay, periods)).toBe(false);
  });

  it("says nothing is at home when home is unknown or the place is missing", () => {
    expect(isAtHome(may[0]!, [])).toBe(false);
    expect(isAtHome({ type: "activity", start: "2026-05-22T09:00:00+01:00" }, periods)).toBe(false);
  });
});

describe("findTripForBooking", () => {
  const periods = homeTimeline(may);
  const [club22, out, back, club26] = may as [ExtractedSegment, ExtractedSegment, ExtractedSegment, ExtractedSegment];
  const trip = (id: string, start: string, end: string): Trip => ({
    id,
    title: id,
    start,
    end,
    ownerUid: "u1",
    sharedWith: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  const clubTrip = trip("club", "2026-05-26", "2026-05-26");
  const awayTrip = trip("liverpool", "2026-05-23", "2026-05-25");
  const segments: Record<string, ExtractedSegment[]> = { club: [club26], liverpool: [out, back] };
  const of = (id: string) => segments[id] ?? [];

  it("keeps a trip away out of a day out at home two days later", () => {
    expect(findTripForBooking([clubTrip], of, [out, back], periods)).toBeUndefined();
  });

  it("keeps a day out at home out of the trip away the day after", () => {
    expect(findTripForBooking([awayTrip, clubTrip], of, [club22], periods)).toBeUndefined();
  });

  it("puts two tickets at home on the same day together", () => {
    const show = { ...club26, title: "Evening show", start: "2026-05-26T19:00:00+01:00" };
    expect(findTripForBooking([awayTrip, clubTrip], of, [show], periods)?.id).toBe("club");
  });

  it("keeps a stay in the destination with its trains", () => {
    const hotel: ExtractedSegment = {
      type: "lodging",
      title: "Hotel",
      start: "2026-05-23T15:00:00+01:00",
      end: "2026-05-25T11:00:00+01:00",
      destination: { name: "Hotel", city: "Liverpool", country: "GB" },
    };
    expect(findTripForBooking([awayTrip, clubTrip], of, [hotel], periods)?.id).toBe("liverpool");
  });

  it("joins the nearest trip as before when home is unknown", () => {
    expect(findTripForBooking([clubTrip], of, [out, back], [])?.id).toBe("club");
  });

  it("calls only a trip of bookings all at home a day out", () => {
    expect(isHomeTrip([club26], periods)).toBe(true);
    expect(isHomeTrip([out, back], periods)).toBe(false);
    expect(isHomeTrip([], periods)).toBe(false);
  });
});

describe("awayPlace", () => {
  const periods = homeTimeline(may);

  it("finds where a trip goes, not home", () => {
    expect(awayPlace([may[1]!, may[2]!], periods)?.city).toBe("Liverpool");
    expect(awayPlace([may[2]!], periods)?.city).toBe("Liverpool");
    expect(awayPlace([may[0]!], periods)).toBeUndefined();
  });
});

describe("homeCorrections", () => {
  it("runs each correction until the next one", () => {
    expect(
      homeCorrections([
        { city: "London", country: "GB", from: "2021-03-12" },
        { city: "Boston", country: "US", from: "2018-09-01" },
      ]),
    ).toEqual([
      { city: "Boston", country: "US", from: "2018-09-01", until: "2021-03-11" },
      { city: "London", country: "GB", from: "2021-03-12" },
    ]);
  });

  it("keeps the later of two on one date", () => {
    expect(homeCorrections([{ city: "Leeds", from: "2021-03-12" }, { city: "London", from: "2021-03-12" }])).toEqual([
      { city: "London", from: "2021-03-12" },
    ]);
  });
});

describe("effectiveHomes", () => {
  const inferred = [
    { city: "Boston", until: "2021-03-11" },
    { city: "London", from: "2021-03-12" },
  ];

  it("is what the journeys say without corrections", () => {
    expect(effectiveHomes(inferred, [])).toEqual(inferred);
  });

  it("follows a correction from its date on", () => {
    expect(effectiveHomes(inferred, [{ city: "Cambridge", country: "GB", from: "2020-09-01" }])).toEqual([
      { city: "Boston", until: "2020-08-31" },
      { city: "Cambridge", country: "GB", from: "2020-09-01" },
    ]);
  });

  it("merges a correction into the same town before it", () => {
    expect(effectiveHomes([{ city: "London" }], [{ city: "London", from: "2024-01-01" }])).toEqual([{ city: "London" }]);
  });
});

describe("describeHomes", () => {
  it("says home over time, newest first", () => {
    expect(
      describeHomes([
        { city: "Boston", from: "2018-09-01", until: "2021-03-11" },
        { city: "London", from: "2021-03-12" },
      ]),
    ).toBe("London since Mar 2021 · Boston 2018–2021");
    expect(describeHomes([{ city: "Boston", until: "2021-03-11" }, { city: "London", from: "2021-03-12" }])).toBe(
      "London since Mar 2021 · Boston until 2021",
    );
    expect(describeHomes([{ city: "London" }])).toBe("London");
    expect(describeHomes([])).toBe("");
  });
});

// A car booked home from the airport after a flight from New York: before
// it was a transfer, it was a day out at home and became a trip of its own.
describe("transfers", () => {
  const periods = [{ city: "London", country: "GB" }];
  const lhr: Place = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
  const jfk: Place = { name: "John F. Kennedy International", code: "JFK", city: "New York", country: "US" };
  const homeAddress: Place = { name: "1 Example Road, London N1 1AA", city: "London", country: "GB" };
  const out: ExtractedSegment = { type: "flight", title: "BA 117", start: "2026-07-10T08:25:00+01:00", end: "2026-07-10T11:10:00-04:00", origin: lhr, destination: jfk };
  const back: ExtractedSegment = { type: "flight", title: "BA 112", start: "2026-07-22T18:30:00-04:00", end: "2026-07-23T06:35:00+01:00", origin: jfk, destination: lhr };
  const ride: ExtractedSegment = {
    type: "car_rental",
    title: "Abetta Car from Heathrow Terminal 3 to London",
    start: "2026-07-23T15:27:00+01:00",
    origin: { name: "Heathrow Terminal 3 - LHR, TW6 1SX", city: "London", country: "GB" },
    destination: homeAddress,
  };
  const hire: ExtractedSegment = {
    type: "car_rental",
    title: "Hertz",
    start: "2026-07-23T09:00:00+01:00",
    end: "2026-07-25T09:00:00+01:00",
    origin: { name: "Hertz Islington", city: "London", country: "GB" },
    destination: { name: "Hertz Islington", city: "London", country: "GB" },
  };
  const trip = (id: string, start: string, end: string): Trip => ({
    id,
    title: id,
    start,
    end,
    ownerUid: "u1",
    sharedWith: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  // A show at home that evening and a trip to Paris the next day lie as
  // near by date as the trip to New York does.
  const show: ExtractedSegment = { type: "activity", title: "Show", start: "2026-07-23T19:30:00+01:00", destination: { name: "Theatre", city: "London", country: "GB" } };
  const toParis: ExtractedSegment = {
    type: "train",
    title: "Eurostar",
    start: "2026-07-24T09:01:00+01:00",
    origin: { name: "London St Pancras", city: "London" },
    destination: { name: "Paris Nord", city: "Paris" },
  };
  const segments: Record<string, ExtractedSegment[]> = { show: [show], paris: [toParis], usa: [out, back], ride: [ride] };
  const of = (id: string) => segments[id] ?? [];
  const showTrip = trip("show", "2026-07-23", "2026-07-23");
  const parisTrip = trip("paris", "2026-07-24", "2026-07-24");

  it("tells a ride between two places from a car hired in one", () => {
    expect(isTransfer(ride)).toBe(true);
    expect(isTransfer(hire)).toBe(false);
    expect(isTransfer({ ...ride, destination: undefined })).toBe(false);
    expect(isTransfer({ ...ride, type: "lodging" })).toBe(false);
  });

  it("does not call a ride home from the airport a day out at home", () => {
    expect(isAtHome(ride, periods)).toBe(false);
    expect(isAtHome(hire, periods)).toBe(true);
  });

  it("joins the ride to the trip of the flight it meets, filed after it", () => {
    const usa = trip("usa", "2026-07-10", "2026-07-23");
    expect(findTripForBooking([showTrip, parisTrip, usa], of, [ride], periods)?.id).toBe("usa");
  });

  it("joins the flight to the trip of the ride it meets, filed before it", () => {
    const rideTrip = trip("ride", "2026-07-23", "2026-07-23");
    expect(findTripForBooking([showTrip, parisTrip, rideTrip], of, [out, back], periods)?.id).toBe("ride");
  });

  it("meets a flight at its airport within hours, not days", () => {
    expect(connects(ride, back)).toBe(true);
    expect(connects(back, ride)).toBe(true);
    expect(connects(ride, out)).toBe(false);
    expect(connects({ ...ride, start: "2026-07-24T15:27:00+01:00" }, back)).toBe(false);
    expect(connects({ ...ride, origin: { name: "Gatwick South Terminal", city: "Crawley" } }, back)).toBe(false);
    const toAirport = { ...ride, start: "2026-07-10T05:00:00+01:00", origin: homeAddress, destination: { name: "Heathrow Airport T5", city: "London" } };
    expect(connects(toAirport, out)).toBe(true);
  });

  it("meets a flight only in the order a traveler would take them", () => {
    // A ride out of Heathrow before the flight lands, and one to Heathrow
    // after the flight has left.
    expect(connects({ ...ride, start: "2026-07-23T05:00:00+01:00" }, back)).toBe(false);
    const toAirport = { ...ride, origin: homeAddress, destination: lhr };
    expect(connects({ ...toAirport, start: "2026-07-10T06:00:00+01:00" }, out)).toBe(true);
    expect(connects({ ...toAirport, start: "2026-07-10T10:00:00+01:00" }, out)).toBe(false);
  });

  it("joins the ride to the trip whose flight it meets soonest", () => {
    const early: ExtractedSegment = { ...back, title: "VS 4", start: "2026-07-22T15:00:00-04:00", end: "2026-07-23T04:00:00+01:00" };
    const both: Record<string, ExtractedSegment[]> = { ...segments, early: [early] };
    const usa = trip("usa", "2026-07-10", "2026-07-23");
    const earlyTrip = trip("early", "2026-07-22", "2026-07-23");
    expect(findTripForBooking([earlyTrip, usa], (id) => both[id] ?? [], [ride], periods)?.id).toBe("usa");
  });

  it("reads an airport code in a place in any case, as a whole word", () => {
    expect(connects({ ...ride, origin: { name: "lhr terminal 3", city: "London" } }, back)).toBe(true);
    expect(connects({ ...ride, origin: { name: "Flhr House terminal", city: "London" } }, back)).toBe(false);
  });

  it("names a ride by its route", () => {
    expect(transferTitle(ride, periods)).toBe("Heathrow to home");
    expect(transferTitle(ride, [])).toBe("Heathrow to London");
    const toAirport = { ...ride, origin: homeAddress, destination: { name: "London Heathrow Airport (LHR)", city: "London" } };
    expect(transferTitle(toAirport, periods)).toBe("Home to London Heathrow");
    expect(transferTitle(hire, periods)).toBeUndefined();
  });

  it("keeps rides to and from the airport out of where home is", () => {
    const fromBristol: ExtractedSegment = { ...ride, start: "2026-07-10T04:00:00+01:00", origin: { name: "Bristol", city: "Bristol" }, destination: lhr };
    const toBristol: ExtractedSegment = { ...ride, origin: lhr, destination: { name: "Bristol", city: "Bristol" } };
    expect(homeTimeline([fromBristol, out, back, toBristol])).toEqual([{ city: "London", country: "GB" }]);
  });
});
