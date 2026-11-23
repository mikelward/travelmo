import { NotACalendar } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { previewIcs } from "./ics";

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
