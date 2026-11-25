import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { airlineNames } from "@travelmo/core";
import { airlineDarkLogos, airlineLogos } from "./airlineLogos";

const file = (name: string) => join(__dirname, "../../public/airlines", name);

describe("airline logos", () => {
  it("has a file for each airline listed, and lists only airlines a heading can name", () => {
    for (const code of airlineLogos) {
      expect(airlineNames[code], code).toBeDefined();
      expect(existsSync(file(`${code}.svg`)), code).toBe(true);
    }
    for (const code of airlineDarkLogos) {
      expect(airlineLogos.has(code), code).toBe(true);
      expect(existsSync(file(`${code}-dark.svg`)), code).toBe(true);
    }
  });
});
