import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// App Hosting builds from the committed apphosting.yaml, and the app treats
// any non-empty optional setting as turned on, so a placeholder value left
// in it ships a broken feature.
const yaml = readFileSync(new URL("../../../../apphosting.yaml", import.meta.url), "utf8");
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

// When apphosting.yaml sets a buildCommand, App Hosting's build rewrites the
// root package.json, writing a missing dependencies or devDependencies field
// as null, and pnpm install then fails with "Cannot convert undefined or null
// to object". Empty objects survive the rewrite.
describe("root package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"));
  it("declares dependencies and devDependencies", () => {
    expect(pkg.dependencies).toBeTypeOf("object");
    expect(pkg.devDependencies).toBeTypeOf("object");
  });
});
