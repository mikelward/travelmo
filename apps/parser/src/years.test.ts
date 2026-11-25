import type { ExtractedBooking, ExtractedSegment } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { withInferredYears } from "./years";

// Invented, shaped like an airline confirmation that gives days without years.
const flight = (start: string, end: string): ExtractedSegment => ({
  type: "flight",
  title: "XX 847 MEL to SYD",
  start,
  end,
  origin: { name: "Melbourne", code: "MEL" },
  destination: { name: "Sydney", code: "SYD" },
});
const booking = (...segments: ExtractedSegment[]): ExtractedBooking => ({ isBooking: true, segments });
const sent = "2025-10-14T09:00:00Z";

describe("withInferredYears", () => {
  it("moves a date before the email, in a year the email never shows, on a year", () => {
    const read = booking(flight("2025-01-02T13:30:00+11:00", "2025-01-02T14:55:00+11:00"));
    expect(withInferredYears(read, "Thu 2 Jan · VA 847 · MEL 13:30 → SYD 14:55", sent).segments[0]).toMatchObject({
      start: "2026-01-02T13:30:00+11:00",
      end: "2026-01-02T14:55:00+11:00",
    });
  });

  it("leaves a date whose year the email gives, one after the email, and an email of unknown date", () => {
    const past = booking(flight("2025-01-02T13:30:00+11:00", "2025-01-02T14:55:00+11:00"));
    expect(withInferredYears(past, "Thanks for staying with us, 2 Jan 2025", sent)).toBe(past);
    expect(withInferredYears(past, "02/01/25 – 05/01/25", sent)).toBe(past);
    expect(withInferredYears(past, "2 Jan ’25", sent)).toBe(past);
    const coming = booking(flight("2025-10-20T13:30:00+11:00", "2025-10-20T14:55:00+11:00"));
    expect(withInferredYears(coming, "Mon 20 Oct", sent)).toBe(coming);
    expect(withInferredYears(past, "Thu 2 Jan", undefined)).toBe(past);
    // Sent the evening after: still that booking.
    const yesterday = booking(flight("2025-10-13T08:00:00+11:00", "2025-10-13T09:00:00+11:00"));
    expect(withInferredYears(yesterday, "Mon 13 Oct", sent)).toBe(yesterday);
    // A year on one leg dates the others.
    const overNewYear = booking(flight("2024-12-30T09:00:00+00:00", "2024-12-30T11:00:00+00:00"), flight("2025-01-02T09:00:00+00:00", "2025-01-02T11:00:00+00:00"));
    expect(withInferredYears(overNewYear, "Outbound 30 Dec; return 2 Jan 2025", "2025-01-10T09:00:00Z")).toBe(overNewYear);
    // Over New Year, the year given on checkout alone.
    const newYear = booking(flight("2025-12-30T15:00:00+00:00", "2026-01-02T11:00:00+00:00"));
    expect(withInferredYears(newYear, "30 Dec – 2 Jan 2026", "2026-01-10T09:00:00Z")).toBe(newYear);
    // A round trip under way when sent: its outbound leg stays before the return.
    const roundTrip = booking(flight("2025-10-01T09:00:00+00:00", "2025-10-01T11:00:00+00:00"), flight("2025-10-20T09:00:00+00:00", "2025-10-20T11:00:00+00:00"));
    expect(withInferredYears(roundTrip, "Outbound 1 Oct, return 20 Oct", sent)).toBe(roundTrip);
    // Under way when sent: a payment taken mid-stay.
    const staying = booking(flight("2025-10-01T15:00:00+01:00", "2025-10-20T11:00:00+01:00"));
    expect(withInferredYears(staying, "1–20 Oct", sent)).toBe(staying);
  });

  it("gives a moved date the offset its airport keeps that day", () => {
    // London is on summer time on 25 October 2025, not on 25 October 2026.
    const london = { ...flight("2025-10-25T13:00:00+01:00", "2025-10-25T14:30:00+00:00"), origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Dublin", code: "DUB" } };
    expect(withInferredYears(booking(london), "Sat 25 Oct", "2025-11-01T09:00:00Z").segments[0]).toMatchObject({
      start: "2026-10-25T13:00:00+00:00",
      end: "2026-10-25T14:30:00+00:00",
    });
  });

  it("keeps the offset as read for a place that isn't the airport its code names", () => {
    // BHM is Birmingham New Street to a train, Birmingham, Alabama to the airport table.
    const train = { ...flight("2025-01-02T10:00:00+00:00", "2025-01-02T11:30:00+00:00"), type: "train" as const, origin: { name: "Birmingham New Street", code: "BHM" }, destination: { name: "London Euston", code: "EUS" } };
    expect(withInferredYears(booking(train), "Thu 2 Jan", sent).segments[0]).toMatchObject({ start: "2026-01-02T10:00:00+00:00", end: "2026-01-02T11:30:00+00:00" });
    const misread = { ...train, type: "flight" as const };
    expect(withInferredYears(booking(misread), "Thu 2 Jan", sent).segments[0]).toMatchObject({ start: "2026-01-02T10:00:00+00:00" });
  });

  it("moves a time given without seconds", () => {
    const sydney = { ...flight("2025-01-02T13:30+11:00", "2025-01-02T14:55+11:00"), origin: { name: "Sydney", code: "SYD" }, destination: { name: "Sydney", code: "SYD" } };
    expect(withInferredYears(booking(sydney), "Thu 2 Jan", sent).segments[0]).toMatchObject({ start: "2026-01-02T13:30+11:00", end: "2026-01-02T14:55+11:00" });
  });

  it("leaves 29 February, which a year on doesn't have", () => {
    const leap = booking(flight("2024-02-29T10:00:00+00:00", "2024-02-29T12:00:00+00:00"));
    expect(withInferredYears(leap, "Thu 29 Feb", sent)).toBe(leap);
    // Nor a stay ending then: it would end before it starts.
    const stay = booking(flight("2024-02-28T15:00:00+00:00", "2024-02-29T11:00:00+00:00"));
    expect(withInferredYears(stay, "28–29 Feb", sent)).toBe(stay);
  });
});
