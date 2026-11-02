import { describe, expect, it } from "vitest";
import { NotATripItExport, parseTripItExport, summarizeTripIt, tripItInstant } from "./tripit";

// Invented data in the export's shape; no real itinerary.
const dt = (date: string, time: string, timezone: string, utc_offset: string) => ({ date, time, timezone, utc_offset });

const flight = {
  display_name: "Example Air to Exampleville",
  supplier_name: "Example Air",
  Segment: [
    {
      StartDateTime: dt("2030-05-01", "08:15:00", "Europe/London", "+01:00"),
      EndDateTime: dt("2030-05-01", "11:40:00", "Europe/Paris", "+02:00"),
      start_airport_code: "lhr",
      start_city_name: "London",
      start_country_code: "GB",
      end_airport_code: "CDG",
      end_city_name: "Paris",
      end_country_code: "FR",
      marketing_airline_code: "XX",
      marketing_flight_number: "123",
      seats: "12A",
      start_terminal: "5",
    },
    {
      StartDateTime: dt("2030-05-08", "18:00:00", "Europe/Paris", "+02:00"),
      EndDateTime: dt("2030-05-08", "18:20:00", "Europe/London", "+01:00"),
      start_airport_code: "CDG",
      end_airport_code: "LHR",
      marketing_airline_code: "XX",
      marketing_flight_number: 124,
    },
  ],
};

const stay = {
  supplier_name: "Hotel Example",
  room_type: "Double",
  StartDateTime: { date: "2030-05-01", timezone: "Europe/Paris" },
  EndDateTime: { date: "2030-05-08", timezone: "Europe/Paris" },
  Address: { address: "1 Rue Exemple, Paris", city: "Paris", country: "FR" },
};

const exportFile = {
  Trips: [
    {
      TripData: { display_name: "Paris, May 2030", start_date: "2030-04-30", end_date: "2030-05-08", is_private: "false" },
      Objects: [flight, stay, { text: "Pack an adapter", DateTime: dt("2030-04-30", "09:00:00", "Europe/London", "+01:00") }],
    },
    { TripData: { display_name: "Empty", start_date: "2030-06-01", end_date: "2030-06-02" }, Objects: [] },
  ],
  UnfiledItems: [
    {
      supplier_name: "Example Cars",
      supplier_conf_num: "ABC123",
      car_type: "Compact",
      start_location_name: "Exampleville Airport",
      StartDateTime: dt("2030-07-01", "10:00:00", "America/New_York", "-04:00"),
      EndDateTime: dt("2030-07-03", "10:00:00", "America/New_York", "-04:00"),
    },
  ],
};

describe("tripItInstant", () => {
  it("uses the given offset, the zone when there is none, and a default time", () => {
    expect(tripItInstant(dt("2030-05-01", "08:15:00", "Europe/London", "+0100"))).toBe("2030-05-01T08:15:00+01:00");
    expect(tripItInstant({ date: "2030-01-10", time: "09:00", timezone: "Europe/London" })).toBe("2030-01-10T09:00:00+00:00");
    expect(tripItInstant({ date: "2030-07-10", timezone: "Europe/London" }, "15:00")).toBe("2030-07-10T15:00:00+01:00");
  });

  it("gives nothing for out-of-range parts rather than a malformed instant", () => {
    expect(tripItInstant(dt("2030-99-99", "08:00", "UTC", "+00:00"))).toBeUndefined();
    expect(tripItInstant(dt("2030-02-30", "08:00", "UTC", "+00:00"))).toBeUndefined();
    expect(tripItInstant(dt("2030-05-01", "99:99", "UTC", "+00:00"))).toBeUndefined();
    expect(tripItInstant(dt("2030-05-01", "08:00", "UTC", "+99:99"))).toBeUndefined();
    const odd = parseTripItExport({ Trips: [{ TripData: { display_name: "Odd", start_date: "2030-13-01" }, Objects: [{ ...flight, Segment: flight.Segment[0] }] }] });
    expect(odd.trips[0]).toMatchObject({ start: "2030-05-01" });
  });

  it("gives nothing rather than guess a zone", () => {
    expect(tripItInstant({ date: "2030-07-10", time: "10:00" })).toBeUndefined();
    expect(tripItInstant({ date: "2030-07-10", time: "10:00", timezone: "Not/AZone" })).toBeUndefined();
    expect(tripItInstant({ date: "July 10", timezone: "UTC" })).toBeUndefined();
  });
});

describe("parseTripItExport", () => {
  const parsed = parseTripItExport(exportFile);

  it("keeps TripIt's trips, one segment per leg, with times as written", () => {
    expect(parsed.trips).toHaveLength(1);
    const trip = parsed.trips[0]!;
    expect(trip).toMatchObject({ title: "Paris, May 2030", start: "2030-04-30", end: "2030-05-08" });
    expect(trip.segments).toHaveLength(3);
    expect(trip.segments[0]).toEqual({
      type: "flight",
      title: "XX 123 LHR to CDG",
      provider: "Example Air",
      start: "2030-05-01T08:15:00+01:00",
      end: "2030-05-01T11:40:00+02:00",
      origin: { name: "London", code: "LHR", city: "London", country: "GB" },
      destination: { name: "Paris", code: "CDG", city: "Paris", country: "FR" },
      notes: "Seat: 12A\nDeparture terminal: 5",
    });
    expect(trip.segments[1]).toMatchObject({ title: "XX 124 CDG to LHR", start: "2030-05-08T18:00:00+02:00" });
  });

  it("tells a stay by its room fields and gives it check-in and check-out hours", () => {
    expect(parsed.trips[0]!.segments[2]).toEqual({
      type: "lodging",
      title: "Hotel Example",
      provider: "Hotel Example",
      start: "2030-05-01T15:00:00+02:00",
      end: "2030-05-08T11:00:00+02:00",
      destination: { name: "Hotel Example", city: "Paris", country: "FR" },
      notes: "Room: Double",
    });
  });

  it("reports notes, empty trips and unrecognized objects instead of importing them", () => {
    expect(parsed.skipped).toEqual([
      { kind: "note", title: "(untitled)", reason: "notes are not bookings" },
      { kind: "trip", title: "Empty", reason: "nothing in it Travelmo can import" },
    ]);
    const odd = parseTripItExport({ Trips: { Objects: [{ display_name: "Mystery", Segment: [] }] } });
    expect(odd.skipped).toContainEqual({ kind: "unknown", title: "Mystery", reason: "not a kind of reservation Travelmo recognizes" });
  });

  it("keeps unfiled items apart, with their confirmation numbers", () => {
    expect(parsed.unfiled).toHaveLength(1);
    expect(parsed.unfiled[0]!.segments[0]).toMatchObject({
      type: "car_rental",
      title: "Example Cars Exampleville Airport",
      confirmation: "ABC123",
      notes: "Car: Compact",
    });
  });

  it("derives the same keys from the same data, and different ones from different data", () => {
    const again = parseTripItExport(structuredClone(exportFile));
    expect(again.trips[0]!.key).toBe(parsed.trips[0]!.key);
    expect(again.unfiled[0]!.key).toBe(parsed.unfiled[0]!.key);
    const moved: { Trips: { Objects: unknown[] }[] } = structuredClone(exportFile);
    moved.Trips[0]!.Objects[0] = { ...flight, Segment: [{ ...flight.Segment[0]!, marketing_flight_number: 999 }] };
    expect(parseTripItExport(moved).trips[0]!.key).not.toBe(parsed.trips[0]!.key);
  });

  it("reports a leg left out of a reservation whose other legs import", () => {
    const halfDated = { ...flight, Segment: [flight.Segment[0]!, { ...flight.Segment[1]!, StartDateTime: { date: "2030-05-08", time: "18:00" } }] };
    const partial = parseTripItExport({ Trips: [{ TripData: { display_name: "Half" }, Objects: [halfDated] }] });
    expect(partial.trips[0]!.segments).toHaveLength(1);
    expect(partial.skipped).toEqual([
      { kind: "leg", title: "Example Air to Exampleville", reason: "1 leg without a usable date left out; the rest imported" },
    ]);
  });

  it("keeps unfiled reservations apart when only their confirmation numbers differ, or nothing at all", () => {
    const room = { supplier_name: "Hotel Example", room_type: "Double", StartDateTime: dt("2030-09-01", "15:00", "UTC", "+00:00"), EndDateTime: dt("2030-09-02", "11:00", "UTC", "+00:00") };
    const keys = (items: object[]) => parseTripItExport({ UnfiledItems: items }).unfiled.map((u) => u.key);
    const [a, b] = keys([{ ...room, supplier_conf_num: "A1" }, { ...room, supplier_conf_num: "B2" }]);
    expect(a).not.toBe(b);
    const [c, d] = keys([room, room]);
    expect(c).not.toBe(d);
    expect(keys([room, room])).toEqual([c, d]);
  });

  it("accepts a lone object where TripIt would have a list of one", () => {
    const lone = parseTripItExport({ Trips: { TripData: { display_name: "Solo" }, Objects: { ...flight, Segment: flight.Segment[0] } } });
    expect(lone.trips[0]!.segments).toHaveLength(1);
    expect(lone.trips[0]).toMatchObject({ start: "2030-05-01", end: "2030-05-01" });
  });

  it("refuses a file that is not an export", () => {
    expect(() => parseTripItExport({ hello: "world" })).toThrow(NotATripItExport);
    expect(() => parseTripItExport([])).toThrow(NotATripItExport);
  });
});

describe("summarizeTripIt", () => {
  it("counts what an import would bring in", () => {
    expect(summarizeTripIt(parseTripItExport(exportFile))).toEqual({
      trips: 1,
      bookings: 4,
      unfiled: 1,
      byType: { flight: 2, lodging: 1, car_rental: 1 },
      skipped: 2,
      first: "2030-05-01",
      last: "2030-07-03",
    });
  });
});
