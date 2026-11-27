import type { BackfillProgress, ExtractedBooking, ExtractedSegment, ParsedMessage, RefreshProgress, Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { continueBackfill, startBackfill, type ChainIo, type ContinueMessage } from "./backfillChain";
import { readerVersion } from "./extract";
import { GmailRateLimited, type EmailMessage } from "./gmail";
import { ImportSupersededError, type ImportDeps, type TripTx } from "./importer";
import {
  editedAtSince,
  handEdited,
  isMailboxRecord,
  readAgain,
  refreshesEverything,
  refreshEmail,
  refreshPage,
  refreshRecord,
  runRefreshBatch,
  type RecordOutcome,
  type RefreshBatchIo,
} from "./refresh";
import { memoryStore, type Memory } from "./testStore";

const uid = "u1";
// After `editedAtSince`, so a rating alone is no edit.
const filed = "2027-01-05T10:00:00Z";
const now = "2027-02-01T12:00:00Z";

// Firestore refuses a read after a write in one transaction; the memory
// store does not, so every transaction here throws on one.
const reads = new Set<string>(["listTrips", "getTrip", "listSegments", "getSegment", "listParsedIds", "listPendingCancellations", "listPeople", "connectedMailboxes"]);
function readsFirst(store: Memory): Memory {
  const withUserLock: Memory["withUserLock"] = (owner, fn) =>
    store.withUserLock(owner, (tx) => {
      let wrote: string | undefined;
      const guarded = new Proxy(tx, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (reads.has(String(key))) {
              if (wrote) throw new Error(`${String(key)} read after ${wrote} wrote`);
            } else wrote = String(key);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      }) as TripTx;
      return fn(guarded);
    });
  return Object.assign(Object.create(Object.getPrototypeOf(store)) as Memory, store, { withUserLock });
}

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({
  id,
  title: "Liverpool",
  start: "2027-03-12",
  end: "2027-03-14",
  ownerUid: uid,
  sharedWith: [],
  createdAt: filed,
  updatedAt: filed,
  ...extra,
});

const stay: ExtractedSegment = {
  type: "lodging",
  title: "Cove Liverpool",
  start: "2027-03-12T15:00:00+00:00",
  end: "2027-03-14T11:00:00+00:00",
  confirmation: "CV-55120",
  destination: { name: "Cove Liverpool", city: "Liverpool", country: "GB" },
};

const show: ExtractedSegment = {
  type: "activity",
  title: "Cavern Club Live",
  start: "2027-03-13T20:00:00+00:00",
  destination: { name: "Cavern Club", city: "Liverpool", country: "GB" },
};

const booking = (id: string, tripId: string, from: ExtractedSegment, extra: Partial<Segment> = {}): Segment => {
  const messageId = id.replace(/-\d+$/, "");
  return {
    ...from,
    id,
    tripId,
    source: "gmail",
    gmailMessageIds: [messageId],
    sources: [{ kind: "gmail", id: messageId, uid, at: filed }],
    sender: "cove.example",
    createdAt: filed,
    updatedAt: filed,
    ...extra,
  };
};

const record = (messageId: string, extra: Partial<ParsedMessage> = {}): ParsedMessage => ({
  messageId,
  uid,
  outcome: "imported",
  segmentIds: [`${messageId}-0`],
  tripId: "t1",
  processedAt: filed,
  ...extra,
});

const email = (id: string): EmailMessage => ({
  id,
  threadId: id,
  from: "Cove <stay@cove.example>",
  subject: "Your booking at Cove Liverpool",
  date: "Mon, 4 Jan 2027 10:00:00 +0000",
  listUnsubscribe: false,
  text: "Check-in 12 Mar, check-out 14 Mar",
});

function world() {
  const memory = memoryStore();
  const store = readsFirst(memory);
  const logged: string[] = [];
  const deps = (extract: ImportDeps["extract"]): ImportDeps => ({ store, extract, now: () => now, log: (event) => void logged.push(event) });
  const put = (t: Trip, ...segments: Segment[]) => {
    memory.trips.set(t.id, t);
    for (const s of segments) memory.segments.set(s.id, s);
  };
  const refresh = async (messageId: string, found: ExtractedBooking) => {
    const r = memory.parsed.get(`${uid}/${messageId}`) ?? record(messageId);
    return refreshEmail(uid, r, email(messageId), deps(async () => found), { generation: 0, snapshot: await memory.listUserSegments(uid) });
  };
  return { memory, logged, deps, put, refresh };
}

const found = (...segments: ExtractedSegment[]): ExtractedBooking => ({ isBooking: true, segments });

describe("handEdited", () => {
  it("goes by editedAt, and counts any change before it existed as an edit", () => {
    expect(handEdited({ createdAt: filed, updatedAt: filed })).toBe(false);
    expect(handEdited({ createdAt: filed, updatedAt: now, editedAt: now })).toBe(true);
    // Rated or moved since editedAt existed: not edited.
    expect(handEdited({ createdAt: filed, updatedAt: now })).toBe(false);
    // Touched before then: an edit may be what touched it.
    expect(handEdited({ createdAt: "2026-06-01T00:00:00Z", updatedAt: now })).toBe(true);
    expect(Date.parse(filed)).toBeGreaterThan(Date.parse(editedAtSince));
  });
});

describe("refreshEmail", () => {
  it("reads the email's attached PDFs, as an import does", async () => {
    const { memory, deps } = world();
    const seen: number[] = [];
    const r = record("m1");
    const message = { ...email("m1"), attachments: async () => [{ name: "ticket.pdf", mimeType: "application/pdf" as const, data: "JVBERi0=" }] };
    await refreshEmail(uid, r, message, deps(async (_m, attachments = []) => (seen.push(attachments.length), { isBooking: false, segments: [] })), { generation: 0, snapshot: await memory.listUserSegments(uid) });
    expect(seen).toEqual([1]);
  });

  it("updates an unedited booking in place, keeping its id, trip, rating and favorite mark", async () => {
    const w = world();
    // An older reading got the check-in time and the provider wrong.
    const old = { ...stay, start: "2027-03-12T00:00:00+00:00", provider: "Booking site" };
    w.put(trip("t1", { sharedWith: ["partner@example.com"] }), booking("m1-0", "t1", old, { rating: 4, favorite: true, updatedAt: "2027-01-06T09:00:00Z" }));
    w.memory.parsed.set(`${uid}/m1`, record("m1"));

    const counts = await w.refresh("m1", found({ ...stay, provider: "Cove" }));

    expect(counts).toEqual({ updated: 1, added: 0, removed: 0, merged: 0, kept: 0 });
    expect(w.memory.segments.size).toBe(1);
    const after = w.memory.segments.get("m1-0")!;
    expect(after).toMatchObject({ id: "m1-0", tripId: "t1", start: stay.start, provider: "Cove", rating: 4, favorite: true });
    // Still not hand edited: rated, so touched since it was filed.
    expect(after.editedAt).toBeUndefined();
    expect(after.createdAt).toBe(filed);
    expect(after.updatedAt).toBe(now);
    expect(w.memory.trips.get("t1")).toMatchObject({ sharedWith: ["partner@example.com"], title: "Liverpool" });
  });

  it("leaves a booking the user edited as they left it", async () => {
    const w = world();
    const mine = booking("m1-0", "t1", { ...stay, title: "Our flat" }, { editedAt: "2027-01-07T09:00:00Z", updatedAt: "2027-01-07T09:00:00Z" });
    w.put(trip("t1"), mine);

    const counts = await w.refresh("m1", found({ ...stay, provider: "Cove" }));

    expect(counts).toMatchObject({ updated: 0, kept: 1 });
    expect(w.memory.segments.get("m1-0")).toEqual(mine);
  });

  it("counts a booking touched before editedAt existed as edited, unless it already says what the email says", async () => {
    const w = world();
    const legacy = { createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-02T00:00:00Z", rating: 3 };
    const old = { ...stay, start: "2027-03-12T00:00:00+00:00" };
    w.put(trip("t1"), booking("m1-0", "t1", old, legacy));
    expect(await w.refresh("m1", found(stay))).toMatchObject({ updated: 0, kept: 1 });
    expect(w.memory.segments.get("m1-0")!.start).toBe(old.start);

    // Already as the email says: nothing of the user's is lost by merging it.
    const w2 = world();
    w2.put(trip("t1"), booking("m1-0", "t1", stay, legacy), booking("m2-0", "t1", stay, { sources: [{ kind: "gmail", id: "m2", uid, at: filed }], gmailMessageIds: ["m2"] }));
    expect(await w2.refresh("m2", found(stay))).toMatchObject({ merged: 1, kept: 0 });
    expect([...w2.memory.segments.keys()]).toEqual(["m1-0"]);
    expect(w2.memory.segments.get("m1-0")!.rating).toBe(3);
  });

  it("merges two bookings an older import filed for one reservation, keeping the rating and every source", async () => {
    const w = world();
    // Email m2's old reading missed the reference and got the dates wrong,
    // so it was filed apart from m1's.
    const wrong = { ...stay, start: "2027-03-11T15:00:00+00:00", confirmation: undefined };
    w.put(
      trip("t1"),
      booking("m1-0", "t1", stay, { rating: 5, updatedAt: "2027-01-06T09:00:00Z" }),
      booking("m2-0", "t1", wrong, { sources: [{ kind: "gmail", id: "m2", uid, at: filed }], gmailMessageIds: ["m2"], favorite: true, updatedAt: "2027-01-06T10:00:00Z" }),
    );
    w.memory.parsed.set(`${uid}/m2`, record("m2"));

    const counts = await w.refresh("m2", found(stay));

    expect(counts).toMatchObject({ merged: 1 });
    expect([...w.memory.segments.keys()]).toEqual(["m1-0"]);
    const kept = w.memory.segments.get("m1-0")!;
    expect(kept).toMatchObject({ rating: 5, favorite: true, start: stay.start, gmailMessageIds: ["m1", "m2"] });
    expect(kept.sources!.map((s) => s.id).sort()).toEqual(["m1", "m2"]);
    expect(w.memory.parsed.get(`${uid}/m2`)).toMatchObject({ outcome: "imported", tripId: "t1", segmentIds: ["m1-0"] });
  });

  it("never merges a booking into one on a trip shared with other people", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));
    w.put(trip("t2", { sharedWith: ["partner@example.com"] }), booking("m2-0", "t2", stay, { sources: [{ kind: "gmail", id: "m2", uid, at: filed }], gmailMessageIds: ["m2"] }));

    expect(await w.refresh("m1", found(stay))).toMatchObject({ merged: 0 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["m1-0", "m2-0"]);
  });

  it("keeps the email's own booking on a shared trip when a rated twin is shared otherwise", async () => {
    const w = world();
    w.put(trip("t1", { sharedWith: ["partner@example.com"] }), booking("m1-0", "t1", stay));
    w.put(trip("t2"), booking("m2-0", "t2", stay, { rating: 4, sources: [{ kind: "gmail", id: "m2", uid, at: filed }], gmailMessageIds: ["m2"] }));

    expect(await w.refresh("m1", found(stay))).toMatchObject({ merged: 0, removed: 0 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["m1-0", "m2-0"]);
    expect(w.memory.segments.get("m1-0")?.tripId).toBe("t1");
  });

  it("keeps a lookalike room from a calendar event or a TripIt item apart, as an import does", async () => {
    const room = { ...stay, confirmation: undefined };
    const w = world();
    w.put(
      trip("t1"),
      booking("m1-0", "t1", room, { sources: [{ kind: "gmail", id: "m1", uid, at: filed }, { kind: "ics", id: "e1", uid, at: filed }] }),
      booking("e2-0", "t1", room, { source: "ics", gmailMessageIds: [], sources: [{ kind: "ics", id: "e2", uid, at: filed }] }),
      booking("tp-0", "t1", room, { source: "tripit", gmailMessageIds: [], sources: [{ kind: "tripit", id: "tp", uid, at: filed }] }),
    );

    expect(await w.refresh("m1", found(room))).toMatchObject({ merged: 0 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["e2-0", "m1-0", "tp-0"]);
  });

  it("keeps two rooms one email booked alike, each with its own id and rating", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay, { rating: 5 }), booking("m1-1", "t1", stay, { rating: 3 }));
    w.memory.parsed.set(`${uid}/m1`, record("m1", { segmentIds: ["m1-0", "m1-1"] }));

    expect(await w.refresh("m1", found(stay, stay))).toMatchObject({ merged: 0, removed: 0 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["m1-0", "m1-1"]);
    expect(w.memory.segments.get("m1-0")?.rating).toBe(5);
    expect(w.memory.segments.get("m1-1")?.rating).toBe(3);
  });

  it("keeps two rooms another email booked alike when this email confirms one", async () => {
    const w = world();
    const a = [{ kind: "gmail" as const, id: "ma", uid, at: filed }];
    w.put(
      trip("t1"),
      // Email B was matched to A's first room when it was imported.
      booking("ma-0", "t1", stay, { sources: [...a, { kind: "gmail", id: "mb", uid, at: filed }], gmailMessageIds: ["ma", "mb"] }),
      booking("ma-1", "t1", stay, { sources: a, gmailMessageIds: ["ma"], rating: 4 }),
    );
    w.memory.parsed.set(`${uid}/mb`, record("mb", { segmentIds: ["ma-0"] }));

    expect(await w.refresh("mb", found(stay))).toMatchObject({ merged: 0, removed: 0 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["ma-0", "ma-1"]);
    expect(w.memory.segments.get("ma-1")?.rating).toBe(4);
  });

  it("never merges two bookings under different references, though this email gives none", async () => {
    const room = { ...stay, confirmation: undefined };
    const w = world();
    w.put(
      trip("t1"),
      booking("m1-0", "t1", { ...stay, confirmation: "CV-1" }),
      booking("m2-0", "t1", { ...stay, confirmation: "CV-2" }, { sources: [{ kind: "gmail", id: "m2", uid, at: filed }], gmailMessageIds: ["m2"] }),
    );

    expect(await w.refresh("m1", found(room))).toMatchObject({ merged: 0, removed: 0 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["m1-0", "m2-0"]);
  });

  it("cancels a booking it adds when a cancellation is already waiting for it", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));
    // The return the first reading missed, cancelled since by another email.
    const back = { ...show, title: "Coach to London", start: "2027-03-14T12:00:00+00:00" };
    w.memory.pending.set(`${uid}/mc`, { messageId: "mc", uid, at: "2027-02-01T00:00:00Z", sentAt: "2027-02-01T00:00:00Z", cancellations: [{ place: "Coach to London", start: back.start }] });

    expect(await w.refresh("m1", found(stay, back))).toMatchObject({ added: 1 });
    const added = [...w.memory.segments.values()].find((s) => s.title === "Coach to London")!;
    expect(added.cancelledBy).toBe("mc");
  });

  it("cancels the flight an older email booked that this one, a rebooking, flies another way", async () => {
    const w = world();
    const bos = { name: "Boston Logan", code: "BOS", city: "Boston", country: "US" };
    const dtw = { name: "Detroit Metro", code: "DTW", city: "Detroit", country: "US" };
    const sfo = { name: "San Francisco International", code: "SFO", city: "San Francisco", country: "US" };
    const leg = (title: string, start: string, end: string, origin: typeof bos, destination: typeof bos): ExtractedSegment => ({ type: "flight", title, start, end, origin, destination, confirmation: "F8D7IY" });
    const home = leg("Delta 1123 BOS to SFO", "2027-03-21T08:25:00-05:00", "2027-03-21T12:23:00-08:00", bos, sfo);
    const viaDetroit = [leg("Delta 919 BOS to DTW", "2027-03-11T13:00:00-05:00", "2027-03-11T15:19:00-05:00", bos, dtw), leg("Delta 2980 DTW to SFO", "2027-03-11T16:45:00-05:00", "2027-03-11T18:56:00-08:00", dtw, sfo)];
    // Both read before rebookings were recognized, each in its own trip.
    const sources = (id: string, sentAt: string) => ({ sources: [{ kind: "gmail" as const, id, uid, at: filed, sentAt }] });
    w.put(trip("t1", { start: "2027-03-21", end: "2027-03-21" }), booking("m1-0", "t1", home, sources("m1", "2027-01-01T10:00:00.000Z")));
    w.put(
      trip("t2", { start: "2027-03-11", end: "2027-03-11" }),
      booking("m2-0", "t2", viaDetroit[0]!, sources("m2", "2027-01-04T10:00:00.000Z")),
      booking("m2-1", "t2", viaDetroit[1]!, sources("m2", "2027-01-04T10:00:00.000Z")),
    );
    w.memory.parsed.set(`${uid}/m2`, record("m2", { segmentIds: ["m2-0", "m2-1"], tripId: "t2" }));

    await w.refresh("m2", found(...viaDetroit));
    expect(w.memory.segments.get("m1-0")).toMatchObject({ cancelledBy: "m2", cancelledSentAt: "2027-01-04T10:00:00.000Z" });
    expect(w.memory.trips.get("t1")?.updatedAt).toBe(now);
    // Reading the older email again leaves it cancelled.
    await w.refresh("m1", found(home));
    expect(w.memory.segments.get("m1-0")?.cancelledBy).toBe("m2");
  });

  it("cancels the onward flight a rebooking that kept the first leg dropped, but never for a receipt", async () => {
    const bos = { name: "Boston Logan", code: "BOS", city: "Boston", country: "US" };
    const dtw = { name: "Detroit Metro", code: "DTW", city: "Detroit", country: "US" };
    const sea = { name: "Seattle-Tacoma", code: "SEA", city: "Seattle", country: "US" };
    const sfo = { name: "San Francisco International", code: "SFO", city: "San Francisco", country: "US" };
    const leg = (title: string, start: string, end: string, origin: typeof bos, destination: typeof bos): ExtractedSegment => ({ type: "flight", title, start, end, origin, destination, confirmation: "F8D7IY" });
    const first = leg("Delta 919 BOS to DTW", "2027-03-11T13:00:00-05:00", "2027-03-11T15:19:00-05:00", bos, dtw);
    const onward = leg("Delta 2980 DTW to SFO", "2027-03-11T16:45:00-05:00", "2027-03-11T18:56:00-08:00", dtw, sfo);
    const viaSeattle = [leg("Delta 400 DTW to SEA", "2027-03-11T17:30:00-05:00", "2027-03-11T19:30:00-08:00", dtw, sea), leg("Alaska 9 SEA to SFO", "2027-03-11T21:00:00-08:00", "2027-03-11T23:00:00-08:00", sea, sfo)];
    const from = (...ids: [string, string][]) => ({ sources: ids.map(([id, sentAt]) => ({ kind: "gmail" as const, id, uid, at: filed, sentAt })) });
    const m1: [string, string] = ["m1", "2027-01-01T10:00:00.000Z"];
    const m2: [string, string] = ["m2", "2027-01-04T10:00:00.000Z"];
    // The original and the rebooking that kept its first leg, both read before rebookings were recognized.
    const setup = () => {
      const w = world();
      w.put(
        trip("t1", { start: "2027-03-11", end: "2027-03-11" }),
        booking("m1-0", "t1", first, from(m1, m2)),
        booking("m1-1", "t1", onward, from(m1)),
        booking("m2-1", "t1", viaSeattle[0]!, from(m2)),
        booking("m2-2", "t1", viaSeattle[1]!, from(m2)),
      );
      w.memory.parsed.set(`${uid}/m2`, record("m2", { segmentIds: ["m1-0", "m2-1", "m2-2"] }));
      return w;
    };

    // A refund for an older direct flight under the reference rebooks nothing.
    const direct = leg("Delta 5 BOS to SFO", "2027-03-11T08:00:00-05:00", "2027-03-11T11:30:00-08:00", bos, sfo);
    const refunded = setup();
    const refund = { ...email("m3"), subject: "Your refund receipt", date: "Fri, 8 Jan 2027 10:00:00 +0000" };
    await refreshEmail(uid, record("m3"), refund, refunded.deps(async () => found(direct)), { generation: 0, snapshot: await refunded.memory.listUserSegments(uid) });
    expect([...refunded.memory.segments.values()].filter((s) => s.cancelledBy).map((s) => s.id)).toEqual([]);

    const w = setup();
    await w.refresh("m2", found(first, ...viaSeattle));
    expect([...w.memory.segments.values()].filter((s) => s.cancelledBy).map((s) => [s.id, s.cancelledBy])).toEqual([["m1-1", "m2"]]);
  });

  it("merges a flight an email gave only the date of, under a codeshare partner's reference, into the flight booked", async () => {
    const w = world();
    const bos = { name: "Boston Logan International Airport", code: "BOS", city: "Boston", country: "US" };
    const lhr = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
    const ticket: ExtractedSegment = { type: "flight", title: "VS4012 BOS to LHR", start: "2027-03-12T19:15:00-05:00", end: "2027-03-13T06:50:00+00:00", origin: bos, destination: lhr, confirmation: "E5WSJI" };
    const menu: ExtractedSegment = { type: "flight", title: "Delta BOS to LHR", start: "2027-03-12T00:00:00-05:00", origin: bos, destination: lhr, confirmation: "GPJIZU" };
    w.put(trip("t1"), booking("m1-0", "t1", ticket), booking("m2-0", "t1", menu));
    w.memory.parsed.set(`${uid}/m2`, record("m2"));

    expect(await w.refresh("m2", found(menu))).toMatchObject({ merged: 1 });
    const flights = [...w.memory.segments.values()];
    expect(flights.map((s) => [s.title, s.start, s.end, s.confirmation])).toEqual([["VS4012 BOS to LHR", ticket.start, ticket.end, "E5WSJI"]]);
    expect(flights[0]!.sources?.map((r) => r.id).sort()).toEqual(["m1", "m2"]);
  });

  it("leaves a booking the user merged another into as one, the other's email read again", async () => {
    const w = world();
    const car = (title: string, start: string, confirmation: string): ExtractedSegment => ({ type: "car_rental", title, start, end: "2027-03-14T17:30:00-04:00", provider: "Avis", confirmation });
    const reservation = car("Avis Boston Logan Intl Airport", "2027-03-12T17:30:00-04:00", "20874163US2");
    const agreement = car("Avis Car Rental East Boston", "2027-03-12T18:15:00-04:00", "708843612");
    const both = { sources: [{ kind: "gmail" as const, id: "m1", uid, at: filed }, { kind: "gmail" as const, id: "m2", uid, at: filed }] };
    w.put(trip("t1"), booking("m1-0", "t1", reservation, { ...both, gmailMessageIds: ["m1", "m2"], mergedFrom: ["m2-0"], mergedBookings: [agreement], editedAt: filed }));
    w.memory.parsed.set(`${uid}/m2`, record("m2", { segmentIds: ["m2-0"] }));

    await w.refresh("m2", found(agreement));
    expect([...w.memory.segments.keys()]).toEqual(["m1-0"]);
    expect(w.memory.segments.get("m1-0")).toMatchObject({ title: "Avis Boston Logan Intl Airport", start: reservation.start });
  });

  it("leaves a booking merged in from two emails out when the other of them is read again", async () => {
    const w = world();
    const car = (title: string, start: string, confirmation: string): ExtractedSegment => ({ type: "car_rental", title, start, end: "2027-03-14T17:30:00-04:00", provider: "Avis", confirmation });
    const reservation = car("Avis Boston Logan Intl Airport", "2027-03-12T17:30:00-04:00", "20874163US2");
    const agreement = car("Avis Car Rental East Boston", "2027-03-12T18:15:00-04:00", "708843612");
    // The agreement, filed from m2 and read again from m3, was merged into the reservation.
    const sources = ["m1", "m2", "m3"].map((id) => ({ kind: "gmail" as const, id, uid, at: filed }));
    w.put(trip("t1"), booking("m1-0", "t1", reservation, { sources, gmailMessageIds: ["m1", "m2", "m3"], mergedFrom: ["m2-0"], mergedBookings: [agreement], editedAt: filed }));
    w.memory.parsed.set(`${uid}/m3`, record("m3", { segmentIds: [] }));

    await w.refresh("m3", found(agreement));
    expect([...w.memory.segments.keys()]).toEqual(["m1-0"]);
  });

  it("files the second of two alike rooms an email gives beside the merged booking that looks like them", async () => {
    const w = world();
    const sources = ["m1", "m2"].map((id) => ({ kind: "gmail" as const, id, uid, at: filed }));
    w.put(trip("t1"), booking("m1-0", "t1", stay, { sources, gmailMessageIds: ["m1", "m2"], mergedFrom: ["m9-0"], mergedBookings: [stay], editedAt: filed }));
    w.memory.parsed.set(`${uid}/m2`, record("m2", { segmentIds: [] }));

    await w.refresh("m2", found(stay, stay));
    expect(w.memory.segments.size).toBe(2);
  });

  it("files a second alike room of an email whose booking was merged in beside the keeper", async () => {
    const w = world();
    const sources = ["m1", "m2"].map((id) => ({ kind: "gmail" as const, id, uid, at: filed }));
    // m2's room was merged into m1's; m2, read again, now gives a second room too.
    w.put(trip("t1"), booking("m1-0", "t1", stay, { sources, gmailMessageIds: ["m1", "m2"], mergedFrom: ["m2-0"], mergedBookings: [stay], editedAt: filed }));
    w.memory.parsed.set(`${uid}/m2`, record("m2", { segmentIds: [] }));

    await w.refresh("m2", found(stay, stay));
    expect(w.memory.segments.size).toBe(2);
  });

  it("finds a merged-in flight by what it says, not where its email lists it", async () => {
    const w = world();
    const leg = (title: string, start: string): ExtractedSegment => ({ type: "flight", title, start, confirmation: "ABC123", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Boston", code: "BOS" } });
    const out = leg("VS 11 LHR to BOS", "2027-03-12T17:20:00+00:00");
    const back = { ...leg("VS 12 BOS to LHR", "2027-03-20T19:00:00-04:00"), origin: { name: "Boston", code: "BOS" }, destination: { name: "Heathrow", code: "LHR" } };
    // m2's outbound, its first item when merged, now comes second.
    const sources = ["m1", "m2"].map((id) => ({ kind: "gmail" as const, id, uid, at: filed }));
    w.put(trip("t1"), booking("m1-0", "t1", out, { sources, gmailMessageIds: ["m1", "m2"], mergedFrom: ["m2-0"], mergedBookings: [out], editedAt: filed }));
    w.memory.parsed.set(`${uid}/m2`, record("m2", { segmentIds: [] }));

    await w.refresh("m2", found(back, out));
    expect([...w.memory.segments.values()].map((s) => s.title).sort()).toEqual(["VS 11 LHR to BOS", "VS 12 BOS to LHR"]);
  });

  it("files an item of an email whose other booking was merged in as a booking of its own", async () => {
    const w = world();
    const leg = (title: string, start: string): ExtractedSegment => ({ type: "flight", title, start, confirmation: "ABC123", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Boston", code: "BOS" } });
    const out = leg("VS 11 LHR to BOS", "2027-03-12T17:20:00+00:00");
    const back = { ...leg("VS 12 BOS to LHR", "2027-03-20T19:00:00-04:00"), origin: { name: "Boston", code: "BOS" }, destination: { name: "Heathrow", code: "LHR" } };
    // m2's outbound was merged into m1's; m2, read again, now gives the flight back too.
    const sources = ["m1", "m2"].map((id) => ({ kind: "gmail" as const, id, uid, at: filed }));
    w.put(trip("t1"), booking("m1-0", "t1", out, { sources, gmailMessageIds: ["m1", "m2"], mergedFrom: ["m2-0"], mergedBookings: [out], editedAt: filed }));
    w.memory.parsed.set(`${uid}/m2`, record("m2", { segmentIds: [] }));

    await w.refresh("m2", found(out, back));
    expect([...w.memory.segments.values()].map((s) => s.title).sort()).toEqual(["VS 11 LHR to BOS", "VS 12 BOS to LHR"]);
  });

  it("leaves two bookings of one email the user merged as one when that email is read again", async () => {
    const w = world();
    const room = { ...stay, title: "Cove Liverpool, room 1" };
    const second = { ...stay, title: "Cove Liverpool, room 2", start: "2027-03-12T16:00:00+00:00" };
    w.put(trip("t1"), booking("m1-0", "t1", room, { mergedFrom: ["m1-1"], mergedBookings: [second], editedAt: filed }));
    w.memory.parsed.set(`${uid}/m1`, record("m1", { segmentIds: ["m1-0"] }));

    await w.refresh("m1", found(room, second));
    expect([...w.memory.segments.keys()]).toEqual(["m1-0"]);
  });

  it("merges a car's reservation and its rental agreement filed before as two", async () => {
    const w = world();
    const car = (title: string, start: string, confirmation: string, rentalStage: "reservation" | "agreement"): ExtractedSegment => ({ type: "car_rental", title, start, end: "2027-03-14T17:30:00-04:00", provider: "Avis", confirmation, rentalStage });
    const reservation = car("Avis Boston Logan Intl Airport", "2027-03-12T17:30:00-04:00", "20874163US2", "reservation");
    const agreement = car("Avis Car Rental East Boston", "2027-03-12T18:15:00-04:00", "708843612", "agreement");
    w.put(trip("t1"), booking("m1-0", "t1", reservation), booking("m2-0", "t1", agreement));
    w.memory.parsed.set(`${uid}/m2`, record("m2"));

    expect(await w.refresh("m2", found(agreement))).toMatchObject({ merged: 1 });
    expect(w.memory.segments.size).toBe(1);

    // The reservation's email refreshed instead: the agreement's times win all the same.
    const v = world();
    v.put(trip("t1"), booking("m1-0", "t1", reservation), booking("m2-0", "t1", agreement));
    v.memory.parsed.set(`${uid}/m1`, record("m1"));
    expect(await v.refresh("m1", found(reservation))).toMatchObject({ merged: 1 });
    expect([...v.memory.segments.values()].map((s) => [s.start, s.rentalStage])).toEqual([[agreement.start, "paired"]]);
  });

  it("keeps what only the duplicate knew, its reference and provider, on the booking that stays", async () => {
    const room = { ...stay, confirmation: undefined };
    const w = world();
    w.put(
      trip("t1"),
      booking("m1-0", "t1", room, { rating: 5 }),
      booking("m2-0", "t1", { ...stay, confirmation: "CV-9", provider: "Cove" }, { sources: [{ kind: "gmail", id: "m2", uid, at: filed }], gmailMessageIds: ["m2"] }),
    );

    expect(await w.refresh("m1", found(room))).toMatchObject({ merged: 1 });
    expect([...w.memory.segments.keys()]).toEqual(["m1-0"]);
    expect(w.memory.segments.get("m1-0")).toMatchObject({ rating: 5, confirmation: "CV-9", provider: "Cove" });
  });

  it("keeps each of two alike rooms on its own booking when the first was read with the wrong dates", async () => {
    const room = { ...stay, confirmation: undefined };
    const wrong = { ...room, start: "2027-04-12T15:00:00+00:00", end: "2027-04-14T11:00:00+00:00" };
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", wrong, { favorite: true }), booking("m1-1", "t1", room, { rating: 4 }));
    w.memory.parsed.set(`${uid}/m1`, record("m1", { segmentIds: ["m1-0", "m1-1"] }));

    expect(await w.refresh("m1", found(room, room))).toMatchObject({ added: 0, removed: 0 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["m1-0", "m1-1"]);
    expect(w.memory.segments.get("m1-0")).toMatchObject({ favorite: true, start: room.start });
    expect(w.memory.segments.get("m1-1")?.rating).toBe(4);
  });

  it("cancels a corrected booking that a waiting cancellation now names", async () => {
    const wrong = { ...stay, start: "2027-04-12T15:00:00+00:00", end: "2027-04-14T11:00:00+00:00" };
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", wrong, { sources: [{ kind: "gmail", id: "m1", uid, at: filed, sentAt: "2027-01-04T10:00:00Z" }] }));
    w.memory.pending.set(`${uid}/mc`, { messageId: "mc", uid, at: "2027-02-01T00:00:00Z", sentAt: "2027-02-01T00:00:00Z", cancellations: [{ confirmation: "CV-55120", start: stay.start }] });

    expect(await w.refresh("m1", found(stay))).toMatchObject({ updated: 1 });
    expect(w.memory.segments.get("m1-0")).toMatchObject({ start: stay.start, cancelledBy: "mc" });
  });

  it("keeps a stay booked again apart from the cancelled one it replaced", async () => {
    const room = { ...stay, confirmation: undefined };
    const w = world();
    w.put(
      trip("t1"),
      booking("m1-0", "t1", room, { cancelledAt: "2027-01-05T09:00:00Z", cancelledBy: "mc" }),
      booking("m2-0", "t1", room, { sources: [{ kind: "gmail", id: "m2", uid, at: filed }], gmailMessageIds: ["m2"] }),
    );

    expect(await w.refresh("m1", found(room))).toMatchObject({ merged: 0, removed: 0 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["m1-0", "m2-0"]);
    expect(w.memory.segments.get("m2-0")?.cancelledAt).toBeUndefined();
  });

  it("drops a booking the email no longer gives only when unedited and from that email alone", async () => {
    const w = world();
    const other = { kind: "gmail" as const, id: "m9", uid, at: filed };
    w.put(
      trip("t1"),
      booking("m1-0", "t1", stay),
      booking("m1-1", "t1", { ...show, title: "Spa" }),
      booking("m1-2", "t1", { ...show, title: "Dinner", start: "2027-03-12T19:00:00+00:00" }, { sources: [{ kind: "gmail", id: "m1", uid, at: filed }, other] }),
      booking("m1-3", "t1", { ...show, title: "Tour", start: "2027-03-13T10:00:00+00:00" }, { editedAt: "2027-01-07T00:00:00Z", updatedAt: "2027-01-07T00:00:00Z" }),
    );

    const counts = await w.refresh("m1", found(stay));

    expect(counts).toMatchObject({ removed: 1, kept: 1 });
    expect([...w.memory.segments.keys()].sort()).toEqual(["m1-0", "m1-2", "m1-3"]);
  });

  it("adds what the email gives now that matches no booking, beside its others", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));

    const counts = await w.refresh("m1", found(stay, show));

    expect(counts).toMatchObject({ added: 1, updated: 0 });
    expect(w.memory.segments.get("m1-1")).toMatchObject({ tripId: "t1", title: "Cavern Club Live", sources: [{ id: "m1" }], createdAt: now, updatedAt: now });
    expect(w.memory.parsed.get(`${uid}/m1`)!.segmentIds.sort()).toEqual(["m1-0", "m1-1"]);
  });

  it("files the travelers of a booking it adds as an import does, each once", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));
    await w.refresh("m1", found(stay, { ...show, travelers: ["SMITH/JOHN MR", "Smith, John"] }));
    expect(w.memory.segments.get("m1-1")?.travelers).toEqual(["John Smith"]);
    // And counts them among the user's people, as an import does.
    expect([...w.memory.people.values()].map((p) => [p.name, p.bookings, p.direct])).toEqual([["John Smith", 1, 1]]);
  });

  it("counts whom a booking it fills out newly names among the user's people, once however often it runs", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));
    await w.refresh("m1", found({ ...stay, travelers: ["SMITH/JOHN MR"] }));
    await w.refresh("m1", found({ ...stay, travelers: ["SMITH/JOHN MR"] }));
    expect(w.memory.segments.get("m1-0")?.travelers).toEqual(["John Smith"]);
    expect([...w.memory.people.values()].map((p) => [p.name, p.bookings])).toEqual([["John Smith", 1]]);
  });

  it("counts the travelers of a booking filed before people were kept, once however often it runs", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", { ...stay, travelers: ["John Smith"] }));
    await w.refresh("m1", found({ ...stay, travelers: ["SMITH/JOHN MR"] }));
    await w.refresh("m1", found({ ...stay, travelers: ["SMITH/JOHN MR"] }));
    expect([...w.memory.people.values()].map((p) => [p.name, p.bookings])).toEqual([["John Smith", 1]]);
  });

  it("changes nothing when the model now finds no booking in the email", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));
    expect(await w.refresh("m1", { isBooking: false, segments: [] })).toEqual({ updated: 0, added: 0, removed: 0, merged: 0, kept: 0 });
    expect(w.memory.segments.size).toBe(1);
    expect(w.logged).toContain("refresh_found_nothing");
  });

  it("writes nothing once the user deleted all their trips", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", { ...stay, start: "2027-03-12T00:00:00+00:00" }));
    await w.memory.withUserLock(uid, async (tx) => tx.bumpGeneration());
    const r = record("m1");
    const deps = w.deps(async () => found(stay));
    await expect(refreshEmail(uid, r, email("m1"), deps, { generation: 0, snapshot: [] })).rejects.toBeInstanceOf(ImportSupersededError);
    expect(await refreshRecord(uid, r, deps, { generation: 0, snapshot: [], fetch: async () => email("m1") })).toEqual({ kind: "superseded" });
    expect(w.memory.segments.get("m1-0")!.start).toBe("2027-03-12T00:00:00+00:00");
  });
});

describe("refreshRecord", () => {
  const r = record("m1");
  const base = (extract: ImportDeps["extract"]) => world().deps(extract);

  it("tells a rate limit from Gmail or the model, a gone email and a failed reading apart", async () => {
    const ok = base(async () => found(stay));
    expect(await refreshRecord(uid, r, ok, { generation: 0, snapshot: [], fetch: async () => undefined })).toEqual({ kind: "missing" });
    const limited = async () => {
      throw new GmailRateLimited(new Error("429"));
    };
    expect(await refreshRecord(uid, r, ok, { generation: 0, snapshot: [], fetch: limited })).toEqual({ kind: "rateLimited", by: "gmail" });
    const busy = base(async () => {
      throw Object.assign(new Error("Too many requests"), { status: 429 });
    });
    expect(await refreshRecord(uid, r, busy, { generation: 0, snapshot: [], fetch: async () => email("m1") })).toEqual({ kind: "rateLimited", by: "model" });
    const broken = base(async () => {
      throw new Error("Gemini returned no text");
    });
    expect(await refreshRecord(uid, r, broken, { generation: 0, snapshot: [], fetch: async () => email("m1") })).toEqual({ kind: "failed" });
  });

  it("adds each reading again to its sender domain's counts, apart from first readings", async () => {
    const w = world();
    w.memory.parsed.set(`${uid}/m1`, r);
    await refreshRecord(uid, r, w.deps(async () => found(stay)), { generation: 0, snapshot: [], fetch: async () => email("m1") });
    await refreshRecord(uid, r, w.deps(async () => {
      throw new Error("Gemini returned no text");
    }), { generation: 0, snapshot: [], fetch: async () => email("m1") });
    expect(w.memory.senderStats.get("cove.example")).toEqual({ refreshRead: 2, refreshFailed: 1 });
  });
});

describe("refreshRecord, an email an older reader found no booking in", () => {
  // Virgin Atlantic's e-tickets were judged no booking while the reader took
  // their plain text, only a footer.
  const judged = record("m1", { outcome: "not_booking", segmentIds: [], tripId: undefined, from: "Cove <stay@cove.example>", reason: "sender cove.example allowed" });

  it("imports it afresh, adding what today's reader finds, and records the reading", async () => {
    const w = world();
    w.memory.parsed.set(`${uid}/m1`, judged);
    const outcome = await refreshRecord(uid, judged, w.deps(async () => found(stay)), { generation: 0, snapshot: [], fetch: async () => email("m1") });
    expect(outcome).toEqual({ kind: "refreshed", counts: { updated: 0, added: 1, removed: 0, merged: 0, kept: 0 } });
    expect(w.memory.parsed.get(`${uid}/m1`)).toMatchObject({ outcome: "imported", segmentIds: ["m1-0"] });
    expect([...w.memory.segments.values()].map((s) => s.title)).toEqual(["Cove Liverpool"]);
  });

  it("records today's reader when it still finds no booking, so the next refresh passes it", async () => {
    const w = world();
    w.memory.parsed.set(`${uid}/m1`, judged);
    const outcome = await refreshRecord(uid, judged, w.deps(async () => ({ isBooking: false, segments: [] })), { generation: 0, snapshot: [], fetch: async () => email("m1") });
    expect(outcome).toEqual({ kind: "refreshed", counts: { updated: 0, added: 0, removed: 0, merged: 0, kept: 0 } });
    expect(w.memory.parsed.get(`${uid}/m1`)).toMatchObject({ outcome: "not_booking", readerVersion });
  });

  it("fails when the model does, and reads it again on the second try", async () => {
    const w = world();
    w.memory.parsed.set(`${uid}/m1`, judged);
    const broken = w.deps(async () => {
      throw new Error("Gemini returned no text");
    });
    expect(await refreshRecord(uid, judged, broken, { generation: 0, snapshot: [], fetch: async () => email("m1") })).toEqual({ kind: "failed" });
    const failed = w.memory.parsed.get(`${uid}/m1`)!;
    expect(failed.outcome).toBe("failed");
    const again = await refreshRecord(uid, failed, w.deps(async () => found(stay)), { generation: 0, snapshot: [], fetch: async () => email("m1") });
    expect(again).toMatchObject({ kind: "refreshed", counts: { added: 1 } });
  });
});

describe("readAgain", () => {
  const none = { allow: [], deny: [] };
  const judged = (extra: Partial<ParsedMessage> = {}) =>
    record("m1", { outcome: "not_booking", segmentIds: [], from: "Virgin Atlantic <booking@service.virginatlantic.com>", ...extra });

  it("reads again what an older reader found no booking in, from a travel company", () => {
    expect(readAgain(judged(), none, now)).toBe(true);
    expect(readAgain(judged({ readerVersion }), none, now)).toBe(false);
  });

  it("reads again a sender the user always imports, never one they never import", () => {
    const shop = judged({ from: "Shop <orders@shop.example>" });
    expect(readAgain(shop, none, now)).toBe(false);
    expect(readAgain(shop, { allow: ["shop.example"], deny: [] }, now)).toBe(true);
    expect(readAgain(judged(), { allow: [], deny: ["virginatlantic.com"] }, now)).toBe(false);
  });

  it("reads again one whose reading failed, whatever reader judged it", () => {
    expect(readAgain(judged({ outcome: "failed", readerVersion }), none, now)).toBe(true);
    expect(readAgain(judged({ outcome: "failed", from: "Shop <orders@shop.example>" }), none, now)).toBe(false);
  });

  it("reads again one whose reading stopped part way, once its claim has run out", () => {
    const claimed = (processedAt: string) => judged({ outcome: "processing", readerVersion, processedAt });
    expect(readAgain(claimed("2027-02-01T11:00:00Z"), none, now)).toBe(true);
    expect(readAgain(claimed("2027-02-01T11:55:00Z"), none, now)).toBe(false);
    expect(readAgain({ ...claimed("2027-02-01T11:00:00Z"), from: undefined }, none, now)).toBe(false);
  });

  it("leaves bookings, other outcomes and emails not in a mailbox alone", () => {
    expect(readAgain(judged({ outcome: "imported" }), none, now)).toBe(false);
    expect(readAgain(judged({ outcome: "filtered" }), none, now)).toBe(false);
    expect(readAgain(judged({ messageId: "fwd-1", source: "forward" }), none, now)).toBe(false);
    expect(readAgain(judged({ from: undefined }), none, now)).toBe(false);
  });
});

describe("isMailboxRecord", () => {
  it("reads again only emails from a mailbox", () => {
    expect(isMailboxRecord(record("m1"))).toBe(true);
    expect(isMailboxRecord(record("fm-1", { source: "fastmail" }))).toBe(true);
    expect(isMailboxRecord(record("imap-1", { source: "imap" }))).toBe(true);
    expect(isMailboxRecord(record("ics-1", { source: "ics" }))).toBe(false);
    expect(isMailboxRecord(record("tripit-1", { source: "tripit" }))).toBe(false);
    expect(isMailboxRecord(record("fwd-1", { source: "forward" }))).toBe(false);
  });
});

// A user's import records, and what refreshing each gives.
function batchIo(records: ParsedMessage[], outcomes: Map<string, RecordOutcome> = new Map(), timeFor = Infinity) {
  const memory = memoryStore();
  for (const r of records) memory.parsed.set(`${uid}/${r.messageId}`, r);
  const refreshed: string[] = [];
  let clock = Date.parse(now);
  const io: RefreshBatchIo = {
    records: (after, limit, everything) => memory.refreshRecords(uid, after, limit, everything),
    senderPatterns: async () => ({ allow: [], deny: [] }),
    record: (id) => memory.getParsed(uid, id),
    snapshot: async () => [],
    refresh: async (r) => {
      refreshed.push(r.messageId);
      return outcomes.get(r.messageId) ?? { kind: "refreshed", counts: { updated: 1, added: 0, removed: 0, merged: 0, kept: 0 } };
    },
    timeLeftMs: () => timeFor - refreshed.length,
    now: () => new Date(clock).toISOString(),
    log: () => {},
  };
  return { io, refreshed, tick: (ms: number) => (clock += ms) };
}

const fresh = (): RefreshProgress => ({ scanned: 0, imported: 0, failed: 0, done: false, updatedAt: now });

describe("runRefreshBatch", () => {
  it("reads only the records that made bookings from a mailbox", async () => {
    const { io, refreshed } = batchIo([
      record("a1"),
      record("a2", { outcome: "not_booking" }),
      record("a3", { outcome: "cancellation" }),
      record("ics-a4", { source: "ics" }),
      record("tripit-a5", { source: "tripit" }),
      record("imap-a6", { source: "imap" }),
    ]);
    const batch = await runRefreshBatch(fresh(), io);
    expect(refreshed).toEqual(["a1", "imap-a6"]);
    expect(batch.progress).toMatchObject({ scanned: 2, total: 2, updated: 2, imported: 2, done: true, cursor: "tripit-a5" });
  });

  it("also reads the emails an older reader found no booking in from travel senders, counting them in the total", async () => {
    const travel = { outcome: "not_booking" as const, segmentIds: [], from: "Virgin Atlantic <booking@service.virginatlantic.com>" };
    const { io, refreshed } = batchIo([
      record("b1"),
      record("b2", travel),
      record("b3", { ...travel, readerVersion }),
      record("b4", { ...travel, from: "Shop <orders@shop.example>" }),
    ]);
    const batch = await runRefreshBatch(fresh(), io);
    expect(refreshed).toEqual(["b1", "b2"]);
    expect(batch.progress).toMatchObject({ scanned: 2, total: 2, done: true });
  });

  it("finds again an email whose reading again stopped part way, and reads it", async () => {
    const w = world();
    const travel = record("c1", { outcome: "not_booking", segmentIds: [], tripId: undefined, from: "Virgin Atlantic <booking@service.virginatlantic.com>" });
    w.memory.parsed.set(`${uid}/c1`, travel);
    // The worker claimed it, then died before writing what it found.
    expect(await w.memory.reclaimMessage(uid, "c1", "2027-02-01T11:00:00Z")).toBe(true);
    const { io, refreshed } = batchIo([w.memory.parsed.get(`${uid}/c1`)!]);
    const batch = await runRefreshBatch(fresh(), io);
    expect(refreshed).toEqual(["c1"]);
    expect(batch.progress).toMatchObject({ scanned: 1, total: 1, done: true });
  });

  it("carries on from where the last batch stopped when it runs out of time", async () => {
    const records = Array.from({ length: 5 }, (_, i) => record(`m${i}`));
    const first = batchIo(records, new Map(), 2);
    const one = await runRefreshBatch(fresh(), first.io);
    expect(first.refreshed).toEqual(["m0", "m1"]);
    expect(one.progress).toMatchObject({ scanned: 2, cursor: "m1", done: false, total: 5 });
    const second = batchIo(records);
    const two = await runRefreshBatch(one.progress as RefreshProgress, second.io);
    expect(second.refreshed).toEqual(["m2", "m3", "m4"]);
    expect(two.progress).toMatchObject({ scanned: 5, done: true, total: 5 });
  });

  it("reads a page at a time", async () => {
    const records = Array.from({ length: refreshPage + 1 }, (_, i) => record(`m${String(i).padStart(3, "0")}`));
    const { io } = batchIo(records);
    const batch = await runRefreshBatch(fresh(), io);
    expect(batch.progress).toMatchObject({ scanned: refreshPage, done: false, total: refreshPage + 1 });
  });

  it("waits out Gmail's rate limit and reads the email again", async () => {
    const { io, refreshed } = batchIo([record("m1"), record("m2")], new Map([["m2", { kind: "rateLimited", by: "gmail" }]]));
    const batch = await runRefreshBatch(fresh(), io);
    expect(refreshed).toEqual(["m1", "m2"]);
    expect(batch.rateLimited).toBe(true);
    expect(batch.counts.failed).toBe(0);
    expect(batch.progress).toMatchObject({ scanned: 1, cursor: "m1", done: false, retryAfter: "2027-02-01T12:01:00.000Z" });
  });

  it("waits out the model's rate limit, slowing the next batch, and reads the email again", async () => {
    const { io } = batchIo([record("m1"), record("m2")], new Map([["m1", { kind: "rateLimited", by: "model" }]]));
    const batch = await runRefreshBatch(fresh(), io);
    expect(batch.counts.failed).toBe(1);
    expect(batch.progress.cursor).toBeUndefined();
    expect(batch.progress).toMatchObject({ scanned: 0, failed: 0, done: false });
  });

  it("passes an email the model failed on, reads on, then reads it again before it is done", async () => {
    const outcomes = new Map<string, RecordOutcome>([["m1", { kind: "missing" }], ["m2", { kind: "failed" }]]);
    const { io, refreshed } = batchIo([record("m1"), record("m2"), record("m3")], outcomes);
    const batch = await runRefreshBatch(fresh(), io);
    expect(refreshed).toEqual(["m1", "m2", "m3"]);
    expect(batch.counts.failed).toBe(1);
    expect(batch.progress).toMatchObject({ scanned: 3, missing: 1, failed: 1, updated: 1, done: false, retrying: ["m2"] });

    const again = await runRefreshBatch(batch.progress as RefreshProgress, io);
    expect(refreshed).toEqual(["m1", "m2", "m3", "m2"]);
    expect(again.progress).toMatchObject({ scanned: 3, failed: 1, done: true, failedIds: ["m2"] });
    expect(again.progress.retrying).toBeUndefined();
  });

  it("no longer counts an email as failed once it is read on the second try", async () => {
    const outcomes = new Map<string, RecordOutcome>([["m1", { kind: "failed" }]]);
    const { io } = batchIo([record("m1"), record("m2")], outcomes);
    const batch = await runRefreshBatch(fresh(), io);
    outcomes.delete("m1");
    const again = await runRefreshBatch(batch.progress as RefreshProgress, io);
    expect(again.progress).toMatchObject({ scanned: 2, failed: 0, updated: 2, done: true });
    expect(again.progress.failedIds).toBeUndefined();
  });

  it("keeps an email whose reading again was left claimed as failed, and reads it once the claim runs out", async () => {
    const travel = { segmentIds: [], tripId: undefined, from: "Virgin Atlantic <booking@service.virginatlantic.com>" };
    const claimed = (processedAt: string) => record("m1", { ...travel, outcome: "processing", processedAt });
    const retrying = { ...fresh(), scanned: 1, failed: 1, retrying: ["m1"] };
    const live = batchIo([claimed("2027-02-01T11:55:00Z")]);
    const kept = await runRefreshBatch(retrying, live.io);
    expect(live.refreshed).toEqual([]);
    expect(kept.progress).toMatchObject({ done: true, failed: 1, failedIds: ["m1"] });
    const stale = batchIo([claimed("2027-02-01T11:00:00Z")]);
    const readNow = await runRefreshBatch(retrying, stale.io);
    expect(stale.refreshed).toEqual(["m1"]);
    expect(readNow.progress).toMatchObject({ done: true, failed: 0 });
  });

  it("drops a failed email whose record is gone by the second try", async () => {
    const { io } = batchIo([record("m1")]);
    const from: RefreshProgress = { ...fresh(), scanned: 2, failed: 1, total: 2, retrying: ["gone"] };
    const again = await runRefreshBatch(from, io);
    expect(again.progress).toMatchObject({ failed: 0, done: true });
    expect(again.progress.failedIds).toBeUndefined();
  });
});

describe("a refresh on the batch chain", () => {
  // The stored progress in memory, as refreshStore.ts keeps it, batches
  // run at once on their message.
  function chain(records: ParsedMessage[], outcomes: Map<string, RecordOutcome>) {
    const { io: batch, refreshed, tick } = batchIo(records, outcomes);
    let stored: BackfillProgress | undefined;
    const queued: ContinueMessage[] = [];
    let regrouped = 0;
    const io: ChainIo<undefined> = {
      change: async (fn) => {
        const { next, result } = fn(stored, 0);
        if (next) stored = next;
        return { state: undefined, generation: 0, result };
      },
      runBatch: (_state, from) => runRefreshBatch(from, batch),
      publish: async (message) => void queued.push({ ...message, kind: "refresh" }),
      now: batch.now,
      log: () => {},
      sleep: async (ms) => void tick(ms),
      newWake: () => "wake",
      finished: async () => void (regrouped += 1),
    };
    return { io, queued, refreshed, progress: () => stored as RefreshProgress | undefined, regrouped: () => regrouped };
  }

  it("carries on past the model's rate limit by itself, reading that email again", async () => {
    const outcomes = new Map<string, RecordOutcome>([["m2", { kind: "rateLimited", by: "model" }]]);
    const c = chain([record("m1"), record("m2"), record("m3")], outcomes);
    await startBackfill(uid, "run1", false, c.io);
    expect(await continueBackfill(c.queued.shift()!, c.io)).toMatchObject({ kind: "ran" });
    expect(c.progress()).toMatchObject({ running: true, scanned: 1, cursor: "m1", done: false });
    expect(c.progress()?.lastFailed).toBeUndefined();

    // The model is free again by the time the next batch runs.
    outcomes.delete("m2");
    expect(c.queued[0]).toMatchObject({ kind: "refresh", run: "run1" });
    while (c.queued.length) await continueBackfill(c.queued.shift()!, c.io);
    expect(c.refreshed).toEqual(["m1", "m2", "m2", "m3"]);
    expect(c.progress()).toMatchObject({ done: true, scanned: 3, total: 3, updated: 3 });
    expect(c.regrouped()).toBe(1);
  });

  it("reads through an email that keeps failing, lists it, and tries only it again on Try again", async () => {
    const outcomes = new Map<string, RecordOutcome>([["m2", { kind: "failed" }]]);
    const c = chain([record("m1"), record("m2"), record("m3")], outcomes);
    await startBackfill(uid, "run1", false, c.io);
    while (c.queued.length) await continueBackfill(c.queued.shift()!, c.io);
    expect(c.refreshed).toEqual(["m1", "m2", "m3", "m2"]);
    expect(c.progress()).toMatchObject({ done: true, scanned: 3, failed: 1, failedIds: ["m2"] });

    outcomes.delete("m2");
    await startBackfill(uid, "run2", false, c.io, undefined, true);
    expect(c.progress()).toMatchObject({ done: false, retrying: ["m2"] });
    while (c.queued.length) await continueBackfill(c.queued.shift()!, c.io);
    expect(c.refreshed).toEqual(["m1", "m2", "m3", "m2", "m2"]);
    expect(c.progress()).toMatchObject({ done: true, scanned: 3, failed: 0, updated: 3 });
    expect(c.progress()?.failedIds).toBeUndefined();
  });
});

describe("Refresh everything from email", () => {
  const patterns = { allow: [], deny: [] };
  it("reads every email from a mailbox, whatever was made of it, but one today's pre-filter still passes over", () => {
    const wanted = refreshesEverything(patterns, now);
    expect(wanted(record("a1"))).toBe(true);
    // Not a booking to today's reader too, and from a sender that is no travel company.
    expect(wanted(record("a2", { outcome: "not_booking", readerVersion, from: "Shop <orders@shop.example>" }))).toBe(true);
    expect(wanted(record("a3", { outcome: "failed" }))).toBe(true);
    // Passed over before, now a travel company's booking email.
    expect(wanted(record("a4", { outcome: "filtered", from: "QR ebooking <ebooking@qatarairways.com.qa>", subject: "Booking confirmation : 9JRJRI" }))).toBe(true);
    // Still a newsletter.
    expect(wanted(record("a5", { outcome: "filtered", from: "Shop <news@shop.example>", subject: "Our summer sale" }))).toBe(false);
    expect(wanted(record("a6", { outcome: "cancellation" }))).toBe(false);
    expect(wanted(record("ics-a7", { source: "ics" }))).toBe(false);
    // A claim a worker is still reading.
    expect(wanted(record("a8", { outcome: "processing", processedAt: now }))).toBe(false);
  });

  it("reads them on the batch chain, keeping that it reads everything", async () => {
    const { io, refreshed } = batchIo([
      record("b1"),
      record("b2", { outcome: "not_booking", readerVersion, from: "Shop <orders@shop.example>" }),
      record("b3", { outcome: "filtered", from: "QR ebooking <ebooking@qatarairways.com.qa>", subject: "Booking confirmation : 9JRJRI" }),
      record("b4", { outcome: "filtered", from: "Shop <news@shop.example>", subject: "Our summer sale" }),
    ]);
    const batch = await runRefreshBatch({ ...fresh(), everything: true }, io);
    expect(refreshed).toEqual(["b1", "b2", "b3"]);
    expect(batch.progress).toMatchObject({ scanned: 3, total: 3, done: true, everything: true });
    // A plain refresh reads only the first.
    const plain = batchIo([record("b1"), record("b2", { outcome: "not_booking", readerVersion, from: "Shop <orders@shop.example>" })]);
    await runRefreshBatch(fresh(), plain.io);
    expect(plain.refreshed).toEqual(["b1"]);
  });

  it("brings an email's loyalty numbers up to date, keeping those of emails it does not read", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));
    w.memory.parsed.set(`${uid}/m1`, record("m1"));
    const before = "2027-01-01T00:00:00Z";
    // An older reader took a wrong number from this email; a forward gave another.
    w.memory.foundLoyalty.set(uid, [
      { program: "Cove Club", number: "CC 9999", messageId: "m1", at: before },
      { program: "Example Air", number: "EA 123", messageId: "fwd-1", at: before },
    ]);
    const withNumber: ExtractedBooking = { ...found(stay), memberships: [{ program: "Cove Club", number: "CC 4455" }] };
    const since = "2027-01-02T00:00:00Z";
    await refreshEmail(uid, record("m1"), email("m1"), w.deps(async () => withNumber), { generation: 0, snapshot: await w.memory.listUserSegments(uid), loyaltySince: since });
    expect(w.memory.foundLoyalty.get(uid)?.map((f) => f.number).sort()).toEqual(["CC 4455", "EA 123"]);
    // A plain refresh leaves found loyalty as it is.
    const plain = world();
    plain.put(trip("t1"), booking("m1-0", "t1", stay));
    await refreshEmail(uid, record("m1"), email("m1"), plain.deps(async () => withNumber), { generation: 0, snapshot: await plain.memory.listUserSegments(uid) });
    expect(plain.memory.foundLoyalty.get(uid)).toBeUndefined();
  });

  it("leaves the numbers an email gave before when today's can't be saved", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));
    const before = [{ program: "Cove Club", number: "CC 4455", messageId: "m1", at: "2027-01-01T00:00:00Z" }];
    w.memory.foundLoyalty.set(uid, before);
    const deps = w.deps(async () => ({ ...found(stay), memberships: [{ program: "Cove Club", number: "CC 4455" }] }));
    const failing = { ...deps, store: { ...deps.store, addFoundLoyalty: async () => Promise.reject(new Error("Firestore unavailable")) } };
    await refreshEmail(uid, record("m1"), email("m1"), failing, { generation: 0, snapshot: await w.memory.listUserSegments(uid), loyaltySince: "2027-01-02T00:00:00Z" });
    expect(w.memory.foundLoyalty.get(uid)).toEqual(before);
  });

  it("brings no numbers back once the user started over during the refresh", async () => {
    const w = world();
    w.put(trip("t1"), booking("m1-0", "t1", stay));
    const before = [{ program: "Cove Club", number: "CC 9999", messageId: "m1", at: "2027-01-01T00:00:00Z" }];
    w.memory.foundLoyalty.set(uid, before);
    // Delete everything and start over runs while the model reads the email.
    const deps = w.deps(async () => {
      await w.memory.withUserLock(uid, async (tx) => tx.bumpGeneration());
      return { ...found(stay), memberships: [{ program: "Cove Club", number: "CC 4455" }] };
    });
    await expect(refreshEmail(uid, record("m1"), email("m1"), deps, { generation: 0, snapshot: await w.memory.listUserSegments(uid), loyaltySince: "2027-01-02T00:00:00Z" })).rejects.toBeInstanceOf(ImportSupersededError);
    expect(w.memory.foundLoyalty.get(uid)).toEqual(before);
    expect(w.logged).toContain("memberships_superseded");
  });

  it("leaves the numbers of an email another worker is reading", async () => {
    const w = world();
    const judged = record("m1", { outcome: "not_booking", segmentIds: [], tripId: undefined, from: "Cove <stay@cove.example>" });
    w.memory.parsed.set(`${uid}/m1`, judged);
    const before = [{ program: "Cove Club", number: "CC 4455", messageId: "m1", at: "2027-01-01T00:00:00Z" }];
    w.memory.foundLoyalty.set(uid, before);
    // Another worker claimed it after the refresh listed it.
    expect(await w.memory.reclaimMessage(uid, "m1", now)).toBe(true);
    const outcome = await refreshRecord(uid, judged, w.deps(async () => ({ isBooking: false, segments: [] })), { generation: 0, snapshot: [], fetch: async () => email("m1"), loyaltySince: "2027-01-02T00:00:00Z" });
    expect(outcome.kind).toBe("refreshed");
    expect(w.memory.foundLoyalty.get(uid)).toEqual(before);
  });

  it("starts over with its flag, which a refresh carried on keeps and a plain one started over drops", async () => {
    let stored: BackfillProgress | undefined = { scanned: 5, imported: 5, failed: 0, done: true, updatedAt: now };
    const io = {
      change: async (fn: (current: BackfillProgress | undefined, generation: number) => { next?: BackfillProgress; result: unknown }) => {
        const { next, result } = fn(stored, 0);
        if (next) stored = next;
        return { state: undefined, generation: 0, result };
      },
      publish: async () => {},
      now: () => now,
      log: () => {},
    } as unknown as ChainIo<undefined>;
    await startBackfill(uid, "run1", true, io, undefined, false, { everything: true, everythingFrom: now });
    expect(stored).toMatchObject({ scanned: 0, everything: true, everythingFrom: now });
    await startBackfill(uid, "run2", true, io);
    expect((stored as RefreshProgress).everything).toBeUndefined();
  });
});
