import { mailboxKey, paths, type ExtractedBooking, type Segment, type Trip } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import type { EmailMessage } from "./gmail";
import type { BackfillBatch } from "./backfill";
import { continueBackfill, startBackfill, type ChainIo, type ContinueMessage } from "./backfillChain";
import { changeBackfill, loadMailbox, saveConnection, updateHistoryId } from "./connections";
import { AccountDeletedError } from "./deleted";
import { cancelImported, emptyCounts, importMessage, importStructured, importTripIt, type ImportDeps } from "./importer";
import { firestoreRetryStore, memoryRetryStore } from "./geocodeSweep";
import { firestoreStore } from "./store";
import { memoryStore } from "./testStore";
import { deleteOldRetries, deleteOwnTrips, resetTrips } from "./tripsReset";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);

const at = "2026-11-01T12:00:00Z";
const trip = (id: string, ownerUid: string, sharedWith: string[] = []): Trip => ({
  id,
  title: id,
  start: "2026-12-12",
  end: "2026-12-14",
  ownerUid,
  sharedWith,
  createdAt: at,
  updatedAt: at,
});
const segment = (tripId: string, id: string, extra: Partial<Segment> = {}): Segment => ({
  id,
  tripId,
  type: "lodging",
  title: "Cove Liverpool",
  start: "2026-12-12T15:00:00+00:00",
  source: "gmail",
  gmailMessageIds: [id],
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const put = async (t: Trip, segments: Segment[]) => {
  await db.doc(paths.trip(t.id)).set(t);
  for (const s of segments) await db.doc(paths.segment(t.id, s.id)).set(s);
};
const quiet = () => {};

describe("resetTrips", () => {
  it("deletes the user's own trips and import records, and nothing else of theirs", async () => {
    const uid = "reset-u1";
    const backfill = { scanned: 300, imported: 12, done: true, updatedAt: at };
    await db.doc(paths.user(uid)).set({
      email: "owner@example.com",
      gmail: { emailAddress: "owner@example.com", connectedAt: at, backfill },
      homes: [{ city: "London", country: "GB", from: "2021-03-12" }],
    });
    await db.doc(paths.gmailState(uid)).set({ emailAddress: "owner@example.com", refreshToken: "token", backfill });
    // A second mailbox, connected since there could be several.
    await db.doc(paths.user(uid)).update(new FieldPath("gmails", "trips@example.org"), { emailAddress: "trips@example.org", connectedAt: at, backfill });
    await db.doc(paths.gmailMailbox(uid, mailboxKey("trips@example.org"))).set({ emailAddress: "trips@example.org", refreshToken: "token2", backfill });
    await db.doc(paths.travelProfile(uid)).set({ ownerUid: uid, trustedEmails: [] });
    await put(trip("reset-own-1", uid), [segment("reset-own-1", "m1-0", { rating: 5, favorite: true }), segment("reset-own-1", "m1-1")]);
    await put(trip("reset-own-2", uid), []);
    // Someone else's trip shared with the user, with a booking the user added.
    await put(trip("reset-theirs", "reset-other", ["owner@example.com"]), [segment("reset-theirs", "added-0")]);
    await db.doc(paths.parsedMessage(uid, "m1")).set({ messageId: "m1", uid, outcome: "imported", segmentIds: ["m1-0"], processedAt: at });
    await db.doc(paths.parsedMessage(uid, "m2")).set({ messageId: "m2", uid, outcome: "not_booking", segmentIds: [], processedAt: at });
    await db.doc(paths.geocodeRetry("reset-own-1", "m1-0")).set({ uid, tripId: "reset-own-1", segmentId: "m1-0", at });
    await db.doc(paths.pendingCancellation(uid, "m3")).set({ messageId: "m3", uid, cancellations: [{ confirmation: "CV-1" }], at });

    expect(await resetTrips(db, uid, quiet)).toEqual({ trips: 2 });
    expect((await db.collection(paths.pendingCancellations(uid)).get()).empty).toBe(true);

    expect((await db.doc(paths.trip("reset-own-1")).get()).exists).toBe(false);
    expect((await db.doc(paths.trip("reset-own-2")).get()).exists).toBe(false);
    expect((await db.collection(paths.segments("reset-own-1")).get()).empty).toBe(true);
    expect((await db.collection(paths.parsedMessages(uid)).get()).empty).toBe(true);
    expect((await db.doc(paths.geocodeRetry("reset-own-1", "m1-0")).get()).exists).toBe(false);

    expect((await db.doc(paths.trip("reset-theirs")).get()).exists).toBe(true);
    expect((await db.doc(paths.segment("reset-theirs", "added-0")).get()).exists).toBe(true);
    expect((await db.doc(paths.travelProfile(uid)).get()).exists).toBe(true);
    const user = (await db.doc(paths.user(uid)).get()).data();
    expect(user?.homes).toEqual([{ city: "London", country: "GB", from: "2021-03-12" }]);
    expect(user?.gmail).toEqual({ emailAddress: "owner@example.com", connectedAt: at });
    expect(user?.gmails).toEqual({ "trips@example.org": { emailAddress: "trips@example.org", connectedAt: at } });
    expect((await db.doc(paths.gmailState(uid)).get()).data()).toEqual({ emailAddress: "owner@example.com", refreshToken: "token" });
    expect((await db.doc(paths.gmailMailbox(uid, mailboxKey("trips@example.org"))).get()).data()).toEqual({ emailAddress: "trips@example.org", refreshToken: "token2" });
  });

  it("files the same email again afterwards", async () => {
    const uid = "reset-u2";
    const store = firestoreStore(db);
    const lodging: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "lodging", title: "Cove Liverpool", start: "2026-12-12T15:00:00+00:00", destination: { name: "Cove Liverpool", city: "Liverpool", country: "GB" } }],
    };
    const deps: ImportDeps = { store, extract: async () => lodging, now: () => new Date().toISOString(), log: quiet };
    const email: EmailMessage = {
      id: "again",
      threadId: "t",
      from: "Cove <stay@cove.example>",
      subject: "Your booking confirmation - Cove Liverpool",
      date: "Mon, 1 Nov 2026 10:00:00 +0000",
      listUnsubscribe: false,
      text: "Check-in 12 Dec",
    };
    const owned = async () => (await db.collection(paths.trips()).where("ownerUid", "==", uid).get()).size;
    expect(await importMessage(uid, email, deps)).toBe("imported");
    expect(await importMessage(uid, email, deps)).toBe("skipped");
    await resetTrips(db, uid, quiet);
    expect(await owned()).toBe(0);
    expect(await importMessage(uid, email, deps)).toBe("imported");
    expect(await owned()).toBe(1);
  });

  it("deletes a trip with more bookings than one pass can, over several", async () => {
    const uid = "reset-u3";
    await put(
      trip("reset-big", uid),
      Array.from({ length: 7 }, (_, i) => segment("reset-big", `b${i}`)),
    );
    expect(await deleteOwnTrips(uid, firestoreStore(db), 3)).toEqual({ trips: 1 });
    expect((await db.doc(paths.trip("reset-big")).get()).exists).toBe(false);
    expect((await db.collection(paths.segments("reset-big")).get()).empty).toBe(true);
  });

  describe("an import running when the trips are deleted", () => {
    const lodging: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "lodging", title: "Cove Liverpool", start: "2026-12-12T15:00:00+00:00", destination: { name: "Cove Liverpool", city: "Liverpool", country: "GB" } }],
    };
    const email: EmailMessage = {
      id: "racing",
      threadId: "t",
      from: "Cove <stay@cove.example>",
      subject: "Your booking confirmation - Cove Liverpool",
      date: "Mon, 1 Nov 2026 10:00:00 +0000",
      listUnsubscribe: false,
      text: "Check-in 12 Dec",
    };
    const deps = (store: ReturnType<typeof memoryStore>, extract: ImportDeps["extract"]): ImportDeps => ({
      store,
      extract,
      now: () => new Date().toISOString(),
      log: quiet,
    });

    it("files nothing when the reset comes while the email is being read", async () => {
      const store = memoryStore();
      const extract = async () => {
        await deleteOwnTrips("u1", store);
        return lodging;
      };
      expect(await importMessage("u1", email, deps(store, extract))).toBe("skipped");
      expect(store.trips.size).toBe(0);
      expect(store.parsed.has("u1/racing")).toBe(false);
      expect(await importMessage("u1", email, deps(store, async () => lodging))).toBe("imported");
      expect(store.trips.size).toBe(1);
    });

    it("adds nothing to a booking found again when the reset comes while the second email is read", async () => {
      const store = memoryStore();
      const retries = memoryRetryStore();
      const showing = (title: string, confirmation: string, extra: object = {}): ExtractedBooking => ({
        isBooking: true,
        segments: [{ type: "activity", title, provider: "Everyman", confirmation, start: "2026-11-08T12:00:00+00:00", ...extra }],
      });
      const reservation = showing("Wild Horse Nine at Everyman", "WQFXR5T");
      const booked = showing("Wild Horse Nine at Muswell Hill", "615858", {
        end: "2026-11-10T14:00:00+00:00",
        notes: "Screen 3, seats C8 and C7",
        destination: { name: "Everyman Muswell Hill", city: "London", country: "GB" },
      });
      const cinema = (id: string): EmailMessage => ({ ...email, id, from: "Everyman <tickets@everymancinema.com>", subject: `Booking confirmation for Wild Horse Nine ${id}` });
      const plain = { ...deps(store, async () => reservation), geocode: async () => "later" as const, geocodeRetries: retries };
      expect(await importMessage("u1", cinema("first"), plain)).toBe("imported");
      // While the second email is read, the user deletes all trips and the
      // first comes in again under the new generation.
      const extract = async () => {
        await deleteOwnTrips("u1", store);
        expect(await importMessage("u1", cinema("first"), plain)).toBe("imported");
        return booked;
      };
      expect(await importMessage("u1", cinema("second"), { ...plain, extract })).toBe("skipped");
      // Only what the first email, read again, made: no seats, no end, no
      // second source, and its trip no wider.
      expect(store.segments.size).toBe(1);
      const [kept] = [...store.segments.values()];
      expect([kept!.notes, kept!.end, kept!.confirmation]).toEqual([undefined, undefined, "WQFXR5T"]);
      expect(kept!.sources?.map((s) => s.id)).toEqual(["first"]);
      expect([...store.trips.values()][0]).toMatchObject({ start: "2026-11-08", end: "2026-11-08" });
      expect(retries.entries.size).toBe(0);
      expect(store.parsed.has("u1/second")).toBe(false);
    });

    it("claims nothing when the reset comes between reading the generation and the claim", async () => {
      const store = memoryStore();
      const read = store.resetGeneration.bind(store);
      store.resetGeneration = async (uid) => {
        const generation = await read(uid);
        await deleteOwnTrips(uid, store);
        return generation;
      };
      expect(await importMessage("u1", email, deps(store, async () => lodging))).toBe("skipped");
      expect(store.parsed.has("u1/racing")).toBe(false);
      expect(store.trips.size).toBe(0);
    });

    it("files nothing from a TripIt upload the reset overtakes", async () => {
      const store = memoryStore();
      const lock = store.withUserLock.bind(store);
      let armed = true;
      store.withUserLock = async (uid, fn) => {
        if (armed) {
          armed = false;
          await deleteOwnTrips(uid, store);
        }
        return lock(uid, fn);
      };
      const item = { id: "tripit-item-1", source: "tripit" as const, title: "Cove Liverpool", segments: lodging.segments };
      expect(await importStructured("u1", item, deps(store, async () => lodging))).toMatchObject({ outcome: "skipped" });
      expect(store.trips.size).toBe(0);
      expect(store.parsed.has("u1/tripit-item-1")).toBe(false);
      // The next upload imports it.
      expect(await importStructured("u1", item, deps(store, async () => lodging))).toMatchObject({ outcome: "imported" });
      expect(store.trips.size).toBe(1);
    });

    it("files nothing from a TripIt upload planned against records the reset then deleted", async () => {
      const store = memoryStore();
      // The reset lands while the upload reads its items' earlier records.
      const getParsed = store.getParsed.bind(store);
      let armed = true;
      store.getParsed = async (uid, id) => {
        const record = await getParsed(uid, id);
        if (armed) {
          armed = false;
          await deleteOwnTrips(uid, store);
        }
        return record;
      };
      const upload = {
        trips: [{ key: "k1", title: "Liverpool", start: "2026-12-12", end: "2026-12-14", segments: lodging.segments }],
        unfiled: [],
        skipped: [],
        floating: 0,
      };
      expect(await importTripIt("u1", upload, deps(store, async () => lodging))).toMatchObject({ imported: 0, skipped: 1 });
      expect(store.trips.size).toBe(0);
    });

    it("does not cancel bookings a later import made, for a calendar read from before the reset", async () => {
      const store = memoryStore();
      const event = { ...email, id: "ics-k1" };
      // The calendar read starts, then the reset, then a fresh import of the
      // same event, and only then does the old read act on a cancellation.
      const before = await store.resetGeneration("u1");
      await deleteOwnTrips("u1", store);
      expect(await importMessage("u1", event, deps(store, async () => lodging), { source: "ics" })).toBe("imported");
      expect(await cancelImported("u1", "ics-k1", deps(store, async () => lodging), before)).toBe(0);
      expect(store.segments.size).toBe(1);
      expect(store.parsed.get("u1/ics-k1")?.outcome).toBe("imported");
    });

    describe("with a cancellation email", () => {
      const numbered: ExtractedBooking = { ...lodging, segments: lodging.segments.map((s) => ({ ...s, confirmation: "CV-1" })) };
      const cancelling: ExtractedBooking = { isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "CV-1" }] };
      const cancelEmail: EmailMessage = { ...email, id: "cancel", subject: "Booking cancelled for Cove Liverpool" };
      // Runs the reset right after the next per-user transaction.
      const resetAfterLock = (store: ReturnType<typeof memoryStore>) => {
        const lock = store.withUserLock.bind(store);
        let armed = true;
        store.withUserLock = async (uid, fn) => {
          const result = await lock(uid, fn);
          if (armed) {
            armed = false;
            await deleteOwnTrips(uid, store);
          }
          return result;
        };
      };

      it("marks nothing and keeps nothing waiting when the reset comes while it is being read", async () => {
        const store = memoryStore();
        const extract = async () => {
          await deleteOwnTrips("u1", store);
          return cancelling;
        };
        expect(await importMessage("u1", cancelEmail, deps(store, extract))).toBe("skipped");
        expect(store.pending.size).toBe(0);
        expect(store.parsed.has("u1/cancel")).toBe(false);
        // Read again, it waits for its booking as before.
        expect(await importMessage("u1", cancelEmail, deps(store, async () => cancelling))).toBe("cancellation");
        expect(store.pending.size).toBe(1);
      });

      it("records nothing when the reset comes after it marked its booking", async () => {
        const store = memoryStore();
        await importMessage("u1", email, deps(store, async () => numbered));
        resetAfterLock(store);
        expect(await importMessage("u1", cancelEmail, deps(store, async () => cancelling))).toBe("cancellation");
        // The reset took the booking and the waiting cancellation; no record is left naming them.
        expect(store.segments.size).toBe(0);
        expect(store.pending.size).toBe(0);
        expect(store.parsed.has("u1/cancel")).toBe(false);
      });

      it("files no booking cancelled by a cancellation the reset cleared", async () => {
        const store = memoryStore();
        await importMessage("u1", cancelEmail, deps(store, async () => cancelling));
        expect(store.pending.size).toBe(1);
        await deleteOwnTrips("u1", store);
        expect(store.pending.size).toBe(0);
        expect(await importMessage("u1", email, deps(store, async () => numbered))).toBe("imported");
        expect([...store.segments.values()][0]?.cancelledAt).toBeUndefined();
      });

      it("doesn't write back the cancellation's record when the reset comes after its booking is filed cancelled", async () => {
        const store = memoryStore();
        await importMessage("u1", cancelEmail, deps(store, async () => cancelling));
        resetAfterLock(store);
        expect(await importMessage("u1", email, deps(store, async () => numbered))).toBe("imported");
        expect(store.segments.size).toBe(0);
        expect(store.parsed.has("u1/cancel")).toBe(false);
      });
    });

    it("records nothing when the reset comes after the booking is filed", async () => {
      const store = memoryStore();
      const lock = store.withUserLock.bind(store);
      let armed = true;
      store.withUserLock = async (uid, fn) => {
        const result = await lock(uid, fn);
        if (armed) {
          armed = false;
          await deleteOwnTrips(uid, store);
        }
        return result;
      };
      expect(await importMessage("u1", email, deps(store, async () => lodging))).toBe("imported");
      expect(store.trips.size).toBe(0);
      // No record saying it was imported, with its bookings gone: it is read again.
      expect(store.parsed.has("u1/racing")).toBe(false);
      expect(await importMessage("u1", email, deps(store, async () => lodging))).toBe("imported");
      expect(store.trips.size).toBe(1);
    });
  });

  it("records nothing for an account deleted while an email was being read", async () => {
    const uid = "reset-u4";
    const store = firestoreStore(db);
    const extract: ImportDeps["extract"] = async () => {
      // What deleting the account does first: the marker, then the user's documents.
      await db.doc(paths.deletedAccount(uid)).set({ uid, at });
      await db.recursiveDelete(db.doc(paths.user(uid)));
      return { isBooking: false, segments: [] };
    };
    const email: EmailMessage = {
      id: "gone",
      threadId: "t",
      from: "Cove <stay@cove.example>",
      subject: "Your booking confirmation - Cove Liverpool",
      date: "Mon, 1 Nov 2026 10:00:00 +0000",
      listUnsubscribe: false,
      text: "Check-in 12 Dec",
    };
    await expect(importMessage(uid, email, { store, extract, now: () => new Date().toISOString(), log: quiet })).rejects.toBeInstanceOf(
      AccountDeletedError,
    );
    expect((await db.doc(paths.parsedMessage(uid, "gone")).get()).exists).toBe(false);
  });

  it("does not write a mailbox reading's place back over a reset, and stops the reading", async () => {
    const uid = "reset-u5";
    await saveConnection(db, uid, { emailAddress: "owner@example.com", connectedAt: at, refreshToken: "token" });
    const queued: ContinueMessage[] = [];
    let duringBatch = async () => {};
    const io: ChainIo<unknown> = {
      change: (fn) => changeBackfill(db, uid, "owner@example.com", fn),
      runBatch: async (): Promise<BackfillBatch> => {
        await duringBatch();
        return { counts: { ...emptyCounts(), imported: 3 }, candidates: 300, progress: { cursor: "page-9", scanned: 300, imported: 3, failed: 0, done: false, updatedAt: at } };
      },
      publish: async (message) => {
        queued.push(message);
      },
      now: () => at,
      log: quiet,
      sleep: async () => {},
      newWake: () => "wake-1",
    };
    expect((await startBackfill(uid, "run-1", false, io)).kind).toBe("started");
    // "Delete all trips" lands while the first batch reads.
    duringBatch = async () => {
      await resetTrips(db, uid, quiet);
    };
    expect((await continueBackfill(queued[0]!, io)).kind).toBe("superseded");
    expect((await db.doc(paths.gmailMailbox(uid, mailboxKey("owner@example.com"))).get()).get("backfill")).toBeUndefined();
    expect((await db.doc(paths.user(uid)).get()).get(new FieldPath("gmails", "owner@example.com", "backfill"))).toBeUndefined();
    expect(queued).toHaveLength(1);
    // A copy of the queued batch delivered after the reset is dropped.
    duringBatch = async () => {};
    expect(await continueBackfill(queued[0]!, io)).toEqual({ kind: "stale", reason: "superseded" });
    // A reading started after the reset saves as before.
    expect((await startBackfill(uid, "run-2", false, io)).kind).toBe("started");
    expect((await continueBackfill(queued[1]!, io)).kind).toBe("ran");
    expect((await db.doc(paths.user(uid)).get()).get(new FieldPath("gmails", "owner@example.com", "backfill"))).toMatchObject({ cursor: "page-9", run: "run-2", step: 1, running: true });
  });

  it("keeps the mailbox's history position for a notification the reset overtook", async () => {
    const uid = "reset-u11";
    const store = firestoreStore(db);
    await saveConnection(db, uid, { emailAddress: "owner11@example.com", connectedAt: at, refreshToken: "token", historyId: "100" });
    const before = await store.resetGeneration(uid);
    await resetTrips(db, uid, quiet);
    expect(await updateHistoryId(db, uid, "owner11@example.com", "200", before)).toBe(false);
    expect((await db.doc(paths.gmailMailbox(uid, mailboxKey("owner11@example.com"))).get()).get("historyId")).toBe("100");
    expect(await updateHistoryId(db, uid, "owner11@example.com", "200", await store.resetGeneration(uid))).toBe(true);
  });

  it("forgets the reading position in the pass that moves the generation on", async () => {
    const uid = "reset-u6";
    const store = firestoreStore(db);
    const backfill = { cursor: "page-9", scanned: 2700, imported: 40, done: false, updatedAt: at };
    await db.doc(paths.user(uid)).set({ gmail: { emailAddress: "owner@example.com", connectedAt: at, backfill } });
    await db.doc(paths.gmailState(uid)).set({ emailAddress: "owner@example.com", connectedAt: at, refreshToken: "token", backfill });
    // A mailbox reading that starts the moment the trips are gone, before
    // anything else the reset does, reads the new generation...
    await deleteOwnTrips(uid, store);
    const generation = await store.resetGeneration(uid);
    const state = await loadMailbox(db, uid, "owner@example.com");
    // ...and must not find the old place to carry on from and save again.
    expect(state?.backfill).toBeUndefined();
    expect((await db.doc(paths.user(uid)).get()).get(new FieldPath("gmails", "owner@example.com", "backfill"))).toBeUndefined();
    expect(generation).toBeGreaterThan(0);
  });

  it("queues no place for another look once the trips were reset", async () => {
    const uid = "reset-u7";
    const store = firestoreStore(db);
    const retries = firestoreRetryStore(db);
    const before = await store.resetGeneration(uid);
    await deleteOwnTrips(uid, store);
    await retries.put({ uid, tripId: "gone-trip", segmentId: "gone-0", at }, before);
    expect((await db.doc(paths.geocodeRetry("gone-trip", "gone-0")).get()).exists).toBe(false);
    await retries.put({ uid, tripId: "new-trip", segmentId: "new-0", at }, await store.resetGeneration(uid));
    expect((await db.doc(paths.geocodeRetry("new-trip", "new-0")).get()).exists).toBe(true);
  });

  it("keeps places a later import queued while it clears the reset's own", async () => {
    const uid = "reset-u8";
    const retry = (tripId: string, generation?: number) =>
      db.doc(paths.geocodeRetry(tripId, "s-0")).set({ uid, tripId, segmentId: "s-0", at, ...(generation === undefined ? {} : { generation }) });
    // Queued before the reset, by an import before entries carried one, and
    // by an import that began after the reset's last pass.
    await retry("before", 0);
    await retry("unmarked");
    await retry("after", 1_000);
    await resetTrips(db, uid, quiet);
    expect((await db.doc(paths.geocodeRetry("before", "s-0")).get()).exists).toBe(false);
    expect((await db.doc(paths.geocodeRetry("unmarked", "s-0")).get()).exists).toBe(false);
    expect((await db.doc(paths.geocodeRetry("after", "s-0")).get()).exists).toBe(true);
  });

  it("marks a queued place with the generation it was filed under", async () => {
    const uid = "reset-u9";
    const store = firestoreStore(db);
    await deleteOwnTrips(uid, store);
    const generation = await store.resetGeneration(uid);
    await firestoreRetryStore(db).put({ uid, tripId: "marked", segmentId: "s-0", at }, generation);
    expect((await db.doc(paths.geocodeRetry("marked", "s-0")).get()).get("generation")).toBe(generation);
  });

  it("keeps a place queued again under the same ID while it clears", async () => {
    const uid = "reset-u10";
    const ref = db.doc(paths.geocodeRetry("requeued", "s-0"));
    await ref.set({ uid, tripId: "requeued", segmentId: "s-0", at, generation: 0 });
    // Found as old, then rewritten by an import of the new generation
    // before the delete.
    const deleted = await deleteOldRetries(db, uid, 1, async () => {
      await ref.set({ uid, tripId: "requeued", segmentId: "s-0", at, generation: 1 });
    });
    expect(deleted).toBe(0);
    expect((await ref.get()).get("generation")).toBe(1);
  });
});
