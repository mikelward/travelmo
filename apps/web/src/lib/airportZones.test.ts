import { describe, expect, it } from "vitest";
import { zonesFromCodes } from "./airportZones";

const table: Record<string, string> = { MAN: "Europe/London", DUB: "Europe/Dublin" };
const lookup = (code: string) => table[code.toUpperCase()];

describe("zonesFromCodes", () => {
  it("maps each known code to its end's zone", () => {
    expect(zonesFromCodes({ originCode: "MAN", destinationCode: "dub" }, lookup, new Set())).toEqual({
      startZone: "Europe/London",
      endZone: "Europe/Dublin",
    });
  });

  it("leaves unknown codes and empty fields alone", () => {
    expect(zonesFromCodes({ originCode: "", destinationCode: "XYZ" }, lookup, new Set())).toEqual({});
  });

  it("never overrides a zone the user picked", () => {
    expect(zonesFromCodes({ originCode: "MAN", destinationCode: "DUB" }, lookup, new Set(["endZone"]))).toEqual({
      startZone: "Europe/London",
    });
  });
});
