import { describe, expect, it } from "vitest";
import { stableHash } from "./hash";

describe("stableHash", () => {
  it("is stable and spreads nearby inputs apart", () => {
    expect(stableHash("trip|2030-05-01")).toBe(stableHash("trip|2030-05-01"));
    expect(stableHash("trip|2030-05-01")).not.toBe(stableHash("trip|2030-05-02"));
    expect(stableHash("")).toMatch(/^[0-9a-z]+$/);
  });
});
