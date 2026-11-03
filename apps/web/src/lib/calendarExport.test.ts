import { describe, expect, it } from "vitest";
import { exportLinks } from "./calendarExport";

describe("exportLinks", () => {
  it("gives the link to copy, to open in Apple Calendar, and to add to Google Calendar", () => {
    expect(exportLinks("abc", "https://parser.example")).toEqual({
      https: "https://parser.example/cal/abc.ics",
      webcal: "webcal://parser.example/cal/abc.ics",
      google: "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fparser.example%2Fcal%2Fabc.ics",
    });
  });
});
