import { describe, expect, it } from "vitest";
import { exportCalendar } from "./calendarExport";
import { directionsQuery } from "./directions";
import { travelDocuments } from "./documents";
import { mergeBookings } from "./mergeBookings";
import { matchesKeyword } from "./review";
import type { Segment } from "./schema";
import { mergeDetails, normalizeReference, providersDiffer, sameBooking } from "./trips";
import { hasWords, hasWordStarts, wordsOf } from "./words";

describe("words", () => {
  it("are letters and digits, case and accents aside", () => {
    expect(wordsOf("Göteborg C, 12:05")).toEqual(["goteborg", "c", "12", "5"]);
    expect(hasWords("Room 12345", "1234")).toBe(false);
    expect(hasWords("Room 1234, sea view", "1234")).toBe(true);
    expect(hasWords("Romeo Hotel", "Rome")).toBe(false);
    expect(hasWords("Hotel Roma Centro", "roma centro")).toBe(true);
    expect(hasWords("Hotel Centro Roma", "roma centro")).toBe(false);
    expect(hasWordStarts("Paris and BA", "par ba")).toBe(true);
    expect(hasWordStarts("Cuba", "ba")).toBe(false);
  });

  it("are numbers however a source pads them with zeros", () => {
    expect(hasWords("Gate 01", "Gate 1")).toBe(true);
    expect(hasWords("Gate 1", "gate 001")).toBe(true);
    expect(hasWords("Flight UA0122", "UA122")).toBe(true);
    expect(hasWords("Room 120034", "12034")).toBe(false);
    expect(hasWords("Platform 0", "0")).toBe(true);
    expect(hasWords("Gate 10", "Gate 1")).toBe(false);
    expect(hasWordStarts("Seat 07A", "7a")).toBe(true);
    expect(normalizeReference("ab-0123")).toBe(normalizeReference("AB123"));
    expect(normalizeReference("0708843612")).toBe(normalizeReference("708843612"));
    expect(normalizeReference("120034")).not.toBe(normalizeReference("12034"));
  });

  it("is one booking under a reference one email pads with zeros", () => {
    const stay = { type: "lodging" as const, title: "Cove Liverpool", start: "2026-12-12T15:00:00+00:00", end: "2026-12-14T11:00:00+00:00" };
    expect(sameBooking({ ...stay, confirmation: "0708843612" }, { ...stay, confirmation: "708843612" })).toBe(true);
    // And a reference padded in one note and not in the other is said once.
    expect(mergeDetails({ ...stay, confirmation: "X1", notes: "Other reference: 0708843612" }, { ...stay, confirmation: "708843612" }).notes).toBe("Other reference: 0708843612");
  });
});

// Each place that asks whether a text already says something asks it of words, not of letters anywhere.
describe("saying a thing once, as whole words", () => {
  const car = { type: "car_rental" as const, title: "Avis", start: "2026-11-24T17:30:00-05:00", end: "2026-11-29T17:30:00-05:00", provider: "Avis" };
  it("keeps a reference a note only contains inside a longer number", () => {
    const merged = mergeDetails({ ...car, confirmation: "AB123", notes: "Room 12345" }, { ...car, confirmation: "1234" });
    expect(merged.notes).toBe("Room 12345\nOther reference: 1234");
  });

  it("keeps a merged booking's note another note only contains inside a word", () => {
    const at = "2026-11-25T10:00:00.000Z";
    const booking = (id: string, notes: string): Segment => ({ ...car, id, tripId: "t", notes, source: "gmail", gmailMessageIds: [id], createdAt: at, updatedAt: at });
    expect(mergeBookings(booking("a", "Gate 12"), booking("b", "Gate 1"), at).notes).toBe("Gate 12\nGate 1");
    expect(mergeBookings(booking("a", "Gate 1, level 2"), booking("b", "Gate 1"), at).notes).toBe("Gate 1, level 2");
  });

  it("knows a seller by its name, not by letters inside another", () => {
    expect(providersDiffer("Hopperton Inn", "Hilton")).toBe(true);
    expect(providersDiffer("Thetrainline", "LNER")).toBe(false);
    expect(providersDiffer("Booking.com", "Hilton")).toBe(false);
  });

  it("adds a town a place's name only contains inside a word", () => {
    expect(directionsQuery({ name: "Romeo Hotel", city: "Rome" })).toBe("Romeo Hotel, Rome");
    expect(directionsQuery({ name: "Hotel Rome Centre", city: "Rome" })).toBe("Hotel Rome Centre");
    const ics = exportCalendar(
      [{ trip: { id: "t", title: "Rome", start: "2026-05-01", end: "2026-05-02", updatedAt: "2026-04-01T00:00:00Z" }, segments: [{ id: "s", type: "lodging", title: "Romeo", start: "2026-05-01T15:00:00+02:00", destination: { name: "Romeo Hotel", city: "Rome" } }] }],
      { stamp: "2026-04-01T00:00:00.000Z", tripUrl: (id) => id },
    ).replace(/\r\n /g, "");
    expect(ics).toContain("LOCATION:Romeo Hotel\\, Rome");
  });

  it("finds a review record by the starts of its words", () => {
    const record = { subject: "Your booking at Cove", from: "Cove <hello@cove.example>", reason: "a booking" };
    expect(matchesKeyword(record, "book cove")).toBe(true);
    expect(matchesKeyword(record, "ook")).toBe(false);
  });

  it("knows a passport or visa by the word, not by letters inside a name", () => {
    const kinds = travelDocuments([
      { title: "Visalia library card", fields: [{ label: "Expiry", value: "2030-01-01" }] },
      { title: "Visas", fields: [{ label: "Expiry", value: "2030-01-01" }] },
      { title: "ePassport", fields: [{ label: "Expiry", value: "2030-01-01" }] },
      { title: "Travel document", fields: [{ label: "Type", value: "e-Visa" }, { label: "Expiry", value: "2030-01-01" }] },
    ]).map((d) => d.kind);
    expect(kinds).toEqual(["other", "visa", "passport", "visa"]);
  });

  it("never takes a birthplace for the country a passport is for", () => {
    const [passport] = travelDocuments([
      { title: "Passport", fields: [{ label: "Birthplace country", value: "FR" }, { label: "Issuing country", value: "GB" }, { label: "Expiry", value: "2030-01-01" }] },
    ]);
    expect(passport?.country).toBe("GB");
  });
});
