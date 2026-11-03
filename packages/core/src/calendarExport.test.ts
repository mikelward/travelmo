import { describe, expect, it } from "vitest";
import { exportCalendar, isExportedUid } from "./calendarExport";
import { parseIcs } from "./ics";

const trip = { id: "t1", title: "Lisbon, at last", start: "2025-06-10", end: "2025-06-14", updatedAt: "2025-05-01T00:00:00Z" };
const segments = [
  {
    id: "s2",
    type: "lodging" as const,
    title: "Example Guesthouse",
    start: "2025-06-10T15:00:00+01:00",
    end: "2025-06-14T11:00:00+01:00",
    destination: { name: "Example Guesthouse", city: "Lisbon", country: "PT" },
    confirmation: "ABC123",
  },
  {
    id: "s1",
    type: "flight" as const,
    title: "XX 1 LHR to LIS",
    provider: "Example Air",
    start: "2025-06-10T08:00:00+01:00",
    end: "2025-06-10T10:45:00+01:00",
    origin: { name: "Heathrow", code: "LHR" },
    destination: { name: "Lisbon", code: "LIS" },
    notes: "Seat 12A; window",
  },
];
const options = { stamp: "2025-05-02T09:30:00.000Z", tripUrl: (id: string) => `https://travelmo.example/trips/${id}` };

describe("exportCalendar", () => {
  const text = exportCalendar([{ trip, segments }], options);
  // Long lines are folded; the assertions read them unfolded.
  const unfolded = text.replace(/\r\n /g, "");

  it("writes each trip as an all-day event and each booking in UTC", () => {
    expect(text).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Travelmo//Trips//EN\r\n");
    expect(text).toContain("DTSTART;VALUE=DATE:20250610\r\nDTEND;VALUE=DATE:20250615\r\nSUMMARY:Lisbon\\, at last\r\n");
    expect(unfolded).toContain("DTSTART:20250610T070000Z\r\nDTEND:20250610T094500Z\r\nSUMMARY:XX 1 LHR to LIS\r\nLOCATION:Heathrow (LHR) → Lisbon (LIS)\r\n");
    expect(unfolded).toContain("DESCRIPTION:Provider: Example Air\\nSeat 12A\\; window\\nhttps://travelmo.example/trips/t1\r\n");
    expect(text).toContain("UID:segment-t1-s2@export.travelmo");
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // Bookings in the order they happen.
    expect(text.indexOf("XX 1 LHR to LIS")).toBeLessThan(text.indexOf("SUMMARY:Example Guesthouse"));
  });

  it("reads back as the same events", () => {
    const parsed = parseIcs(text);
    expect(parsed.events.map((e) => [e.summary, e.start.date, e.start.time ?? null, e.location ?? null])).toEqual([
      ["Lisbon, at last", "2025-06-10", null, null],
      ["XX 1 LHR to LIS", "2025-06-10", "07:00", "Heathrow (LHR) → Lisbon (LIS)"],
      ["Example Guesthouse", "2025-06-10", "14:00", "Example Guesthouse, Lisbon"],
    ]);
    expect(parsed.events.every((e) => e.exported)).toBe(true);
    expect(parsed.events[1]!.description).toContain("Seat 12A; window");
  });

  it("leaves out the end of a booking with none, or one not after its start", () => {
    const moment = { id: "s3", type: "activity" as const, title: "Tour", start: "2025-06-11T10:00:00+01:00" };
    const backwards = { ...moment, id: "s4", end: "2025-06-11T09:00:00+01:00" };
    const out = exportCalendar([{ trip, segments: [moment, backwards] }], options);
    expect(out).toContain("DTSTART:20250611T090000Z\r\nSUMMARY:Tour");
    expect(out).not.toContain("DTEND:20250611");
  });

  it("folds long lines without splitting a character", () => {
    const long = exportCalendar([{ trip: { ...trip, title: "é".repeat(60) }, segments: [] }], options);
    const lines = long.split("\r\n");
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(parseIcs(long).events[0]!.summary).toBe("é".repeat(60));
  });

  it("names its own events", () => {
    expect(isExportedUid("trip-t1@export.travelmo")).toBe(true);
    expect(isExportedUid("abc@google.com")).toBe(false);
  });
});
