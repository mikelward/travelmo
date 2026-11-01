import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { paths, type ExtractedSegment, type Segment, type Trip } from "@travelmo/core";
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteSegment, deleteTrip, fitTripDates, renameTrip, saveSegment } from "./edits";

// Runs inside `firebase emulators:exec` with the real rules loaded, so these
// workflows are exercised the way the browser runs them.
let env: RulesTestEnvironment;
const owner = { uid: "owner", email: "owner@example.com" };
const partner = { uid: "partner", email: "partner@example.com" };

const trip: Trip = {
  id: "t1",
  title: "Liverpool",
  start: "2026-12-12",
  end: "2026-12-14",
  ownerUid: owner.uid,
  sharedWith: [partner.email],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const imported: Segment = {
  id: "s1",
  tripId: trip.id,
  type: "lodging",
  title: "Cove Liverpool",
  start: "2026-12-12T15:00:00+00:00",
  end: "2026-12-14T11:00:00+00:00",
  destination: { name: "Cove Liverpool", city: "Liverpool", country: "GB" },
  source: "gmail",
  gmailMessageIds: ["m1"],
  sender: "cove.example",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const flight = (day: string): ExtractedSegment => ({
  type: "flight",
  title: `Flight on ${day}`,
  start: `${day}T08:00:00+00:00`,
  end: `${day}T09:00:00+00:00`,
});

// The test environment hands out compat instances; the modular functions
// accept them at runtime, so only the type needs persuading.
const as = (user: { uid: string; email: string }) =>
  env.authenticatedContext(user.uid, { email: user.email, email_verified: true }).firestore() as unknown as Firestore;
const asOwner = () => as(owner);
const readTrip = async () => (await getDoc(doc(asOwner(), paths.trip(trip.id)))).data() as Trip | undefined;
const seed = (fn: (db: Firestore) => Promise<void>) =>
  env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore() as unknown as Firestore));

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-travelmo",
    firestore: { rules: readFileSync(new URL("../../../../firestore.rules", import.meta.url), "utf8") },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, paths.trip(trip.id)), trip);
    await setDoc(doc(db, paths.segment(trip.id, imported.id)), imported);
  });
});

describe("saveSegment", () => {
  it("adds a manual segment and widens the trip to include it", async () => {
    const saved = await saveSegment(asOwner(), trip.id, flight("2026-12-16"));
    expect(saved).toMatchObject({ source: "manual", gmailMessageIds: [], tripId: trip.id });
    const stored = (await getDoc(doc(asOwner(), paths.segment(trip.id, saved.id)))).data();
    expect(stored).toMatchObject({ title: "Flight on 2026-12-16", source: "manual" });
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-16" });
  });

  it("keeps an edited segment's identity and widens backwards too", async () => {
    const saved = await saveSegment(asOwner(), trip.id, { ...imported, start: "2026-12-10T15:00:00+00:00", title: "Renamed" }, imported);
    expect(saved).toMatchObject({ id: imported.id, source: "gmail", gmailMessageIds: ["m1"], sender: "cove.example", createdAt: imported.createdAt });
    expect((await getDoc(doc(asOwner(), paths.segment(trip.id, imported.id)))).data()?.sender).toBe("cove.example");
    expect(await readTrip()).toMatchObject({ start: "2026-12-10", end: "2026-12-14" });
  });

  it("counts two concurrent saves from the same stale view", async () => {
    await Promise.all([
      saveSegment(asOwner(), trip.id, flight("2026-12-18")),
      saveSegment(asOwner(), trip.id, flight("2026-12-17")),
    ]);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-18" });
    expect((await getDocs(collection(asOwner(), paths.segments(trip.id)))).size).toBe(3);
  });

  it("lets a sharee add and edit bookings, widening the trip as needed", async () => {
    const saved = await saveSegment(as(partner), trip.id, flight("2026-12-16"));
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-16", title: "Liverpool" });
    await saveSegment(as(partner), trip.id, { ...flight("2026-12-16"), title: "Edited by partner" }, saved);
    expect((await getDoc(doc(asOwner(), paths.segment(trip.id, saved.id)))).data()?.title).toBe("Edited by partner");
    await deleteSegment(as(partner), trip.id, saved.id);
    expect((await getDoc(doc(asOwner(), paths.segment(trip.id, saved.id)))).exists()).toBe(false);
  });

  it("keeps renaming and deleting the trip to the owner", async () => {
    await expect(renameTrip(as(partner), trip.id, "Mine")).rejects.toThrow();
    await expect(deleteTrip(as(partner), trip.id)).rejects.toThrow();
    expect(await readTrip()).toMatchObject({ title: "Liverpool" });
  });

  it("refuses a trip that is being deleted", async () => {
    await seed((db) => setDoc(doc(db, paths.trip(trip.id)), { ...trip, deleting: true }));
    await expect(saveSegment(asOwner(), trip.id, flight("2026-12-16"))).rejects.toThrow(/being deleted/);
  });
});

describe("deleteSegment", () => {
  it("removes the segment and leaves the bounds alone", async () => {
    await deleteSegment(asOwner(), trip.id, imported.id);
    expect((await getDoc(doc(asOwner(), paths.segment(trip.id, imported.id)))).exists()).toBe(false);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-14" });
  });
});

describe("fitTripDates", () => {
  it("snaps the trip back to the span of its bookings", async () => {
    const late = await saveSegment(asOwner(), trip.id, flight("2026-12-20"));
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-20" });
    await deleteSegment(asOwner(), trip.id, late.id);
    expect(await readTrip()).toMatchObject({ end: "2026-12-20" });
    expect(await fitTripDates(asOwner(), trip.id)).toBe(true);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-14" });
  });

  it("does nothing for a trip with no bookings", async () => {
    await deleteSegment(asOwner(), trip.id, imported.id);
    expect(await fitTripDates(asOwner(), trip.id)).toBe(false);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-14" });
  });

  it("re-reads when a booking lands between the read and the write", async () => {
    const late = await saveSegment(asOwner(), trip.id, flight("2026-12-20"));
    await deleteSegment(asOwner(), trip.id, late.id);
    let raced = false;
    const applied = await fitTripDates(asOwner(), trip.id, {
      afterRead: async () => {
        if (raced) return;
        raced = true;
        await saveSegment(as(partner), trip.id, flight("2026-12-25"));
      },
    });
    expect(applied).toBe(true);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-25" });
  });

  it("is refused for a sharee when it would narrow the trip", async () => {
    const late = await saveSegment(asOwner(), trip.id, flight("2026-12-20"));
    await deleteSegment(asOwner(), trip.id, late.id);
    await expect(fitTripDates(as(partner), trip.id)).rejects.toThrow();
    expect(await readTrip()).toMatchObject({ end: "2026-12-20" });
  });
});

describe("renameTrip", () => {
  it("trims and saves the title", async () => {
    await renameTrip(asOwner(), trip.id, "  Liverpool weekend ");
    expect((await readTrip())?.title).toBe("Liverpool weekend");
  });
});

describe("deleteTrip", () => {
  it("removes the trip and all its segments", async () => {
    await saveSegment(asOwner(), trip.id, flight("2026-12-16"));
    await deleteTrip(asOwner(), trip.id);
    expect(await readTrip()).toBeUndefined();
    await seed(async (db) => {
      expect((await getDocs(collection(db, paths.segments(trip.id)))).size).toBe(0);
    });
  });

  it("finishes a deletion that was interrupted after the marker, including bookings added meanwhile by the server", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, paths.trip(trip.id)), { ...trip, deleting: true });
      await setDoc(doc(db, paths.segment(trip.id, "late")), { ...imported, id: "late" });
    });
    await assertFails(setDoc(doc(asOwner(), paths.segment(trip.id, "later")), { ...imported, id: "later", source: "manual" }));
    await deleteTrip(asOwner(), trip.id);
    expect(await readTrip()).toBeUndefined();
    await seed(async (db) => {
      expect((await getDocs(collection(db, paths.segments(trip.id)))).size).toBe(0);
    });
  });

  it("is a no-op for a trip that is already gone", async () => {
    await deleteTrip(asOwner(), "missing");
  });
});
