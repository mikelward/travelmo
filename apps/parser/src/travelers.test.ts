import type { ExtractedBooking } from "@travelmo/core";
import type { EmailMessage } from "./gmail";
import { forwarded, importMessage, type ImportDeps, type TripStore } from "./importer";
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
    // And kept on the trip, for whether the user is only watching it.
    expect([...store.trips.values()][0]?.travelers).toEqual(["John Smith", "Jane Smith"]);
  });

  it("gain whoever a later email about the booking names", async () => {
    const store = memoryStore();
    await importMessage("u1", email("m1"), deps(store, flight(["SMITH/JOHN MR"])));
    await importMessage("u1", email("m2"), deps(store, flight(["SMITH/JOHN MR", "SMITH/AMY MISS"])));
    expect(store.segments.size).toBe(1);
    expect([...store.segments.values()][0]?.travelers).toEqual(["John Smith", "Amy Smith"]);
    // Amy is one of the user's people now; John, named again, isn't counted twice.
    expect([...store.people.values()].map((p) => [p.name, p.bookings])).toEqual([
      ["John Smith", 1],
      ["Amy Smith", 1],
    ]);
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

describe("people", () => {
  it("are added and counted as bookings name them, emails sent straight to the user counting toward who they are", async () => {
    const store = memoryStore();
    await importMessage("u1", email("m1"), deps(store, flight(["SMITH/JOHN MR", "SMITH/JANE MRS"])));
    const people = [...store.people.values()].map((p) => [p.name, p.bookings, p.direct]);
    expect(people).toEqual([
      ["John Smith", 1, 1],
      ["Jane Smith", 1, 1],
    ]);
    // A forwarded itinerary: Mum's, not the user's.
    await importMessage("u1", { ...email("m2"), subject: "Fwd: Your booking XQ8ABC", text: "---------- Forwarded message ---------\\nBooking XQ8ABC" }, deps(store, {
      ...flight(["DOE/PAT MRS"]),
      segments: [{ ...flight([]).segments[0]!, confirmation: "XQ8ABC", start: "2026-07-10T08:00:00+01:00", travelers: ["DOE/PAT MRS"] }],
    }));
    expect([...store.people.values()].find((p) => p.name === "Pat Doe")).toMatchObject({ bookings: 1, direct: 0 });
  });
});

describe("people across an email's bookings", () => {
  it("count a person once for each booking the email names them on", async () => {
    const store = memoryStore();
    const leg = flight([]).segments[0]!;
    await importMessage("u1", email("m1"), deps(store, {
      isBooking: true,
      segments: [
        { ...leg, travelers: ["SMITH/JOHN MR"] },
        { ...leg, title: "XX 2 DUB to LHR", start: "2026-06-14T08:00:00+01:00", origin: leg.destination, destination: leg.origin, travelers: ["SMITH/JOHN MR", "Smith, John"] },
      ],
    }));
    expect([...store.people.values()].map((p) => [p.name, p.bookings, p.direct])).toEqual([["John Smith", 2, 2]]);
  });
});

describe("forwarded", () => {
  it("knows a forwarded email by its subject or the header in its body", () => {
    expect(forwarded({ subject: "Fwd: Your trip", text: "" })).toBe(true);
    expect(forwarded({ subject: "FW: Booking", text: "" })).toBe(true);
    expect(forwarded({ subject: "Your trip", text: "Begin forwarded message:\nFrom: Air" })).toBe(true);
    expect(forwarded({ subject: "Your trip", text: "Booking XQ7P2L" })).toBe(false);
  });
});
