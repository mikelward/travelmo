import { describe, expect, it } from "vitest";
import type { ExtractedSegment } from "./schema";
import { placeRows, placeRowsCsv, tripRows, tripRowsCsv, type SummaryTrip } from "./tripsExport";

const london = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
const periods = [{ city: "London", country: "GB" }];
const until = "2026-11-24";

const seg = (s: Partial<ExtractedSegment> & Pick<ExtractedSegment, "type" | "start">): ExtractedSegment => ({ title: s.type, ...s });

const sweden: SummaryTrip = {
  trip: { id: "se", title: "Stockholm", start: "2026-08-15", end: "2026-08-23" },
  segments: [
    seg({ type: "flight", start: "2026-08-15T09:00:00+01:00", end: "2026-08-15T12:30:00+02:00", origin: london, destination: { name: "Arlanda", code: "ARN", city: "Stockholm", country: "SE" } }),
    seg({ type: "lodging", start: "2026-08-15T15:00:00+02:00", end: "2026-08-19T11:00:00+02:00", destination: { name: "Hotel", city: "Stockholm", country: "SE" } }),
    // A ticket says nothing about where anyone slept.
    seg({ type: "activity", start: "2026-08-17T10:00:00+02:00", destination: { name: "Castle", city: "Uppsala", country: "SE" } }),
    seg({ type: "train", start: "2026-08-19T12:00:00+02:00", end: "2026-08-19T15:00:00+02:00", origin: { name: "Stockholm C", city: "Stockholm", country: "SE" }, destination: { name: "Göteborg C", city: "Göteborg", country: "SE" } }),
    seg({ type: "lodging", start: "2026-08-19T16:00:00+02:00", end: "2026-08-23T11:00:00+02:00", destination: { name: "Villa", city: "Göteborg", country: "SE" } }),
    seg({ type: "flight", start: "2026-08-23T14:00:00+02:00", end: "2026-08-23T15:00:00+01:00", origin: { name: "Landvetter", code: "GOT", city: "Gothenburg", country: "SE" }, destination: london }),
  ],
};

const liverpool: SummaryTrip = {
  trip: { id: "lpl", title: "Liverpool", start: "2026-05-23", end: "2026-05-25" },
  segments: [
    seg({ type: "train", start: "2026-05-23T12:00:00+01:00", end: "2026-05-23T14:15:00+01:00", origin: { name: "Euston", city: "London", country: "GB" }, destination: { name: "Lime Street", city: "Liverpool", country: "GB" } }),
    seg({ type: "train", start: "2026-05-25T11:00:00+01:00", end: "2026-05-25T13:15:00+01:00", origin: { name: "Lime Street", city: "Liverpool", country: "GB" }, destination: { name: "Euston", city: "London", country: "GB" } }),
  ],
};

describe("tripRows", () => {
  it("gives each trip's dates and where it went, home and tickets left out, oldest first", () => {
    expect(tripRows([sweden, liverpool], { periods, until })).toEqual([
      { trip: "Liverpool", start: "2026-05-23", end: "2026-05-25", cities: ["Liverpool"], countries: ["United Kingdom"] },
      { trip: "Stockholm", start: "2026-08-15", end: "2026-08-23", cities: ["Stockholm", "Göteborg"], countries: ["Sweden"] },
    ]);
  });

  it("keeps only trips outside the home country when asked", () => {
    expect(tripRows([sweden, liverpool], { periods, until, international: true }).map((r) => r.trip)).toEqual(["Stockholm"]);
  });
});

describe("placeRows", () => {
  it("gives each place from the day someone got there until they moved on", () => {
    expect(placeRows([sweden, liverpool], { periods, until })).toEqual([
      { city: "Liverpool", country: "United Kingdom", start: "2026-05-23", end: "2026-05-25", trip: "Liverpool" },
      { city: "Stockholm", country: "Sweden", start: "2026-08-15", end: "2026-08-19", trip: "Stockholm" },
      { city: "Göteborg", country: "Sweden", start: "2026-08-19", end: "2026-08-23", trip: "Stockholm" },
    ]);
    expect(placeRows([sweden, liverpool], { periods, until, international: true }).map((r) => r.city)).toEqual(["Stockholm", "Göteborg"]);
  });
});

describe("towns", () => {
  it("shows no town for a stay or a car without one, rather than the hotel's name, but a station's for a journey", () => {
    const inn: SummaryTrip = {
      trip: { id: "inn", title: "Inn", start: "2026-04-10", end: "2026-04-12" },
      segments: [
        seg({ type: "train", start: "2026-04-10T09:00:00+02:00", end: "2026-04-10T11:00:00+02:00", origin: { name: "Example Central", country: "FR" }, destination: { name: "Exampleville Gare", country: "FR" } }),
        seg({ type: "lodging", start: "2026-04-10T15:00:00+02:00", end: "2026-04-12T11:00:00+02:00", destination: { name: "Example Inn", country: "FR" } }),
      ],
    };
    expect(tripRows([inn], { periods, until })[0]).toMatchObject({ cities: ["Exampleville Gare"], countries: ["France"] });
    expect(placeRows([inn], { periods, until }).map((r) => r.city)).toEqual(["Exampleville Gare", ""]);
  });
});

describe("what counts", () => {
  it("leaves out trips that start after the day chosen, and trips wholly cancelled", () => {
    const later: SummaryTrip = { ...liverpool, trip: { ...liverpool.trip, id: "later", title: "Later", start: "2027-01-02", end: "2027-01-04" } };
    const cancelled: SummaryTrip = { ...liverpool, trip: { ...liverpool.trip, id: "off", title: "Off" }, segments: liverpool.segments.map((s) => ({ ...s, cancelledAt: "2026-05-01T00:00:00Z" })) };
    expect(tripRows([liverpool, later, cancelled], { periods, until }).map((r) => r.trip)).toEqual(["Liverpool"]);
    expect(placeRows([liverpool, later, cancelled], { periods, until }).map((r) => r.trip)).toEqual(["Liverpool"]);
    // A later day takes in a planned trip; a cancelled one stays out.
    expect(tripRows([liverpool, later, cancelled], { periods, until: "2027-12-31" }).map((r) => r.trip)).toEqual(["Liverpool", "Later"]);
    // So does one its owner marked cancelled, whatever its bookings say.
    const marked: SummaryTrip = { ...liverpool, trip: { ...liverpool.trip, id: "marked", title: "Marked", cancelledAt: "2026-05-01T00:00:00Z" } };
    expect(tripRows([liverpool, marked], { periods, until }).map((r) => r.trip)).toEqual(["Liverpool"]);
    expect(placeRows([liverpool, marked], { periods, until }).map((r) => r.trip)).toEqual(["Liverpool"]);
  });

  it("judges each place against the home of its own day", () => {
    // Home moved from London to Lyon mid-trip; the trip's only stop is Lyon, after the move.
    const moved = [{ city: "London", country: "GB", until: "2026-08-16" }, { city: "Paris", country: "FR", from: "2026-08-17" }];
    const lyon: SummaryTrip = {
      trip: { id: "ly", title: "Lyon", start: "2026-08-15", end: "2026-08-20" },
      segments: [seg({ type: "lodging", start: "2026-08-18T15:00:00+02:00", end: "2026-08-20T11:00:00+02:00", destination: { name: "Hotel", city: "Lyon", country: "FR" } })],
    };
    expect(tripRows([lyon], { periods: moved, until, international: true })).toEqual([]);
    expect(placeRows([lyon], { periods: moved, until, international: true })).toEqual([]);
  });

  it("keeps two towns of one name in different countries apart", () => {
    const twoLondons: SummaryTrip = {
      trip: { id: "ca", title: "Ontario", start: "2026-06-01", end: "2026-06-10" },
      segments: [
        seg({ type: "lodging", start: "2026-06-01T15:00:00-04:00", end: "2026-06-05T11:00:00-04:00", destination: { name: "Inn", city: "London", country: "CA" } }),
        seg({ type: "flight", start: "2026-06-05T18:00:00-04:00", end: "2026-06-06T07:00:00+01:00", origin: { name: "YYZ", city: "Toronto", country: "CA" }, destination: { name: "Heathrow", city: "London", country: "GB" } }),
      ],
    };
    // Home is Paris here, so both Londons are away.
    expect(placeRows([twoLondons], { periods: [{ city: "Paris", country: "FR" }], until }).map((r) => `${r.city}, ${r.country}`)).toEqual([
      "London, Canada",
      "London, United Kingdom",
    ]);
  });
});

describe("what is one trip and one place", () => {
  it("lists no trip of nothing but events and tickets", () => {
    const dinner: SummaryTrip = {
      trip: { id: "din", title: "Dinner", start: "2026-03-01", end: "2026-03-01" },
      segments: [seg({ type: "activity", start: "2026-03-01T19:00:00+00:00", destination: { name: "Restaurant", city: "Brighton", country: "GB" } })],
    };
    expect(tripRows([dinner], { periods, until })).toEqual([]);
  });

  it("takes a town's local and English names as one town", () => {
    const gothenburg: SummaryTrip = {
      trip: { id: "got", title: "Gothenburg", start: "2026-09-01", end: "2026-09-04" },
      segments: [
        seg({ type: "flight", start: "2026-09-01T09:00:00+01:00", end: "2026-09-01T12:00:00+02:00", origin: london, destination: { name: "Landvetter", city: "Gothenburg", country: "SE" } }),
        seg({ type: "lodging", start: "2026-09-01T15:00:00+02:00", end: "2026-09-04T11:00:00+02:00", destination: { name: "Hotel", city: "Göteborg", country: "SE" } }),
      ],
    };
    expect(placeRows([gothenburg], { periods, until })).toEqual([{ city: "Gothenburg", country: "Sweden", start: "2026-09-01", end: "2026-09-04", trip: "Gothenburg" }]);
  });
});

describe("what the bookings leave out", () => {
  it("takes a place's country from any of its bookings", () => {
    const liverpoolStay: SummaryTrip = {
      trip: { id: "lv", title: "Liverpool", start: "2026-05-23", end: "2026-05-25" },
      segments: [
        seg({ type: "train", start: "2026-05-23T12:00:00+01:00", end: "2026-05-23T14:15:00+01:00", origin: { name: "Euston", city: "London", country: "GB" }, destination: { name: "Lime Street", city: "Liverpool" } }),
        seg({ type: "lodging", start: "2026-05-23T15:00:00+01:00", end: "2026-05-25T11:00:00+01:00", destination: { name: "Hotel", city: "Liverpool", country: "GB" } }),
      ],
    };
    expect(placeRows([liverpoolStay], { periods, until })).toEqual([{ city: "Liverpool", country: "United Kingdom", start: "2026-05-23", end: "2026-05-25", trip: "Liverpool" }]);
    expect(placeRows([liverpoolStay], { periods, until, international: true })).toEqual([]);
    expect(tripRows([liverpoolStay], { periods, until }).map((r) => r.countries)).toEqual([["United Kingdom"]]);
    expect(tripRows([liverpoolStay], { periods, until, international: true })).toEqual([]);
  });

  it("tells a London abroad from London at home by the airport's country", () => {
    const lookup = (code: string) => (code === "YXU" ? { country: "CA", lat: 43.04, lon: -81.15 } : undefined);
    const ontario: SummaryTrip = {
      trip: { id: "on", title: "Ontario", start: "2026-07-01", end: "2026-07-05" },
      segments: [seg({ type: "flight", start: "2026-07-01T10:00:00-04:00", end: "2026-07-01T11:00:00-04:00", origin: { name: "Toronto", code: "YYZ", city: "Toronto" }, destination: { name: "London", code: "YXU", city: "London" } })],
    };
    expect(tripRows([ontario], { periods, until, lookup }).map((r) => r.countries)).toEqual([["Canada"]]);
    expect(placeRows([ontario], { periods, until, lookup }).map((r) => `${r.city}, ${r.country}`)).toEqual(["London, Canada"]);
    // A later booking that names the country does the same for a stop that had none.
    const withHotel: SummaryTrip = {
      ...ontario,
      segments: [
        seg({ type: "train", start: "2026-07-01T10:00:00-04:00", end: "2026-07-01T12:00:00-04:00", origin: { name: "Union", city: "Toronto" }, destination: { name: "London station", city: "London" } }),
        seg({ type: "lodging", start: "2026-07-01T15:00:00-04:00", end: "2026-07-05T11:00:00-04:00", destination: { name: "Inn", city: "London", country: "CA" } }),
      ],
    };
    expect(placeRows([withHotel], { periods, until }).map((r) => `${r.city}, ${r.country}, ${r.start}–${r.end}`)).toEqual(["London, Canada, 2026-07-01–2026-07-05"]);
  });

  it("does not read a ticket's validity as its arrival", () => {
    // An airport train ticket from 15 Aug, valid until 13 Nov.
    const express: SummaryTrip = {
      trip: { id: "ex", title: "Stockholm", start: "2026-08-15", end: "2026-08-17" },
      segments: [
        seg({ type: "train", start: "2026-08-15T13:00:00+02:00", end: "2026-11-13T23:59:00+01:00", origin: { name: "Arlanda", city: "Stockholm", country: "SE" }, destination: { name: "Stockholm C", city: "Stockholm", country: "SE" } }),
        seg({ type: "lodging", start: "2026-08-15T15:00:00+02:00", end: "2026-08-17T11:00:00+02:00", destination: { name: "Hotel", city: "Solna", country: "SE" } }),
      ],
    };
    // Read as arriving in November, the train would come after the hotel and stretch it to then.
    expect(placeRows([express], { periods, until })).toEqual([
      { city: "Stockholm", country: "Sweden", start: "2026-08-15", end: "2026-08-15", trip: "Stockholm" },
      { city: "Solna", country: "Sweden", start: "2026-08-15", end: "2026-08-17", trip: "Stockholm" },
    ]);
  });
});

describe("CSV", () => {
  it("writes a header and quotes what needs it", () => {
    expect(tripRowsCsv([{ trip: 'Paris, "spring"', start: "2026-04-01", end: "2026-04-05", cities: ["Paris"], countries: ["France"] }])).toBe(
      'Trip,Start,End,Cities,Countries\r\n"Paris, ""spring""",2026-04-01,2026-04-05,Paris,France\r\n',
    );
    expect(placeRowsCsv([{ city: "Paris", country: "France", start: "2026-04-01", end: "2026-04-05", trip: "Paris" }])).toBe(
      "City,Country,Start,End,Trip\r\nParis,France,2026-04-01,2026-04-05,Paris\r\n",
    );
  });

  it("keeps a spreadsheet from reading a field as a formula", () => {
    expect(placeRowsCsv([{ city: '=HYPERLINK("x","y")', country: "@SUM(1)", start: "2026-04-01", end: "2026-04-05", trip: "-1+2" }])).toBe(
      `City,Country,Start,End,Trip\r\n"'=HYPERLINK(""x"",""y"")",'@SUM(1),2026-04-01,2026-04-05,'-1+2\r\n`,
    );
  });
});
