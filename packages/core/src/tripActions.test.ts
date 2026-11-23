import { describe, expect, it } from "vitest";
import { describeDeletedTrips, describeNeverImport, describeRegroup } from "./tripActions";

describe("describeRegroup", () => {
  it("says what changed", () => {
    expect(describeRegroup({ changed: 3, deleted: 0 })).toBe("Done: 3 trips rebuilt.");
    expect(describeRegroup({ changed: 1, deleted: 1 })).toBe("Done: 1 trip rebuilt, 1 trip merged away.");
  });

  it("says when nothing needed changing", () => {
    expect(describeRegroup({ changed: 0, deleted: 0 })).toBe("Your trips were already grouped this way.");
  });
});

describe("describeDeletedTrips", () => {
  it("says how many went and what to do next", () => {
    expect(describeDeletedTrips(12)).toBe("Deleted 12 trips. Import past bookings to start again.");
    expect(describeDeletedTrips(1)).toBe("Deleted 1 trip. Import past bookings to start again.");
    expect(describeDeletedTrips(0)).toBe("You had no trips to delete.");
  });
});

describe("describeNeverImport", () => {
  it("says what stopping a sender did", () => {
    expect(describeNeverImport("drama.example")).toBe("Never importing drama.example.");
    expect(describeNeverImport("drama.example", { bookings: 12, trips: 12 })).toBe("Never importing drama.example. Deleted 12 bookings and 12 empty trips.");
    expect(describeNeverImport("drama.example", { bookings: 1, trips: 0 })).toBe("Never importing drama.example. Deleted 1 booking.");
    expect(describeNeverImport("drama.example", { bookings: 0, trips: 0 })).toBe("Never importing drama.example. It had no bookings to delete.");
  });
});
