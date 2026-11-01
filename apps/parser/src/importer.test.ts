import type { ExtractedBooking, ParsedMessage, Segment, Trip } from "@travelmo/core";
import type { EmailMessage } from "./gmail";
import {
  claimLeaseMs,
  claimable,
  reclaimable,
  importMessage,
  importMessages,
  tripTitle,
  type ImportDeps,
  type TripStore,
  type TripTx,
} from "./importer";
import { addExample, emptyExamples, minExamples, type Examples } from "./similarity";

type Memory = TripStore & {
  trips: Map<string, Trip>;
  segments: Map<string, Segment>;
  parsed: Map<string, ParsedMessage>;
  examplesOf: Map<string, Examples>;
};

function memoryStore(): Memory {
  const trips = new Map<string, Trip>();
  const segments = new Map<string, Segment>();
  const parsed = new Map<string, ParsedMessage>();
  const examplesOf = new Map<string, Examples>();
  const locks = new Map<string, Promise<unknown>>();
  let ids = 0;
  const tx: TripTx = {
    listTrips: async () => [...trips.values()],
    createTrip: (t) => {
      if (trips.has(t.id)) throw new Error(`trip ${t.id} exists`);
      trips.set(t.id, t);
    },
    extendTrip: (id, bounds) => {
      const trip = trips.get(id);
      if (!trip) throw new Error(`trip ${id} missing`);
      trips.set(id, { ...trip, ...bounds });
    },
    putSegment: (s) => void segments.set(s.id, s),
  };
  return {
    trips,
    segments,
    parsed,
    examplesOf,
    examples: async (uid) => examplesOf.get(uid) ?? emptyExamples(),
    saveExample: async (uid, label, example) => {
      examplesOf.set(uid, addExample(examplesOf.get(uid) ?? emptyExamples(), label, example));
    },
    claimMessage: async (uid, id, processedAt) => {
      const key = `${uid}/${id}`;
      if (!claimable(parsed.get(key), processedAt)) return false;
      parsed.set(key, { messageId: id, uid, outcome: "processing", segmentIds: [], processedAt });
      return true;
    },
    reclaimMessage: async (uid, id, processedAt) => {
      const key = `${uid}/${id}`;
      if (!reclaimable(parsed.get(key), processedAt)) return false;
      parsed.set(key, { messageId: id, uid, outcome: "processing", segmentIds: [], processedAt });
      return true;
    },
    setParsed: async (r) => void parsed.set(`${r.uid}/${r.messageId}`, r),
    withUserLock: (uid, fn) => {
      const run = (locks.get(uid) ?? Promise.resolve()).then(() => fn(tx));
      locks.set(uid, run.catch(() => undefined));
      return run;
    },
    senderPatterns: async () => ({ allow: [], deny: [] }),
    newId: () => `trip${++ids}`,
  };
}

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
