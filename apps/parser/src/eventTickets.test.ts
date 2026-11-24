import type { ExtractedBooking, ExtractedSegment } from "@travelmo/core";
import type { EmailMessage } from "./gmail";
import { importMessage, type ImportDeps, type TripStore } from "./importer";
import { memoryStore } from "./testStore";

// An invented show's tickets told twice: an order email listing two ticket
// lines with the day alone, then an e-ticket email giving the time and both
// lines in one. One event, one booking, one trip.
const email = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  id: "m1",
  threadId: "t1",
  from: "Example Circus <tickets@circus.example>",
  subject: "Your order is confirmed",
  date: "Thu, 1 Jan 2026 10:00:00 +0000",
  listUnsubscribe: false,
  text: "Order 002-1716 5714. Example Show, Saturday 24 January.",
  ...over,
});

const ticket: ExtractedSegment = {
  type: "activity",
  title: "Example Show",
  provider: "Example Circus",
  confirmation: "002-1716 5714",
  start: "2026-01-24T00:00:00+00:00",
  destination: { name: "Example Hall", city: "London", country: "GB" },
  notes: "Row 2 / Seats 6",
};
const order: ExtractedBooking = { isBooking: true, segments: [ticket, { ...ticket, notes: "Row 2 / Seats 7-8" }] };
const eTicket: ExtractedBooking = { isBooking: true, segments: [{ ...ticket, start: "2026-01-24T11:30:00+00:00", notes: "Row 2 / Seats 6, 7-8" }] };

const deps = (store: TripStore, extract: ImportDeps["extract"]): ImportDeps => ({ store, extract, now: () => "2026-01-02T12:00:00Z", log: () => {} });

describe("one event's tickets", () => {
  it("are one booking in one trip, taking the time the second email gives", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => order));
    expect([...store.segments.values()]).toHaveLength(1);
    await importMessage("u1", email({ id: "m2", subject: "Your e-tickets" }), deps(store, async () => eTicket));
    const segments = [...store.segments.values()];
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: "2026-01-24T11:30:00+00:00" });
    expect(segments[0]!.notes).toContain("Seats 7-8");
    expect(store.trips.size).toBe(1);
  });
});
