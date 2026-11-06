import type { ExtractedBooking } from "@travelmo/core";
import type { BookingCandidate, Candidate, TextCandidate } from "./candidate";
import type { EmailMessage } from "./gmail";
import {
  claimLeaseMs,
  importCandidate,
  importGroup,
  importMessage,
  importMessages,
  isDuplicate,
  maxSegmentsPerTransaction,
  reclaimable,
  resolveTrip,
  tripTitle,
  type ImportDeps,
  type TripStore,
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

  it("records Gmail imports without a source field, as before", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging));
    expect(store.parsed.get("u1/m1")).not.toHaveProperty("source");
  });
});

const structured = (over: Partial<BookingCandidate> = {}): BookingCandidate => ({
  kind: "booking",
  source: "tripit",
  id: "tripit-abc",
  subject: "Cove Liverpool",
  booking: lodging,
  tripHint: { title: "Liverpool weekend", start: "2026-12-12", end: "2026-12-14" },
  ...over,
});

const event = (over: Partial<TextCandidate> = {}): TextCandidate => ({
  kind: "text",
  source: "ics",
  id: "ics-def",
  from: "",
  subject: "Flight to Dublin",
  message: email({ id: "ics-def", from: "", subject: "Flight to Dublin", text: "FR 123 MAN to DUB 15 Dec 08:00" }),
  ...over,
});

describe("importCandidate", () => {
  it("writes a structured booking without the pre-filter or the model, marked with its source", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => flight);
    const plain: Candidate = { ...structured() };
    Reflect.deleteProperty(plain, "tripHint");
    const outcome = await importCandidate("u1", plain, deps(store, extract));
    expect(outcome).toBe("imported");
    expect(extract).not.toHaveBeenCalled();
    expect([...store.segments.values()][0]).toMatchObject({ id: "tripit-abc-0", source: "tripit", gmailMessageIds: [] });
    expect([...store.segments.values()][0]).not.toHaveProperty("sender");
    expect(store.parsed.get("u1/tripit-abc")).toMatchObject({ outcome: "imported", source: "tripit" });
    expect(store.parsed.get("u1/tripit-abc")).not.toHaveProperty("reason");
    expect([...store.trips.values()][0]).toMatchObject({ title: "Liverpool", start: "2026-12-12", end: "2026-12-14" });
  });

  it("filters a calendar event by its summary alone and reads the rest with the model", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => flight);
    const lunch = event({ id: "ics-lunch", subject: "Lunch with Sam", message: email({ id: "ics-lunch", from: "", subject: "Lunch with Sam", text: "" }) });
    expect(await importCandidate("u1", lunch, deps(store, extract))).toBe("filtered");
    expect(store.parsed.get("u1/ics-lunch")).toMatchObject({ outcome: "filtered", source: "ics", reason: "no booking signal" });
    expect(await importCandidate("u1", event(), deps(store, extract))).toBe("imported");
    expect(extract).toHaveBeenCalledTimes(1);
    expect([...store.segments.values()][0]).toMatchObject({ id: "ics-def-0", source: "ics" });
  });

  it("joins the live trip that overlaps the hint the most and widens it, else creates one with the hint's title", async () => {
    const store = memoryStore();
    await importMessage("u1", email(), deps(store, async () => lodging)); // Liverpool 12–14 Dec
    await importMessage("u1", email({ id: "m2", subject: "Your booking: Paris" }), deps(store, async () => ({
      isBooking: true,
      segments: [{ type: "lodging", title: "Hotel Paris", start: "2026-12-17T15:00:00+00:00", end: "2026-12-20T11:00:00+00:00", destination: { name: "Hotel Paris", city: "Paris", country: "FR" } }],
    })));
    expect(store.trips.size).toBe(2);
    const hinted = structured({
      id: "tripit-1",
      booking: flight,
      tripHint: { title: "Dublin hop", start: "2026-12-15", end: "2026-12-21" },
    });
    expect(await importCandidate("u1", hinted, deps(store, async () => flight))).toBe("imported");
    expect(store.trips.size).toBe(2);
    const paris = [...store.trips.values()].find((t) => t.title === "Paris")!;
    expect(paris).toMatchObject({ start: "2026-12-15", end: "2026-12-21" });
    expect([...store.segments.values()].find((s) => s.id === "tripit-1-0")?.tripId).toBe(paris.id);

    const apart = structured({ id: "tripit-2", booking: flight, tripHint: { title: "January", start: "2027-01-10", end: "2027-01-12" } });
    expect(await importCandidate("u1", apart, deps(store, async () => flight))).toBe("imported");
    expect([...store.trips.values()].find((t) => t.title === "January")).toMatchObject({ start: "2026-12-15", end: "2027-01-12" });
  });

  it("reuses a holding trip by title only, never by overlapping dates", () => {
    const trips = [
      { id: "a", title: "Liverpool", start: "2026-12-10", end: "2026-12-20", ownerUid: "u1", sharedWith: [], createdAt: "x", updatedAt: "x" },
      { id: "b", title: "Unfiled (TripIt)", start: "2020-01-01", end: "2020-01-02", ownerUid: "u1", sharedWith: [], createdAt: "x", updatedAt: "x" },
    ];
    const range = { start: "2026-12-12", end: "2026-12-13" };
    expect(resolveTrip(trips, range, { title: "Unfiled (TripIt)", start: "2026-12-12", end: "2026-12-13", merge: "title" })?.id).toBe("b");
    expect(resolveTrip(trips, range, { title: "Anything", start: "2026-12-12", end: "2026-12-13" })?.id).toBe("a");
    expect(resolveTrip(trips, range)?.id).toBe("a");
    expect(resolveTrip(trips, { start: "2027-03-01", end: "2027-03-02" })).toBeUndefined();
  });

  it("leaves out bookings the trip already holds and says which", async () => {
    const store = memoryStore();
    await importMessage("u1", email({ id: "m2", subject: "Your Ryanair itinerary" }), deps(store, async () => flight));
    const twin: ExtractedBooking = {
      isBooking: true,
      segments: [
        { ...flight.segments[0]!, title: "Ryanair FR123 Manchester to Dublin", start: "2026-12-15T08:05:00+00:00" },
        { type: "lodging", title: "Hendrick Smithfield", start: "2026-12-15T15:00:00+00:00", end: "2026-12-17T11:00:00+00:00" },
      ],
    };
    const outcome = await importCandidate("u1", structured({ id: "tripit-9", booking: twin, tripHint: { title: "Dublin", start: "2026-12-15", end: "2026-12-17" } }), deps(store, async () => twin));
    expect(outcome).toBe("imported");
    const ids = [...store.segments.keys()];
    expect(ids).toContain("tripit-9-1");
    expect(ids).not.toContain("tripit-9-0");
    expect(store.parsed.get("u1/tripit-9")?.segmentIds).toEqual(["tripit-9-1"]);

    const onlyTwin = structured({ id: "tripit-10", booking: { isBooking: true, segments: [twin.segments[0]!] }, tripHint: { title: "Dublin", start: "2026-12-15", end: "2026-12-17" } });
    expect(await importCandidate("u1", onlyTwin, deps(store, async () => twin))).toBe("filtered");
    expect(store.parsed.get("u1/tripit-10")).toMatchObject({ outcome: "filtered", reason: 'duplicates "FR 123 MAN to DUB" in Dublin' });
  });

  it("compares bookings by kind, day and route or title", () => {
    const base = flight.segments[0]!;
    expect(isDuplicate(base, { ...base, title: "Something else" })).toBe(true);
    expect(isDuplicate(base, { ...base, destination: { name: "Cork", code: "ORK" } })).toBe(false);
    expect(isDuplicate(base, { ...base, start: "2026-12-16T08:00:00+00:00" })).toBe(false);
    expect(isDuplicate(base, { ...base, type: "train" })).toBe(false);
    const stay = lodging.segments[0]!;
    expect(isDuplicate(stay, { ...stay, title: "COVE, Liverpool" })).toBe(true);
    expect(isDuplicate(stay, { ...stay, title: "Titanic Hotel" })).toBe(false);
  });
});

describe("importGroup", () => {
  const legs = (n: number, prefix: string): Candidate[] =>
    Array.from({ length: n }, (_, i) => {
      const day = String(1 + (i % 28)).padStart(2, "0");
      const month = i < 28 ? "03" : "04";
      return structured({
        id: `${prefix}-${i}`,
        booking: { isBooking: true, segments: [{ type: "activity", title: `Thing ${i}`, start: `2027-${month}-${day}T10:00:00+00:00` }] },
        tripHint: { title: "Long trip", start: "2027-03-01", end: "2027-04-30" },
      });
    });

  it("puts a trip's candidates into one trip, in as few transactions as the write limit allows", async () => {
    const store = memoryStore();
    const result = await importGroup("u1", legs(maxSegmentsPerTransaction + 1, "a"), deps(store, async () => flight));
    expect(result.counts.imported).toBe(maxSegmentsPerTransaction + 1);
    expect(result.created).toBe(true);
    expect(store.trips.size).toBe(1);
    expect(store.transactions).toBe(2);
    expect(store.segments.size).toBe(maxSegmentsPerTransaction + 1);
  });

  it("changes nothing when the same group is imported again", async () => {
    const store = memoryStore();
    const group = legs(3, "b");
    await importGroup("u1", group, deps(store, async () => flight));
    const transactions = store.transactions;
    const again = await importGroup("u1", group, deps(store, async () => flight));
    expect(again.counts).toMatchObject({ skipped: 3, imported: 0 });
    expect(store.transactions).toBe(transactions);
    expect(store.segments.size).toBe(3);
  });

  it("reads text candidates with the model and files everything into the trip", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    const group = [
      structured({ id: "c-1", booking: flight, tripHint: { title: "Mixed", start: "2026-12-12", end: "2026-12-15" } }),
      event({ id: "c-2", subject: "Hotel booking", message: email({ id: "c-2", subject: "Hotel booking" }), tripHint: { title: "Mixed", start: "2026-12-12", end: "2026-12-15" } }),
    ];
    const result = await importGroup("u1", group, deps(store, extract), { force: true });
    expect(result.counts.imported).toBe(2);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.trips.size).toBe(1);
    expect([...store.trips.values()][0]).toMatchObject({ title: "Mixed", start: "2026-12-12", end: "2026-12-15" });
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
});

describe("tripTitle", () => {
  it("prefers the destination city, then its name, then the segment title", () => {
    expect(tripTitle(lodging.segments)).toBe("Liverpool");
    expect(tripTitle([{ type: "activity", title: "Museum", start: "2026-01-01T10:00:00Z", destination: { name: "Tate" } }])).toBe("Tate");
    expect(tripTitle([{ type: "other", title: "Thing", start: "2026-01-01T10:00:00Z" }])).toBe("Thing");
  });
});
