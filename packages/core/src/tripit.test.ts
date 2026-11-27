import { describe, expect, it } from "vitest";
import {
  NotATripItExport,
  cleanNotes,
  cityFromAddress,
  countryFromAddress,
  floatingNote,
  groupSkips,
  parseTripItExport,
  summarizeTripIt,
  tripItDateTime,
  tripItInstant,
} from "./tripit";

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
      start_airport_latitude: "51.4775",
      start_airport_longitude: "-0.4614",
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
  Address: { address: "1 Rue Exemple, Paris", city: "Paris", country: "FR", latitude: "48.8567", longitude: "2.3508" },
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

  it("keeps a time with no zone at all as written, marked floating", () => {
    expect(tripItDateTime({ date: "2030-07-10", time: "10:00" })).toEqual({ instant: "2030-07-10T10:00:00+00:00", floating: true });
    expect(tripItDateTime({ date: "2030-07-10" }, "15:00")).toEqual({ instant: "2030-07-10T15:00:00+00:00", floating: true });
    expect(tripItDateTime(dt("2030-07-10", "10:00", "Europe/London", "+01:00"))).toEqual({ instant: "2030-07-10T10:00:00+01:00", floating: false });
    // A zone that is named but unknown is a bad value, not a missing one.
    expect(tripItDateTime({ date: "2030-07-10", time: "10:00", timezone: "Not/AZone" })).toBeUndefined();
  });
});

describe("cleanNotes", () => {
  it("drops TripIt's markers and pasted HTML, keeping the text", () => {
    expect(cleanNotes("[[TripItALT: Gate: B12]]Gate: B12\r\nBring <b>ID</b>.<br>Thanks &amp; bye")).toBe("Gate: B12\nBring ID.\nThanks & bye");
    expect(cleanNotes("<p>One</p><p>Two</p>\n\n\n\nThree")).toBe("One\nTwo\n\nThree");
    expect(cleanNotes("  ")).toBeUndefined();
    expect(cleanNotes(42)).toBe("42");
  });
});

describe("countryFromAddress", () => {
  it("reads the country a one-line address ends in", () => {
    expect(countryFromAddress("1 Example St, Sydney NSW 2000, Australia")).toBe("AU");
    expect(countryFromAddress("Rue Exemple 1, Paris, France 75001")).toBe("FR");
    expect(countryFromAddress("12 Sample Rd, Exampleton, Scotland")).toBe("GB");
    expect(countryFromAddress("5 Main St, Boston, MA 02116")).toBe("US");
    expect(countryFromAddress("5 Main St, Boston, MA 02116, USA")).toBe("US");
  });

  it("reads a US state as the US, not the country its code also names", () => {
    // VA is Vatican City, CA Canada and MA Morocco, but TripIt writes countries by name.
    expect(countryFromAddress("147 Example Lane, Sperryville, VA")).toBe("US");
    expect(countryFromAddress("San Francisco, CA")).toBe("US");
    expect(countryFromAddress("26 Example Street, Back Bay, Boston (massachusetts), MA, 02716")).toBe("US");
    expect(countryFromAddress("3600 Example Blvd, Austin, TX, 78719-2339")).toBe("US");
    expect(countryFromAddress("5 Example St, San Jose, CA 95117 US")).toBe("US");
    expect(countryFromAddress("5 Example St, San Francisco, CA, 94102 United States of America")).toBe("US");
    expect(countryFromAddress("5 Example Way, Los Angeles, CA, United States 90045")).toBe("US");
    // A country's code that is no state still names it, and so does a country after a postcode.
    expect(countryFromAddress("Piazzale Example 4, Perugia, IT 06124")).toBe("IT");
    expect(countryFromAddress("Arrivals Dr, Melbourne Vic, XX 3045 AU")).toBe("AU");
    expect(countryFromAddress("200 Example Street East, Toronto, Canada, M5A4R6")).toBe("CA");
    // A time where the region would be gives no country rather than a wrong one ("PM" is a country code).
    expect(countryFromAddress("Example Airport, Example City, UT 84122, 6:18 PM, 2025")).toBeUndefined();
  });

  it("reads no country from a street's abbreviation", () => {
    expect(countryFromAddress("10 Downing St")).toBeUndefined();
    expect(countryFromAddress("Hotel Example, 1 High St")).toBeUndefined();
    expect(countryFromAddress("1 Example Pl")).toBeUndefined();
    // Nor from a street named for a country.
    expect(countryFromAddress("10 Rue du Luxembourg")).toBeUndefined();
    expect(countryFromAddress("Hotel Example, 10 Rue du Luxembourg")).toBeUndefined();
    // A country beside a postcode, after the town, still counts.
    expect(countryFromAddress("1 Example St New Orleans LA 70112 US")).toBe("US");
    expect(countryFromAddress("12 Example Street, Paddington, London United Kingdom W2 1HL")).toBe("GB");
    expect(countryFromAddress("1 Example Blvd Lake Buena Vista, Florida 32830 USA")).toBe("US");
    expect(countryFromAddress("Oude Burg 5 8000 Bruges Belgium")).toBe("BE");
    // A code that is the whole part still names its country.
    expect(countryFromAddress("1 Example Street, Exampleville, PL")).toBe("PL");
  });

  it("gives nothing when the address stops at a city or state", () => {
    expect(countryFromAddress("5 Main St, Exampleton")).toBeUndefined();
    expect(countryFromAddress("Exampleton VIC 3000")).toBeUndefined();
    expect(countryFromAddress("")).toBeUndefined();
    expect(countryFromAddress(undefined)).toBeUndefined();
  });
});

describe("cityFromAddress", () => {
  it("reads the town an address names before its region", () => {
    expect(cityFromAddress("26 Example Street, Back Bay, Boston (massachusetts), MA, 02716")).toBe("Boston");
    expect(cityFromAddress("147 Example Lane, Sperryville, VA")).toBe("Sperryville");
    expect(cityFromAddress("924 25th Street Northwest, Foggy Bottom, Washington, D.c. (washington, D.c.), DC, 20037")).toBe("Washington");
    expect(cityFromAddress("1 Example Street, Philadelphia, PA 19107")).toBe("Philadelphia");
    expect(cityFromAddress("Example 1, Lower Town, 10000 Zagreb, Croatia")).toBe("Zagreb");
    expect(cityFromAddress("39 Example Road, Chelmsford, CM2 0DD, United Kingdom")).toBe("Chelmsford");
    expect(cityFromAddress("22 Example Rd, Bathwick, Bath BA2 6NS, UK")).toBe("Bath");
    expect(cityFromAddress("Largo Example, 63, Rome, RM, 00185 Italy")).toBe("Rome");
    expect(cityFromAddress("Example 7, 1071 NR Amsterdam, Netherlands")).toBe("Amsterdam");
    expect(cityFromAddress("8 Example Street, Melbourne, VI, 3000, Australia")).toBe("Melbourne");
    expect(cityFromAddress("122 Example Street, Katoomba, New South Wales, 2780, Australia")).toBe("Katoomba");
    // A saint, a mount or a fort begins a town, and is no street.
    expect(cityFromAddress("1 Market St, St. Louis, MO")).toBe("St. Louis");
    expect(cityFromAddress("163 Example St, St Kilda VIC 3182, Australia")).toBe("St Kilda");
    // A province code with its postcode comes between the town and its country.
    expect(cityFromAddress("123 King St, Toronto, ON M5V 3L9, Canada")).toBe("Toronto");
    expect(cityFromAddress("1 Example St, Vancouver, BC V6B 1A1, Canada")).toBe("Vancouver");
    // A town in capitals keeps its short last word; a province code after a town in mixed case goes.
    expect(cityFromAddress("1 Example St, SANTA FE, NM")).toBe("SANTA FE");
    expect(cityFromAddress("Via Example, 28, 10122 Torino TO, Italy")).toBe("Torino");
  });

  it("gives nothing rather than a street, a business or a nation", () => {
    expect(cityFromAddress("1 Example St San Francisco, CA 94110")).toBeUndefined();
    expect(cityFromAddress("Example Bar 45 Front St San Francisco, CA 94111")).toBeUndefined();
    expect(cityFromAddress("1 Example Foot, England CV37 6YW, GB")).toBeUndefined();
    expect(cityFromAddress("Piazzale Example 4 Perugia, 06124")).toBeUndefined();
    expect(cityFromAddress("London")).toBeUndefined();
    // A US house number is no postcode to strip.
    expect(cityFromAddress("1 Infinite Loop, CA")).toBeUndefined();
    expect(cityFromAddress("12345 Infinite Loop, CA")).toBeUndefined();
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
      origin: { name: "London", code: "LHR", city: "London", country: "GB", lat: 51.4775, lon: -0.4614 },
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
      destination: { name: "Hotel Example", city: "Paris", country: "FR", address: "1 Rue Exemple, Paris", lat: 48.8567, lon: 2.3508 },
      notes: "Room: Double",
    });
  });

  it("reports notes, empty trips and unrecognized objects instead of importing them", () => {
    expect(parsed.skipped).toEqual([
      { kind: "note", title: "(untitled)", reason: "notes are not bookings" },
      { kind: "trip", title: "Empty", reason: "nothing in it Travelmo can import" },
    ]);
    const odd = parseTripItExport({ Trips: { Objects: [{ display_name: "Mystery", Segment: [{ gizmo: "1" }] }] } });
    expect(odd.skipped).toContainEqual({ kind: "unknown", title: "Mystery", reason: "not a kind of reservation Travelmo recognizes" });
  });

  it("says when TripIt kept only a reservation's name", () => {
    const stripped = parseTripItExport({
      Trips: { Objects: [{ display_name: "Old flight", Segment: [{}], is_purchased: "true" }, { display_name: "Old thing" }] },
      UnfiledItems: [
        { display_name: "Old stay", supplier_name: "Hotel Example", room_type: "Double", supplier_conf_num: "H1" },
        { display_name: "Old air", Segment: [{}, {}], booking_site_conf_num: "A1" },
      ],
    });
    expect(stripped.skipped).toEqual([
      { kind: "unknown", title: "Old flight", reason: "TripIt kept only its name" },
      { kind: "unknown", title: "Old thing", reason: "TripIt kept only its name" },
      { kind: "trip", title: "Trip", reason: "nothing in it Travelmo can import" },
      { kind: "lodging", title: "Old stay", reason: "TripIt kept only its name and confirmation number" },
      { kind: "unknown", title: "Old air", reason: "TripIt kept only its name and confirmation number" },
    ]);
    // A stay with a date field that cannot be read is a different story.
    const undated = parseTripItExport({ UnfiledItems: [{ supplier_name: "Hotel", room_type: "Double", StartDateTime: { date: "soon" } }] });
    expect(undated.skipped).toEqual([{ kind: "lodging", title: "Hotel", reason: "no usable date" }]);
  });

  it("keeps a time with no zone as written and counts it", () => {
    const zoneless = parseTripItExport({
      Trips: [
        {
          TripData: { display_name: "Show", start_date: "2030-03-01", end_date: "2030-03-01" },
          Objects: [{ display_name: "Example Theatre", detail_type_code: "H", StartDateTime: { date: "2030-03-01", time: "19:30:00" }, Address: { address: "1 Stage St, Exampleton" } }],
        },
      ],
    });
    expect(zoneless.floating).toBe(1);
    expect(zoneless.trips[0]!.segments[0]).toEqual({
      type: "activity",
      title: "Example Theatre",
      start: "2030-03-01T19:30:00+00:00",
      destination: { name: "Example Theatre", address: "1 Stage St, Exampleton" },
      notes: floatingNote,
    });
    expect(parsed.floating).toBe(0);
  });

  it("maps a transfer per leg, a ferry by its code, and a cruise as one booking over its port calls", () => {
    const transfer = {
      display_name: "Airport transfer",
      supplier_name: "Example Shuttles",
      Segment: [
        {
          detail_type_code: "G",
          carrier_name: "Example Shuttles",
          start_location_name: "Exampleville Airport",
          StartLocationAddress: { address: "Airport Rd, Exampleville, Australia" },
          end_location_name: "Hotel Example",
          EndLocationAddress: { address: "1 Beach Rd, Exampleville NSW 2000, Australia" },
          StartDateTime: dt("2030-05-02", "10:00:00", "Australia/Sydney", "+10:00"),
          EndDateTime: dt("2030-05-02", "11:00:00", "Australia/Sydney", "+10:00"),
          vehicle_description: "Minibus",
        },
        { detail_type_code: "F", start_location_name: "Pier 1", end_location_name: "Island", StartDateTime: dt("2030-05-03", "09:00:00", "Australia/Sydney", "+10:00") },
        { start_location_name: "Island", end_location_name: "Pier 1", StartDateTime: dt("2030-05-04", "09:00:00", "Australia/Sydney", "+10:00") },
      ],
    };
    const cruiseObject = {
      display_name: "Example Seas",
      ship_name: "MS Example",
      cabin_type: "Balcony",
      booking_site_name: "Example Cruises",
      Segment: [
        { location_name: "Port A", LocationAddress: { address: "Port A, Italy" }, StartDateTime: dt("2030-06-01", "17:00:00", "Europe/Rome", "+02:00") },
        { detail_type_code: "P", location_name: "Port B", LocationAddress: { address: "Port B, Croatia" }, StartDateTime: dt("2030-06-02", "08:00:00", "Europe/Zagreb", "+02:00") },
        { detail_type_code: "P", location_name: "Port C", LocationAddress: { address: "Port C, Italy" }, StartDateTime: dt("2030-06-04", "07:00:00", "Europe/Rome", "+02:00") },
      ],
    };
    const result = parseTripItExport({ Trips: [{ TripData: { display_name: "Sea" }, Objects: [transfer, cruiseObject] }] });
    expect(result.skipped).toEqual([]);
    const [shuttle, ferry, uncoded, ...voyage] = result.trips[0]!.segments;
    expect(shuttle).toEqual({
      type: "bus",
      title: "Example Shuttles Exampleville Airport to Hotel Example",
      provider: "Example Shuttles",
      start: "2030-05-02T10:00:00+10:00",
      end: "2030-05-02T11:00:00+10:00",
      origin: { name: "Exampleville Airport", city: "Exampleville", country: "AU", address: "Airport Rd, Exampleville, Australia" },
      destination: { name: "Hotel Example", city: "Exampleville", country: "AU", address: "1 Beach Rd, Exampleville NSW 2000, Australia" },
      notes: "Vehicle: Minibus",
    });
    expect(ferry).toMatchObject({ type: "ferry", title: "Pier 1 to Island", provider: "Example Shuttles", start: "2030-05-03T09:00:00+10:00" });
    // No code: still a journey for the reports, so a bus, not "other".
    expect(uncoded).toMatchObject({ type: "bus", title: "Island to Pier 1" });
    // One sailing per pair of port calls, so the Croatian stop counts for reports.
    expect(voyage).toEqual([
      {
        type: "ferry",
        title: "Example Seas: Port A to Port B",
        provider: "Example Cruises",
        start: "2030-06-01T17:00:00+02:00",
        end: "2030-06-02T08:00:00+02:00",
        origin: { name: "Port A", city: "Port A", country: "IT", address: "Port A, Italy" },
        destination: { name: "Port B", city: "Port B", country: "HR", address: "Port B, Croatia" },
        notes: "Ship: MS Example\nCabin: Balcony",
      },
      {
        type: "ferry",
        title: "Example Seas: Port B to Port C",
        provider: "Example Cruises",
        start: "2030-06-02T08:00:00+02:00",
        end: "2030-06-04T07:00:00+02:00",
        origin: { name: "Port B", city: "Port B", country: "HR", address: "Port B, Croatia" },
        destination: { name: "Port C", city: "Port C", country: "IT", address: "Port C, Italy" },
        notes: "Ship: MS Example\nCabin: Balcony",
      },
    ]);
    expect(result.trips[0]).toMatchObject({ start: "2030-05-02", end: "2030-06-04" });
    const lone = parseTripItExport({ Trips: [{ Objects: [{ ...cruiseObject, Segment: cruiseObject.Segment[0] }] }] });
    expect(lone.trips[0]!.segments).toEqual([
      { type: "ferry", title: "Example Seas: Port A", provider: "Example Cruises", start: "2030-06-01T17:00:00+02:00", origin: { name: "Port A", city: "Port A", country: "IT", address: "Port A, Italy" }, notes: "Ship: MS Example\nCabin: Balcony" },
    ]);
    // A call without a usable date is reported, since the reports will not see its country.
    const undated = parseTripItExport({
      Trips: [{ Objects: [{ ...cruiseObject, Segment: [cruiseObject.Segment[0], { ...cruiseObject.Segment[1], StartDateTime: { date: "2030-06-02", timezone: "Not/AZone" } }, cruiseObject.Segment[2]] }] }],
    });
    expect(undated.trips[0]!.segments.map((s) => s.title)).toEqual(["Example Seas: Port A to Port C"]);
    expect(undated.skipped).toEqual([{ kind: "leg", title: "Example Seas", reason: "1 port call without a usable date left out; the rest imported" }]);
  });

  it("orders a cruise's port calls by the moment, across the date line", () => {
    const crossing = parseTripItExport({
      Trips: [
        {
          Objects: [
            {
              ship_name: "MS Example",
              Segment: [
                { location_name: "Apia", StartDateTime: dt("2030-06-02", "08:00:00", "Pacific/Apia", "+13:00") },
                { location_name: "Pago Pago", StartDateTime: dt("2030-06-01", "20:00:00", "Pacific/Pago_Pago", "-11:00") },
              ],
            },
          ],
        },
      ],
    });
    expect(crossing.trips[0]!.segments).toEqual([
      {
        type: "ferry",
        title: "MS Example: Apia to Pago Pago",
        start: "2030-06-02T08:00:00+13:00",
        end: "2030-06-01T20:00:00-11:00",
        origin: { name: "Apia" },
        destination: { name: "Pago Pago" },
      },
    ]);
  });

  it("gives a stay or an activity the country its address ends in", () => {
    const withCountry = parseTripItExport({ Trips: [{ Objects: [{ ...stay, Address: { address: "1 Rue Exemple, 75001 Paris, France" } }] }] });
    // The address is kept for the geocoder, with the town it names.
    expect(withCountry.trips[0]!.segments[0]!.destination).toEqual({ name: "Hotel Example", city: "Paris", country: "FR", address: "1 Rue Exemple, 75001 Paris, France" });
    const blank = parseTripItExport({ Trips: [{ Objects: [{ ...stay, Address: { address: "1 Rue Exemple, Paris", city: "Paris", country: "FR", latitude: "0", longitude: "0" } }] }] });
    expect(blank.trips[0]!.segments[0]!.destination).toEqual({ name: "Hotel Example", city: "Paris", country: "FR", address: "1 Rue Exemple, Paris" });
    const bad = parseTripItExport({ Trips: [{ Objects: [{ ...stay, Address: { address: "1 Rue Exemple, Paris", city: "Paris", country: "FR", latitude: "north", longitude: "2.35" } }] }] });
    expect(bad.trips[0]!.segments[0]!.destination).toEqual({ name: "Hotel Example", city: "Paris", country: "FR", address: "1 Rue Exemple, Paris" });
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
    const halfDated = { ...flight, Segment: [flight.Segment[0]!, { ...flight.Segment[1]!, StartDateTime: { date: "2030-05-08", time: "18:00", timezone: "Not/AZone" } }] };
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
      floating: 0,
      first: "2030-05-01",
      last: "2030-07-03",
    });
  });
});

describe("groupSkips", () => {
  it("groups by reason, the largest group first", () => {
    const groups = groupSkips([
      { title: "A", reason: "no usable date" },
      { title: "B", reason: "TripIt kept only its name" },
      { title: "C", reason: "TripIt kept only its name" },
    ]);
    expect(groups).toEqual([
      { reason: "TripIt kept only its name", titles: ["B", "C"] },
      { reason: "no usable date", titles: ["A"] },
    ]);
    expect(groupSkips([])).toEqual([]);
  });
});
