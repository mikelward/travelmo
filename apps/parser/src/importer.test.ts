import { gmailIdPrefix, maxFoundLoyalty, parseIcs, parseTripItExport, type ExtractedBooking, type ExtractedSegment, type ParsedMessage, type Segment, type Trip } from "@travelmo/core";
import { readerVersion } from "./extract";
import { recordedAs, type EmailMessage } from "./gmail";
import {
  claimLeaseMs,
  changeClaimable,
  claimable,
  fileBooking,
  reclaimable,
  retryable,
  importCalendar,
  importMessage,
  importMessages,
  importTripIt,
  reserveByReference,
  tripItUnfiledTripId,
  tripTitle,
  placeTitle,
  type ImportDeps,
  type TripStore,
  type TripTx,
} from "./importer";
import { addExample, emptyExamples, minExamples } from "./similarity";
import { memoryRetryStore } from "./geocodeSweep";
import { memoryStore, type Memory } from "./testStore";

const email = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  id: "m1",
  threadId: "t1",
  from: "Cove <stay@cove.example>",
  subject: "Your booking confirmation - Cove Liverpool",
  date: "Mon, 1 Nov 2026 10:00:00 +0000",
  listUnsubscribe: false,
  text: "Check-in 12 Dec, check-out 14 Dec",
  ...over,
});

const lodging: ExtractedBooking = {
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
};

const flight: ExtractedBooking = {
  isBooking: true,
  segments: [
    {
      type: "flight",
      title: "FR 123 MAN to DUB",
      start: "2026-12-15T08:00:00+00:00",
      end: "2026-12-15T09:00:00+00:00",
      origin: { name: "Manchester", code: "MAN", country: "GB" },
      destination: { name: "Dublin", code: "DUB", city: "Dublin", country: "IE" },
    },
  ],
};

function deps(store: TripStore, extract: ImportDeps["extract"]): ImportDeps {
  return { store, extract, now: () => "2026-11-01T12:00:00Z", log: () => {} };
}

describe("attached PDFs", () => {
  it("reach the model with the email once it passes the filters, and a failure to fetch them doesn't stop it", async () => {
    const seen: number[] = [];
    const extract: ImportDeps["extract"] = async (_message, attachments = []) => (seen.push(attachments.length), lodging);
    const store = memoryStore();
    const ticket = { name: "ticket.pdf", mimeType: "application/pdf" as const, data: "JVBERi0=" };
    await importMessage("u1", { ...email({ id: "m-pdf" }), attachments: async () => [ticket] }, deps(store, extract));
    await importMessage("u1", { ...email({ id: "m-broken" }), attachments: async () => Promise.reject(new Error("quota")) }, deps(store, extract));
    expect(seen).toEqual([1, 0]);
  });
});

describe("importMessage", () => {
  it("keeps the kind of place the reader saw the stay in, for the trip's picture", async () => {
    const store = memoryStore();
    const beach = { ...lodging, segments: [{ ...lodging.segments[0]!, destination: { name: "Sea View", city: "Woburn", setting: "beach" as const } }] };
    await importMessage("u1", email(), deps(store, async () => beach));
    expect([...store.trips.values()][0]).toMatchObject({ setting: "beach" });
  });

  it("creates a trip and segment from a booking email", async () => {
    const store = memoryStore();
    const outcome = await importMessage("u1", email(), deps(store, async () => lodging));
    expect(outcome).toBe("imported");
    const trip = [...store.trips.values()][0]!;
    // With the kind of place it goes to, for its picture in the list.
    expect(trip).toMatchObject({ title: "Liverpool", start: "2026-12-12", end: "2026-12-14", ownerUid: "u1", setting: "city" });
    expect([...store.segments.values()][0]).toMatchObject({
      id: "m1-0",
      tripId: trip.id,
      source: "gmail",
      gmailMessageIds: ["m1"],
      sender: "cove.example",
    });
    expect(store.parsed.get("u1/m1")).toMatchObject({
      outcome: "imported",
      segmentIds: ["m1-0"],
      from: "Cove <stay@cove.example>",
      subject: "Your booking confirmation - Cove Liverpool",
    });
  });

  it("files an email read from Fastmail as Fastmail's, with its sender and no Gmail link", async () => {
    const store = memoryStore();
    const outcome = await importMessage("u1", email({ id: "fm-M1", threadId: "fm-T1" }), deps(store, async () => lodging), { source: "fastmail" });
    expect(outcome).toBe("imported");
    const segment = [...store.segments.values()][0]!;
    expect(segment).toMatchObject({ id: "fm-M1-0", source: "fastmail", gmailMessageIds: [], sender: "cove.example" });
    expect(segment.sources).toEqual([expect.objectContaining({ kind: "fastmail", id: "fm-M1", label: "Your booking confirmation - Cove Liverpool" })]);
    expect(store.parsed.get("u1/fm-M1")).toMatchObject({ source: "fastmail", outcome: "imported" });
  });

  it("files a weekly class from one email as a day out each week", async () => {
    const store = memoryStore();
    const session = (date: string) => ({
      type: "activity" as const,
      title: "Saturday Drama Club",
      start: `${date}T12:30:00+01:00`,
      end: `${date}T13:30:00+01:00`,
      destination: { name: "Example School", city: "London", country: "GB" },
    });
    const term: ExtractedBooking = { isBooking: true, segments: ["2025-09-11", "2025-09-18", "2025-09-25"].map(session) };
    const mail = email({ from: "Drama Club <hello@drama.example>", subject: "Your drama club booking" });
    expect(await importMessage("u1", mail, deps(store, async () => term))).toBe("imported");
    const trips = [...store.trips.values()].sort((a, b) => a.start.localeCompare(b.start));
    expect(trips.map((t) => [t.start, t.end])).toEqual([
      ["2025-09-11", "2025-09-11"],
      ["2025-09-18", "2025-09-18"],
      ["2025-09-25", "2025-09-25"],
    ]);
    const ids = [...store.segments.values()].map((s) => [s.id, s.start.slice(0, 10)]).sort();
    expect(ids).toEqual([
      ["m1-0", "2025-09-11"],
      ["m1-1", "2025-09-18"],
      ["m1-2", "2025-09-25"],
    ]);
    expect(store.parsed.get("u1/m1")).toMatchObject({ outcome: "imported", segmentIds: ["m1-0", "m1-1", "m1-2"] });
  });

  it("keeps a travel statement's balance, though it is no booking, and skips an old one", async () => {
    const store = memoryStore();
    const statement: ExtractedBooking = {
      isBooking: false,
      segments: [],
      memberships: [{ program: "Emerald Club", number: "EC 77", status: "Executive", balance: "3 free rental days" }],
    };
    const mail = email({
      from: "Emerald Club <EmeraldClub@email.emeraldclub.com>",
      subject: "Account notification: we're pleased to present your Emerald Club eStatement",
      date: "Sun, 1 Nov 2026 08:00:00 +0000",
    });
    expect(await importMessage("u1", mail, deps(store, async () => statement))).toBe("not_booking");
    expect(store.foundLoyalty.get("u1")).toEqual([
      expect.objectContaining({ program: "Emerald Club", number: "EC 77", balance: "3 free rental days", balanceAt: "2026-11-01T08:00:00.000Z" }),
    ]);

    let asked = false;
    const old = email({ ...mail, id: "m2", date: "Mon, 1 Jun 2026 08:00:00 +0000" });
    const outcome = await importMessage("u1", old, deps(store, async () => {
      asked = true;
      return statement;
    }));
    expect(outcome).toBe("filtered");
    expect(asked).toBe(false);
    expect(store.parsed.get("u1/m2")).toMatchObject({ outcome: "filtered", reason: "old loyalty statement" });
  });

  it("keeps a statement's balance when it is read on request or forwarded, which skip the pre-filter", async () => {
    const statement: ExtractedBooking = { isBooking: false, segments: [], memberships: [{ program: "MileagePlus", number: "MP 5", balance: "41,000 miles" }] };
    const requested = memoryStore();
    const mail = email({ from: "MileagePlus Statement <MyMileagePlus@enews.united.com>", subject: "November statement: Cardmembers save 10% or more on flights booked with miles" });
    expect(await importMessage("u1", mail, deps(requested, async () => statement), { force: true })).toBe("not_booking");
    expect(requested.foundLoyalty.get("u1")).toEqual([expect.objectContaining({ program: "MileagePlus", balance: "41,000 miles" })]);

    const forwarded = memoryStore();
    const fwd = email({
      from: "Me <me@example.com>",
      subject: "Fwd: November statement",
      text: "---------- Forwarded message ---------\nFrom: MileagePlus Statement <MyMileagePlus@enews.united.com>\nDate: Sun, 1 Nov 2026 08:00:00 +0000\nSubject: November statement\n\nYour balance is 41,000 miles.",
    });
    expect(await importMessage("u1", fwd, deps(forwarded, async () => statement), { force: true, source: "forward" })).toBe("not_booking");
    expect(forwarded.foundLoyalty.get("u1")).toEqual([expect.objectContaining({ program: "MileagePlus", balance: "41,000 miles" })]);

    // Read on request, a shop's statement is still no travel statement.
    const shop = memoryStore();
    const clubcard = email({ from: "Example Mart <rewards@examplemart.example>", subject: "Your points statement" });
    await importMessage("u1", clubcard, deps(shop, async () => statement), { force: true });
    expect(shop.foundLoyalty.get("u1")).toBeUndefined();
  });

  it("keeps the loyalty numbers from a booking email, a fellow traveler's as theirs, and no balance read as one", async () => {
    const store = memoryStore();
    store.ownerNames.set("u1", "Jane Example");
    const withNumbers: ExtractedBooking = {
      ...flight,
      memberships: [
        { program: "Example Air Club", number: "EA 123 456", holder: "MS J EXAMPLE", status: "Silver" },
        { program: "Example Air Club", number: "EA 999 000", holder: "MR ALEX SAMPLE" },
        { program: "Example Air Club", number: "9,600 Points" },
      ],
    };
    const logged: unknown[] = [];
    const outcome = await importMessage("u1", email({ subject: "Your flight to Dublin" }), { ...deps(store, async () => withNumbers), log: (event, fields) => void logged.push({ event, ...fields }) });
    expect(outcome).toBe("imported");
    expect(store.foundLoyalty.get("u1")).toEqual([
      { program: "Example Air Club", number: "EA 123 456", holder: "MS J EXAMPLE", status: "Silver", statusAt: "2026-11-01T10:00:00.000Z", messageId: "m1", label: "Your flight to Dublin", at: expect.any(String) },
      { program: "Example Air Club", number: "EA 999 000", holder: "MR ALEX SAMPLE", person: "Alex Sample", messageId: "m1", label: "Your flight to Dublin", at: expect.any(String) },
    ]);
    // Counts only: the numbers never reach the logs.
    expect(logged).toContainEqual({ event: "memberships", uid: "u1", messageId: "m1", found: 3, kept: 2 });
    expect(JSON.stringify(logged)).not.toContain("EA 123 456");
  });

  it("files numbers under a generic label with the airline's program, each traveler's as theirs", async () => {
    const store = memoryStore();
    store.ownerNames.set("u1", "Mikel Example");
    const united: ExtractedBooking = {
      isBooking: true,
      segments: [
        { type: "flight", title: "UA 123 LHR to DEN", start: "2026-12-15T09:00:00+00:00", origin: { name: "London Heathrow", code: "LHR", country: "GB" }, destination: { name: "Denver", code: "DEN", country: "US" } },
      ],
      memberships: [
        { program: "Frequent Flyer", number: "UA-*****505", holder: "Mikel Example" },
        { program: "Frequent Flyer", number: "UA-*****166", holder: "Jessica Example" },
      ],
    };
    expect(await importMessage("u1", email({ subject: "Your United booking confirmation" }), deps(store, async () => united))).toBe("imported");
    expect(store.foundLoyalty.get("u1")).toEqual([
      expect.objectContaining({ program: "United MileagePlus", number: "UA-*****505", holder: "Mikel Example" }),
      expect.objectContaining({ program: "United MileagePlus", number: "UA-*****166", holder: "Jessica Example", person: "Jessica Example" }),
    ]);
    expect(store.foundLoyalty.get("u1")?.[0]).not.toHaveProperty("person");
  });

  it("keeps every number already found when the list is full, saying so in the logs by count", async () => {
    const store = memoryStore();
    const full = Array.from({ length: maxFoundLoyalty }, (_, i) => ({ program: "Example Air Club", number: `EA${i}`, messageId: `old${i}`, at: "2026-10-01T00:00:00Z" }));
    store.foundLoyalty.set("u1", full);
    const withNumbers: ExtractedBooking = { ...flight, memberships: [{ program: "Example Air Club", number: "EA 999 000" }] };
    const logged: unknown[] = [];
    const log: ImportDeps["log"] = (event, fields, severity) => void logged.push({ event, severity, ...fields });
    expect(await importMessage("u1", email(), { ...deps(store, async () => withNumbers), log })).toBe("imported");
    expect(store.foundLoyalty.get("u1")).toEqual(full);
    expect(logged).toContainEqual({ event: "found_loyalty_full", severity: "WARNING", uid: "u1", messageId: "m1", refused: 1 });
    expect(JSON.stringify(logged)).not.toContain("EA 999 000");
  });

  it("keeps no membership from an email that books no travel, nor from one that is no booking", async () => {
    const store = memoryStore();
    const appointment: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Example Clinic appointment", start: "2026-12-12T10:00:00+00:00", destination: { name: "Example Clinic", city: "Liverpool", country: "GB" } }],
      memberships: [{ program: "Example Health Plan", number: "HP 123" }],
    };
    expect(await importMessage("u1", email({ id: "m1" }), deps(store, async () => appointment))).toBe("imported");
    const notice: ExtractedBooking = { isBooking: false, segments: [], memberships: [{ program: "Example Party", number: "P 9" }] };
    expect(await importMessage("u1", email({ id: "m2", subject: "Your booking: membership renewal" }), deps(store, async () => notice))).toBe("not_booking");
    expect(store.foundLoyalty.get("u1")).toBeUndefined();
  });

  it("imports the booking even when keeping its loyalty numbers fails", async () => {
    const store = memoryStore();
    store.addFoundLoyalty = async () => {
      throw new Error("profile unavailable");
    };
    const withNumbers: ExtractedBooking = { ...lodging, memberships: [{ program: "Sample Hotels Rewards", number: "777" }] };
    expect(await importMessage("u1", email(), deps(store, async () => withNumbers))).toBe("imported");
    expect(store.segments.size).toBe(1);
  });

  it("imports the same message id from two mailboxes as two emails", async () => {
    const store = memoryStore();
    const second = gmailIdPrefix("trips@example.org");
    const fetch = async (id: string) => email({ id });
    const counts = await importMessages("u1", ["m1"], fetch, deps(store, async () => lodging));
    const more = await importMessages("u1", ["m1"], recordedAs(second, fetch), deps(store, async () => lodging));
    expect([counts.imported, more.imported]).toEqual([1, 1]);
    expect((await store.getParsed("u1", `${second}m1`))?.outcome).toBe("imported");
    expect((await store.getParsed("u1", "m1"))?.outcome).toBe("imported");
    // The second email of one booking is kept as its source too, by its own id.
    const [segment] = [...store.segments.values()];
    expect(segment?.sources?.map((s) => s.id)).toEqual(["m1", `${second}m1`]);
  });

  it("imports a filtered message again when the user asks for it", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    const lunch = email({ from: "friend@example.com", subject: "Lunch?" });
    expect(await importMessage("u1", lunch, deps(store, extract))).toBe("filtered");
    expect(store.parsed.get("u1/m1")).toMatchObject({ outcome: "filtered", from: "friend@example.com", subject: "Lunch?" });
    expect(await importMessage("u1", lunch, deps(store, extract), { force: true, reclaim: true })).toBe("imported");
    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.parsed.get("u1/m1")?.outcome).toBe("imported");
  });

  it("does not take another look while an import of the same message is live", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    await store.claimMessage("u1", "m1", "2026-11-01T12:00:00Z");
    expect(await importMessage("u1", email(), deps(store, extract), { force: true, reclaim: true })).toBe("skipped");
    expect(extract).not.toHaveBeenCalled();
    expect(reclaimable({ messageId: "m1", uid: "u1", outcome: "processing", segmentIds: [], processedAt: "2026-11-01T12:00:00Z" }, "2026-11-01T12:05:00Z")).toBe(false);
    expect(reclaimable({ messageId: "m1", uid: "u1", outcome: "failed", segmentIds: [], processedAt: "2026-11-01T12:00:00Z" }, "2026-11-01T12:00:01Z")).toBe(true);
  });

  it("never imports an already imported message again, so its bookings stay as edited", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    expect(await importMessage("u1", email(), deps(store, extract))).toBe("imported");
    expect(await importMessage("u1", email(), deps(store, extract), { force: true, reclaim: true })).toBe("skipped");
    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.segments.size).toBe(1);
  });

  it("skips a message already processed and does not call the extractor", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    await importMessage("u1", email(), deps(store, extract));
    expect(await importMessage("u1", email(), deps(store, extract))).toBe("skipped");
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("imports one message delivered twice concurrently exactly once", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    const outcomes = await Promise.all([
      importMessage("u1", email(), deps(store, extract)),
      importMessage("u1", email(), deps(store, extract)),
    ]);
    expect(outcomes.sort()).toEqual(["imported", "skipped"]);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.trips.size).toBe(1);
  });

  it("puts two overlapping bookings imported concurrently into one trip", async () => {
    const store = memoryStore();
    await Promise.all([
      importMessage("u1", email(), deps(store, async () => lodging)),
      importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight)),
    ]);
    expect(store.trips.size).toBe(1);
    expect([...store.trips.values()][0]).toMatchObject({ start: "2026-12-12", end: "2026-12-15" });
    expect(store.segments.size).toBe(2);
  });

  it("retries a message whose earlier claim was abandoned", async () => {
    const store = memoryStore();
    const crashing = deps(store, async () => {
      throw new Error("boom");
    });
    // A crash between the claim and any outcome leaves a bare "processing" record.
    await store.claimMessage("u1", "m1", "2026-11-01T12:00:00Z");
    expect(await importMessage("u1", email(), crashing)).toBe("skipped");
    const later = new Date(Date.parse("2026-11-01T12:00:00Z") + claimLeaseMs + 1000).toISOString();
    const outcome = await importMessage("u1", email(), { ...deps(store, async () => lodging), now: () => later });
    expect(outcome).toBe("imported");
    expect(store.trips.size).toBe(1);
  });

  it("records a filtered message without calling the extractor", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    const outcome = await importMessage("u1", email({ from: "friend@example.com", subject: "Lunch?" }), deps(store, extract));
    expect(outcome).toBe("filtered");
    expect(extract).not.toHaveBeenCalled();
    expect(store.parsed.get("u1/m1")?.outcome).toBe("filtered");
  });

  it("extends an existing trip's bounds only, leaving sharing alone", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const trip = [...store.trips.values()][0]!;
    store.trips.set(trip.id, { ...trip, sharedWith: ["partner@example.com"], title: "Liverpool weekend" });
    await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    expect(store.trips.size).toBe(1);
    expect(store.trips.get(trip.id)).toMatchObject({
      start: "2026-12-12",
      end: "2026-12-15",
      sharedWith: ["partner@example.com"],
      title: "Liverpool weekend",
    });
    expect(store.segments.get("m2-0")?.tripId).toBe(trip.id);
  });

  it("files a return leg with the trip of an outbound already imported, however far apart", async () => {
    const store = memoryStore();
    const outbound = flight.segments[0]!;
    const returnLeg = { ...outbound, title: "FR 124 DUB to MAN", start: "2026-12-29T18:00:00+00:00", end: "2026-12-29T19:00:00+00:00", origin: outbound.destination, destination: outbound.origin };
    await importMessage("u1", email({ id: "m1", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    const outcome = await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary (updated)" }), deps(store, async () => ({ isBooking: true, segments: [outbound, returnLeg!] })));
    expect(outcome).toBe("imported");
    expect(store.trips.size).toBe(1);
    expect([...store.trips.values()][0]).toMatchObject({ start: "2026-12-15", end: "2026-12-29" });
    expect(store.parsed.get("u1/m2")).toMatchObject({ segmentIds: ["m2-1"], reason: "1 already imported from elsewhere" });
  });

  it("never attaches a booking to a trip that is being deleted", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const dying = [...store.trips.values()][0]!;
    store.trips.set(dying.id, { ...dying, deleting: true });
    await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    expect(store.trips.size).toBe(2);
    expect(store.segments.get("m2-0")?.tripId).not.toBe(dying.id);
  });

  it("tells a report what went to the model and what it said, or why it failed", async () => {
    const debug = {};
    await importMessage("u1", email(), deps(memoryStore(), async () => ({ isBooking: false, segments: [] })), { debug });
    expect(debug).toEqual({ attachments: 0, extraction: { isBooking: false, segments: [] } });
    const failed = {};
    await importMessage("u1", email(), deps(memoryStore(), async () => {
      throw new Error("Gemini returned no text");
    }), { debug: failed });
    expect(failed).toEqual({ attachments: 0, error: "Gemini returned no text" });
  });

  it("adds what came of each email to its sender domain's counts, and nothing of the person or the email", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => ({ isBooking: false, segments: [] })));
    await importMessage("u1", email({ id: "m2" }), deps(store, async () => lodging), { force: true, importAnyway: true });
    // Skipping the pre-filter alone (a forward, a refresh reading again) is no Import anyway.
    await importMessage("u1", email({ id: "m3" }), deps(store, async () => lodging), { force: true });
    expect(Object.fromEntries(store.senderStats)).toEqual({ "cove.example": { read: 3, notBooking: 1, imported: 2, importAnyway: 1, importAnywayImported: 1 } });
    // One already read is skipped without counting again; a calendar event has no sender.
    await importMessage("u1", email(), deps(store, async () => lodging));
    await importMessage("u1", email({ id: "ics-1", from: "" }), deps(store, async () => lodging), { source: "ics" });
    expect(store.senderStats.get("cove.example")?.read).toBe(3);
    expect(store.senderStats.size).toBe(1);
  });

  it("records not_booking when the model says so, with the reader that said it", async () => {
    const store = memoryStore();
    const outcome = await importMessage("u1", email(), deps(store, async () => ({ isBooking: false, segments: [] })));
    expect(outcome).toBe("not_booking");
    expect(store.trips.size).toBe(0);
    expect([...store.parsed.values()][0]).toMatchObject({ outcome: "not_booking", readerVersion });
  });

  // Invented, shaped like a palace trust's membership email: no visit date,
  // only the day it was bought.
  const membershipEmail = email({
    id: "m-member",
    from: "Example Palaces <tickets@palaces.example>",
    subject: "Ticket Summary",
    text: "Family 2 Adults Membership. Valid from 28 October 2026. Ref EXAMPLE123",
  });

  it("files no membership, pass or voucher as a trip", async () => {
    const store = memoryStore();
    const membership: ExtractedBooking = {
      isBooking: true,
      segments: [
        { type: "activity", title: "Family 2 Adults Membership", provider: "Example Palaces", confirmation: "EXAMPLE123", start: "2026-10-28T00:00:00+00:00" },
      ],
    };
    expect(await importMessage("u1", membershipEmail, deps(store, async () => membership))).toBe("not_booking");
    expect(store.trips.size).toBe(0);
    // When the email was sent goes on the record, for finding it by date in the review list.
    expect(store.parsed.get("u1/m-member")).toMatchObject({ outcome: "not_booking", reason: "membership, pass or voucher", sentAt: "2026-11-01T10:00:00.000Z" });
  });

  it("still imports a ticket for a set time", async () => {
    const store = memoryStore();
    const ticket: ExtractedBooking = {
      isBooking: true,
      segments: [
        {
          type: "activity",
          title: "Hampton Court Palace admission",
          provider: "Example Palaces",
          start: "2026-12-20T12:00:00+00:00",
          destination: { name: "Hampton Court Palace", city: "East Molesey", country: "GB" },
        },
      ],
    };
    expect(await importMessage("u1", membershipEmail, deps(store, async () => ticket))).toBe("imported");
    expect([...store.segments.values()]).toHaveLength(1);
  });

  it("files an open ticket on its travel day, not until it expires", async () => {
    const store = memoryStore();
    // Invented, shaped like an airport train's ticket and receipt.
    const ticket: ExtractedBooking = {
      isBooking: true,
      segments: [
        {
          type: "train",
          title: "Airport express to the city",
          provider: "Example Airport Express",
          confirmation: "ORDER-1234",
          start: "2026-08-15T13:28:00+02:00",
          end: "2026-11-13T23:59:00+01:00",
          origin: { name: "Arlanda", city: "Stockholm", country: "SE" },
          destination: { name: "Stockholm Central", city: "Stockholm", country: "SE" },
        },
      ],
    };
    const mail = email({ id: "m-open", subject: "Ticket and receipt - Order number 1234" });
    expect(await importMessage("u1", mail, deps(store, async () => ticket))).toBe("imported");
    expect(store.segments.get("m-open-0")).not.toHaveProperty("end");
    expect([...store.trips.values()][0]).toMatchObject({ start: "2026-08-15", end: "2026-08-15" });
  });

  it("gives a receipt filed first the date and time of the booking it pays for", async () => {
    const store = memoryStore();
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [
        { type: "activity", title: "Stage Stars Holiday Club payment", provider: "Example Academy of Performing Arts", start: "2026-12-14T00:00:00+00:00" },
      ],
    };
    const club: ExtractedBooking = {
      isBooking: true,
      segments: [
        {
          type: "activity",
          title: "Stage Stars! Holiday Club - Day 1",
          provider: "Example Academy of Performing Arts",
          start: "2026-12-21T09:00:00+00:00",
          end: "2026-12-21T15:00:00+00:00",
        },
      ],
    };
    await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), deps(store, async () => receipt));
    await importMessage("u1", email({ id: "m-club", subject: "Booking confirmed: Stage Stars!" }), deps(store, async () => club));
    expect(store.segments.size).toBe(1);
    expect(store.segments.get("m-paid-0")).toMatchObject({
      title: "Stage Stars! Holiday Club - Day 1",
      start: "2026-12-21T09:00:00+00:00",
      end: "2026-12-21T15:00:00+00:00",
    });
    expect(store.segments.get("m-paid-0")?.sources?.map((source) => source.id)).toEqual(["m-paid", "m-club"]);
    expect(store.trips.size).toBe(1);
    expect([...store.trips.values()][0]).toMatchObject({ start: "2026-12-21", end: "2026-12-21" });
  });

  it("spans every booking of a receipt's trip once the booking it pays for arrives", async () => {
    const store = memoryStore();
    const provider = "Example Academy of Performing Arts";
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Stage Stars Holiday Club payment", provider, start: "2026-12-14T00:00:00+00:00" }],
    };
    const club: ExtractedBooking = {
      isBooking: true,
      segments: [
        { type: "activity", title: "Stage Stars! Holiday Club - Day 1", provider, start: "2026-12-21T09:00:00+00:00", end: "2026-12-21T15:00:00+00:00" },
        { type: "activity", title: "Stage Stars! Holiday Club - Day 2", provider, start: "2026-12-22T09:00:00+00:00", end: "2026-12-22T15:00:00+00:00" },
      ],
    };
    await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), deps(store, async () => receipt));
    await importMessage("u1", email({ id: "m-club", subject: "Booking confirmed: Stage Stars!" }), deps(store, async () => club));
    expect(store.segments.size).toBe(2);
    expect(store.trips.size).toBe(1);
    expect([...store.trips.values()][0]).toMatchObject({ start: "2026-12-21", end: "2026-12-22" });
  });

  it("adds a receipt to the booking with its reference, not one that shares a name and a date", async () => {
    const store = memoryStore();
    const lesson = (start: string, confirmation?: string): ExtractedBooking => ({
      isBooking: true,
      segments: [{ type: "activity", title: "Ballet class", provider: "Example Dance", start, end: start.replace("T17:", "T18:"), ...(confirmation ? { confirmation } : {}) }],
    });
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Ballet class payment", provider: "Example Dance", confirmation: "CLASS-21", start: "2026-12-14T00:00:00+00:00" }],
    };
    await importMessage("u1", email({ id: "m-14" }), deps(store, async () => lesson("2026-12-14T17:00:00+00:00")));
    await importMessage("u1", email({ id: "m-21" }), deps(store, async () => lesson("2026-12-21T17:00:00+00:00", "CLASS-21")));
    await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), deps(store, async () => receipt));
    expect(store.segments.size).toBe(2);
    expect(store.segments.get("m-21-0")?.sources?.map((source) => source.id)).toEqual(["m-21", "m-paid"]);
    expect(store.segments.get("m-14-0")?.sources?.map((source) => source.id)).toEqual(["m-14"]);
  });

  it("adds a receipt to the lesson of the order it is dated nearest", async () => {
    const store = memoryStore();
    const lesson = (start: string): ExtractedBooking => ({
      isBooking: true,
      segments: [{ type: "activity", title: "Ballet class", provider: "Example Dance", confirmation: "TERM3", start, end: start.replace("T17:", "T18:") }],
    });
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Ballet class payment", provider: "Example Dance", confirmation: "TERM3", start: "2026-12-14T00:00:00+00:00" }],
    };
    // The later lesson first, so the first found is not the nearest.
    await importMessage("u1", email({ id: "m-21" }), deps(store, async () => lesson("2026-12-21T17:00:00+00:00")));
    await importMessage("u1", email({ id: "m-14" }), deps(store, async () => lesson("2026-12-14T17:00:00+00:00")));
    await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), deps(store, async () => receipt));
    expect(store.segments.get("m-14-0")?.sources?.map((source) => source.id)).toEqual(["m-14", "m-paid"]);
    expect(store.segments.get("m-21-0")?.sources?.map((source) => source.id)).toEqual(["m-21"]);
  });

  it("keeps each day of a camp, whatever they share", async () => {
    const store = memoryStore();
    const day = (n: number, start: string): ExtractedBooking => ({
      isBooking: true,
      segments: [{ type: "activity", title: `Holiday Camp (Day ${n})`, provider: "Example Camps", confirmation: "ORDER-77", start }],
    });
    await importMessage("u1", email({ id: "m-d1" }), deps(store, async () => day(1, "2026-12-21T09:00:00+00:00")));
    await importMessage("u1", email({ id: "m-d2" }), deps(store, async () => day(2, "2026-12-22T00:00:00+00:00")));
    expect(store.segments.size).toBe(2);
  });

  it("adds a payment receipt to the booking it pays for instead of a trip of its own", async () => {
    const store = memoryStore();
    const club: ExtractedBooking = {
      isBooking: true,
      segments: [
        {
          type: "activity",
          title: "Stage Stars! Holiday Club - Day 1",
          provider: "Example Academy of Performing Arts",
          start: "2026-12-21T09:00:00+00:00",
          end: "2026-12-21T15:00:00+00:00",
          destination: { name: "Example Academy", city: "Kingston upon Thames", country: "GB" },
        },
      ],
    };
    // Invented, shaped like a class-booking site's receipt: paid a week
    // before, no time of its own.
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [
        { type: "activity", title: "Stage Stars Holiday Club payment", provider: "Example Academy of Performing Arts", start: "2026-12-14T00:00:00+00:00" },
      ],
    };
    await importMessage("u1", email({ id: "m-club", subject: "Booking confirmed: Stage Stars!" }), deps(store, async () => club));
    expect(await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), deps(store, async () => receipt))).toBe("imported");
    expect(store.trips.size).toBe(1);
    expect(store.segments.size).toBe(1);
    expect(store.segments.get("m-club-0")?.sources?.map((source) => source.id)).toEqual(["m-club", "m-paid"]);
  });

  // Embeddings stand in for meaning: bookings point one way, newsletters another.
  const bookingVector = [1, 0];
  const newsletterVector = [0, 1];
  const taught = (store: Memory, uid: string, count = minExamples) => {
    let examples = emptyExamples();
    for (let i = 0; i < count; i++) {
      examples = addExample(examples, "bookings", { subject: `Booking ${i}`, vector: bookingVector });
      examples = addExample(examples, "others", { subject: `Deals ${i}`, vector: newsletterVector });
    }
    store.examplesOf.set(uid, examples);
  };
  const promo = email({ from: "news@deals.example", subject: "Flight deals this weekend" });

  it("skips an email that resembles past non-bookings without calling the model", async () => {
    const store = memoryStore();
    taught(store, "u1");
    const extract = vi.fn(async () => lodging);
    const outcome = await importMessage("u1", promo, { ...deps(store, extract), embed: async () => newsletterVector });
    expect(outcome).toBe("filtered");
    expect(extract).not.toHaveBeenCalled();
    expect(store.parsed.get("u1/m1")).toMatchObject({ outcome: "filtered", reason: 'resembles "Deals 0", which was not a booking' });
  });

  it("asks the model about an email that resembles past bookings, and learns from the answer", async () => {
    const store = memoryStore();
    taught(store, "u1");
    const extract = vi.fn(async () => lodging);
    const outcome = await importMessage("u1", email(), { ...deps(store, extract), embed: async () => bookingVector });
    expect(outcome).toBe("imported");
    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.examplesOf.get("u1")?.bookings).toHaveLength(minExamples + 1);
    expect(store.examplesOf.get("u1")?.bookings.at(-1)).toEqual({ subject: email().subject, vector: bookingVector });
  });

  it("only learns until it has seen enough of both kinds", async () => {
    const store = memoryStore();
    taught(store, "u1", minExamples - 1);
    const extract = vi.fn(async () => ({ isBooking: false, segments: [] }));
    const outcome = await importMessage("u1", promo, { ...deps(store, extract), embed: async () => newsletterVector });
    expect(outcome).toBe("not_booking");
    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.examplesOf.get("u1")?.others).toHaveLength(minExamples);
  });

  it("lets an allowed sender and the user's own request through, but learns from them", async () => {
    const store = memoryStore();
    taught(store, "u1");
    const extract = vi.fn(async () => lodging);
    const fromBooking = email({ from: "noreply@booking.com", subject: "Flight deals this weekend" });
    expect(await importMessage("u1", fromBooking, { ...deps(store, extract), embed: async () => newsletterVector })).toBe("imported");
    expect(await importMessage("u1", { ...promo, id: "m2" }, { ...deps(store, extract), embed: async () => newsletterVector }, { force: true })).toBe(
      "imported",
    );
    expect(extract).toHaveBeenCalledTimes(2);
    expect(store.examplesOf.get("u1")?.bookings).toHaveLength(minExamples + 2);
  });

  it("goes on to the model when the examples cannot be read or compared", async () => {
    const store = memoryStore();
    taught(store, "u1");
    const extract = vi.fn(async () => lodging);
    const log = vi.fn();
    const unreadable = { ...store, examples: async () => Promise.reject(new Error("unavailable")) };
    expect(await importMessage("u1", promo, { ...deps(unreadable, extract), log, embed: async () => newsletterVector })).toBe("imported");
    expect(log).toHaveBeenCalledWith("similarity_failed", expect.objectContaining({ reason: "unavailable" }));
    // A vector of another length, as after a change of embedding model.
    expect(await importMessage("u1", { ...promo, id: "m2" }, { ...deps(store, extract), log, embed: async () => [1, 0, 0] })).toBe("imported");
    expect(log).toHaveBeenCalledWith("similarity_failed", expect.objectContaining({ reason: expect.stringMatching(/dimensions/) }));
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("goes on to the model when embedding fails", async () => {
    const store = memoryStore();
    taught(store, "u1");
    const extract = vi.fn(async () => lodging);
    const log = vi.fn();
    const outcome = await importMessage("u1", promo, {
      ...deps(store, extract),
      log,
      embed: async () => {
        throw new Error("quota");
      },
    });
    expect(outcome).toBe("imported");
    expect(log).toHaveBeenCalledWith("embed_failed", expect.objectContaining({ reason: "quota" }));
    expect(store.examplesOf.get("u1")?.bookings).toHaveLength(minExamples);
  });

  it("records a failure when extraction throws, so the message is not retried forever", async () => {
    const store = memoryStore();
    const outcome = await importMessage(
      "u1",
      email(),
      deps(store, async () => {
        throw new Error("quota");
      }),
    );
    expect(outcome).toBe("failed");
    expect(store.parsed.get("u1/m1")).toMatchObject({ outcome: "failed", reason: "quota" });
  });
});

describe("importMessages", () => {
  it("skips a message Gmail no longer has and imports the rest", async () => {
    const store = memoryStore();
    const fetch = async (id: string) => {
      if (id === "gone") throw Object.assign(new Error("Requested entity was not found."), { code: 404, status: 404 });
      return email({ id });
    };
    const counts = await importMessages("u1", ["gone", "m1"], fetch, deps(store, async () => lodging));
    expect(counts).toMatchObject({ skipped: 1, imported: 1 });
    expect(store.trips.size).toBe(1);
  });

  it("propagates other fetch failures so the delivery is retried", async () => {
    const store = memoryStore();
    const fetch = async () => {
      throw Object.assign(new Error("Backend Error"), { code: 503, status: 503 });
    };
    await expect(importMessages("u1", ["m1"], fetch, deps(store, async () => lodging))).rejects.toThrow("Backend Error");
  });

  it("reads a failed message again only when asked to retry failures, as a mailbox reading does", async () => {
    const store = memoryStore();
    const fetch = async (id: string) => email({ id });
    let down = true;
    const extract: ImportDeps["extract"] = async () => {
      if (down) throw new Error("quota");
      return lodging;
    };
    expect(await importMessages("u1", ["m1"], fetch, deps(store, extract))).toMatchObject({ failed: 1 });
    down = false;
    expect(await importMessages("u1", ["m1"], fetch, deps(store, extract))).toMatchObject({ skipped: 1, imported: 0 });
    expect(await importMessages("u1", ["m1"], fetch, deps(store, extract), { retryFailed: true })).toMatchObject({ imported: 1 });
  });
});

describe("tripTitle", () => {
  it("prefers the destination city, then its name, then the segment title", () => {
    expect(tripTitle(lodging.segments)).toBe("Liverpool");
    expect(tripTitle([{ type: "lodging", title: "Stay", start: "2026-01-01T15:00:00Z", destination: { name: "Tate Inn" } }])).toBe("Tate Inn");
    expect(tripTitle([{ type: "car_rental", title: "Thing", start: "2026-01-01T10:00:00Z" }])).toBe("Thing");
  });

  it("names a dinner after itself, not its town", () => {
    const dinner = { type: "other", title: "Locale (Southbank)", start: "2025-08-19T18:00:00+01:00", end: "2025-08-19T19:30:00+01:00", destination: { name: "Locale", city: "London", country: "GB" } } as const;
    expect(tripTitle([dinner])).toBe("Locale");
    expect(tripTitle([{ ...dinner, title: "Dinner for two", destination: { name: "The Ivy", city: "London" } }])).toBe("Dinner for two");
    // A ride there is no day out: the trip is named for where it goes, not the taxi.
    const taxi = { type: "other", title: "Taxi booking", start: "2025-08-19T17:30:00+01:00", origin: { name: "Home", city: "Woburn" }, destination: { name: "Locale", city: "London" } } as const;
    expect(tripTitle([taxi, dinner])).not.toBe("Taxi booking");
  });

  it("names a one-day outing after the place or the event, not its town", () => {
    const palace = { name: "Hampton Court Palace", city: "East Molesey", country: "GB" };
    const admission = { type: "activity" as const, title: "Hampton Court Palace Admission", start: "2026-12-20T12:00:00+00:00", destination: palace };
    expect(tripTitle([admission])).toBe("Hampton Court Palace");
    expect(tripTitle([{ ...lodging.segments[0]!, destination: { ...palace } }, admission])).toBe("East Molesey");
    // Admission on two days is still the event, not its town.
    expect(tripTitle([admission, { ...admission, start: "2026-12-21T12:00:00+00:00" }])).toBe("Hampton Court Palace Admission");
    const show = {
      type: "activity" as const,
      title: "The Graham Norton Show",
      start: "2026-09-24T18:00:00+01:00",
      end: "2026-09-24T21:00:00+01:00",
      destination: { name: "Television Centre", city: "London", country: "GB" },
    };
    expect(tripTitle([show])).toBe("The Graham Norton Show");
    const film = {
      type: "activity" as const,
      title: "Toy Story 5 at Everyman Muswell Hill",
      start: "2026-07-04T12:00:00+01:00",
      destination: { name: "Everyman", city: "London", country: "GB" },
    };
    expect(tripTitle([film])).toBe("Toy Story 5 at Everyman Muswell Hill");
  });

  it("names a course of several days after the course", () => {
    const place = { name: "Holiday Camp East Finchley", city: "London", country: "GB" };
    const days = [1, 2, 3].map((n) => ({
      type: "activity" as const,
      title: `Holiday Camp East Finchley - Junior Group (Day ${n})`,
      start: `2026-08-1${n}T09:00:00+01:00`,
      end: `2026-08-1${n}T17:00:00+01:00`,
      destination: place,
    }));
    expect(tripTitle(days)).toBe("Holiday Camp East Finchley - Junior Group");
    // A ticket a day with the very same title is a course too, not "London".
    const same = days.map((d) => ({ ...d, title: "Holiday Camp East Finchley - Junior Group" }));
    expect(tripTitle(same)).toBe("Holiday Camp East Finchley - Junior Group");
    const course = {
      type: "activity" as const,
      title: "5 Day Summer Holiday Course: Peter Pan",
      start: "2026-08-24T09:30:00+01:00",
      end: "2026-08-28T15:30:00+01:00",
      destination: { name: "N10 3BG", city: "London", country: "GB" },
    };
    expect(tripTitle([course])).toBe("5 Day Summer Holiday Course: Peter Pan");
  });

  it("names a day camp after the camp, not its venue", () => {
    const school = { name: "Weston Park School", address: "Denton Road, Hornsey, London, N8 9WP", country: "GB" };
    const days = [11, 12, 13, 14, 15].map((d) => ({
      type: "activity" as const,
      title: `Debutots Camp - ${d}th Aug 2025`,
      start: `2025-08-${d}T10:00:00+01:00`,
      end: `2025-08-${d}T15:00:00+01:00`,
      destination: school,
    }));
    expect(tripTitle(days)).toBe("Debutots Camp");
  });

  it("names a course after it whatever form its dates take", () => {
    const camp = (titles: string[]) =>
      titles.map((title, i) => ({
        type: "activity" as const,
        title,
        start: `2026-08-1${i + 1}T10:00:00+01:00`,
        destination: { name: "Weston Park School" },
      }));
    expect(tripTitle(camp(["Camp – 11 August", "Camp – 12 August"]))).toBe("Camp");
    expect(tripTitle(camp(["Camp (Mon 11 Aug)", "Camp (Tue 12 Aug)"]))).toBe("Camp");
    expect(tripTitle(camp(["Camp, 11/08/2026", "Camp, 12/08/2026"]))).toBe("Camp");
    expect(tripTitle(camp(["Camp - 2026-08-11", "Camp - 2026-08-12"]))).toBe("Camp");
    expect(tripTitle(camp(["Camp on 11 Aug", "Camp on 12 Aug"]))).toBe("Camp");
    expect(tripTitle(camp(["Camp - August 11th, 2026", "Camp - August 12th, 2026"]))).toBe("Camp");
  });

  it("keeps a number that is not a date", () => {
    const film = (n: number, day: number) => ({
      type: "activity" as const,
      title: `Toy Story ${n}`,
      start: `2026-07-0${day}T12:00:00+01:00`,
      destination: { name: "Everyman" },
    });
    expect(tripTitle([film(5, 4)])).toBe("Toy Story 5");
    expect(tripTitle([film(4, 4), film(5, 5)])).toBe("Everyman");
    expect(tripTitle([{ ...film(5, 4), title: "Camp - Group 2" }, { ...film(5, 5), title: "Camp - Group 3" }])).toBe("Everyman");
  });

  it("names a trip after where it goes, not the car to the airport", () => {
    const car = {
      type: "other" as const,
      title: "Abetta car to Stansted Airport",
      start: "2026-08-15T10:30:00+01:00",
      origin: { name: "N10 3AR", city: "London", country: "GB" },
      destination: { name: "Stansted Airport", code: "STN", city: "Stansted", country: "GB" },
    };
    const express = {
      type: "train" as const,
      title: "Arlanda Express",
      start: "2026-08-15T13:28:00+02:00",
      origin: { name: "Stockholm Arlanda Airport", city: "Stockholm", country: "SE" },
      destination: { name: "Stockholm Central", city: "Stockholm", country: "SE" },
    };
    expect(tripTitle([car, express], [{ city: "London", country: "GB" }])).toBe("Stockholm");
  });

  it("names a trip of places with no town after the one away from home", () => {
    const stay = (name: string, day: number) => ({
      type: "lodging" as const,
      title: `Stay in ${name}`,
      start: `2026-09-0${day}T15:00:00+01:00`,
      end: `2026-09-0${day + 1}T10:00:00+01:00`,
      destination: { name },
    });
    const home = [{ city: "London", country: "GB" }];
    expect(tripTitle([stay("London", 1), stay("Liverpool", 2)], [], home)).toBe("Liverpool");
    expect(tripTitle([stay("London", 1), stay("Liverpool", 2)], home)).toBe("Liverpool");
  });
});

// Invented data in the export's shape.
const at = (date: string, time: string) => ({ date, time, timezone: "Europe/London", utc_offset: "+00:00" });
const tripItFlight = (date: string, number: string, from: string, to: string) => ({
  Segment: {
    StartDateTime: at(date, "08:00:00"),
    EndDateTime: at(date, "09:00:00"),
    start_airport_code: from,
    end_airport_code: to,
    marketing_airline_code: "FR",
    marketing_flight_number: number,
  },
});
const tripItExport = (over: Record<string, unknown> = {}) =>
  parseTripItExport({
    Trips: [
      { TripData: { display_name: "Dublin weekend", start_date: "2026-12-15", end_date: "2026-12-17" }, Objects: [tripItFlight("2026-12-15", "123", "MAN", "DUB"), tripItFlight("2026-12-17", "124", "DUB", "MAN")] },
      { TripData: { display_name: "Cork", start_date: "2026-12-18", end_date: "2026-12-19" }, Objects: [tripItFlight("2026-12-18", "200", "MAN", "ORK")] },
    ],
    UnfiledItems: [{ supplier_name: "Example Cars", supplier_conf_num: "ABC123", car_type: "Compact", StartDateTime: at("2025-03-01", "10:00:00"), EndDateTime: at("2025-03-02", "10:00:00") }],
    ...over,
  });

describe("reserveByReference", () => {
  it("sets an existing booking aside for the item carrying its confirmation, whatever comes first", async () => {
    const store = memoryStore();
    const confirmed = { ...lodging, segments: [{ ...lodging.segments[0]!, confirmation: "ABC123" }] };
    await importMessage("u1", email(), deps(store, async () => confirmed));
    const room = lodging.segments[0]!;
    const parsed = {
      // A trip object: no confirmation number, but alike the Gmail room.
      trips: [{ key: "t1", title: "Liverpool", start: "2026-12-12", end: "2026-12-14", segments: [room] }],
      // The unfiled item that is that Gmail room, by its reference.
      unfiled: [{ key: "u1", title: "Cove Liverpool", segments: [{ ...room, confirmation: "abc-123" }] }],
      skipped: [],
      floating: 0,
    };
    await importTripIt("u1", parsed, deps(store, async () => lodging));
    const rooms = [...store.segments.values()].filter((seg) => seg.type === "lodging");
    // The Gmail room, found again by the unfiled item, and the trip's own room.
    expect(rooms).toHaveLength(2);
    const gmailRoom = rooms.find((seg) => seg.source === "gmail")!;
    expect(gmailRoom.sources?.map((ref) => ref.id)).toContain("tripit-unfiled-u1");
    expect(rooms.filter((seg) => seg.confirmation)).toHaveLength(1);
  });
});

describe("reserved matches", () => {
  it("takes the booking set aside for an item before a lookalike, leaving the lookalike for the next", async () => {
    const store = memoryStore();
    const room = lodging.segments[0]!;
    // Two alike Gmail rooms (two rooms of one stay), the second carrying the
    // reference.
    await importMessage("u1", email({ id: "m1" }), deps(store, async () => lodging));
    const [first] = [...store.segments.values()];
    store.segments.set("m2-0", { ...first!, id: "m2-0", confirmation: "ABC123", gmailMessageIds: ["m2"] });
    const gmailRooms = [...store.segments.values()].filter((seg) => seg.source === "gmail");
    expect(gmailRooms).toHaveLength(2);
    // The confirmed unfiled item comes first, then an unconfirmed one.
    const parsed = {
      trips: [],
      unfiled: [
        { key: "u1", title: "Cove Liverpool", segments: [{ ...room, confirmation: "ABC123" }] },
        { key: "u2", title: "Cove Liverpool", segments: [room] },
      ],
      skipped: [],
      floating: 0,
    };
    await importTripIt("u1", parsed, deps(store, async () => lodging));
    // Both TripIt items were found on the two Gmail rooms: nothing new.
    expect([...store.segments.values()].filter((seg) => seg.type === "lodging")).toHaveLength(2);
    const confirmed = gmailRooms.find((seg) => seg.confirmation)!;
    expect(store.segments.get(confirmed.id)?.sources?.map((ref) => ref.id)).toContain("tripit-unfiled-u1");
  });
});

describe("reservations on a second upload", () => {
  it("reserves nothing for items already imported, so a new item gets the free booking", async () => {
    const store = memoryStore();
    const room = { ...lodging.segments[0]!, confirmation: "ABC123" };
    // Two Gmail rooms of one stay, both carrying the reference.
    await importMessage("u1", email({ id: "m1" }), deps(store, async () => ({ ...lodging, segments: [room] })));
    const [first] = [...store.segments.values()];
    store.segments.set("m2-0", { ...first!, id: "m2-0", gmailMessageIds: ["m2"] });
    const one = { key: "u1", title: "Cove Liverpool", segments: [room] };
    await importTripIt("u1", { trips: [], unfiled: [one], skipped: [], floating: 0 }, deps(store, async () => lodging));
    // The same export again, now with the second room's item.
    const counts = await importTripIt("u1", { trips: [], unfiled: [one, { key: "u2", title: "Cove Liverpool", segments: [room] }], skipped: [], floating: 0 }, deps(store, async () => lodging));
    expect(counts).toMatchObject({ skipped: 1, imported: 0, duplicates: 1 });
    expect([...store.segments.values()].filter((seg) => seg.type === "lodging")).toHaveLength(2);
  });
});

describe("importTripIt", () => {
  it("keeps TripIt's trips and titles, even when they are back to back", async () => {
    const store = memoryStore();
    const counts = await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    expect(counts).toEqual({ trips: 2, imported: 4, duplicates: 0, skipped: 0, failed: 0 });
    const titles = [...store.trips.values()].map((t) => [t.title, t.start, t.end]);
    expect(titles).toEqual([
      ["Dublin weekend", "2026-12-15", "2026-12-17"],
      ["Cork", "2026-12-18", "2026-12-19"],
      ["Unfiled from TripIt", "2025-03-01", "2025-03-02"],
    ]);
    expect([...store.segments.values()].every((s) => s.source === "tripit" && s.gmailMessageIds.length === 0)).toBe(true);
    expect(store.trips.get(tripItUnfiledTripId("u1"))).toBeDefined();
    const record = [...store.parsed.values()].find((r) => r.subject === "Dublin weekend");
    expect(record).toMatchObject({ source: "tripit", from: "TripIt", outcome: "imported", segmentIds: expect.any(Array) });
  });

  it("changes nothing when the same export is imported again", async () => {
    const store = memoryStore();
    await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    const before = structuredClone([...store.segments.values()]);
    const counts = await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    expect(counts).toEqual({ trips: 0, imported: 0, duplicates: 0, skipped: 3, failed: 0 });
    expect([...store.segments.values()]).toEqual(before);
    expect(store.trips.size).toBe(3);
  });

  it("files a TripIt booking already imported from Gmail once, into the Gmail trip", async () => {
    const store = memoryStore();
    await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    const gmailTrip = [...store.trips.values()][0]!;
    const counts = await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    expect(counts.duplicates).toBe(1);
    // The return leg is new and joins the trip that already covers those dates.
    expect([...store.segments.values()].filter((s) => s.tripId === gmailTrip.id).map((s) => s.source)).toEqual(["gmail", "tripit"]);
    expect(store.trips.get(gmailTrip.id)).toMatchObject({ start: "2026-12-15", end: "2026-12-17" });
    expect([...store.trips.values()].map((t) => t.title)).not.toContain("Dublin weekend");
  });

  it("widens a joined trip to the TripIt trip's own dates, so later bookings within them find it", async () => {
    const store = memoryStore();
    await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    const gmailTrip = [...store.trips.values()][0]!;
    const wide = tripItExport({
      Trips: [{ TripData: { display_name: "Ireland", start_date: "2026-12-10", end_date: "2026-12-31" }, Objects: [tripItFlight("2026-12-15", "123", "MAN", "DUB"), tripItFlight("2026-12-17", "124", "DUB", "MAN")] }],
      UnfiledItems: [],
    });
    await importTripIt("u1", wide, deps(store, async () => lodging));
    expect(store.trips.get(gmailTrip.id)).toMatchObject({ start: "2026-12-10", end: "2026-12-31" });
  });

  it("starts a trip with the flight that lands where it leaves from, in whichever order the emails come", async () => {
    const lhr = { name: "Heathrow", code: "LHR", city: "London", country: "GB" };
    const zag = { name: "Zagreb", code: "ZAG", city: "Zagreb", country: "HR" };
    const cdg = { name: "Paris Charles de Gaulle", code: "CDG", city: "Paris", country: "FR" };
    const ewr = { name: "Newark", code: "EWR", city: "New York/Newark", country: "US" };
    const bookings: Record<string, ExtractedBooking> = {
      out: { isBooking: true, segments: [{ type: "flight", title: "LHR to ZAG", start: "2026-03-30T08:00:00+01:00", end: "2026-03-30T11:00:00+02:00", origin: lhr, destination: zag }] },
      stay: { isBooking: true, segments: [{ type: "lodging", title: "Apartments Angel", start: "2026-03-30T15:00:00+02:00", end: "2026-04-04T11:00:00+02:00", destination: { name: "Apartments Angel", city: "Zagreb", country: "HR" } }] },
      on: {
        isBooking: true,
        segments: [
          { type: "flight", title: "A5 8362 ZAG to PAR", start: "2026-04-04T16:00:00+02:00", end: "2026-04-04T18:15:00+02:00", origin: zag, destination: cdg },
          { type: "flight", title: "AF 8702 PAR to JFK", start: "2026-04-04T20:30:00+02:00", end: "2026-04-04T22:40:00-04:00", origin: cdg, destination: { name: "JFK", code: "JFK", city: "New York", country: "US" } },
        ],
      },
      home: { isBooking: true, segments: [{ type: "flight", title: "UA122 EWR to LHR", start: "2026-04-11T09:10:00-04:00", end: "2026-04-11T21:25:00+01:00", origin: ewr, destination: lhr }] },
    };
    for (const order of [["out", "stay", "on", "home"], ["out", "stay", "home", "on"]]) {
      const store = memoryStore();
      for (const id of order) await importMessage("u1", email({ id, subject: `Booking ${id}` }), deps(store, async () => bookings[id]!));
      const trips = [...store.trips.values()]
        .map((t) => ({ title: t.title, segments: [...store.segments.values()].filter((s) => s.tripId === t.id).map((s) => s.title).sort() }))
        .sort((a, b) => a.title.localeCompare(b.title));
      expect(trips).toEqual([
        { title: "New York", segments: ["A5 8362 ZAG to PAR", "AF 8702 PAR to JFK", "UA122 EWR to LHR"] },
        { title: "Zagreb", segments: ["Apartments Angel", "LHR to ZAG"] },
      ]);
    }
    // A first leg confirmed alone, then with its connection by a later email,
    // comes over with it.
    {
      const store = memoryStore();
      const firstLeg: ExtractedBooking = { isBooking: true, segments: [bookings.on!.segments[0]!] };
      for (const [id, booking] of [["out", bookings.out!], ["stay", bookings.stay!], ["leg", firstLeg], ["on", bookings.on!], ["home", bookings.home!]] as const) {
        await importMessage("u1", email({ id, subject: `Booking ${id}` }), deps(store, async () => booking));
      }
      const tripOf = (title: string) => [...store.segments.values()].find((s) => s.title === title)!.tripId;
      expect(tripOf("A5 8362 ZAG to PAR")).toBe(tripOf("UA122 EWR to LHR"));
      expect(tripOf("AF 8702 PAR to JFK")).toBe(tripOf("UA122 EWR to LHR"));
    }
    // A booking brought over with a cancelled leg keeps the trip's own dates
    // covering that leg, so a later email finds it by date.
    {
      const store = memoryStore();
      const jfk = { name: "JFK", code: "JFK", city: "New York", country: "US" };
      const there: ExtractedBooking = {
        isBooking: true,
        segments: [
          { type: "flight", title: "BA 1 LHR to JFK", confirmation: "BAQ1", start: "2027-01-10T08:00:00+00:00", end: "2027-01-10T11:00:00-05:00", origin: lhr, destination: jfk },
          { type: "flight", title: "BA 2 JFK to LHR", confirmation: "BAQ1", start: "2027-04-10T18:00:00-04:00", end: "2027-04-11T06:00:00+01:00", origin: jfk, destination: lhr },
        ],
      };
      await importMessage("u1", email({ id: "there", subject: "Booking there" }), deps(store, async () => there));
      const back = [...store.segments.values()].find((s) => s.title === "BA 2 JFK to LHR")!;
      store.segments.set(back.id, { ...back, cancelledAt: "2026-11-02T00:00:00Z", cancelledBy: "m-x" });
      // As a cancellation leaves it: shown for what is still booked.
      store.trips.set(back.tripId, { ...store.trips.get(back.tripId)!, liveStart: "2027-01-10", liveEnd: "2027-01-10" });
      const early: ExtractedBooking = { isBooking: true, segments: [{ type: "flight", title: "UA 9 EWR to LHR", start: "2027-01-20T18:00:00-05:00", end: "2027-01-21T06:00:00+00:00", origin: ewr, destination: lhr }] };
      await importMessage("u1", email({ id: "early", subject: "Booking early" }), deps(store, async () => early));
      const trip = store.trips.get([...store.segments.values()].find((s) => s.title === "UA 9 EWR to LHR")!.tripId)!;
      expect([...store.segments.values()].filter((s) => s.tripId === trip.id).length).toBe(3);
      expect(trip.end >= "2027-04-11").toBe(true);
    }
    // A flight home cancelled before its confirmation is read brings nothing over.
    {
      const store = memoryStore();
      for (const id of ["out", "stay", "on"]) await importMessage("u1", email({ id, subject: `Booking ${id}` }), deps(store, async () => bookings[id]!));
      const cancelled: ExtractedBooking = {
        isBooking: false,
        segments: [],
        cancellations: [{ type: "flight", confirmation: "UAXYZ1", start: "2026-04-11T09:10:00-04:00", place: "EWR to LHR" }],
      };
      await importMessage("u1", email({ id: "cancel", subject: "Your flight is cancelled", date: "Thu, 5 Nov 2026 10:00:00 +0000" }), deps(store, async () => cancelled));
      const confirmed: ExtractedBooking = { isBooking: true, segments: [{ ...bookings.home!.segments[0]!, confirmation: "UAXYZ1" }] };
      await importMessage("u1", email({ id: "home", subject: "Booking home" }), deps(store, async () => confirmed));
      expect([...store.segments.values()].find((s) => s.title.startsWith("UA122"))?.cancelledAt).toBeDefined();
      const zagreb = [...store.trips.values()].find((t) => t.title === "Zagreb")!;
      expect([...store.segments.values()].filter((s) => s.tripId === zagreb.id).map((s) => s.title).sort()).toEqual(["A5 8362 ZAG to PAR", "AF 8702 PAR to JFK", "Apartments Angel", "LHR to ZAG"]);
    }
    // A flight out never skips a trip to join a later one: a January flight to
    // Paris stays with the January stay there, not a February trip home from Paris.
    {
      const store = memoryStore();
      const paris = { name: "Paris Charles de Gaulle", code: "CDG", city: "Paris", country: "FR" };
      const items: Record<string, ExtractedBooking> = {
        hotel: { isBooking: true, segments: [{ type: "lodging", title: "Hôtel Example", start: "2027-01-10T15:00:00+01:00", end: "2027-01-15T11:00:00+01:00", destination: { name: "Hôtel Example", city: "Paris", country: "FR" } }] },
        back: { isBooking: true, segments: [{ type: "flight", title: "AF 1 CDG to LHR", start: "2027-02-20T10:00:00+01:00", end: "2027-02-20T10:30:00+00:00", origin: paris, destination: lhr }] },
        jan: { isBooking: true, segments: [{ type: "flight", title: "AF 2 LHR to CDG", start: "2027-01-10T08:00:00+00:00", end: "2027-01-10T10:20:00+01:00", origin: lhr, destination: paris }] },
      };
      for (const id of ["hotel", "back", "jan"]) await importMessage("u1", email({ id, subject: `Booking ${id}` }), deps(store, async () => items[id]!));
      const tripOf = (title: string) => [...store.segments.values()].find((s) => s.title === title)!.tripId;
      expect(tripOf("AF 2 LHR to CDG")).toBe(tripOf("Hôtel Example"));
      expect(tripOf("AF 2 LHR to CDG")).not.toBe(tripOf("AF 1 CDG to LHR"));
    }
    // A flight the user edited stays where they left it.
    const store = memoryStore();
    for (const id of ["out", "stay", "on"]) await importMessage("u1", email({ id, subject: `Booking ${id}` }), deps(store, async () => bookings[id]!));
    for (const segment of [...store.segments.values()].filter((s) => s.title.startsWith("A"))) store.segments.set(segment.id, { ...segment, updatedAt: "2026-11-02T00:00:00Z" });
    await importMessage("u1", email({ id: "home", subject: "Booking home" }), deps(store, async () => bookings.home!));
    const zagreb = [...store.trips.values()].find((t) => t.title === "Zagreb")!;
    expect([...store.segments.values()].filter((s) => s.tripId === zagreb.id).map((s) => s.title).sort()).toEqual(["A5 8362 ZAG to PAR", "AF 8702 PAR to JFK", "Apartments Angel", "LHR to ZAG"]);
  });

  it("takes a flight's times from the newest email for its reference, in whichever order they are read", async () => {
    const booked: ExtractedBooking = { isBooking: true, segments: [{ ...flight.segments[0]!, confirmation: "B0ECXM" }] };
    const moved: ExtractedBooking = { isBooking: true, segments: [{ ...booked.segments[0]!, title: "FR123 MAN to DUB", start: "2026-12-15T08:20:00+00:00", end: "2026-12-15T09:20:00+00:00" }] };
    const first = email({ id: "m-booked", subject: "Your Ryanair itinerary", date: "Mon, 1 Nov 2026 10:00:00 +0000" });
    const change = email({ id: "m-change", subject: "Your flight time has changed", date: "Thu, 5 Nov 2026 10:00:00 +0000" });
    for (const order of [[first, change], [change, first]]) {
      const store = memoryStore();
      for (const message of order) await importMessage("u1", message, deps(store, async () => (message === change ? moved : booked)));
      const flights = [...store.segments.values()];
      expect(flights.map((s) => [s.start, s.end])).toEqual([["2026-12-15T08:20:00+00:00", "2026-12-15T09:20:00+00:00"]]);
    }
    // A receipt in between dates nothing, so the change still moves the flight.
    const store = memoryStore();
    const receipt = email({ id: "m-receipt", subject: "Ryanair booking B0ECXM", date: "Tue, 3 Nov 2026 10:00:00 +0000" });
    const paid: ExtractedBooking = { isBooking: true, segments: [{ ...booked.segments[0]!, title: "Payment receipt FR 123", notes: "Payment received" }] };
    for (const message of [first, receipt, change]) await importMessage("u1", message, deps(store, async () => (message === change ? moved : message === receipt ? paid : booked)));
    expect([...store.segments.values()].map((s) => [s.start, s.sources?.map((r) => r.id)])).toEqual([["2026-12-15T08:20:00+00:00", ["m-booked", "m-receipt", "m-change"]]]);
  });

  // Coming home two days early: the rebooking flies Boston to San Francisco
  // through Detroit on 19 Dec, and the original flight home on 21 Dec is
  // filed cancelled, whichever email is read first (a mailbox is read
  // newest first).
  it("files cancelled the flight a rebooking under the same reference replaced with other flights", async () => {
    const sfo = { name: "San Francisco International", code: "SFO", city: "San Francisco", country: "US" };
    const bos = { name: "Boston Logan", code: "BOS", city: "Boston", country: "US" };
    const dtw = { name: "Detroit Metro", code: "DTW", city: "Detroit", country: "US" };
    const leg = (title: string, start: string, end: string, origin: typeof sfo, destination: typeof sfo) => ({ type: "flight" as const, title, start, end, origin, destination, confirmation: "F8D7IY" });
    const out = leg("Delta 100 SFO to BOS", "2026-12-10T08:00:00-08:00", "2026-12-10T16:30:00-05:00", sfo, bos);
    const booked: ExtractedBooking = { isBooking: true, segments: [out, leg("Delta 1123 BOS to SFO", "2026-12-21T08:25:00-05:00", "2026-12-21T12:23:00-08:00", bos, sfo)] };
    const rebooked: ExtractedBooking = {
      isBooking: true,
      segments: [out, leg("Delta 919 BOS to DTW", "2026-12-19T13:00:00-05:00", "2026-12-19T15:19:00-05:00", bos, dtw), leg("Delta 2980 DTW to SFO", "2026-12-19T16:45:00-05:00", "2026-12-19T18:56:00-08:00", dtw, sfo)],
    };
    const first = email({ id: "m-booked", subject: "Your Delta itinerary", date: "Tue, 20 Oct 2026 10:00:00 +0000" });
    const change = email({ id: "m-change", subject: "Your Delta itinerary has changed", date: "Fri, 30 Oct 2026 10:00:00 +0000" });
    for (const order of [[first, change], [change, first]]) {
      const store = memoryStore();
      for (const message of order) await importMessage("u1", message, deps(store, async () => (message === change ? rebooked : booked)));
      const flights = [...store.segments.values()].sort((a, b) => a.start.localeCompare(b.start));
      expect(flights.map((s) => [s.title, s.cancelledBy ?? null])).toEqual([
        ["Delta 100 SFO to BOS", null],
        ["Delta 919 BOS to DTW", null],
        ["Delta 2980 DTW to SFO", null],
        ["Delta 1123 BOS to SFO", "m-change"],
      ]);
      // The trip ends with the flight home that was flown.
      expect([...store.trips.values()].map((t) => t.liveEnd ?? t.end)).toEqual(["2026-12-19"]);
    }

    // Restored by hand: an itinerary sent before the Restore leaves it live.
    const store = memoryStore();
    for (const message of [first, change]) await importMessage("u1", message, deps(store, async () => (message === change ? rebooked : booked)));
    const [id, home] = [...store.segments.entries()].find(([, s]) => s.title === "Delta 1123 BOS to SFO")!;
    const { cancelledAt: _at, cancelledBy: _by, cancelledSentAt: _sent, ...live } = home;
    store.segments.set(id, { ...live, restoredFrom: ["m-change"], restoredAt: "2026-11-01T09:00:00.000Z" });
    const again = email({ id: "m-change-again", subject: "Your Delta itinerary has changed", date: "Sat, 31 Oct 2026 10:00:00 +0000" });
    await importMessage("u1", again, deps(store, async () => rebooked));
    expect(store.segments.get(id)?.cancelledBy).toBeUndefined();

    // Rebooked twice: the second rebooking dates the cancellation afresh, so a
    // confirmation of the original sent between them doesn't revive it.
    {
      const twice = memoryStore();
      const sea2 = { name: "Seattle-Tacoma", code: "SEA", city: "Seattle", country: "US" };
      const third: ExtractedBooking = {
        isBooking: true,
        segments: [out, leg("Alaska 5 BOS to SEA", "2026-12-20T08:00:00-05:00", "2026-12-20T11:00:00-08:00", bos, sea2), leg("Alaska 9 SEA to SFO", "2026-12-20T13:00:00-08:00", "2026-12-20T15:00:00-08:00", sea2, sfo)],
      };
      const latest = email({ id: "m-third", subject: "Your Delta itinerary has changed", date: "Fri, 30 Oct 2026 12:00:00 +0000" });
      const earlier = email({ id: "m-change", subject: "Your Delta itinerary has changed", date: "Tue, 27 Oct 2026 10:00:00 +0000" });
      const between = email({ id: "m-booked-again", subject: "Your Delta itinerary", date: "Wed, 28 Oct 2026 10:00:00 +0000" });
      const extracted = new Map([[first, booked], [earlier, rebooked], [latest, third], [between, booked]]);
      for (const message of [first, earlier, latest, between]) await importMessage("u1", message, deps(twice, async () => extracted.get(message)!));
      expect([...twice.segments.values()].find((s) => s.title === "Delta 1123 BOS to SFO")?.cancelledBy).toBe("m-third");
    }

    // An explicit cancellation sent before the rebooking: the later rebooking
    // dates the cancellation, whichever arrives first.
    {
      const cancel = email({ id: "m-cancel", subject: "Your flight is cancelled", date: "Sun, 25 Oct 2026 10:00:00 +0000" });
      const cancelled: ExtractedBooking = {
        isBooking: false,
        segments: [],
        cancellations: [{ type: "flight", confirmation: "F8D7IY", start: "2026-12-21T08:25:00-05:00", place: "BOS to SFO" }],
      };
      const extracted = new Map([[first, booked], [change, rebooked], [cancel, cancelled]]);
      for (const order of [[cancel, change, first], [first, cancel, change], [change, cancel, first]]) {
        const both = memoryStore();
        for (const message of order) await importMessage("u1", message, deps(both, async () => extracted.get(message)!));
        expect([...both.segments.values()].find((s) => s.title === "Delta 1123 BOS to SFO")?.cancelledBy).toBe("m-change");
      }
    }

    // The replacement cancelled in turn, read newest first: it still replaced the original.
    {
      const cancel = email({ id: "m-cancel-new", subject: "Your flight is cancelled", date: "Sun, 1 Nov 2026 10:00:00 +0000" });
      const cancelled: ExtractedBooking = {
        isBooking: false,
        segments: [],
        cancellations: [
          { type: "flight", confirmation: "F8D7IY", start: "2026-12-19T13:00:00-05:00", place: "BOS to DTW" },
          { type: "flight", confirmation: "F8D7IY", start: "2026-12-19T16:45:00-05:00", place: "DTW to SFO" },
        ],
      };
      const extracted = new Map([[first, booked], [change, rebooked], [cancel, cancelled]]);
      for (const order of [[cancel, change, first], [first, change, cancel]]) {
        const gone = memoryStore();
        for (const message of order) await importMessage("u1", message, deps(gone, async () => extracted.get(message)!));
        expect([...gone.segments.values()].filter((s) => !s.cancelledBy).map((s) => s.title)).toEqual(["Delta 100 SFO to BOS"]);
      }
    }

    // A replacement filed into another trip still gives the original's trip a fresh revision.
    {
      const apart = memoryStore();
      const homeOnly: ExtractedBooking = { isBooking: true, segments: [booked.segments[1]!] };
      await importMessage("u1", first, { ...deps(apart, async () => homeOnly), now: () => "2026-10-20T12:00:00Z" });
      const [tripId] = [...apart.segments.values()].filter((s) => s.title === "Delta 1123 BOS to SFO").map((s) => s.tripId);
      const early: ExtractedBooking = { isBooking: true, segments: [leg("Delta 919 BOS to SFO", "2026-12-11T13:00:00-05:00", "2026-12-11T16:30:00-08:00", bos, sfo)] };
      await importMessage("u1", change, { ...deps(apart, async () => early), now: () => "2026-10-30T12:00:00Z" });
      expect([...apart.segments.values()].find((s) => s.title === "Delta 919 BOS to SFO")?.tripId).not.toBe(tripId);
      expect([...apart.segments.values()].find((s) => s.title === "Delta 1123 BOS to SFO")?.cancelledBy).toBe("m-change");
      expect(apart.trips.get(tripId!)?.updatedAt).toBe("2026-10-30T12:00:00Z");
    }

    // A later email confirming only a leg of the replacement (a seat change) doesn't date the cancellation.
    {
      const seat = email({ id: "m-seat", subject: "Your Delta itinerary", date: "Thu, 5 Nov 2026 10:00:00 +0000" });
      const extracted = new Map([[first, booked], [change, rebooked], [seat, { isBooking: true, segments: [rebooked.segments[1]!] }]]);
      const partly = memoryStore();
      for (const message of [change, seat, first]) await importMessage("u1", message, deps(partly, async () => extracted.get(message)!));
      expect([...partly.segments.values()].find((s) => s.title === "Delta 1123 BOS to SFO")?.cancelledBy).toBe("m-change");
    }

    // A rebooking that keeps the first leg and changes the onward flights: the dropped one is found.
    const sea = { name: "Seattle-Tacoma", code: "SEA", city: "Seattle", country: "US" };
    const viaDetroit: ExtractedBooking = { isBooking: true, segments: rebooked.segments.slice(1) };
    const viaSeattle: ExtractedBooking = {
      isBooking: true,
      segments: [rebooked.segments[1]!, leg("Delta 400 DTW to SEA", "2026-12-19T17:30:00-05:00", "2026-12-19T19:30:00-08:00", dtw, sea), leg("Alaska 9 SEA to SFO", "2026-12-19T21:00:00-08:00", "2026-12-19T23:00:00-08:00", sea, sfo)],
    };
    for (const order of [[first, change], [change, first]]) {
      const kept = memoryStore();
      for (const message of order) await importMessage("u1", message, deps(kept, async () => (message === change ? viaSeattle : viaDetroit)));
      expect([...kept.segments.values()].filter((s) => s.cancelledBy).map((s) => s.title)).toEqual(["Delta 2980 DTW to SFO"]);
    }
  });

  it("files an email giving only the date of a codeshare flight under the partner's reference as a source of the flight booked", async () => {
    const bos = { name: "Boston Logan International Airport", code: "BOS", city: "Boston", country: "US" };
    const lhr = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
    const ticket: ExtractedBooking = { isBooking: true, segments: [{ type: "flight", title: "VS4012 BOS to LHR", start: "2026-11-29T19:15:00-05:00", end: "2026-11-30T06:50:00+00:00", origin: bos, destination: lhr, confirmation: "E5WSJI" }] };
    const menu: ExtractedBooking = { isBooking: true, segments: [{ type: "flight", title: "Delta BOS to LHR", start: "2026-11-29T00:00:00-05:00", origin: bos, destination: { ...lhr, name: "London Heathrow Airport" }, confirmation: "GPJIZU" }] };
    const first = email({ id: "m-ticket", subject: "Virgin Atlantic Airways e-Ticket E5WSJI", date: "Tue, 20 Oct 2026 10:00:00 +0000" });
    const second = email({ id: "m-menu", subject: "Your Menu For Your Delta Flight Has Landed", date: "Mon, 23 Nov 2026 00:17:50 +0000" });
    for (const order of [[first, second], [second, first]]) {
      const store = memoryStore();
      for (const message of order) await importMessage("u1", message, deps(store, async () => (message === first ? ticket : menu)));
      const flights = [...store.segments.values()];
      expect(flights.map((s) => [s.title, s.start, s.confirmation])).toEqual([["VS4012 BOS to LHR", "2026-11-29T19:15:00-05:00", "E5WSJI"]]);
      expect(flights[0]!.sources?.map((r) => r.id).sort()).toEqual(["m-menu", "m-ticket"]);
      // Delta's reference is kept too, for managing the booking with the airline flying it.
      expect(flights[0]!.notes).toContain("Other reference: GPJIZU");
    }
  });

  it("cancels a merged booking by the reference of a booking merged into it", async () => {
    const store = memoryStore();
    const car = (title: string, start: string, confirmation: string) => ({ type: "car_rental" as const, title, start, end: "2026-11-29T17:30:00-05:00", provider: "Avis", confirmation });
    const agreement = car("Avis Car Rental East Boston", "2026-11-24T18:15:00-05:00", "708843612");
    await importMessage("u1", email({ id: "m-res", subject: "Avis reservation confirmed" }), deps(store, async () => ({ isBooking: true, segments: [car("Avis Boston Logan Intl Airport", "2026-11-24T17:30:00-05:00", "20874163US2")] })));
    const [kept] = [...store.segments.values()];
    store.segments.set(kept!.id, { ...kept!, mergedFrom: ["m-agree-0"], mergedBookings: [agreement], editedAt: "2026-11-02T00:00:00Z" });
    const cancelled: ExtractedBooking = { isBooking: false, segments: [], cancellations: [{ type: "car_rental", provider: "Avis", confirmation: "708843612", start: agreement.start }] };
    await importMessage("u1", email({ id: "m-cancel", subject: "Your Avis rental is cancelled" }), deps(store, async () => cancelled));
    expect(store.segments.get(kept!.id)?.cancelledBy).toBe("m-cancel");
  });

  it("files the second of two alike rooms beside a merged booking that looks like them", async () => {
    const store = memoryStore();
    const room = { type: "lodging" as const, title: "Cove Liverpool", start: "2026-12-12T15:00:00+00:00", end: "2026-12-14T11:00:00+00:00", provider: "Cove" };
    await importMessage("u1", email({ id: "m-stay", subject: "Your stay at Cove" }), deps(store, async () => ({ isBooking: true, segments: [room] })));
    const [kept] = [...store.segments.values()];
    store.segments.set(kept!.id, { ...kept!, mergedFrom: ["m-other-0"], mergedBookings: [room], editedAt: "2026-11-02T00:00:00Z" });
    await importMessage("u1", email({ id: "m-two", subject: "Your stay at Cove" }), deps(store, async () => ({ isBooking: true, segments: [room, room] })));
    expect(store.segments.size).toBe(2);
  });

  it("files the other of two alike rooms beside a merged booking, whichever item was merged", async () => {
    const store = memoryStore();
    const room = { type: "lodging" as const, title: "Cove Liverpool", start: "2026-12-12T15:00:00+00:00", end: "2026-12-14T11:00:00+00:00", provider: "Cove" };
    await importMessage("u1", email({ id: "m-stay", subject: "Your stay at Cove" }), deps(store, async () => ({ isBooking: true, segments: [room] })));
    const [kept] = [...store.segments.values()];
    store.segments.set(kept!.id, { ...kept!, mergedFrom: ["m-two-1"], mergedBookings: [room], editedAt: "2026-11-02T00:00:00Z" });
    await importMessage("u1", email({ id: "m-two", subject: "Your stay at Cove" }), deps(store, async () => ({ isBooking: true, segments: [room, room] })));
    expect(store.segments.size).toBe(2);
  });

  it("leaves a merged booking cancelled when the email of a booking merged into it is read again", async () => {
    const store = memoryStore();
    const car = (title: string, start: string, confirmation: string) => ({ type: "car_rental" as const, title, start, end: "2026-11-29T17:30:00-05:00", provider: "Avis", confirmation });
    await importMessage("u1", email({ id: "m-res", subject: "Avis reservation confirmed" }), deps(store, async () => ({ isBooking: true, segments: [car("Avis Boston Logan Intl Airport", "2026-11-24T17:30:00-05:00", "AAA111")] })));
    const [kept] = [...store.segments.values()];
    const agreement = car("Avis Car Rental East Boston", "2026-11-24T18:15:00-05:00", "BBB222");
    const both = [...kept!.sources!, { kind: "gmail" as const, id: "m-agree", uid: "u1", at: "2026-11-02T00:00:00Z" }];
    store.segments.set(kept!.id, { ...kept!, sources: both, mergedFrom: ["m-agree-0"], mergedBookings: [agreement], editedAt: "2026-11-02T00:00:00Z", cancelledAt: "2026-11-03T00:00:00Z", userCancelled: "booking" });
    await importMessage("u1", email({ id: "m-agree", subject: "Avis Rental Confirmation" }), deps(store, async () => ({ isBooking: true, segments: [agreement] })));
    expect([...store.segments.values()].filter((s) => !s.cancelledAt)).toEqual([]);
  });

  it("files a stay booked again after a merged booking was cancelled as a booking of its own", async () => {
    const store = memoryStore();
    const stay = { type: "lodging" as const, title: "Cove Liverpool", start: "2026-12-12T15:00:00+00:00", end: "2026-12-14T11:00:00+00:00", provider: "Cove" };
    await importMessage("u1", email({ id: "m-stay", subject: "Your stay at Cove" }), deps(store, async () => ({ isBooking: true, segments: [stay] })));
    const [kept] = [...store.segments.values()];
    // Merged with another reading of it, then cancelled by the user.
    store.segments.set(kept!.id, { ...kept!, mergedFrom: ["m-other-0"], mergedBookings: [stay], editedAt: "2026-11-02T00:00:00Z", cancelledAt: "2026-11-03T00:00:00Z", userCancelled: "booking" });
    await importMessage("u1", email({ id: "m-again", subject: "Your stay at Cove" }), deps(store, async () => ({ isBooking: true, segments: [stay] })));
    const live = [...store.segments.values()].filter((s) => !s.cancelledAt);
    expect(live.map((s) => s.title)).toEqual(["Cove Liverpool"]);
  });

  it("files an email whose booking the user merged into another as that one", async () => {
    const store = memoryStore();
    const car = (title: string, start: string, confirmation: string) => ({ type: "car_rental" as const, title, start, end: "2026-11-29T17:30:00-05:00", provider: "Avis", confirmation });
    await importMessage("u1", email({ id: "m-res", subject: "Avis reservation confirmed" }), deps(store, async () => ({ isBooking: true, segments: [car("Avis Boston Logan Intl Airport", "2026-11-24T17:30:00-05:00", "20874163US2")] })));
    const [kept] = [...store.segments.values()];
    // The user merged the rental agreement's booking into it, then its email is read again.
    const agreementSource = { kind: "gmail" as const, id: "m-agree", uid: "u1", at: "2026-11-02T00:00:00Z" };
    const agreed = car("Avis Car Rental East Boston", "2026-11-24T18:15:00-05:00", "708843612");
    store.segments.set(kept!.id, { ...kept!, sources: [...(kept!.sources ?? []), agreementSource], mergedFrom: ["m-agree-0"], mergedBookings: [agreed], editedAt: "2026-11-02T00:00:00Z" });
    await importMessage("u1", email({ id: "m-agree", subject: "Avis Rental Confirmation: 708843612" }), deps(store, async () => ({ isBooking: true, segments: [car("Avis Car Rental East Boston", "2026-11-24T18:15:00-05:00", "708843612")] })));
    expect([...store.segments.values()].map((s) => [s.id, s.title])).toEqual([[kept!.id, "Avis Boston Logan Intl Airport"]]);
    expect(store.segments.get(kept!.id)?.sources?.map((s) => s.id)).toEqual(["m-res", "m-agree"]);

    // Another email already among its sources (the agreement read again before the merge) finds it too.
    const again = { kind: "gmail" as const, id: "m-again", uid: "u1", at: "2026-11-02T00:00:00Z" };
    const agreement = car("Avis Car Rental East Boston", "2026-11-24T18:15:00-05:00", "708843612");
    store.segments.set(kept!.id, { ...store.segments.get(kept!.id)!, sources: [...store.segments.get(kept!.id)!.sources!, again], mergedBookings: [agreement] });
    await importMessage("u1", email({ id: "m-again", subject: "Avis Rental Confirmation: 708843612" }), deps(store, async () => ({ isBooking: true, segments: [car("Avis Car Rental East Boston", "2026-11-24T18:15:00-05:00", "708843612")] })));
    expect([...store.segments.keys()]).toEqual([kept!.id]);
  });

  it("files a car's rental agreement as the reservation it was picked up on, either order", async () => {
    const car = (title: string, start: string, provider: string, confirmation: string, rentalStage: "reservation" | "agreement") => ({ type: "car_rental" as const, title, start, end: "2026-11-29T17:30:00-05:00", provider, confirmation, rentalStage });
    const reservation: ExtractedBooking = { isBooking: true, segments: [car("Avis Boston Logan Intl Airport", "2026-11-24T17:30:00-05:00", "Avis", "20874163US2", "reservation")] };
    const agreement: ExtractedBooking = { isBooking: true, segments: [car("Avis Car Rental East Boston", "2026-11-24T18:15:00-05:00", "Avis Rent A Car", "708843612", "agreement")] };
    const first = email({ id: "m-res", subject: "Avis reservation confirmed", date: "Tue, 20 Oct 2026 10:00:00 +0000" });
    const second = email({ id: "m-agree", subject: "Avis Rental Confirmation: 708843612", date: "Tue, 24 Nov 2026 20:12:50 +0000" });
    for (const order of [[first, second], [second, first]]) {
      const store = memoryStore();
      for (const message of order) await importMessage("u1", message, deps(store, async () => (message === first ? reservation : agreement)));
      const cars = [...store.segments.values()];
      expect(cars).toHaveLength(1);
      expect(cars[0]!.sources?.map((s) => s.id).sort()).toEqual(["m-agree", "m-res"]);
      // The agreement, the newer, says when the car was picked up.
      expect(cars[0]!.start).toBe("2026-11-24T18:15:00-05:00");
    }

    // Two cars for a family trip: two reservations, then two agreements, are two rentals.
    const store = memoryStore();
    const another = (booking: ExtractedBooking, confirmation: string): ExtractedBooking => ({ isBooking: true, segments: [{ ...booking.segments[0]!, confirmation }] });
    const emails: [string, ExtractedBooking][] = [
      ["m-res1", reservation],
      ["m-res2", another(reservation, "20874164US2")],
      ["m-agree1", agreement],
      ["m-agree2", another(agreement, "708843613")],
    ];
    for (const [id, extracted] of emails) await importMessage("u1", email({ id, subject: "Avis Rental Confirmation" }), deps(store, async () => extracted));
    expect([...store.segments.values()].map((s) => s.sources?.map((r) => r.id).sort())).toEqual([["m-agree1", "m-res1"], ["m-agree2", "m-res2"]]);

    // Read newest first, the agreements before the reservations: still two, each one car's reservation and agreement.
    const newest = memoryStore();
    for (const [id, extracted] of [emails[2]!, emails[3]!, emails[0]!, emails[1]!]) await importMessage("u1", email({ id, subject: "Avis Rental Confirmation" }), deps(newest, async () => extracted));
    const rentals = [...newest.segments.values()].map((s) => s.sources?.map((r) => r.id.replace(/\d$/, "")).sort());
    expect(rentals).toEqual([["m-agree", "m-res"], ["m-agree", "m-res"]]);
  });

  it("keeps the source of a booking dropped as a duplicate on the booking it matched", async () => {
    const store = memoryStore();
    await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    expect(store.segments.get("m2-0")?.sources).toEqual([
      { kind: "gmail", id: "m2", label: "Your Ryanair itinerary", uid: "u1", at: "2026-11-01T12:00:00Z", sentAt: "2026-11-01T10:00:00.000Z" },
    ]);
    await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    // The outbound was already there: it now lists the TripIt trip as well.
    expect(store.segments.get("m2-0")?.sources?.map((s) => [s.kind, s.label])).toEqual([
      ["gmail", "Your Ryanair itinerary"],
      ["tripit", "Dublin weekend"],
    ]);
    // A second email confirming the same flight is listed too, not lost.
    await importMessage("u1", email({ id: "m3", subject: "Your e-ticket" }), deps(store, async () => flight));
    expect(store.segments.get("m2-0")?.sources?.map((s) => s.id)).toEqual(["m2", expect.stringMatching(/^tripit-/), "m3"]);
    expect(store.segments.has("m3-0")).toBe(false);
  });

  it("skips a Gmail booking already imported from TripIt", async () => {
    const store = memoryStore();
    await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    const segments = store.segments.size;
    const outcome = await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    expect(outcome).toBe("imported");
    expect(store.segments.size).toBe(segments);
    expect(store.parsed.get("u1/m2")).toMatchObject({ segmentIds: [], reason: "1 already imported from elsewhere" });
  });

  it("never files a later email into the unfiled holding trip by its dates", async () => {
    const store = memoryStore();
    const holding = tripItExport({
      Trips: [],
      UnfiledItems: [
        { supplier_name: "Example Cars", car_type: "Compact", StartDateTime: at("2025-03-01", "10:00:00"), EndDateTime: at("2025-03-02", "10:00:00") },
        { supplier_name: "Other Cars", car_type: "Van", StartDateTime: at("2027-03-01", "10:00:00"), EndDateTime: at("2027-03-02", "10:00:00") },
      ],
    });
    await importTripIt("u1", holding, deps(store, async () => lodging));
    expect(store.trips.get(tripItUnfiledTripId("u1"))).toMatchObject({ start: "2025-03-01", end: "2027-03-02" });
    await importMessage("u1", email(), deps(store, async () => lodging));
    expect(store.segments.get("m1-0")?.tripId).not.toBe(tripItUnfiledTripId("u1"));
    expect(store.trips.size).toBe(2);
  });

  it("imports two unfiled rooms alike in every field as two bookings", async () => {
    const store = memoryStore();
    const room = { supplier_name: "Hotel Example", room_type: "Double", StartDateTime: at("2025-03-01", "15:00:00"), EndDateTime: at("2025-03-02", "11:00:00") };
    const counts = await importTripIt("u1", tripItExport({ Trips: [], UnfiledItems: [room, room] }), deps(store, async () => lodging));
    expect(counts).toMatchObject({ imported: 2, duplicates: 0 });
    expect(store.segments.size).toBe(2);
  });

  it("lets one booking from Gmail stand in for only one of two alike TripIt rooms", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const room = {
      supplier_name: "Cove Liverpool",
      room_type: "Double",
      StartDateTime: { date: "2026-12-12", time: "15:00", timezone: "Europe/London", utc_offset: "+00:00" },
      EndDateTime: { date: "2026-12-14", time: "11:00", timezone: "Europe/London", utc_offset: "+00:00" },
    };
    const counts = await importTripIt("u1", tripItExport({ Trips: [], UnfiledItems: [room, room] }), deps(store, async () => lodging));
    expect(counts).toMatchObject({ imported: 1, duplicates: 1 });
    expect([...store.segments.values()].filter((s) => s.type === "lodging")).toHaveLength(2);
  });

  it("lets a merged Gmail booking stand in for only one of two alike TripIt rooms", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const [kept] = [...store.segments.values()].filter((s) => s.type === "lodging");
    // Merged with another reading of that stay.
    const { id: _id, tripId: _trip, source: _source, gmailMessageIds: _ids, sources: _sources, createdAt: _c, updatedAt: _u, ...said } = kept!;
    store.segments.set(kept!.id, { ...kept!, mergedFrom: ["m9-0"], mergedBookings: [said], editedAt: "2026-11-02T00:00:00Z" });
    const room = {
      supplier_name: "Cove Liverpool",
      room_type: "Double",
      StartDateTime: { date: "2026-12-12", time: "15:00", timezone: "Europe/London", utc_offset: "+00:00" },
      EndDateTime: { date: "2026-12-14", time: "11:00", timezone: "Europe/London", utc_offset: "+00:00" },
    };
    await importTripIt("u1", tripItExport({ Trips: [], UnfiledItems: [room, room] }), deps(store, async () => lodging));
    expect([...store.segments.values()].filter((s) => s.type === "lodging")).toHaveLength(2);
  });

  it("keeps matching one to one when a partly failed upload is retried", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const room = {
      supplier_name: "Cove Liverpool",
      room_type: "Double",
      StartDateTime: { date: "2026-12-12", time: "15:00", timezone: "Europe/London", utc_offset: "+00:00" },
      EndDateTime: { date: "2026-12-14", time: "11:00", timezone: "Europe/London", utc_offset: "+00:00" },
    };
    const file = tripItExport({ Trips: [], UnfiledItems: [room, room] });
    let calls = 0;
    const flaky: TripStore = {
      ...store,
      withUserLock: (uid, fn) => (++calls === 2 ? Promise.reject(new Error("contention")) : store.withUserLock(uid, fn)),
    };
    expect(await importTripIt("u1", file, deps(flaky, async () => lodging))).toMatchObject({ duplicates: 1, failed: 1 });
    expect(await importTripIt("u1", file, deps(store, async () => lodging))).toMatchObject({ imported: 1, skipped: 1 });
    expect([...store.segments.values()].filter((s) => s.type === "lodging")).toHaveLength(2);
  });

  it("keeps matching one to one when the item that failed came first", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const room = {
      supplier_name: "Cove Liverpool",
      room_type: "Double",
      StartDateTime: { date: "2026-12-12", time: "15:00", timezone: "Europe/London", utc_offset: "+00:00" },
      EndDateTime: { date: "2026-12-14", time: "11:00", timezone: "Europe/London", utc_offset: "+00:00" },
    };
    const file = tripItExport({ Trips: [], UnfiledItems: [room, room] });
    let calls = 0;
    const flaky: TripStore = {
      ...store,
      withUserLock: (uid, fn) => (++calls === 1 ? Promise.reject(new Error("contention")) : store.withUserLock(uid, fn)),
    };
    expect(await importTripIt("u1", file, deps(flaky, async () => lodging))).toMatchObject({ duplicates: 1, failed: 1 });
    expect(await importTripIt("u1", file, deps(store, async () => lodging))).toMatchObject({ imported: 1, skipped: 1 });
    expect([...store.segments.values()].filter((s) => s.type === "lodging")).toHaveLength(2);
  });

  it("matches two alike TripIt rooms to two Gmail rooms one to one, adding none", async () => {
    const store = memoryStore();
    const gmailRoom = (confirmation: string) => ({ isBooking: true, segments: [{ ...lodging.segments[0]!, confirmation }] });
    await importMessage("u1", email({ id: "r1" }), deps(store, async () => gmailRoom("AAA111")));
    await importMessage("u1", email({ id: "r2" }), deps(store, async () => gmailRoom("BBB222")));
    expect(store.segments.size).toBe(2);
    const room = {
      supplier_name: "Cove Liverpool",
      room_type: "Double",
      StartDateTime: { date: "2026-12-12", time: "15:00", timezone: "Europe/London", utc_offset: "+00:00" },
      EndDateTime: { date: "2026-12-14", time: "11:00", timezone: "Europe/London", utc_offset: "+00:00" },
    };
    const counts = await importTripIt("u1", tripItExport({ Trips: [], UnfiledItems: [room, room] }), deps(store, async () => lodging));
    expect(counts).toMatchObject({ imported: 0, duplicates: 2 });
    expect(store.segments.size).toBe(2);
  });

  it("files a TripIt trip's new legs with the trip already holding its matched ones, not any overlapping trip", async () => {
    const store = memoryStore();
    const barcelona = { ...lodging.segments[0]!, title: "Hotel Barcelona", start: "2026-12-05T15:00:00+01:00", end: "2026-12-06T11:00:00+01:00", destination: { name: "Hotel Barcelona", city: "Barcelona" } };
    await importMessage("u1", email({ id: "b1" }), deps(store, async () => ({ isBooking: true, segments: [barcelona] })));
    await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    const barcelonaTrip = store.segments.get("b1-0")!.tripId;
    const dublinTrip = store.segments.get("m2-0")!.tripId;
    expect(barcelonaTrip).not.toBe(dublinTrip);
    const wide = tripItExport({
      Trips: [{ TripData: { display_name: "Dublin", start_date: "2026-12-01", end_date: "2026-12-31" }, Objects: [tripItFlight("2026-12-15", "123", "MAN", "DUB"), tripItFlight("2026-12-20", "124", "DUB", "MAN")] }],
      UnfiledItems: [],
    });
    await importTripIt("u1", wide, deps(store, async () => lodging));
    const returnLeg = [...store.segments.values()].find((s) => s.title.startsWith("FR 124"))!;
    expect(returnLeg.tripId).toBe(dublinTrip);
  });

  it("gives two users importing the same itinerary trips of their own", async () => {
    const store = memoryStore();
    await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    await importTripIt("u2", tripItExport(), deps(store, async () => lodging));
    expect(store.trips.size).toBe(6);
    expect(new Set([...store.trips.values()].map((t) => t.ownerUid))).toEqual(new Set(["u1", "u2"]));
  });

  it("stops before the next item when told to, keeping what it finished", async () => {
    const store = memoryStore();
    let items = 0;
    const stop = () => {
      if (++items > 1) throw new Error("superseded");
    };
    await expect(importTripIt("u1", tripItExport(), deps(store, async () => lodging), { beforeEach: stop })).rejects.toThrow("superseded");
    expect([...store.trips.values()].map((t) => t.title)).toEqual(["Dublin weekend"]);
    const retry = await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    expect(retry).toMatchObject({ skipped: 1, trips: 1 });
  });

  it("records a trip that could not be written as failed and goes on with the rest", async () => {
    const store = memoryStore();
    let calls = 0;
    const flaky: TripStore = {
      ...store,
      withUserLock: (uid, fn) => (++calls === 1 ? Promise.reject(new Error("contention")) : store.withUserLock(uid, fn)),
    };
    const counts = await importTripIt("u1", tripItExport(), deps(flaky, async () => lodging));
    expect(counts).toMatchObject({ trips: 1, failed: 1 });
    expect([...store.parsed.values()].find((r) => r.subject === "Dublin weekend")).toMatchObject({ outcome: "failed", reason: "contention" });
    const retry = await importTripIt("u1", tripItExport(), deps(store, async () => lodging));
    expect(retry).toMatchObject({ trips: 1, skipped: 2, failed: 0 });
    expect([...store.trips.values()].map((t) => t.title)).toContain("Dublin weekend");
  });
});

const ics = (prodId: string, events: string[]) =>
  parseIcs(["BEGIN:VCALENDAR", `PRODID:${prodId}`, ...events, "END:VCALENDAR"].join("\r\n"));
const vevent = (uid: string, summary: string, extra: string[] = []) => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTART;TZID=Europe/London:20261215T080000",
  "DTEND;TZID=Europe/Dublin:20261215T090000",
  `SUMMARY:${summary}`,
  ...extra,
  "END:VEVENT",
].join("\r\n");

describe("changeClaimable", () => {
  const seen: ParsedMessage = { messageId: "ics-1", uid: "u1", outcome: "imported", segmentIds: ["s1"], revision: "r1", processedAt: "2026-11-01T00:00:00Z" };
  it("allows a claim only on the version the caller read, and not over a live claim", () => {
    expect(changeClaimable(seen, seen, "2026-11-02T00:00:00Z")).toBe(true);
    expect(changeClaimable({ ...seen, revision: "r2" }, seen, "2026-11-02T00:00:00Z")).toBe(false);
    expect(changeClaimable({ ...seen, processedAt: "2026-11-01T01:00:00Z" }, seen, "2026-11-02T00:00:00Z")).toBe(false);
    expect(changeClaimable(undefined, seen, "2026-11-02T00:00:00Z")).toBe(false);
    const claim = { ...seen, outcome: "processing" as const };
    expect(changeClaimable(claim, claim, "2026-11-01T00:05:00Z")).toBe(false);
    expect(changeClaimable(claim, claim, "2026-11-01T00:20:00Z")).toBe(true);
  });
});

describe("importCalendar", () => {
  it("reads travel events through the model and files them as calendar bookings", async () => {
    const store = memoryStore();
    const seen: string[] = [];
    const extract = vi.fn(async (m: { text: string }) => (seen.push(m.text), flight));
    const calendar = ics("-//Example//EN", [vevent("e1", "FR123 MAN to DUB"), vevent("e2", "Dentist")]);
    const counts = await importCalendar("u1", calendar, deps(store, extract), 100);
    expect(counts).toMatchObject({ imported: 1, filtered: 1, recurring: 0, cancelled: 0, remaining: 0 });
    expect(seen[0]).toContain("Starts: 2026-12-15T08:00:00+00:00 (Europe/London)");
    const segment = [...store.segments.values()][0]!;
    expect(segment).toMatchObject({ source: "ics", gmailMessageIds: [] });
    expect(segment.sender).toBeUndefined();
    const record = [...store.parsed.values()].find((r) => r.outcome === "imported")!;
    expect(record).toMatchObject({ source: "ics", from: "Calendar file", subject: "FR123 MAN to DUB" });
  });

  it("skips repeating and cancelled events, and anything already read", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => flight);
    const calendar = ics("-//Example//EN", [
      vevent("e1", "FR123 MAN to DUB"),
      vevent("e2", "Flight club", ["RRULE:FREQ=WEEKLY"]),
      vevent("e3", "Flight to Dublin", ["STATUS:CANCELLED"]),
    ]);
    expect(await importCalendar("u1", calendar, deps(store, extract), 100)).toMatchObject({ imported: 1, recurring: 1, cancelled: 1 });
    expect(await importCalendar("u1", calendar, deps(store, extract), 100)).toMatchObject({ imported: 0, skipped: 1 });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("never reads Travelmo's own exported events back in", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => flight);
    const calendar = ics("-//Example//EN", [vevent("segment-t1-s1@export.travelmo", "FR123 MAN to DUB"), vevent("e2", "FR123 MAN to DUB")]);
    expect(await importCalendar("u1", calendar, deps(store, extract), 100)).toMatchObject({ imported: 1, exported: 1 });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("stops reading at the cap and picks up where it left off", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => ({ isBooking: false, segments: [] }));
    const calendar = ics("-//Example//EN", [vevent("e1", "Flight one"), vevent("e2", "Flight two"), vevent("e3", "Flight three")]);
    expect(await importCalendar("u1", calendar, deps(store, extract), 2)).toMatchObject({ not_booking: 2, remaining: 1 });
    expect(await importCalendar("u1", calendar, deps(store, extract), 2)).toMatchObject({ not_booking: 1, skipped: 2, remaining: 0 });
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it("reads an event whose extraction failed again on the next upload, and nothing else", async () => {
    const store = memoryStore();
    const calendar = ics("-//Example//EN", [vevent("e1", "FR123 MAN to DUB"), vevent("e2", "Flight to nowhere")]);
    let rateLimited = true;
    const extract = vi.fn(async (m: { subject: string }) => {
      if (m.subject.startsWith("FR123") && rateLimited) throw new Error("429 rate limited");
      return m.subject.startsWith("FR123") ? flight : { isBooking: false, segments: [] };
    });
    expect(await importCalendar("u1", calendar, deps(store, extract), 100)).toMatchObject({ failed: 1, not_booking: 1 });
    rateLimited = false;
    expect(await importCalendar("u1", calendar, deps(store, extract), 100)).toMatchObject({ imported: 1, skipped: 1 });
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it("keeps two calendar events that describe alike rooms as two bookings", async () => {
    const store = memoryStore();
    const calendar = ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool"), vevent("room2", "Cove Liverpool")]);
    expect(await importCalendar("u1", calendar, deps(store, async () => lodging), 100)).toMatchObject({ imported: 2 });
    expect(store.segments.size).toBe(2);
  });

  it("lets one Gmail room stand in for only one of two alike calendar room events, across uploads too", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const calendar = ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool"), vevent("room2", "Cove Liverpool")]);
    let fail = true;
    const flaky = async (m: { subject: string; id: string }) => {
      if (m.id.endsWith(calendar.events[0]!.key) && fail) throw new Error("rate limited");
      return lodging;
    };
    // The first event fails, the second matches the Gmail room; the retry
    // must not let the first match it again.
    expect(await importCalendar("u1", calendar, deps(store, flaky), 100)).toMatchObject({ failed: 1, imported: 1 });
    fail = false;
    expect(await importCalendar("u1", calendar, deps(store, flaky), 100)).toMatchObject({ imported: 1, skipped: 1 });
    expect([...store.segments.values()].filter((s) => s.type === "lodging")).toHaveLength(2);
  });

  it("removes a booking whose event is later cancelled, unless it was edited or matched since", async () => {
    const store = memoryStore();
    const live = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]);
    await importCalendar("u1", live, deps(store, async () => flight), 100);
    const [segment] = [...store.segments.values()];
    expect(segment).toBeDefined();
    const cancelled = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["STATUS:CANCELLED"])]);
    expect(await importCalendar("u1", cancelled, deps(store, async () => flight), 100)).toMatchObject({ cancelled: 1, removed: 1 });
    expect(store.segments.size).toBe(0);
    expect([...store.parsed.values()][0]).toMatchObject({ outcome: "not_booking", reason: "cancelled in the calendar", segmentIds: [] });
    // Once is enough: the record no longer holds the booking.
    expect(await importCalendar("u1", cancelled, deps(store, async () => flight), 100)).toMatchObject({ removed: 0 });
  });

  it("keeps a calendar event's outings on days apart in one trip, so cancelling it removes them all", async () => {
    const store = memoryStore();
    const session = (date: string) => ({
      type: "activity" as const,
      title: "Saturday Drama Club",
      start: `${date}T12:30:00+01:00`,
      end: `${date}T13:30:00+01:00`,
      destination: { name: "Example School", city: "London", country: "GB" },
    });
    const term = async (): Promise<ExtractedBooking> => ({ isBooking: true, segments: ["2026-12-05", "2026-12-12"].map(session) });
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "Drama Club")]), deps(store, term), 100);
    expect(store.trips.size).toBe(1);
    expect(store.segments.size).toBe(2);
    const cancelled = ics("-//TripIt//EN", [vevent("e1", "Drama Club", ["STATUS:CANCELLED"])]);
    expect(await importCalendar("u1", cancelled, deps(store, term), 100)).toMatchObject({ cancelled: 1, removed: 2 });
    expect(store.segments.size).toBe(0);
  });

  it("keeps a cancelled event's booking that the user edited or another import matched", async () => {
    const store = memoryStore();
    const live = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB"), vevent("e2", "Cove Liverpool")]);
    await importCalendar("u1", live, deps(store, async (m) => (m.subject.startsWith("FR") ? flight : lodging)), 100);
    const [flightSeg, staySeg] = [...store.segments.values()];
    store.segments.set(flightSeg!.id, { ...flightSeg!, title: "Edited", updatedAt: "2026-11-05T00:00:00Z" });
    // The confirmation email arrives later and is matched to the stay.
    await importMessage("u1", email({ id: "m9" }), deps(store, async () => lodging));
    expect(store.segments.get(staySeg!.id)?.sources?.map((s) => s.kind)).toEqual(["ics", "gmail"]);
    const cancelled = ics("-//TripIt//EN", [
      vevent("e1", "FR123 MAN to DUB", ["STATUS:CANCELLED"]),
      vevent("e2", "Cove Liverpool", ["STATUS:CANCELLED"]),
    ]);
    expect(await importCalendar("u1", cancelled, deps(store, async () => flight), 100)).toMatchObject({ cancelled: 2, removed: 0 });
    expect(store.segments.size).toBe(2);
  });

  it("reads an event again when its text changes, replacing the booking it made, and not for a new timestamp", async () => {
    const store = memoryStore();
    const later = { ...flight, segments: flight.segments.map((seg) => ({ ...seg, start: "2026-12-15T18:00:00+00:00" })) };
    let answer = flight;
    const extract = vi.fn(async () => answer);
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DTSTAMP:20261101T000000Z"])]), deps(store, extract), 100);
    // Restamped on the next export, nothing else changed: not read again.
    const restamped = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DTSTAMP:20261102T000000Z"])]);
    expect(await importCalendar("u1", restamped, deps(store, extract), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect(extract).toHaveBeenCalledTimes(1);
    answer = later;
    const moved = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Moved to the evening"])]);
    expect(await importCalendar("u1", moved, deps(store, extract), 100)).toMatchObject({ imported: 1, updated: 1 });
    expect([...store.segments.values()].map((seg) => seg.start)).toEqual(["2026-12-15T18:00:00+00:00"]);
    expect(await importCalendar("u1", moved, deps(store, extract), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("keeps the old booking when reading a changed event fails, and tries the change again", async () => {
    const store = memoryStore();
    const later = { ...flight, segments: flight.segments.map((seg) => ({ ...seg, start: "2026-12-15T18:00:00+00:00" })) };
    let down = false;
    const extract = vi.fn(async () => {
      if (down) throw new Error("429 rate limited");
      return extract.mock.calls.length > 1 ? later : flight;
    });
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]), deps(store, extract), 100);
    const before = [...store.parsed.values()][0]!;
    down = true;
    const moved = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Moved to the evening"])]);
    expect(await importCalendar("u1", moved, deps(store, extract), 100)).toMatchObject({ failed: 1, updated: 0 });
    expect([...store.segments.values()].map((seg) => seg.start)).toEqual([flight.segments[0]!.start]);
    expect([...store.parsed.values()][0]).toEqual(before);
    down = false;
    expect(await importCalendar("u1", moved, deps(store, extract), 100)).toMatchObject({ imported: 1, updated: 1 });
    expect([...store.segments.values()].map((seg) => seg.start)).toEqual(["2026-12-15T18:00:00+00:00"]);
  });

  it("keeps a changed event's match reserved when its new read fails", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const rooms = (extra: string[] = []) => ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool", extra), vevent("room2", "Cove Liverpool")]);
    const calendar = rooms();
    const room1 = `ics-${calendar.events[0]!.key}`;
    let failing = new Set([`ics-${calendar.events[1]!.key}`]);
    const flaky = async (m: { id: string }) => {
      if (failing.has(m.id)) throw new Error("rate limited");
      return lodging;
    };
    // room1 matches the Gmail room; room2 fails for now.
    expect(await importCalendar("u1", calendar, deps(store, flaky), 100)).toMatchObject({ imported: 1, failed: 1 });
    // room1 changes but its read fails; room2 now reads and must not take
    // the Gmail room room1 still holds.
    failing = new Set([room1]);
    expect(await importCalendar("u1", rooms(["DESCRIPTION:Late check-in"]), deps(store, flaky), 100)).toMatchObject({ imported: 1, failed: 1 });
    expect([...store.segments.values()].filter((seg) => seg.type === "lodging")).toHaveLength(2);
  });

  it("keeps a changed event's bookings named when removing them fails, and replaces them later", async () => {
    const store = memoryStore();
    const later = { ...flight, segments: flight.segments.map((seg) => ({ ...seg, start: "2026-12-15T18:00:00+00:00" })) };
    let answer = flight;
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]), deps(store, async () => answer), 100);
    const [segment] = [...store.segments.values()];
    answer = later;
    // The check passes; the transaction that removes the old booking fails.
    let locks = 0;
    const flaky: TripStore = { ...store, withUserLock: (uid, fn) => (++locks === 2 ? Promise.reject(new Error("contention")) : store.withUserLock(uid, fn)) };
    const moved = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Moved to the evening"])]);
    await expect(importCalendar("u1", moved, deps(flaky, async () => answer), 100)).rejects.toThrow("contention");
    expect(store.segments.has(segment!.id)).toBe(true);
    expect([...store.parsed.values()][0]).toMatchObject({ outcome: "processing", segmentIds: [segment!.id] });
    // Once that claim has expired, the change is made in full.
    const afterLease = { ...deps(store, async () => answer), now: () => new Date(Date.parse("2026-11-01T12:00:00Z") + claimLeaseMs + 1).toISOString() };
    expect(await importCalendar("u1", moved, afterLease, 100)).toMatchObject({ imported: 1, updated: 1 });
    expect([...store.segments.values()].map((seg) => seg.start)).toEqual(["2026-12-15T18:00:00+00:00"]);
  });

  it("keeps the matches of an event mid-change reserved against an overlapping read", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const calendar = ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool")]);
    await importCalendar("u1", calendar, deps(store, async () => lodging), 100);
    const record = [...store.parsed.values()].find((r) => r.messageId === `ics-${calendar.events[0]!.key}`)!;
    expect(record.matchedSegmentIds?.length).toBe(1);
    // Another worker has claimed room1's change and not finished it.
    await store.setParsed({ ...record, outcome: "processing", processedAt: "2026-11-01T12:00:00Z" });
    const withRoom2 = ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool"), vevent("room2", "Cove Liverpool")]);
    expect(await importCalendar("u1", withRoom2, deps(store, async () => lodging), 100)).toMatchObject({ imported: 1 });
    expect([...store.segments.values()].filter((seg) => seg.type === "lodging")).toHaveLength(2);
  });

  it("does not write a stale record over a change another read has made", async () => {
    const store = memoryStore();
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]), deps(store, async () => flight), 100);
    const stale = [...store.parsed.values()][0]!;
    // Meanwhile another read replaced the booking into another trip.
    const [segment] = [...store.segments.values()];
    store.segments.set(segment!.id, { ...segment!, tripId: "trip-new" });
    const fresh = { ...stale, tripId: "trip-new", revision: "r-fresh", processedAt: "2026-11-01T12:30:00Z" };
    await store.setParsed(fresh);
    // A read that saw the old record finds its booking gone from the old
    // trip, and must not put the old trip back on the record.
    const behind: TripStore = { ...store, getParsed: async () => stale };
    const moved = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Moved again"])]);
    expect(await importCalendar("u1", moved, deps(behind, async () => flight), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect([...store.parsed.values()][0]).toEqual(fresh);
  });

  it("recovers a dead worker's claim on a duplicate-only event without duplicating its booking", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const calendar = ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool")]);
    await importCalendar("u1", calendar, deps(store, async () => lodging), 100);
    const record = [...store.parsed.values()].find((r) => r.messageId === `ics-${calendar.events[0]!.key}`)!;
    // A worker claimed a change, then died; its claim keeps the match.
    await store.setParsed({ ...record, outcome: "processing", processedAt: "2026-11-01T12:00:00Z" });
    const afterLease = { ...deps(store, async () => lodging), now: () => new Date(Date.parse("2026-11-01T12:00:00Z") + claimLeaseMs + 1).toISOString() };
    const changed = ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool", ["DESCRIPTION:Late check-in"])]);
    expect(await importCalendar("u1", changed, afterLease, 100)).toMatchObject({ imported: 1, updated: 1 });
    expect([...store.segments.values()].filter((seg) => seg.type === "lodging")).toHaveLength(1);
  });

  it("frees a changed event's old match before newer events are matched, whatever the file's order", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const manchester: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "lodging", title: "Cove Manchester", start: "2027-01-08T15:00:00+00:00", end: "2027-01-10T11:00:00+00:00", destination: { name: "Cove Manchester", city: "Manchester", country: "GB" } }],
    };
    const extract = async (m: { text: string }) => (m.text.includes("Manchester") ? manchester : lodging);
    // room1 first matches the Gmail room in Liverpool.
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool")]), deps(store, extract), 100);
    // Then room1 moves to Manchester, and a new event before it in the file
    // is the Liverpool stay.
    const later = ics("-//TripIt//EN", [vevent("room0", "Cove Liverpool"), vevent("room1", "Cove Liverpool", ["DESCRIPTION:Moved to Manchester"])]);
    expect(await importCalendar("u1", later, deps(store, extract), 100)).toMatchObject({ imported: 2, updated: 1 });
    const rooms = [...store.segments.values()].filter((seg) => seg.type === "lodging");
    // The Gmail room, found again by room0, and room1's Manchester stay.
    expect(rooms.map((seg) => seg.title).sort()).toEqual(["Cove Liverpool", "Cove Manchester"]);
  });

  it("reads a changed event once when two reads of the calendar overlap", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => flight);
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]), deps(store, extract), 100);
    const moved = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Moved"])]);
    const [a, b] = await Promise.all([importCalendar("u1", moved, deps(store, extract), 100), importCalendar("u1", moved, deps(store, extract), 100)]);
    expect(a.updated + b.updated).toBe(1);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(store.segments.size).toBe(1);
  });

  it("keeps an edited booking when its event changes, and notes the change once", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => flight);
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]), deps(store, extract), 100);
    const [segment] = [...store.segments.values()];
    store.segments.set(segment!.id, { ...segment!, title: "Edited", updatedAt: "2026-11-05T00:00:00Z" });
    const moved = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Moved"])]);
    expect(await importCalendar("u1", moved, deps(store, extract), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect(await importCalendar("u1", moved, deps(store, extract), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect(extract).toHaveBeenCalledTimes(1);
    expect([...store.segments.values()].map((seg) => seg.title)).toEqual(["Edited"]);
    expect([...store.parsed.values()][0]).toMatchObject({ outcome: "imported", reason: "changed in the calendar; edited or matched bookings kept" });
  });

  it("reads a changed event again when it had only matched another source's booking", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    const extract = vi.fn(async () => lodging);
    expect(await importCalendar("u1", ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool")]), deps(store, extract), 100)).toMatchObject({ imported: 1 });
    expect(store.segments.size).toBe(1);
    const changed = ics("-//TripIt//EN", [vevent("room1", "Cove Liverpool", ["DESCRIPTION:Late check-in"])]);
    expect(await importCalendar("u1", changed, deps(store, extract), 100)).toMatchObject({ imported: 1, updated: 1 });
    expect(extract).toHaveBeenCalledTimes(2);
    // Still the one Gmail room, matched again rather than duplicated.
    expect(store.segments.size).toBe(1);
  });

  it("keeps a booking a cancellation kept when its event comes back changed", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => flight);
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]), deps(store, extract), 100);
    const [segment] = [...store.segments.values()];
    store.segments.set(segment!.id, { ...segment!, title: "Edited", updatedAt: "2026-11-05T00:00:00Z" });
    const cancelled = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["STATUS:CANCELLED"])]);
    expect(await importCalendar("u1", cancelled, deps(store, extract), 100)).toMatchObject({ removed: 0 });
    const back = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Reinstated"])]);
    expect(await importCalendar("u1", back, deps(store, extract), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect(extract).toHaveBeenCalledTimes(1);
    expect([...store.segments.values()].map((seg) => seg.title)).toEqual(["Edited"]);
  });

  it("leaves a booking the user moved to another trip, or deleted, when its event changes", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => flight);
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]), deps(store, extract), 100);
    const [segment] = [...store.segments.values()];
    // Moved: the same booking now sits in another trip.
    store.segments.clear();
    store.segments.set(segment!.id, { ...segment!, tripId: "elsewhere" });
    const moved = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Moved"])]);
    expect(await importCalendar("u1", moved, deps(store, extract), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect(extract).toHaveBeenCalledTimes(1);
    expect([...store.segments.values()].map((seg) => seg.tripId)).toEqual(["elsewhere"]);
    // Deleted: nothing comes back either.
    store.segments.clear();
    const again = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Moved again"])]);
    expect(await importCalendar("u1", again, deps(store, extract), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect(store.segments.size).toBe(0);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("reads a changed event that was not a booking, and takes a record from before revisions as the baseline", async () => {
    const store = memoryStore();
    let answer: typeof flight | { isBooking: false; segments: [] } = { isBooking: false, segments: [] };
    const extract = vi.fn(async () => answer);
    await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB")]), deps(store, extract), 100);
    answer = flight;
    const confirmed = ics("-//TripIt//EN", [vevent("e1", "FR123 MAN to DUB", ["DESCRIPTION:Booking confirmed"])]);
    expect(await importCalendar("u1", confirmed, deps(store, extract), 100)).toMatchObject({ imported: 1, updated: 1 });
    // A record read before revisions existed is not read again for having none.
    const record = [...store.parsed.values()][0]!;
    const { revision: _r, ...legacy } = record;
    await store.setParsed(legacy);
    expect(await importCalendar("u1", confirmed, deps(store, extract), 100)).toMatchObject({ skipped: 1, updated: 0 });
    expect([...store.parsed.values()][0]?.revision).toBe(record.revision);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("reads every event of a TripIt calendar, whatever its title", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    const counts = await importCalendar("u1", ics("-//TripIt//EN", [vevent("e1", "Cove Liverpool")]), deps(store, extract), 100);
    expect(counts.imported).toBe(1);
  });
});

describe("fileBooking geocoding", () => {
  const stay: ExtractedBooking = {
    isBooking: true,
    segments: [{ type: "lodging", title: "Hotel Example", start: "2026-12-12T15:00:00+00:00", end: "2026-12-14T11:00:00+00:00", destination: { name: "Hotel Example", city: "Exampleville" } }],
  };
  const codedFlight: ExtractedBooking = {
    isBooking: true,
    segments: [{ type: "flight", title: "XX 1 MAN to DUB", start: "2026-12-15T08:00:00+00:00", origin: { name: "Manchester", code: "MAN" }, destination: { name: "Dublin", code: "DUB" } }],
  };

  it("fills a place's country and spot from the geocoder before writing, asking once per place", async () => {
    const store = memoryStore();
    const asked: [string, string][] = [];
    const d: ImportDeps = {
      ...deps(store, async () => stay),
      geocode: async (query, need) => {
        asked.push([query, need]);
        return { country: "FR", city: "Exampleville", lat: 48.5, lon: 2.25 };
      },
    };
    expect(await importMessage("u1", email(), d)).toBe("imported");
    expect([...store.segments.values()][0]!.destination).toEqual({ name: "Hotel Example", city: "Exampleville", country: "FR", lat: 48.5, lon: 2.25 });
    expect(asked).toEqual([["Hotel Example, Exampleville", "country"]]);
  });

  it("asks only where a place is when its source named the country", async () => {
    const store = memoryStore();
    const asked: [string, string][] = [];
    const placed: ExtractedBooking = { isBooking: true, segments: [{ ...stay.segments[0]!, destination: { name: "Hotel Example", city: "Exampleville", country: "FR" } }] };
    const d: ImportDeps = { ...deps(store, async () => placed), geocode: async (query, need) => (asked.push([query, need]), { country: "FR", lat: 48.5, lon: 2.25 }) };
    expect(await importMessage("u1", email(), d)).toBe("imported");
    expect([...store.segments.values()][0]!.destination).toEqual({ name: "Hotel Example", city: "Exampleville", country: "FR", lat: 48.5, lon: 2.25 });
    expect(asked).toEqual([["Hotel Example, Exampleville, FR", "location"]]);
  });

  it("still imports when the geocoder fails, and leaves places alone without one", async () => {
    const failing = memoryStore();
    const d: ImportDeps = {
      ...deps(failing, async () => stay),
      geocode: async () => {
        throw new Error("REQUEST_DENIED");
      },
    };
    expect(await importMessage("u1", email(), d)).toBe("imported");
    expect([...failing.segments.values()][0]!.destination).toEqual({ name: "Hotel Example", city: "Exampleville" });
    const plain = memoryStore();
    await importMessage("u1", email(), deps(plain, async () => stay));
    expect([...plain.segments.values()][0]!.destination).toEqual({ name: "Hotel Example", city: "Exampleville" });
  });

  it("queues a booking for the daily sweep when the budget put its lookup off", async () => {
    const store = memoryStore();
    const retries = memoryRetryStore();
    const d: ImportDeps = { ...deps(store, async () => stay), geocode: async () => "later", geocodeRetries: retries };
    expect(await importMessage("u1", email(), d)).toBe("imported");
    const segment = [...store.segments.values()][0]!;
    expect(segment.destination).toEqual({ name: "Hotel Example", city: "Exampleville" });
    expect([...retries.entries.values()]).toEqual([{ uid: "u1", tripId: segment.tripId, segmentId: segment.id, at: "2026-11-01T12:00:00Z" }]);
    // Answered, nothing is queued; nor without a queue.
    const answered = memoryStore();
    const none = memoryRetryStore();
    await importMessage("u1", email({ id: "m3" }), { ...deps(answered, async () => stay), geocode: async () => "none", geocodeRetries: none });
    expect(none.entries.size).toBe(0);
  });

  it("queues a receipt upgraded by a booking whose place lookup was put off", async () => {
    const store = memoryStore();
    const retries = memoryRetryStore();
    const provider = "Example Academy of Performing Arts";
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Stage Stars Holiday Club payment", provider, start: "2026-12-14T00:00:00+00:00" }],
    };
    const club: ExtractedBooking = {
      isBooking: true,
      segments: [
        {
          type: "activity",
          title: "Stage Stars! Holiday Club - Day 1",
          provider,
          start: "2026-12-21T09:00:00+00:00",
          end: "2026-12-21T15:00:00+00:00",
          destination: { name: "Example Academy", city: "Exampleville" },
        },
      ],
    };
    await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), deps(store, async () => receipt));
    const d: ImportDeps = { ...deps(store, async () => club), geocode: async () => "later", geocodeRetries: retries };
    await importMessage("u1", email({ id: "m-club", subject: "Booking confirmed: Stage Stars!" }), d);
    const upgraded = store.segments.get("m-paid-0")!;
    expect(upgraded.destination).toEqual({ name: "Example Academy", city: "Exampleville" });
    expect(upgraded.updatedAt).toBe(upgraded.createdAt);
    expect([...retries.entries.values()]).toEqual([{ uid: "u1", tripId: upgraded.tripId, segmentId: "m-paid-0", at: "2026-11-01T12:00:00Z" }]);
  });

  it("upgrades no receipt, moves no trip and queues no place for a booking the trips' reset overtook", async () => {
    const store = memoryStore();
    const retries = memoryRetryStore();
    const provider = "Example Academy of Performing Arts";
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Stage Stars Holiday Club payment", provider, start: "2026-12-14T00:00:00+00:00" }],
    };
    const club: ExtractedBooking = {
      isBooking: true,
      segments: [
        {
          type: "activity",
          title: "Stage Stars! Holiday Club - Day 1",
          provider,
          start: "2026-12-21T09:00:00+00:00",
          destination: { name: "Example Academy", city: "Exampleville" },
        },
      ],
    };
    await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), deps(store, async () => receipt));
    const before = { segment: store.segments.get("m-paid-0"), trips: [...store.trips.values()] };
    // The reset moves the generation on while the model reads the booking.
    const overtaken: ImportDeps["extract"] = async () => {
      await store.withUserLock("u1", async (tx) => tx.bumpGeneration());
      return club;
    };
    await importMessage("u1", email({ id: "m-club", subject: "Booking confirmed: Stage Stars!" }), {
      ...deps(store, overtaken),
      geocode: async () => "later",
      geocodeRetries: retries,
    }).catch(() => undefined);
    expect(store.segments.get("m-paid-0")).toEqual(before.segment);
    expect([...store.trips.values()]).toEqual(before.trips);
    expect(retries.entries.size).toBe(0);
  });

  it("upgrades a receipt a second receipt filled out, once the booking arrives", async () => {
    const store = memoryStore();
    const provider = "Example Academy of Performing Arts";
    const paid = { type: "activity" as const, title: "Stage Stars Holiday Club payment", provider, start: "2026-12-14T00:00:00+00:00" };
    const receipt: ExtractedBooking = { isBooking: true, segments: [paid] };
    const invoice: ExtractedBooking = { isBooking: true, segments: [{ ...paid, title: "Stage Stars Holiday Club invoice", confirmation: "INV-88" }] };
    const club: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Stage Stars! Holiday Club - Day 1", provider, start: "2026-12-21T09:00:00+00:00", end: "2026-12-21T15:00:00+00:00" }],
    };
    // Each import at its own time, as in the mailbox.
    const at = (time: string, extract: ImportDeps["extract"]): ImportDeps => ({ ...deps(store, extract), now: () => time });
    await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), at("2026-11-01T12:00:00Z", async () => receipt));
    await importMessage("u1", email({ id: "m-invoice", subject: "Your invoice and booking confirmation" }), at("2026-11-02T12:00:00Z", async () => invoice));
    expect(store.segments.get("m-paid-0")).toMatchObject({ confirmation: "INV-88" });
    await importMessage("u1", email({ id: "m-club", subject: "Booking confirmed: Stage Stars!" }), at("2026-11-03T12:00:00Z", async () => club));
    expect(store.segments.size).toBe(1);
    expect(store.segments.get("m-paid-0")).toMatchObject({ title: "Stage Stars! Holiday Club - Day 1", start: "2026-12-21T09:00:00+00:00", confirmation: "INV-88" });
    expect(store.segments.get("m-paid-0")?.sources?.map((source) => source.id)).toEqual(["m-paid", "m-invoice", "m-club"]);
  });

  it("leaves a receipt the user edited as they wrote it", async () => {
    const store = memoryStore();
    const provider = "Example Academy of Performing Arts";
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Stage Stars Holiday Club payment", provider, start: "2026-12-14T00:00:00+00:00" }],
    };
    const club: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Stage Stars! Holiday Club - Day 1", provider, start: "2026-12-21T09:00:00+00:00" }],
    };
    await importMessage("u1", email({ id: "m-paid", subject: "New Payment Confirmation" }), deps(store, async () => receipt));
    const filed = store.segments.get("m-paid-0")!;
    store.segments.set(filed.id, { ...filed, notes: "Pack lunch", updatedAt: "2026-11-01T13:00:00Z" });
    await importMessage("u1", email({ id: "m-club", subject: "Booking confirmed: Stage Stars!" }), deps(store, async () => club));
    expect(store.segments.get("m-paid-0")).toMatchObject({ title: "Stage Stars Holiday Club payment", notes: "Pack lunch" });
    expect(store.segments.get("m-paid-0")?.sources?.map((source) => source.id)).toEqual(["m-paid", "m-club"]);
  });

  it("still counts the import as done when the retry queue cannot be written, and logs why", async () => {
    const store = memoryStore();
    const logs: [string, Record<string, unknown>][] = [];
    const broken = { ...memoryRetryStore(), put: async () => Promise.reject(new Error("queue unavailable")) };
    const d: ImportDeps = { ...deps(store, async () => stay), geocode: async () => "later", geocodeRetries: broken, log: (e, f) => logs.push([e, f]) };
    expect(await importMessage("u1", email(), d)).toBe("imported");
    expect(store.segments.size).toBe(1);
    expect(store.parsed.get("u1/m1")?.outcome).toBe("imported");
    expect(logs.find(([e]) => e === "geocode_retry_queue_failed")?.[1]).toMatchObject({ uid: "u1", reason: "queue unavailable" });
  });

  it("gives a flight's airports their country and spot from the table without asking", async () => {
    const store = memoryStore();
    const asked: string[] = [];
    const d: ImportDeps = { ...deps(store, async () => codedFlight), geocode: async (q) => (asked.push(q), "none") };
    await importMessage("u1", email({ id: "m2", subject: "Your flight" }), d);
    const segment = [...store.segments.values()][0]!;
    expect(segment.origin).toMatchObject({ name: "Manchester", code: "MAN", country: "GB" });
    expect(segment.destination).toMatchObject({ name: "Dublin", code: "DUB", country: "IE" });
    for (const p of [segment.origin!, segment.destination!]) {
      expect(typeof p.lat).toBe("number");
      expect(typeof p.lon).toBe("number");
    }
    expect(asked).toEqual([]);
  });
});

// The May 2026 bookings that came in as one "London" trip: a holiday club at
// home either side of a weekend in Liverpool, booked as a return train.
describe("fileBooking with home known", () => {
  const academy = { name: "Fixation Academy of Performing Arts", city: "London", country: "GB" };
  const euston = { name: "London Euston", code: "EUS", city: "London", country: "GB" };
  const limeStreet = { name: "Liverpool Lime Street", code: "LIV", city: "Liverpool", country: "GB" };
  const club22: ExtractedSegment = { type: "activity", title: "Eva Ward's Stage Stars! Holiday Club", start: "2026-05-22T00:00:00+01:00", destination: academy };
  const club26: ExtractedSegment = {
    type: "activity",
    title: "Stage Stars! Holiday Club - Day 1",
    start: "2026-05-26T09:00:00+01:00",
    end: "2026-05-26T16:00:00+01:00",
    destination: academy,
  };
  const trains: ExtractedSegment[] = [
    { type: "train", title: "Avanti West Coast London Euston to Liverpool Lime Street", start: "2026-05-23T12:07:00+01:00", end: "2026-05-23T14:23:00+01:00", origin: euston, destination: limeStreet },
    { type: "train", title: "Avanti West Coast Liverpool Lime Street to London Euston", start: "2026-05-25T11:43:00+01:00", end: "2026-05-25T14:03:00+01:00", origin: limeStreet, destination: euston },
  ];
  const file = (store: Memory, sourceId: string, segments: ExtractedSegment[]) =>
    fileBooking("u1", { sourceId, source: "gmail", segments }, deps(store, async () => ({ isBooking: false, segments: [] })));
  const titles = (store: Memory) =>
    [...store.trips.values()].map((t) => `${t.title} ${t.start}..${t.end}`).sort();

  it.each([
    ["newest first", [["c26", [club26]], ["tr", trains], ["c22", [club22]]]],
    ["oldest first", [["c22", [club22]], ["tr", trains], ["c26", [club26]]]],
  ] as const)("keeps days out at home apart from the trip away, read %s", async (_, order) => {
    const store = memoryStore();
    for (const [id, segments] of order) await file(store, id, [...segments]);
    expect(titles(store)).toEqual([
      "Eva Ward's Stage Stars! Holiday Club 2026-05-22..2026-05-22",
      "Liverpool 2026-05-23..2026-05-25",
      "Stage Stars! Holiday Club - Day 1 2026-05-26..2026-05-26",
    ]);
  });

  it("names a trip away after where it goes, even from its return leg alone", async () => {
    const store = memoryStore();
    await file(store, "tr", trains);
    await file(store, "back", [{ ...trains[1]!, start: "2026-07-05T11:43:00+01:00", end: "2026-07-05T14:03:00+01:00" }]);
    expect(titles(store)).toContain("Liverpool 2026-07-05..2026-07-05");
  });

  it("keeps a stay in the destination with its trains", async () => {
    const store = memoryStore();
    await file(store, "tr", trains);
    await file(store, "hotel", [
      { type: "lodging", title: "Hotel", start: "2026-05-23T15:00:00+01:00", end: "2026-05-25T11:00:00+01:00", destination: { name: "Hotel", city: "Liverpool", country: "GB" } },
    ]);
    expect(titles(store)).toEqual(["Liverpool 2026-05-23..2026-05-25"]);
  });

  it("keeps a journey out of a day out the day before while home is unknown", async () => {
    const store = memoryStore();
    await file(store, "c22", [club22]);
    await file(store, "out", [trains[0]!]);
    expect(store.trips.size).toBe(2);
  });
});

describe("fileBooking a summer of camps and trips", () => {
  // What production filed as one "Tower of London" trip from 10 Aug to
  // 13 Nov: a day camp and a course at home, a trip to Stockholm, one to
  // Boston, and a day at the Tower.
  const gb = (name: string, city: string) => ({ name, city, country: "GB" });
  const camp: ExtractedSegment[] = [1, 2, 3, 4, 5].map((n) => ({
    type: "activity",
    title: `Holiday Camp East Finchley - Junior Group (Day ${n})`,
    start: `2026-08-${9 + n}T09:00:00+01:00`,
    end: `2026-08-${9 + n}T17:00:00+01:00`,
    destination: gb("N2 9JP", "London"),
  }));
  const car: ExtractedSegment = {
    type: "other",
    title: "Abetta car to Stansted Airport",
    start: "2026-08-15T10:30:00+01:00",
    origin: gb("N10 3AR", "London"),
    destination: { ...gb("Stansted Airport", "Stansted"), code: "STN" },
  };
  const express: ExtractedSegment = {
    type: "train",
    title: "Arlanda Express Stockholm → Stockholm",
    start: "2026-08-15T13:28:00+02:00",
    end: "2026-11-13T23:59:00+01:00",
    origin: { name: "Stockholm Arlanda Airport", city: "Stockholm", country: "SE" },
    destination: { name: "Stockholm Central", city: "Stockholm", country: "SE" },
  };
  const course: ExtractedSegment = {
    type: "activity",
    title: "5 Day Summer Holiday Course: Peter Pan",
    start: "2026-08-24T09:30:00+01:00",
    end: "2026-08-28T15:30:00+01:00",
    destination: gb("N10 3BG", "Muswell Hill"),
  };
  const boston: ExtractedSegment[] = [
    {
      type: "flight",
      title: "VS157 LHR to BOS",
      start: "2026-08-25T11:20:00+01:00",
      end: "2026-08-25T13:50:00-04:00",
      origin: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
      destination: { name: "Logan", code: "BOS", city: "Boston", country: "US" },
    },
    {
      type: "flight",
      title: "VS158 BOS to LHR",
      start: "2026-09-04T19:00:00-04:00",
      end: "2026-09-05T06:30:00+01:00",
      origin: { name: "Logan", code: "BOS", city: "Boston", country: "US" },
      destination: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
    },
  ];
  const tower: ExtractedSegment = { type: "activity", title: "Tower of London Admission", start: "2026-11-01T10:00:00+00:00", destination: gb("Tower of London", "London") };
  const bookings: [string, ExtractedSegment[]][] = [
    ["camp", camp],
    ["car", [car]],
    ["express", [express]],
    ["course", [course]],
    ["boston", boston],
    ["tower", [tower]],
  ];
  const file = (store: Memory, sourceId: string, segments: ExtractedSegment[]) =>
    fileBooking("u1", { sourceId, source: "gmail", segments }, deps(store, async () => ({ isBooking: false, segments: [] })));
  const trips = (store: Memory) =>
    [...store.trips.values()]
      .map((t) => ({
        start: t.start,
        end: t.end,
        bookings: [...new Set([...store.segments.values()].filter((s) => s.tripId === t.id).map((s) => s.id.replace(/-\d+$/, "")))].sort(),
      }))
      .sort((a, b) => a.start.localeCompare(b.start));

  it.each([
    ["oldest first", bookings],
    ["newest first", [...bookings].reverse()],
    ["the tower first", [bookings[5]!, ...bookings.slice(0, 5)]],
  ])("keeps the outings at home apart from both trips, read %s", async (_, order) => {
    const store = memoryStore();
    for (const [id, segments] of order) await file(store, id, segments);
    expect(trips(store)).toEqual([
      { start: "2026-08-10", end: "2026-08-14", bookings: ["camp"] },
      { start: "2026-08-15", end: "2026-08-15", bookings: ["car", "express"] },
      { start: "2026-08-24", end: "2026-08-28", bookings: ["course"] },
      { start: "2026-08-25", end: "2026-09-05", bookings: ["boston"] },
      { start: "2026-11-01", end: "2026-11-01", bookings: ["tower"] },
    ]);
  });
});

describe("fileBooking a return flight booked alone", () => {
  const museum: ExtractedSegment = {
    type: "activity",
    title: "Vasa Museum",
    start: "2026-08-21T11:00:00+02:00",
    destination: { name: "Vasa Museum", city: "Stockholm", country: "SE" },
  };
  const back: ExtractedSegment = {
    type: "flight",
    title: "SK 1529 ARN to LHR",
    start: "2026-08-22T08:00:00+02:00",
    end: "2026-08-22T09:50:00+01:00",
    origin: { name: "Arlanda", code: "ARN", city: "Stockholm", country: "SE" },
    destination: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
  };
  const london = async () => [{ city: "London", country: "GB", from: "2020-01-01" }];

  it.each([
    ["the museum first", [["museum", museum], ["back", back]]],
    ["the flight first", [["back", back], ["museum", museum]]],
  ] as const)("keeps a museum in the town it leaves from in its trip, read %s", async (_, order) => {
    const store = memoryStore();
    for (const [id, segment] of order) {
      await fileBooking("u1", { sourceId: id, source: "gmail", segments: [segment] }, { ...deps(store, async () => ({ isBooking: false, segments: [] })), homeOverrides: london });
    }
    expect([...store.trips.values()].map((t) => `${t.start}..${t.end}`)).toEqual(["2026-08-21..2026-08-22"]);
  });
});

describe("fileBooking one showing confirmed twice", () => {
  const film: ExtractedSegment = {
    type: "activity",
    title: "Wild Horse Nine at Muswell Hill",
    provider: "Everyman Cinemas",
    confirmation: "615858",
    start: "2026-11-08T12:00:00+00:00",
    destination: { name: "Everyman Muswell Hill", city: "London", country: "GB" },
    notes: "Screen 3, seats C8 and C7",
  };
  const reservation: ExtractedSegment = {
    type: "activity",
    title: "Wild Horse Nine at Everyman Muswell Hill",
    provider: "Everyman",
    confirmation: "WQFXR5T",
    start: "2026-11-08T12:00:00+00:00",
    destination: { name: "Everyman", city: "London", country: "GB" },
  };
  const club: ExtractedSegment = {
    type: "activity",
    title: "Junior Adventures Group Club",
    provider: "Junior Adventures Group",
    confirmation: "PSAD8686493/38",
    start: "2026-11-09T12:02:00+00:00",
    destination: { name: "BR1 2SQ", city: "Bromley", country: "GB" },
  };
  const file = (store: Memory, sourceId: string, segments: ExtractedSegment[], sender?: string) =>
    fileBooking("u1", { sourceId, source: "gmail", segments, ...(sender ? { sender } : {}) }, deps(store, async () => ({ isBooking: false, segments: [] })));

  it.each([
    ["the confirmation first", [["615858", [film]], ["WQFXR5T", [reservation]], ["club", [club]]]],
    ["the club first", [["club", [club]], ["WQFXR5T", [reservation]], ["615858", [film]]]],
  ] as const)("keeps one booking with its seats and a day out of its own each, read %s", async (_, order) => {
    const store = memoryStore();
    for (const [id, segments] of order) await file(store, id, [...segments], id === "club" ? "junioradventures.example" : "everymancinema.com");
    const films = [...store.segments.values()].filter((s) => s.title.startsWith("Wild Horse Nine"));
    expect(films).toHaveLength(1);
    expect(films[0]!.notes).toContain("Screen 3, seats C8 and C7");
    expect(films[0]!.sources?.map((s) => s.id).sort()).toEqual(["615858", "WQFXR5T"]);
    expect([...store.trips.values()].map((t) => `${t.start} ${t.title}`).sort()).toEqual([
      expect.stringMatching(/^2026-11-08 Wild Horse Nine at /),
      "2026-11-09 Junior Adventures Group Club",
    ]);
  });

  it("stretches the trip when the second email gives the end the first lacked", async () => {
    const store = memoryStore();
    const stay = lodging.segments[0]!;
    const { end: _end, ...open } = stay;
    await file(store, "first", [open], "cove.example");
    expect([...store.trips.values()][0]).toMatchObject({ start: "2026-12-12", end: "2026-12-12" });
    await file(store, "second", [{ ...stay, end: "2026-12-16T11:00:00+00:00", confirmation: "C1" }], "cove.example");
    expect(store.segments.size).toBe(1);
    expect([...store.trips.values()][0]).toMatchObject({ start: "2026-12-12", end: "2026-12-16", updatedAt: "2026-11-01T12:00:00Z" });
  });

  it("queues the booking for the daily sweep when the place the second email adds is put off", async () => {
    const store = memoryStore();
    const { destination: _d, ...placeless } = film;
    await file(store, "615858", [placeless], "everymancinema.com");
    const retries = memoryRetryStore();
    await fileBooking(
      "u1",
      { sourceId: "WQFXR5T", source: "gmail", segments: [reservation], sender: "everymancinema.com" },
      { ...deps(store, async () => ({ isBooking: false, segments: [] })), geocode: async () => "later", geocodeRetries: retries },
    );
    const kept = [...store.segments.values()];
    expect(kept).toHaveLength(1);
    expect(kept[0]!.destination).toEqual(reservation.destination);
    expect([...retries.entries.values()]).toEqual([{ uid: "u1", tripId: kept[0]!.tripId, segmentId: kept[0]!.id, at: "2026-11-01T12:00:00Z" }]);
  });

  it("files one booking for an event confirmed twice and paid for, matched once each", async () => {
    const store = memoryStore();
    const paid: ExtractedSegment = {
      type: "activity",
      title: "Wild Horse Nine payment",
      provider: "Everyman Cinemas",
      start: "2026-11-01T00:00:00+00:00",
      destination: { name: "Everyman Muswell Hill", city: "London", country: "GB" },
    };
    const elsewhere: ExtractedSegment = { ...paid, destination: { name: "Everyman Hampstead", city: "London", country: "GB" } };
    await file(store, "615858", [film], "everymancinema.com");
    await file(store, "WQFXR5T", [reservation], "everymancinema.com");
    await file(store, "paid", [paid], "everymancinema.com");
    await file(store, "hampstead", [elsewhere], "everymancinema.com");
    const films = [...store.segments.values()].filter((s) => s.title.startsWith("Wild Horse Nine"));
    expect(films.map((s) => s.title)).toEqual(["Wild Horse Nine at Muswell Hill", "Wild Horse Nine payment"]);
    expect(films[0]!.sources?.map((s) => s.id)).toEqual(["615858", "WQFXR5T", "paid"]);
  });

  it("keeps two films at the same time apart", async () => {
    const store = memoryStore();
    await file(store, "a", [film], "everymancinema.com");
    await file(store, "b", [{ ...reservation, title: "Toy Story 5 at Everyman Muswell Hill" }], "everymancinema.com");
    expect(store.segments.size).toBe(2);
  });
});

// A car home from Heathrow after a flight from New York, which was filed as
// a trip of its own named after home.
describe("fileBooking with a ride from the airport", () => {
  const lhr = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
  const jfk = { name: "John F. Kennedy International", code: "JFK", city: "New York", country: "US" };
  const cdg = { name: "Paris Charles de Gaulle", code: "CDG", city: "Paris", country: "FR" };
  const homeAddress = { name: "1 Example Road, London N1 1AA", city: "London", country: "GB" };
  const flights: ExtractedSegment[] = [
    { type: "flight", title: "BA 117", start: "2026-07-10T08:25:00+01:00", end: "2026-07-10T11:10:00-04:00", origin: lhr, destination: jfk },
    { type: "flight", title: "BA 112", start: "2026-07-22T18:30:00-04:00", end: "2026-07-23T06:35:00+01:00", origin: jfk, destination: lhr },
  ];
  const paris: ExtractedSegment[] = [
    { type: "flight", title: "AF 1081", start: "2026-03-06T07:00:00+00:00", end: "2026-03-06T09:15:00+01:00", origin: lhr, destination: cdg },
    { type: "flight", title: "AF 1180", start: "2026-03-09T19:00:00+01:00", end: "2026-03-09T19:20:00+00:00", origin: cdg, destination: lhr },
  ];
  const ride: ExtractedSegment = {
    type: "car_rental",
    title: "Abetta Car from Heathrow Terminal 3 to London",
    start: "2026-07-23T15:27:00+01:00",
    origin: { name: "Heathrow Terminal 3 - LHR, TW6 1SX", city: "London", country: "GB" },
    destination: homeAddress,
  };
  const file = (store: Memory, sourceId: string, segments: ExtractedSegment[]) =>
    fileBooking("u1", { sourceId, source: "gmail", segments }, deps(store, async () => ({ isBooking: false, segments: [] })));
  const titles = (store: Memory) =>
    [...store.trips.values()].map((t) => `${t.title} ${t.start}..${t.end}`).sort();

  it.each([
    ["after", [["flights", flights], ["ride", [ride]]]],
    ["before", [["ride", [ride]], ["flights", flights]]],
  ] as const)("files the ride with the flight it meets, read %s it", async (_, order) => {
    const store = memoryStore();
    for (const [id, segments] of order) await file(store, id, [...segments]);
    expect(titles(store)).toEqual(["New York 2026-07-10..2026-07-23"]);
  });

  it("names a ride with no flight by its route", async () => {
    const store = memoryStore();
    await file(store, "paris", paris);
    await file(store, "ride", [ride]);
    expect(titles(store)).toEqual(["Heathrow to home 2026-07-23..2026-07-23", "Paris 2026-03-06..2026-03-09"]);
  });

  it("keeps a renamed ride's name when the flight joins it", async () => {
    const store = memoryStore();
    const { tripId } = await file(store, "ride", [ride]);
    store.trips.set(tripId!, { ...store.trips.get(tripId!)!, title: "Home from New York" });
    await file(store, "flights", flights);
    expect(titles(store)).toEqual(["Home from New York 2026-07-10..2026-07-23"]);
  });

  it("still keeps a car hired at home out of the trip away", async () => {
    const store = memoryStore();
    await file(store, "flights", flights);
    const where = { name: "Hertz Islington", city: "London", country: "GB" };
    await file(store, "hire", [{ type: "car_rental", title: "Hertz", start: "2026-07-24T09:00:00+01:00", end: "2026-07-24T18:00:00+01:00", origin: where, destination: where }]);
    expect(titles(store)).toEqual(["London 2026-07-24..2026-07-24", "New York 2026-07-10..2026-07-23"]);
  });
});

// A week in Melbourne as one user's emails gave it (invented references):
// two emails for one St Kilda stay, a flight in, a terrace whose place has
// no town, and a car back to the airport.
describe("fileBooking a week in Melbourne", () => {
  const listing = "Best balcony in St Kilda & Entire apartment.";
  const requested: ExtractedSegment = {
    type: "lodging",
    title: listing,
    provider: "Airbnb",
    start: "2025-12-26T15:00:00+11:00",
    end: "2025-12-27T10:00:00+11:00",
    destination: { name: listing, city: "Melbourne", country: "AU" },
  };
  const confirmed: ExtractedSegment = {
    ...requested,
    confirmation: "HMEXAMPLE01",
    destination: { name: listing, address: "1 Example Street, St Kilda VIC 3182, Australia", city: "St Kilda", country: "AU" },
  };
  const flightIn: ExtractedSegment = {
    type: "flight",
    title: "VA 234",
    provider: "Virgin Australia",
    start: "2025-12-26T16:50:00+10:30",
    end: "2025-12-26T18:40:00+11:00",
    origin: { name: "Adelaide", code: "ADL", city: "Adelaide", country: "AU" },
    destination: { name: "Melbourne", code: "MEL", city: "Melbourne", country: "AU" },
  };
  const terrace: ExtractedSegment = {
    type: "lodging",
    title: "Designer Collingwood Terrace",
    provider: "Airbnb",
    confirmation: "HMEXAMPLE02",
    start: "2025-12-27T15:00:00+11:00",
    end: "2025-12-30T10:00:00+11:00",
    destination: { name: "Designer Collingwood Terrace" },
  };
  const car: ExtractedSegment = {
    type: "car_rental",
    title: "Avis",
    provider: "Avis",
    confirmation: "EXAMPLE123",
    start: "2025-12-30T12:00:00+11:00",
    end: "2026-01-02T12:00:00+11:00",
    origin: { name: "South Yarra, 650 Chapel Street" },
    destination: { name: "Melbourne Tullamarine Airport arrivals" },
  };
  const file = (store: Memory, sourceId: string, segments: ExtractedSegment[]) =>
    fileBooking("u1", { sourceId, source: "gmail", segments }, deps(store, async () => ({ isBooking: false, segments: [] })));
  const titles = (store: Memory) => [...store.trips.values()].map((t) => `${t.title} ${t.start}..${t.end}`);

  it("names the trip after the town the flight goes to, not a stay with no town", () => {
    expect(tripTitle([terrace, flightIn])).toBe("Melbourne");
    expect(tripTitle([requested, flightIn, terrace, car])).toBe("Melbourne");
    expect(tripTitle([confirmed, flightIn])).toBe("Melbourne");
    // Whatever order they come in, the first journey by date names it.
    const onToSydney: ExtractedSegment = {
      ...flightIn,
      title: "VA 800",
      start: "2025-12-31T09:00:00+11:00",
      end: "2025-12-31T10:30:00+11:00",
      origin: flightIn.destination,
      destination: { name: "Sydney", code: "SYD", city: "Sydney", country: "AU" },
    };
    expect(tripTitle([onToSydney, terrace, flightIn])).toBe("Melbourne");
    expect(placeTitle([onToSydney, flightIn])).toBe("Melbourne");
    // Nothing else to go on: the stay's own name, not "Trip".
    expect(tripTitle([terrace])).toBe("Designer Collingwood Terrace");
  });

  it("renames a trip the terrace started once the flight joins it", async () => {
    const store = memoryStore();
    for (const [id, segments] of [["terrace", [terrace]], ["car", [car]], ["flight", [flightIn]], ["requested", [requested]]] as const) {
      await file(store, id, [...segments]);
    }
    expect(titles(store)).toEqual(["Melbourne 2025-12-26..2026-01-02"]);
  });

  it("keeps a name the user gave the trip", async () => {
    const store = memoryStore();
    const { tripId } = await file(store, "terrace", [terrace]);
    store.trips.set(tripId!, { ...store.trips.get(tripId!)!, title: "Christmas away" });
    await file(store, "flight", [flightIn]);
    expect(titles(store)).toEqual(["Christmas away 2025-12-26..2025-12-30"]);
  });

  it("renames a trip named after a stay once another email for it gives the town", async () => {
    const store = memoryStore();
    await file(store, "terrace", [terrace]);
    const placed = { ...terrace, destination: { name: "Designer Collingwood Terrace", address: "2 Example Lane, Collingwood VIC 3066, Australia", city: "Collingwood", country: "AU" } };
    await file(store, "terrace-again", [placed]);
    expect(titles(store)).toEqual(["Collingwood 2025-12-27..2025-12-30"]);
    expect(store.segments.size).toBe(1);
  });

  it.each([
    ["with", true],
    ["without", false],
  ] as const)("names the trip from its bookings as merged, %s a new booking in the same email", async (_, withLoft) => {
    const loft: ExtractedSegment = {
      type: "lodging",
      title: "Harbour Loft",
      provider: "Airbnb",
      confirmation: "HMEXAMPLE03",
      start: "2025-12-27T15:00:00+11:00",
      end: "2025-12-28T10:00:00+11:00",
      destination: { name: "Harbour Loft", city: "St Kilda", country: "AU" },
    };
    const store = memoryStore();
    await file(store, "requested", [requested]);
    expect(titles(store)).toEqual(["Melbourne 2025-12-26..2025-12-27"]);
    await file(store, "confirmed", withLoft ? [confirmed, loft] : [confirmed]);
    expect(titles(store)).toEqual([withLoft ? "St Kilda 2025-12-26..2025-12-28" : "St Kilda 2025-12-26..2025-12-27"]);
  });

  it.each([
    ["request first", [["requested", requested], ["confirmed", confirmed]]],
    ["confirmation first", [["confirmed", confirmed], ["requested", requested]]],
  ] as const)("files a stay requested and confirmed in two emails once, %s", async (_, order) => {
    const store = memoryStore();
    await file(store, "flight", [flightIn]);
    for (const [id, segment] of order) await file(store, id, [segment]);
    const stays = [...store.segments.values()].filter((s) => s.type === "lodging");
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ confirmation: "HMEXAMPLE01", destination: confirmed.destination });
    expect(stays[0]!.sources?.map((s) => s.id).sort()).toEqual(["confirmed", "requested"]);
  });
});
