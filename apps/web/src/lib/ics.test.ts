import { NotACalendar } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { describeCalendarResult, previewIcs } from "./ics";

const file = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:a",
  "DTSTART:20300101T090000Z",
  "SUMMARY:XX1 AAA to BBB",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b",
  "DTSTART:20300101T090000Z",
  "RRULE:FREQ=DAILY",
  "SUMMARY:Standup",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("previewIcs", () => {
  it("counts what will be checked and what is skipped", () => {
    expect(previewIcs(file)).toMatchObject({ text: "2 events; 1 will be checked for bookings. Skipping 1 repeating event.", importable: 1 });
  });
  it("refuses a file that is not a calendar", () => {
    expect(() => previewIcs("hello")).toThrow(NotACalendar);
  });
});

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
