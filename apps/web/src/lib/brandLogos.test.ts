import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brands } from "@travelmo/core";
import { brandDarkLogos, brandLogos } from "./brandLogos";

const file = (name: string) => join(__dirname, "../../public/brands", name);

describe("brand logos", () => {
  it("has a file for each brand listed, and lists only brands a booking can name", () => {
    const ids = new Set(brands.map((b) => b.id));
    for (const id of brandLogos) {
      expect(ids.has(id), id).toBe(true);
      expect(existsSync(file(`${id}.svg`)), id).toBe(true);
    }
    for (const id of brandDarkLogos) {
      expect(brandLogos.has(id), id).toBe(true);
      expect(existsSync(file(`${id}-dark.svg`)), id).toBe(true);
    }
  });
});
