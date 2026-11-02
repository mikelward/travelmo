import { describe, expect, it } from "vitest";
import { NotACalendar, endFromDuration, icsEventText, isTravelCalendar, parseIcs, summarizeIcs } from "./ics";

// Invented events.
const calendar = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Example//Example Travel Feed//EN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:flight-1@example.com",
  "DTSTAMP:20300101T000000Z",
  "DTSTART;TZID=/example.org/20070129_1/Europe/London:20300501T081500",
  "DTEND;TZID=Europe/Paris:20300501T114000",
  "SUMMARY:XX123 LHR to CDG",
  "LOCATION:London Heathrow\\, Terminal 5",
  "DESCRIPTION:Booking reference ABC123\\nSeat 12A",
  "BEGIN:VALARM",
  "TRIGGER:-PT1H",
  "DESCRIPTION:Alarm text that is not the event's",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:stay-1@example.com",
  "DTSTART;VALUE=DATE:20300501",
  "DTEND;VALUE=DATE:20300508",
  "SUMMARY:Hotel Example",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup@example.com",
  "DTSTART:20300101T090000Z",
  "RRULE:FREQ=DAILY",
  "SUMMARY:Standup",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:cancelled@example.com",
  "DTSTART:20300601T090000",
  "STATUS:CANCELLED",
  "SUMMARY:Flight to Exampleville",
  "  folded onward",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  const parsed = parseIcs(calendar);

  it("reads events with their times resolved where the file names a zone", () => {
    expect(parsed.events).toHaveLength(4);
    expect(parsed.events[0]).toMatchObject({
      summary: "XX123 LHR to CDG",
      location: "London Heathrow, Terminal 5",
      description: "Booking reference ABC123\nSeat 12A",
      start: { date: "2030-05-01", time: "08:15", offset: "+01:00", zone: "Europe/London" },
      end: { date: "2030-05-01", time: "11:40", offset: "+02:00", zone: "Europe/Paris" },
      recurring: false,
      cancelled: false,
    });
    expect(parsed.events[1]).toMatchObject({ start: { date: "2030-05-01" }, end: { date: "2030-05-08" } });
    expect(parsed.events[1]!.start.time).toBeUndefined();
  });

  it("marks recurring and cancelled events, unfolds lines and leaves floating times without an offset", () => {
    expect(parsed.events[2]).toMatchObject({ summary: "Standup", recurring: true, start: { offset: "+00:00" } });
    expect(parsed.events[3]).toMatchObject({ summary: "Flight to Exampleville folded onward", cancelled: true });
    expect(parsed.events[3]!.start.offset).toBeUndefined();
  });

  it("keys events by UID, stably", () => {
    expect(parseIcs(calendar).events[0]!.key).toBe(parsed.events[0]!.key);
    expect(new Set(parsed.events.map((e) => e.key)).size).toBe(4);
  });

  it("leaves out events whose times are out of range", () => {
    const bad = (dtstart: string) =>
      parseIcs(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", `DTSTART:${dtstart}`, "SUMMARY:XX1", "END:VEVENT", "END:VCALENDAR"].join("\r\n")).events;
    expect(bad("20309999T080000Z")).toEqual([]);
    expect(bad("20300230T080000Z")).toEqual([]);
    expect(bad("20300501T996000Z")).toEqual([]);
    expect(bad("20300501T080000Z")).toHaveLength(1);
  });

  it("refuses a file that is not a calendar", () => {
    expect(() => parseIcs("hello")).toThrow(NotACalendar);
  });
});

describe("icsEventText", () => {
  it("gives the model the event with its instants spelled out", () => {
    expect(icsEventText(parseIcs(calendar).events[0]!)).toBe(
      [
        "Calendar event",
        "Title: XX123 LHR to CDG",
        "Starts: 2030-05-01T08:15:00+01:00 (Europe/London)",
        "Ends: 2030-05-01T11:40:00+02:00 (Europe/Paris)",
        "Location: London Heathrow, Terminal 5",
        "",
        "Booking reference ABC123\nSeat 12A",
      ].join("\n"),
    );
    expect(icsEventText(parseIcs(calendar).events[3]!)).toContain("Starts: 2030-06-01 09:00 (local time; zone not given)");
  });
});

describe("summarizeIcs and isTravelCalendar", () => {
  it("counts what would be read", () => {
    expect(summarizeIcs(parseIcs(calendar))).toEqual({ events: 4, importable: 2, recurring: 1, cancelled: 1 });
  });
  it("trusts TripIt's calendars only", () => {
    expect(isTravelCalendar(parseIcs(calendar))).toBe(false);
    expect(isTravelCalendar(parseIcs(calendar.replace("Example Travel Feed", "TripIt")))).toBe(true);
  });
});

describe("endFromDuration", () => {
  it("ends an event given a DURATION instead of a DTEND", () => {
    const parsed = parseIcs(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:d", "DTSTART:20300501T080000Z", "DURATION:PT2H", "SUMMARY:XX1", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
    expect(parsed.events[0]!.end).toEqual({ date: "2030-05-01", time: "10:00", offset: "+00:00", zone: "UTC" });
  });
  it("moves dates by days, wall clocks by hours, and takes the zone's offset at the end", () => {
    // Across London's October DST change (01:00 UTC on 27 October 2030):
    // 22:30 BST plus five exact hours is 02:30 GMT, not 03:30.
    expect(endFromDuration({ date: "2030-10-26", time: "22:30", offset: "+01:00", zone: "Europe/London" }, "PT5H")).toEqual({
      date: "2030-10-27",
      time: "02:30",
      offset: "+00:00",
      zone: "Europe/London",
    });
    expect(endFromDuration({ date: "2030-05-01" }, "P1W")).toEqual({ date: "2030-05-08" });
    expect(endFromDuration({ date: "2030-05-01", time: "08:00", offset: "+00:00", zone: "UTC" }, "PT2H45S")).toEqual({
      date: "2030-05-01",
      time: "10:00",
      offset: "+00:00",
      zone: "UTC",
    });
    expect(endFromDuration({ date: "2030-05-01", time: "23:00" }, "P1DT2H30M")).toEqual({ date: "2030-05-03", time: "01:30" });
  });
  it("gives nothing for a negative or unreadable duration", () => {
    expect(endFromDuration({ date: "2030-05-01" }, "-P1D")).toBeUndefined();
    expect(endFromDuration({ date: "2030-05-01" }, "two hours")).toBeUndefined();
  });
});

describe("calendar-defined zones (VTIMEZONE)", () => {
  const calendar = (zone: string[], tzid: string) =>
    parseIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:z",
        `DTSTART;TZID=${tzid}:20300115T080000`,
        "SUMMARY:XX1 AAA to BBB",
        "END:VEVENT",
        ...zone,
        "END:VCALENDAR",
      ].join("\r\n"),
    ).events[0]!;

  it("uses the IANA name a calendar app records for its zone", () => {
    const zone = ["BEGIN:VTIMEZONE", "TZID:Office time", "X-LIC-LOCATION:America/New_York", "BEGIN:STANDARD", "TZOFFSETTO:-0500", "END:STANDARD", "END:VTIMEZONE"];
    expect(calendar(zone, "Office time").start).toEqual({ date: "2030-01-15", time: "08:00", offset: "-05:00", zone: "America/New_York" });
  });

  it("takes the one offset of a zone without daylight saving, even defined after the event", () => {
    const zone = ["BEGIN:VTIMEZONE", "TZID:Custom/Fixed", "BEGIN:STANDARD", "TZOFFSETFROM:+0530", "TZOFFSETTO:+0530", "END:STANDARD", "END:VTIMEZONE"];
    expect(calendar(zone, "Custom/Fixed").start).toEqual({ date: "2030-01-15", time: "08:00", offset: "+05:30" });
  });

  it("names a zone with several offsets for the model rather than saying none was given", () => {
    const zone = [
      "BEGIN:VTIMEZONE",
      "TZID:Custom/Eastern",
      "BEGIN:STANDARD",
      "TZOFFSETTO:-0500",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "TZOFFSETTO:-0400",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
    ];
    const event = calendar(zone, "Custom/Eastern");
    expect(event.start).toEqual({ date: "2030-01-15", time: "08:00", zoneNote: "Custom/Eastern, UTC -05:00 or -04:00" });
    expect(icsEventText(event)).toContain("Starts: 2030-01-15 08:00 (local time in the calendar's zone Custom/Eastern, UTC -05:00 or -04:00)");
  });
});
