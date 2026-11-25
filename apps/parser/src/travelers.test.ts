import type { ExtractedBooking } from "@travelmo/core";
import type { EmailMessage } from "./gmail";
import { importMessage, type ImportDeps, type TripStore } from "./importer";
import { withDetails } from "./refresh";
import { memoryStore } from "./testStore";

// An invented flight booked for two, read twice: the second email adds a third.
const email = (id: string): EmailMessage => ({
  id,
  threadId: id,
  from: "Example Air <noreply@air.example>",
  subject: "Your booking XQ7P2L",
  date: "Fri, 1 May 2026 10:00:00 +0000",
  listUnsubscribe: false,
  text: "Booking XQ7P2L",
});
const flight = (travelers: string[]): ExtractedBooking => ({
  isBooking: true,
  segments: [
    {
      type: "flight",
      title: "XX 1 LHR to DUB",
      confirmation: "XQ7P2L",
      start: "2026-06-10T08:00:00+01:00",
      origin: { name: "Heathrow", code: "LHR" },
      destination: { name: "Dublin", code: "DUB" },
      travelers,
    },
  ],
});
const deps = (store: TripStore, booking: ExtractedBooking): ImportDeps => ({ store, extract: async () => booking, now: () => "2026-05-01T12:00:00Z", log: () => {} });

describe("travelers", () => {
  it("are filed as people write their names, each once", async () => {
    const store = memoryStore();
    expect(await importMessage("u1", email("m1"), deps(store, flight(["SMITH/JOHN MR", "SMITH/JANE MRS", "Smith, John"])))).toBe("imported");
    expect([...store.segments.values()][0]?.travelers).toEqual(["John Smith", "Jane Smith"]);
  });

  it("gain whoever a later email about the booking names", async () => {
    const store = memoryStore();
    await importMessage("u1", email("m1"), deps(store, flight(["SMITH/JOHN MR"])));
    await importMessage("u1", email("m2"), deps(store, flight(["SMITH/JOHN MR", "SMITH/AMY MISS"])));
    expect(store.segments.size).toBe(1);
    expect([...store.segments.values()][0]?.travelers).toEqual(["John Smith", "Amy Smith"]);
  });
});

describe("Refresh from email", () => {
  const stored = {
    id: "m1-0",
    tripId: "t1",
    source: "gmail" as const,
    gmailMessageIds: ["m1"],
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...flight([]).segments[0]!,
  };
  delete (stored as { travelers?: string[] }).travelers;

  it("gives a booking read before travelers were the names its email gives, as people write them", () => {
    expect(withDetails(stored, flight(["SMITH/JOHN MR", "Smith, John"]).segments[0]!).travelers).toEqual(["John Smith"]);
  });

  it("corrects a booking's travelers to its email's, and drops them when the email names nobody", () => {
    expect(withDetails({ ...stored, travelers: ["Jon Smith"] }, flight(["SMITH/JOHN MR"]).segments[0]!).travelers).toEqual(["John Smith"]);
    expect(withDetails({ ...stored, travelers: ["John Smith"] }, flight([]).segments[0]!).travelers).toBeUndefined();
  });
});
