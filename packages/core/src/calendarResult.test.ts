import { describe, expect, it } from "vitest";
import { describeCalendarResult } from "./calendarResult";

describe("describeCalendarResult", () => {
  it("says what happened and whether to upload again", () => {
    expect(describeCalendarResult({ skipped: 0, filtered: 3, not_booking: 1, imported: 2, failed: 0, recurring: 1, cancelled: 0, remaining: 0 })).toBe(
      "2 events imported, 1 not bookings, 3 skipped as not travel.",
    );
    expect(describeCalendarResult({ skipped: 5, filtered: 0, not_booking: 0, imported: 1, failed: 1, recurring: 0, cancelled: 0, remaining: 40 })).toBe(
      "1 event imported, 5 read before, 1 failed. 40 events are left: import the file again to continue.",
    );
    expect(describeCalendarResult({ skipped: 0, filtered: 0, not_booking: 0, imported: 1, failed: 0, recurring: 0, cancelled: 0, remaining: 0, updated: 1 })).toBe(
      "1 event imported, 1 read again after changing.",
    );
  });
});
