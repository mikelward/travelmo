import { describe, expect, it } from "vitest";
import {
  GeocodeError,
  applyGeocode,
  enrichSegments,
  fillAirportCountries,
  geocodeKey,
  geocodeQuery,
  normalizeQuery,
  parseGeocodeResponse,
  placeFromComponents,
} from "./geocode";
import type { ExtractedSegment } from "./schema";

// Invented places; no real address.
const geocoding = (country: string, extra: { type: string; name: string }[] = []) => ({
  status: "OK",
  results: [
    {
      address_components: [
        ...extra.map((e) => ({ long_name: e.name, short_name: e.name, types: [e.type, "political"] })),
        { long_name: "Exampleland", short_name: country, types: ["country", "political"] },
      ],
    },
  ],
});

describe("parseGeocodeResponse", () => {
  it("reads the country code and the locality", () => {
    expect(parseGeocodeResponse(geocoding("FR", [{ type: "locality", name: "Exampleville" }]))).toEqual({ country: "FR", city: "Exampleville" });
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

describe("geocodeQuery and keys", () => {
  it("asks about a named place without a country, name and city together", () => {
    expect(geocodeQuery({ name: "Hotel Example", city: "Exampleville" })).toBe("Hotel Example, Exampleville");
    expect(geocodeQuery({ name: "Exampleville", city: "Exampleville" })).toBe("Exampleville");
    expect(geocodeQuery({ name: "Hotel Example" })).toBe("Hotel Example");
  });

  it("asks nothing for a place with a country, a bare code, or no place", () => {
    expect(geocodeQuery({ name: "Hotel Example", country: "FR" })).toBeUndefined();
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
});

const stay: ExtractedSegment = { type: "lodging", title: "Hotel Example", start: "2030-05-01T15:00:00+02:00", destination: { name: "Hotel Example", city: "Exampleville" } };
const flight: ExtractedSegment = {
  type: "flight",
  title: "XX 1 AAA to BBB",
  start: "2030-05-01T08:00:00+00:00",
  origin: { name: "Exampleville", code: "AAA" },
  destination: { name: "Sampleton", code: "BBB", country: "GB" },
};

describe("fillAirportCountries", () => {
  it("gives a flight's airports their country from the table, leaving other kinds alone", () => {
    const lookup = (code: string) => (code === "AAA" ? { country: "FR" } : undefined);
    expect(fillAirportCountries(flight, lookup)).toEqual({ ...flight, origin: { name: "Exampleville", code: "AAA", country: "FR" } });
    expect(fillAirportCountries(stay, lookup)).toBe(stay);
    expect(fillAirportCountries({ ...flight, origin: { name: "Nowhere", code: "ZZZ" } }, lookup).origin).toEqual({ name: "Nowhere", code: "ZZZ" });
  });
});

describe("enrichSegments", () => {
  it("asks once per distinct query and fills the places", async () => {
    const asked: string[] = [];
    const lookup = async (query: string) => {
      asked.push(query);
      return { country: "FR", city: "Exampleville" };
    };
    const twice = [stay, { ...stay, destination: { name: "HOTEL EXAMPLE", city: "exampleville" } }, flight];
    const { segments, filled, failed } = await enrichSegments(twice, lookup);
    expect(asked).toEqual(["Hotel Example, Exampleville", "Exampleville"]);
    expect(filled).toBe(3);
    expect(failed).toBe(0);
    expect(segments[0]!.destination).toEqual({ name: "Hotel Example", city: "Exampleville", country: "FR" });
    expect(segments[1]!.destination).toEqual({ name: "HOTEL EXAMPLE", city: "exampleville", country: "FR" });
    expect(segments[2]!.origin).toEqual({ name: "Exampleville", code: "AAA", city: "Exampleville", country: "FR" });
    expect(segments[2]!.destination).toEqual(flight.destination);
  });

  it("leaves a place alone when the lookup finds nothing or fails", async () => {
    const none = await enrichSegments([stay], async () => "none");
    expect(none).toEqual({ segments: [stay], filled: 0, failed: 0 });
    const failing = await enrichSegments([stay, flight], async () => {
      throw new GeocodeError("REQUEST_DENIED");
    });
    expect(failing.segments).toEqual([stay, flight]);
    expect(failing.failed).toBe(2);
  });
});
