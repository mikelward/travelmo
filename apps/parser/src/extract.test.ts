import { parseExtraction } from "./extract";

describe("parseExtraction", () => {
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

  it("rejects malformed JSON with the message id in the error", () => {
    expect(() => parseExtraction("{nope", "m2")).toThrow(/m2/);
  });

  it("rejects output that fails the schema", () => {
    expect(() =>
      parseExtraction(JSON.stringify({ isBooking: true, segments: [{ type: "spaceship", title: "x", start: "2026-01-01T00:00:00Z" }] }), "m3"),
    ).toThrow(/schema/);
  });
});
