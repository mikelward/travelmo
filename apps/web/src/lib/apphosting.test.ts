import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// App Hosting builds from the committed apphosting.yaml, and the app treats
// any non-empty optional setting as turned on, so a placeholder value left
// in it ships a broken feature.
const yaml = readFileSync(new URL("../../apphosting.yaml", import.meta.url), "utf8");
const values = yaml
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .map((line) => /^\s*value:\s*(.*)$/.exec(line)?.[1]?.trim())
  .filter((value): value is string => value !== undefined);

describe("apphosting.yaml", () => {
  it("sets every variable it declares", () => {
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toMatch(/REPLACE_ME|^<.*>$|^$/);
    }
  });
});
