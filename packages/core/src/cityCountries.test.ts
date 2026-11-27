import { describe, expect, it } from "vitest";
import { cityCountry } from "./cityCountries";
import { cityKey } from "./cityKey";
import { fillCities } from "./geocode";
import type { ExtractedSegment } from "./schema";

describe("cityCountry", () => {
  it("places a city whose name is unambiguous, however it is written", () => {
    expect(cityCountry("Liverpool")).toBe("GB");
    expect(cityCountry("LONDON")).toBe("GB");
    expect(cityCountry("Las Vegas")).toBe("US");
    expect(cityCountry("São Paulo")).toBe("BR");
    expect(cityCountry("Sao  Paulo")).toBe("BR");
  });

  it("takes the much larger city of a shared name, and leaves a close call to the geocoder", () => {
    // Boston, Massachusetts is sixteen times Boston, Lincolnshire.
    expect(cityCountry("Boston")).toBe("US");
    // Birmingham, England is under five times Birmingham, Alabama.
    expect(cityCountry("Birmingham")).toBeUndefined();
    expect(cityCountry("Manchester")).toBeUndefined();
    expect(cityCountry("Nowhere In Particular")).toBeUndefined();
    expect(cityCountry("")).toBeUndefined();
  });

  it("keys a name in lower case, with accents and punctuation gone", () => {
    expect(cityKey("  Saint-Étienne ")).toBe("saint etienne");
  });
});

describe("fillCities", () => {
  const lookup = (name: string) => cityCountry(name);
  const train: ExtractedSegment = {
    type: "train",
    title: "Euston to Liverpool",
    start: "2026-05-23T12:07:00+01:00",
    origin: { name: "London Euston", city: "London" },
    destination: { name: "Liverpool" },
  };

  it("gives a journey's ends their city's country, or a station named for its city", () => {
    expect(fillCities(train, lookup)).toMatchObject({ origin: { country: "GB" }, destination: { country: "GB" } });
  });

  it("keeps a country the booking gave, and takes no venue's name for a city", () => {
    const show: ExtractedSegment = { type: "activity", title: "Dinner", start: "2026-05-23T19:00:00+01:00", destination: { name: "Florence" } };
    expect(fillCities(show, lookup).destination?.country).toBeUndefined();
    const meal: ExtractedSegment = { type: "meal", title: "Dinner at Florence", start: "2026-05-23T19:00:00+01:00", destination: { name: "Florence" } };
    expect(fillCities(meal, lookup).destination?.country).toBeUndefined();
    const stay: ExtractedSegment = { type: "lodging", title: "Cove", start: "2026-05-23T15:00:00+01:00", destination: { name: "Cove", city: "Liverpool", country: "AU" } };
    expect(fillCities(stay, lookup).destination?.country).toBe("AU");
    expect(fillCities({ ...stay, destination: { name: "Cove", city: "Liverpool" } }, lookup).destination?.country).toBe("GB");
  });
});
