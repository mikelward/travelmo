import { describe, expect, it } from "vitest";
import { formCountry, formPlace } from "./places";

describe("formCountry", () => {
  it("passes the picker's country through, and a flight's only when an address pick gave it", () => {
    expect(formCountry("lodging", "FR")).toBe("FR");
    expect(formCountry("lodging", "")).toBe("");
    expect(formCountry("flight", "FR")).toBeUndefined();
    expect(formCountry("flight", "FR", true)).toBe("FR");
    expect(formCountry("flight", "FR", false)).toBeUndefined();
  });
});

describe("formPlace", () => {
  it("keeps a country chosen without a place name, named by the country", () => {
    expect(formPlace(undefined, "  ", "", "IE")).toEqual({ name: "Ireland", country: "IE" });
  });

  it("is no place at all with neither a name nor a country", () => {
    expect(formPlace(undefined, "", "", "")).toBeUndefined();
    expect(formPlace(undefined, "", "", undefined)).toBeUndefined();
  });

  it("keeps the name given", () => {
    expect(formPlace(undefined, "Example Square", "", "IE")).toEqual({ name: "Example Square", country: "IE" });
  });

  it("takes an address pick's city and address, and keeps them when the form did not touch them", () => {
    const picked = formPlace(undefined, "Hotel Example", "", "FR", { city: "Exampleville", address: "1 Example St" });
    expect(picked).toEqual({ name: "Hotel Example", country: "FR", city: "Exampleville", address: "1 Example St" });
    expect(formPlace(picked, "Hotel Example", "", "FR")).toEqual(picked);
    expect(formPlace(picked, "Somewhere else", "", "FR", { city: "", address: "" })).toEqual({ name: "Somewhere else", country: "FR" });
  });
});
