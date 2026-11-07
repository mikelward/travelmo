import { parseIcs, parseTripItExport, type ExtractedBooking, type ParsedMessage, type Segment, type Trip } from "@travelmo/core";
import type { EmailMessage } from "./gmail";
import {
  claimLeaseMs,
  changeClaimable,
  claimable,
  reclaimable,
  retryable,
  importCalendar,
  importMessage,
  importMessages,
  importTripIt,
  reserveByReference,
  tripItUnfiledTripId,
  tripTitle,
  type ImportDeps,
  type TripStore,
  type TripTx,
} from "./importer";
import { addExample, emptyExamples, minExamples } from "./similarity";
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

describe("importMessage", () => {
  it("creates a trip and segment from a booking email", async () => {
    const store = memoryStore();
    const outcome = await importMessage("u1", email(), deps(store, async () => lodging));
    expect(outcome).toBe("imported");
    const trip = [...store.trips.values()][0]!;
    expect(trip).toMatchObject({ title: "Liverpool", start: "2026-12-12", end: "2026-12-14", ownerUid: "u1" });
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

  it("records not_booking when the model says so", async () => {
    const store = memoryStore();
    const outcome = await importMessage("u1", email(), deps(store, async () => ({ isBooking: false, segments: [] })));
    expect(outcome).toBe("not_booking");
    expect(store.trips.size).toBe(0);
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
    expect(tripTitle([{ type: "activity", title: "Museum", start: "2026-01-01T10:00:00Z", destination: { name: "Tate" } }])).toBe("Tate");
    expect(tripTitle([{ type: "other", title: "Thing", start: "2026-01-01T10:00:00Z" }])).toBe("Thing");
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

  it("keeps the source of a booking dropped as a duplicate on the booking it matched", async () => {
    const store = memoryStore();
    await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    expect(store.segments.get("m2-0")?.sources).toEqual([
      { kind: "gmail", id: "m2", label: "Your Ryanair itinerary", uid: "u1", at: "2026-11-01T12:00:00Z" },
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

  it("fills a place's country from the geocoder before writing, asking once per place", async () => {
    const store = memoryStore();
    const asked: string[] = [];
    const d: ImportDeps = {
      ...deps(store, async () => stay),
      geocode: async (query) => {
        asked.push(query);
        return { country: "FR", city: "Exampleville" };
      },
    };
    expect(await importMessage("u1", email(), d)).toBe("imported");
    expect([...store.segments.values()][0]!.destination).toEqual({ name: "Hotel Example", city: "Exampleville", country: "FR" });
    expect(asked).toEqual(["Hotel Example, Exampleville"]);
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

  it("gives a flight's airports their country from the table without asking", async () => {
    const store = memoryStore();
    const asked: string[] = [];
    const d: ImportDeps = { ...deps(store, async () => codedFlight), geocode: async (q) => (asked.push(q), "none") };
    await importMessage("u1", email({ id: "m2", subject: "Your flight" }), d);
    const segment = [...store.segments.values()][0]!;
    expect(segment.origin).toEqual({ name: "Manchester", code: "MAN", country: "GB" });
    expect(segment.destination).toEqual({ name: "Dublin", code: "DUB", country: "IE" });
    expect(asked).toEqual([]);
  });
});
