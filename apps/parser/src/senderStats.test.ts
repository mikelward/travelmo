import { describe, expect, it } from "vitest";
import { senderCounts, senderReport } from "./senderStats";

describe("senderCounts", () => {
  it("counts a reading and what came of it, or a skip", () => {
    expect(senderCounts("imported", false)).toEqual({ read: 1, imported: 1 });
    expect(senderCounts("not_booking", false)).toEqual({ read: 1, notBooking: 1 });
    expect(senderCounts("failed", false)).toEqual({ read: 1, failed: 1 });
    expect(senderCounts("cancellation", false)).toEqual({ read: 1, cancellation: 1 });
    expect(senderCounts("filtered", false)).toEqual({ skipped: 1 });
  });

  it("counts Import anyway, and when it made a booking", () => {
    expect(senderCounts("imported", true)).toEqual({ read: 1, imported: 1, importAnyway: 1, importAnywayImported: 1 });
    expect(senderCounts("not_booking", true)).toEqual({ read: 1, notBooking: 1, importAnyway: 1 });
  });
});

describe("senderReport", () => {
  it("puts first the domains people made bookings of, then those the reader most often turns down", () => {
    const lines = senderReport([
      { domain: "steady.example", read: 10, imported: 10 },
      { domain: "missed.example", read: 10, imported: 2, notBooking: 8 },
      { domain: "overridden.example", read: 3, imported: 1, notBooking: 2, importAnyway: 1, importAnywayImported: 1 },
      { domain: "skipped.example", skipped: 4 },
      // Booked before counting began, and failing when read again.
      { domain: "regressed.example", refreshRead: 4, refreshFailed: 2 },
    ]);
    expect(lines.map((l) => l.split(":")[0])).toEqual(["overridden.example", "missed.example", "regressed.example", "steady.example"]);
    expect(lines[1]).toBe("missed.example: read 10, imported 2, not a booking 8, failed 0, skipped 0, Import anyway 0 (0 became bookings), read again 0 (0 failed)");
  });
});
