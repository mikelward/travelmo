import { describe, expect, it } from "vitest";
import { describeRegroup } from "./regroup";

describe("describeRegroup", () => {
  it("says what changed", () => {
    expect(describeRegroup({ changed: 3, deleted: 0 })).toBe("Done: 3 trips rebuilt.");
    expect(describeRegroup({ changed: 1, deleted: 1 })).toBe("Done: 1 trip rebuilt, 1 trip merged away.");
  });

  it("says when nothing needed changing", () => {
    expect(describeRegroup({ changed: 0, deleted: 0 })).toBe("Your trips were already grouped this way.");
  });
});
