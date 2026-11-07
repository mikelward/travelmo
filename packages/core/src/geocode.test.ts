import { describe, expect, it } from "vitest";
import {
  GeocodeError,
  applyGeocode,
  enrichSegments,
  fillAirports,
  geocodeKey,
  geocodeNeed,
  geocodeQuery,
  needsGeocoding,
  normalizeQuery,
  parseGeocodeResponse,
  placeFromComponents,
  readLocation,
} from "./geocode";
import type { ExtractedSegment } from "./schema";

// Invented places; no real address.
const geocoding = (country: string, extra: { type: string; name: string }[] = [], location?: unknown) => ({
  status: "OK",
  results: [
    {
      address_components: [
        ...extra.map((e) => ({ long_name: e.name, short_name: e.name, types: [e.type, "political"] })),
        { long_name: "Exampleland", short_name: country, types: ["country", "political"] },
      ],
      ...(location ? { geometry: { location } } : {}),
    },
  ],
});

describe("parseGeocodeResponse", () => {
  it("reads the country code and the locality", () => {
    expect(parseGeocodeResponse(geocoding("FR", [{ type: "locality", name: "Exampleville" }]))).toEqual({ country: "FR", city: "Exampleville" });
  });

  it("reads the coordinates when the answer has them", () => {
    expect(parseGeocodeResponse(geocoding("FR", [], { lat: 48.5, lng: 2.25 }))).toEqual({ country: "FR", lat: 48.5, lon: 2.25 });
    expect(parseGeocodeResponse(geocoding("FR", [], { lat: "48.5", lng: 2.25 }))).toEqual({ country: "FR" });
    expect(parseGeocodeResponse(geocoding("FR", [], { lat: 48.5 }))).toEqual({ country: "FR" });
  });

  it("falls back to a postal town, then a county, for the city", () => {
    expect(parseGeocodeResponse(geocoding("GB", [{ type: "postal_town", name: "Sampleton" }]))).toEqual({ country: "GB", city: "Sampleton" });
    expect(parseGeocodeResponse(geocoding("GB", [{ type: "administrative_area_level_2", name: "Exampleshire" }]))).toEqual({ country: "GB", city: "Exampleshire" });
    expect(parseGeocodeResponse(geocoding("gb"))).toEqual({ country: "GB" });
  });

  it("gives none for no results, a result without a country, or a code it does not know", () => {
    expect(parseGeocodeResponse({ status: "ZERO_RESULTS", results: [] })).toBe("none");
    expect(parseGeocodeResponse({ status: "OK", results: [{ address_components: [{ long_name: "Somewhere", types: ["locality"] }] }] })).toBe("none");
    expect(parseGeocodeResponse(geocoding("ZZ"))).toBe("none");
  });

  it("throws for any other status, with Google's message", () => {
    expect(() => parseGeocodeResponse({ status: "REQUEST_DENIED", error_message: "The provided API key is invalid." })).toThrow(GeocodeError);
    expect(() => parseGeocodeResponse({ status: "OVER_QUERY_LIMIT" })).toThrow("OVER_QUERY_LIMIT");
    expect(() => parseGeocodeResponse(undefined)).toThrow("UNKNOWN");
  });
});

describe("placeFromComponents", () => {
  it("reads the Places API's spelling of the same components", () => {
    expect(
      placeFromComponents([
        { longText: "Exampleville", shortText: "Exampleville", types: ["locality", "political"] },
        { longText: "Australia", shortText: "AU", types: ["country", "political"] },
      ]),
    ).toEqual({ country: "AU", city: "Exampleville" });
    expect(placeFromComponents(undefined)).toBeUndefined();
  });
});

describe("readLocation", () => {
  it("reads either API's spelling, and nothing off the globe", () => {
    expect(readLocation({ lat: 48.5, lng: 2.25 })).toEqual({ lat: 48.5, lon: 2.25 });
    expect(readLocation({ latitude: -33.9, longitude: 151.2 })).toEqual({ lat: -33.9, lon: 151.2 });
    expect(readLocation({ lat: 91, lng: 0 })).toBeUndefined();
    expect(readLocation({ lat: 0, lng: 181 })).toBeUndefined();
    expect(readLocation({ lat: Number.NaN, lng: 0 })).toBeUndefined();
    expect(readLocation("48.5,2.25")).toBeUndefined();
    expect(readLocation(undefined)).toBeUndefined();
  });
});

describe("geocodeQuery and keys", () => {
  it("asks about a named place without a country, name and city together", () => {
    expect(geocodeQuery({ name: "Hotel Example", city: "Exampleville" })).toBe("Hotel Example, Exampleville");
    expect(geocodeQuery({ name: "Exampleville", city: "Exampleville" })).toBe("Exampleville");
    expect(geocodeQuery({ name: "Hotel Example" })).toBe("Hotel Example");
  });

  it("asks where a place with a country is, naming the country, until it has coordinates", () => {
    expect(geocodeNeed({ name: "Hotel Example", city: "Exampleville" })).toBe("country");
    expect(geocodeNeed({ name: "Hotel Example", country: "FR" })).toBe("location");
    expect(geocodeNeed({ name: "Hotel Example", country: "FR", lat: 48.5, lon: 2.25 })).toBeUndefined();
    expect(geocodeNeed(undefined)).toBeUndefined();
    expect(geocodeQuery({ name: "Hotel Example", city: "Exampleville", country: "FR" })).toBe("Hotel Example, Exampleville, FR");
    expect(geocodeQuery({ name: "Hotel Example", country: "FR", lat: 48.5, lon: 2.25 })).toBeUndefined();
  });

  it("asks nothing for a placed place, a bare code, or no place", () => {
    expect(geocodeQuery({ name: "Hotel Example", country: "FR", lat: 1, lon: 2 })).toBeUndefined();
    expect(geocodeQuery({ name: "LHR", code: "LHR" })).toBeUndefined();
    expect(geocodeQuery({ name: "lhr", code: "LHR" })).toBeUndefined();
    expect(geocodeQuery({ name: "KX" })).toBeUndefined();
    expect(geocodeQuery({ name: "  " })).toBeUndefined();
    expect(geocodeQuery(undefined)).toBeUndefined();
  });

  it("asks about a short real name, with its city when it has one", () => {
    expect(geocodeQuery({ name: "Rome" })).toBe("Rome");
    expect(geocodeQuery({ name: "Bath", city: "Bath" })).toBe("Bath");
    expect(geocodeQuery({ name: "Lima", code: "LIM" })).toBe("Lima");
  });

  it("keys the cache by the words, whatever the case and punctuation", () => {
    expect(normalizeQuery("  Hôtel  Example, Exampleville! ")).toBe("hôtel example exampleville");
    expect(geocodeKey("Hotel Example, Exampleville")).toBe(geocodeKey("hotel example exampleville"));
    expect(geocodeKey("Hotel Example")).not.toBe(geocodeKey("Hotel Sample"));
  });
});

describe("applyGeocode", () => {
  it("fills only what is missing", () => {
    expect(applyGeocode({ name: "Hotel Example" }, { country: "FR", city: "Exampleville" })).toEqual({ name: "Hotel Example", city: "Exampleville", country: "FR" });
    expect(applyGeocode({ name: "Hotel Example", city: "Sampleton", country: "GB" }, { country: "FR", city: "Exampleville" })).toEqual({
      name: "Hotel Example",
      city: "Sampleton",
      country: "GB",
    });
  });

  it("fills the coordinates, both or neither, never over the source's", () => {
    expect(applyGeocode({ name: "Hotel Example", country: "GB" }, { country: "FR", lat: 48.5, lon: 2.25 })).toEqual({ name: "Hotel Example", country: "GB", lat: 48.5, lon: 2.25 });
    expect(applyGeocode({ name: "Hotel Example", country: "GB", lat: 51.5, lon: -0.1 }, { country: "FR", lat: 48.5, lon: 2.25 })).toEqual({
      name: "Hotel Example",
      country: "GB",
      lat: 51.5,
      lon: -0.1,
    });
    expect(applyGeocode({ name: "Hotel Example" }, { country: "FR", lat: 48.5 })).toEqual({ name: "Hotel Example", country: "FR" });
  });
});

const stay: ExtractedSegment = { type: "lodging", title: "Hotel Example", start: "2030-05-01T15:00:00+02:00", destination: { name: "Hotel Example", city: "Exampleville" } };
const flight: ExtractedSegment = {
  type: "flight",
  title: "XX 1 AAA to BBB",
  start: "2030-05-01T08:00:00+00:00",
  origin: { name: "Exampleville", code: "AAA" },
  destination: { name: "Sampleton", code: "BBB", country: "GB" },
};

describe("fillAirports", () => {
  it("gives a flight's airports their country and spot from the table, leaving other kinds alone", () => {
    const lookup = (code: string) => (code === "AAA" ? { country: "FR", lat: 48.5, lon: 2.25 } : code === "BBB" ? { country: "GB", lat: 51.5, lon: -0.5 } : undefined);
    expect(fillAirports(flight, lookup)).toEqual({
      ...flight,
      origin: { name: "Exampleville", code: "AAA", country: "FR", lat: 48.5, lon: 2.25 },
      destination: { name: "Sampleton", code: "BBB", country: "GB", lat: 51.5, lon: -0.5 },
    });
    expect(fillAirports(stay, lookup)).toBe(stay);
    expect(fillAirports({ ...flight, origin: { name: "Nowhere", code: "ZZZ" } }, lookup).origin).toEqual({ name: "Nowhere", code: "ZZZ" });
  });

  it("keeps the coordinates the source gave and fills only the country from a table without any", () => {
    const placed = { name: "Exampleville", code: "AAA", lat: 48.6, lon: 2.3 };
    expect(fillAirports({ ...flight, origin: placed }, () => ({ country: "FR", lat: 48.5, lon: 2.25 })).origin).toEqual({ ...placed, country: "FR" });
    expect(fillAirports(flight, () => ({ country: "FR" })).origin).toEqual({ name: "Exampleville", code: "AAA", country: "FR" });
  });
});

describe("enrichSegments", () => {
  it("asks once per distinct query, saying what each place lacks, and fills the places", async () => {
    const asked: [string, string][] = [];
    const lookup = async (query: string, need: string) => {
      asked.push([query, need]);
      return need === "location" ? { country: "GB", lat: 48.5, lon: 2.25 } : { country: "FR", city: "Exampleville", lat: 48.5, lon: 2.25 };
    };
    const twice = [stay, { ...stay, destination: { name: "HOTEL EXAMPLE", city: "exampleville" } }, flight];
    const { segments, filled, failed } = await enrichSegments(twice, lookup);
    expect(asked).toEqual([
      ["Hotel Example, Exampleville", "country"],
      ["Exampleville", "country"],
      ["Sampleton, GB", "location"],
    ]);
    expect(filled).toBe(4);
    expect(failed).toBe(0);
    const spot = { lat: 48.5, lon: 2.25 };
    expect(segments[0]!.destination).toEqual({ name: "Hotel Example", city: "Exampleville", country: "FR", ...spot });
    expect(segments[1]!.destination).toEqual({ name: "HOTEL EXAMPLE", city: "exampleville", country: "FR", ...spot });
    expect(segments[2]!.origin).toEqual({ name: "Exampleville", code: "AAA", city: "Exampleville", country: "FR", ...spot });
    expect(segments[2]!.destination).toEqual({ ...flight.destination, ...spot });
  });

  it("counts nothing filled when the answer adds nothing", async () => {
    const placed = { ...stay, destination: { name: "Hotel Example", country: "FR" } };
    const { segments, filled } = await enrichSegments([placed], async () => ({ country: "FR" }));
    expect(segments).toEqual([placed]);
    expect(filled).toBe(0);
  });

  it("counts the places put off to another day, and says which segments still need asking", async () => {
    const { segments, filled, deferred, countryDeferred } = await enrichSegments([stay, flight], async () => "later");
    expect(segments).toEqual([stay, flight]);
    expect(filled).toBe(0);
    expect(deferred).toBe(3);
    // The stay and the flight's origin lack a country; its destination only its spot.
    expect(countryDeferred).toBe(2);
    expect(needsGeocoding(stay)).toBe(true);
    expect(needsGeocoding({ ...stay, destination: { name: "Hotel Example", country: "FR", lat: 1, lon: 2 } })).toBe(false);
    expect(needsGeocoding({ ...stay, destination: undefined })).toBe(false);
  });

  it("leaves a place alone when the lookup finds nothing or fails", async () => {
    const none = await enrichSegments([stay], async () => "none");
    expect(none).toEqual({ segments: [stay], filled: 0, failed: 0, deferred: 0, countryDeferred: 0 });
    const failing = await enrichSegments([stay, flight], async () => {
      throw new GeocodeError("REQUEST_DENIED");
    });
    expect(failing.segments).toEqual([stay, flight]);
    expect(failing.failed).toBe(3);
  });
});
