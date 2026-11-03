import { describe, expect, it } from "vitest";
import { formPlace } from "./places";

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
});
