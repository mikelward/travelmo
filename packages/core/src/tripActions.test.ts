import { describe, expect, it } from "vitest";
import { describeDeletedTrips, describeRegroup } from "./tripActions";

describe("describeRegroup", () => {
  it("says what changed", () => {
    expect(describeRegroup({ changed: 3, deleted: 0 })).toBe("Done: 3 trips rebuilt.");
    expect(describeRegroup({ changed: 1, deleted: 1 })).toBe("Done: 1 trip rebuilt, 1 trip merged away.");
  });

  it("says when nothing needed changing", () => {
    expect(describeRegroup({ changed: 0, deleted: 0 })).toBe("Your trips were already grouped this way.");
    expect(describeRegroup({ changed: 0, deleted: 0, placed: 0 })).toBe("Your trips were already grouped this way.");
  });

  it("counts the bookings it gave a place", () => {
    expect(describeRegroup({ changed: 0, deleted: 0, placed: 2 })).toBe("Done: 2 bookings placed.");
    expect(describeRegroup({ changed: 1, deleted: 0, placed: 1 })).toBe("Done: 1 trip rebuilt, 1 booking placed.");
  });
});

describe("describeDeletedTrips", () => {
  it("says how many went and what to do next", () => {
    expect(describeDeletedTrips(12)).toBe("Deleted 12 trips. Import past bookings to start again.");
    expect(describeDeletedTrips(1)).toBe("Deleted 1 trip. Import past bookings to start again.");
    expect(describeDeletedTrips(0)).toBe("You had no trips to delete.");
  });
});
