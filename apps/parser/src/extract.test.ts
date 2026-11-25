import type { GoogleGenAI } from "@google/genai";
import { geminiExtractor, isModelRateLimit, parseExtraction } from "./extract";

describe("geminiExtractor", () => {
  it("hands attached PDFs to the model as documents beside the email, and the email alone without", async () => {
    const asked: unknown[] = [];
    const client = { models: { generateContent: async (request: { contents: unknown }) => (asked.push(request.contents), { text: JSON.stringify({ isBooking: false, segments: [] }) }) } } as unknown as GoogleGenAI;
    const extract = geminiExtractor(client, "model");
    const message = { id: "m1", threadId: "t1", from: "SJ <noreply@sj.example>", subject: "Tickets for booking ABC", date: "Mon, 1 Nov 2026 10:00:00 +0000", listUnsubscribe: false, text: "Your tickets are attached." };
    await extract(message, [{ name: "ticket.pdf", mimeType: "application/pdf", data: "JVBERi0=" }]);
    await extract(message);
    expect(asked[0]).toEqual([
      { role: "user", parts: [{ text: expect.stringContaining("Your tickets are attached.") }, { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } }] },
    ]);
    expect(asked[1]).toEqual(expect.stringContaining("Your tickets are attached."));
  });
});

describe("parseExtraction", () => {
  it("reads the loyalty numbers a booking shows", () => {
    const booking = parseExtraction(
      JSON.stringify({
        isBooking: true,
        segments: [],
        memberships: [{ program: "Example Air Club", number: "EA 123", holder: "MS J EXAMPLE", status: "Silver" }],
      }),
      "m1",
    );
    expect(booking.memberships).toEqual([{ program: "Example Air Club", number: "EA 123", holder: "MS J EXAMPLE", status: "Silver" }]);
    expect(() => parseExtraction(JSON.stringify({ isBooking: true, segments: [], memberships: [{ program: "Example Air Club" }] }), "m2")).toThrow(/schema/);
  });

  it("never takes a car rental an email gives as already paired", () => {
    const car = { type: "car_rental", title: "Avis Boston", start: "2026-11-24T17:30:00-05:00", end: "2026-11-29T17:30:00-05:00", provider: "Avis" };
    const booking = parseExtraction(JSON.stringify({ isBooking: true, segments: [{ ...car, rentalStage: "paired" }, { ...car, rentalStage: "agreement" }] }), "m1");
    expect(booking.segments.map((s) => s.rentalStage)).toEqual([undefined, "agreement"]);
  });

  it("accepts a valid booking", () => {
    const booking = parseExtraction(
      JSON.stringify({
        isBooking: true,
        segments: [
          {
            type: "lodging",
            title: "Cove Liverpool",
            start: "2026-12-12T15:00:00+00:00",
            end: "2026-12-14T11:00:00+00:00",
            destination: { name: "Cove Liverpool", city: "Liverpool", country: "GB" },
          },
        ],
      }),
      "m1",
    );
    expect(booking.segments[0]?.destination?.city).toBe("Liverpool");
  });

  it("keeps the bookings a cancellation email cancels", () => {
    // An invented Booking.com cancellation, in the shape the model returns.
    const booking = parseExtraction(
      JSON.stringify({
        isBooking: false,
        segments: [],
        cancellations: [
          {
            type: "lodging",
            provider: "Booking.com",
            confirmation: "1234567890",
            place: "Example Hotel Gamla Stan",
            start: "2026-06-10T15:00:00+02:00",
            end: "2026-06-13T11:00:00+02:00",
          },
        ],
      }),
      "m4",
    );
    expect(booking.cancellations).toEqual([
      expect.objectContaining({ confirmation: "1234567890", place: "Example Hotel Gamla Stan", type: "lodging" }),
    ]);
  });

  it("reads an older extraction without cancellations", () => {
    expect(parseExtraction(JSON.stringify({ isBooking: false, segments: [] }), "m5").cancellations).toBeUndefined();
  });

  it("rejects malformed JSON with the message id in the error", () => {
    expect(() => parseExtraction("{nope", "m2")).toThrow(/m2/);
  });

  it("rejects output that fails the schema", () => {
    expect(() =>
      parseExtraction(JSON.stringify({ isBooking: true, segments: [{ type: "spaceship", title: "x", start: "2026-01-01T00:00:00Z" }] }), "m3"),
    ).toThrow(/schema/);
  });
});

describe("isModelRateLimit", () => {
  it("tells the model's rate limit from other failures", () => {
    expect(isModelRateLimit(Object.assign(new Error("got status: 429 Too Many Requests"), { status: 429 }))).toBe(true);
    expect(isModelRateLimit(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(true);
    expect(isModelRateLimit(Object.assign(new Error("Internal"), { status: 500 }))).toBe(false);
    expect(isModelRateLimit(new Error("Gemini returned no text for message m1"))).toBe(false);
    expect(isModelRateLimit("429")).toBe(false);
  });
});
