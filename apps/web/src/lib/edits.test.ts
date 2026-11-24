import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { paths, type ExtractedSegment, type Segment, type Trip } from "@travelmo/core";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSegment, deleteTrip, deleteTripIfOnly, favoriteSegment, fitTripDates, mergeTrips, moveSegment, rateSegment, renameTrip, restoreSegment, saveSegment } from "./edits";

// A switch to make reading a collection fail, as when the connection drops.
const failReads = vi.hoisted(() => ({ on: false }));
vi.mock("firebase/firestore", async (importOriginal) => {
  const real = await importOriginal<typeof import("firebase/firestore")>();
  return { ...real, getDocs: ((q: Parameters<typeof real.getDocs>[0]) => (failReads.on ? Promise.reject(new Error("offline")) : real.getDocs(q))) as typeof real.getDocs };
});

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

const other: Trip = {
  ...trip,
  id: "t2",
  title: "Dublin",
  start: "2026-12-20",
  end: "2026-12-22",
  sharedWith: [],
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
    await setDoc(doc(db, paths.trip(other.id)), other);
    await setDoc(doc(db, paths.segment(trip.id, imported.id)), imported);
    // Accounts from before approvals (SPEC "Access").
    await setDoc(doc(db, paths.user(owner.uid)), { email: owner.email });
    await setDoc(doc(db, paths.user(partner.uid)), { email: partner.email });
  });
});

const readOther = async () => (await getDoc(doc(asOwner(), paths.trip(other.id)))).data() as Trip | undefined;
const segmentIds = async (tripId: string) =>
  (await getDocs(collection(asOwner(), paths.segments(tripId)))).docs.map((d) => d.id).sort();

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

  it("records a hand edit, and not a rating, a favorite mark or a move", async () => {
    await rateSegment(asOwner(), trip.id, imported.id, 4);
    await favoriteSegment(asOwner(), trip.id, imported.id, true);
    const stored = async () => (await getDoc(doc(asOwner(), paths.segment(trip.id, imported.id)))).data();
    expect((await stored())?.editedAt).toBeUndefined();
    const saved = await saveSegment(asOwner(), trip.id, { ...imported, title: "Renamed" }, imported);
    expect(saved.editedAt).toBe(saved.updatedAt);
    expect(await stored()).toMatchObject({ editedAt: saved.editedAt, rating: 4, favorite: true });
  });

  it("keeps a source the importer added while the booking was being edited", async () => {
    const added = { kind: "gmail", id: "m9", label: "Your second room", at: "2026-11-02T00:00:00Z" };
    await updateDoc(doc(asOwner(), paths.segment(trip.id, imported.id)), { sources: [added] });
    // The form still holds the booking as it was before the import.
    await saveSegment(asOwner(), trip.id, { ...imported, title: "Renamed" }, imported);
    const stored = (await getDoc(doc(asOwner(), paths.segment(trip.id, imported.id)))).data();
    expect(stored).toMatchObject({ title: "Renamed", sources: [added], gmailMessageIds: ["m1"] });
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

describe("cancelled bookings", () => {
  const cancel = () =>
    seed(async (db) => {
      await updateDoc(doc(db, paths.segment(trip.id, imported.id)), { cancelledAt: "2026-11-05T09:00:00Z", cancelledBy: "m2" });
    });
  const stored = async () => (await getDoc(doc(asOwner(), paths.segment(trip.id, imported.id)))).data();

  it("stay cancelled when edited", async () => {
    await cancel();
    await saveSegment(asOwner(), trip.id, { ...imported, title: "Renamed" }, imported);
    expect(await stored()).toMatchObject({ title: "Renamed", cancelledAt: "2026-11-05T09:00:00Z", cancelledBy: "m2" });
  });

  it("widen only the trip's own dates when edited, not those it is shown with", async () => {
    await cancel();
    await seed(async (db) => {
      await updateDoc(doc(db, paths.trip(trip.id)), { start: "2026-12-13", end: "2026-12-13" });
    });
    await saveSegment(as(partner), trip.id, { ...imported, title: "Renamed" }, imported);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-14", liveStart: "2026-12-13", liveEnd: "2026-12-13" });
  });

  it("can be restored by the owner or a sharee", async () => {
    await cancel();
    await restoreSegment(as(partner), trip.id, imported.id);
    const data = await stored();
    expect(data?.cancelledAt).toBeUndefined();
    expect(data?.cancelledBy).toBeUndefined();
    // Remembered, so the importer doesn't cancel it again; an edit keeps it.
    expect(data?.restoredFrom).toEqual(["m2"]);
    // And when, so no cancellation sent before it applies again.
    expect(data?.restoredAt).toEqual(expect.any(String));
    await saveSegment(asOwner(), trip.id, { ...imported, title: "Renamed" }, imported);
    expect((await stored())?.restoredFrom).toEqual(["m2"]);
    expect((await stored())?.restoredAt).toBe(data?.restoredAt);
  });

  it("widen the trip again when restored after Fit dates narrowed it", async () => {
    await cancel();
    await seed(async (db) => {
      await updateDoc(doc(db, paths.trip(trip.id)), { start: "2026-12-13", end: "2026-12-13" });
    });
    await restoreSegment(as(partner), trip.id, imported.id);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-14" });
  });

  // The trip as the parser leaves it: 12-18 December, shown as the 18th
  // only while the 12-14 stay is cancelled.
  const showingOnlyThe18th = async () => {
    await cancel();
    await seed(async (db) => {
      await updateDoc(doc(db, paths.trip(trip.id)), { start: "2026-12-12", end: "2026-12-18", liveStart: "2026-12-18", liveEnd: "2026-12-18" });
    });
  };

  it("show the trip for all its dates again once restored", async () => {
    await showingOnlyThe18th();
    await restoreSegment(as(partner), trip.id, imported.id);
    const restored = await readTrip();
    expect(restored).toMatchObject({ start: "2026-12-12", end: "2026-12-18" });
    expect(restored?.liveStart).toBeUndefined();
    expect(restored?.liveEnd).toBeUndefined();
  });

  it("widen the dates the trip is shown with for a booking added meanwhile", async () => {
    await showingOnlyThe18th();
    await saveSegment(as(partner), trip.id, flight("2026-12-16"));
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-18", liveStart: "2026-12-16", liveEnd: "2026-12-18" });
  });

  it("fit the trip to every booking, cancelled ones too, shown by what is still booked", async () => {
    await showingOnlyThe18th();
    await saveSegment(asOwner(), trip.id, flight("2026-12-18"));
    await seed(async (db) => {
      await updateDoc(doc(db, paths.trip(trip.id)), { start: "2026-12-01", end: "2026-12-31", liveStart: "2026-12-10", liveEnd: "2026-12-20" });
    });
    expect(await fitTripDates(asOwner(), trip.id)).toBe(true);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-18", liveStart: "2026-12-18", liveEnd: "2026-12-18" });
  });
});

describe("deleteSegment", () => {
  it("removes the segment and leaves the bounds alone", async () => {
    await deleteSegment(asOwner(), trip.id, imported.id);
    expect((await getDoc(doc(asOwner(), paths.segment(trip.id, imported.id)))).exists()).toBe(false);
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-14" });
  });
});

describe("deleteTripIfOnly", () => {
  it("deletes the trip when its bookings are still just the ones expected", async () => {
    expect(await deleteTripIfOnly(asOwner(), trip.id, [imported.id])).toBe(true);
    expect(await readTrip()).toBeUndefined();
  });

  it("keeps the trip, unlocked, when another booking arrived", async () => {
    await saveSegment(asOwner(), trip.id, flight("2026-12-13"));
    expect(await deleteTripIfOnly(asOwner(), trip.id, [imported.id])).toBe(false);
    expect(await readTrip()).toMatchObject({ deleting: false });
    expect((await segmentIds(trip.id)).length).toBe(2);
  });

  it("unlocks the trip when its bookings can't be read", async () => {
    failReads.on = true;
    try {
      await expect(deleteTripIfOnly(asOwner(), trip.id, [imported.id])).rejects.toThrow("offline");
    } finally {
      failReads.on = false;
    }
    expect(await readTrip()).toMatchObject({ deleting: false });
    expect(await segmentIds(trip.id)).toEqual([imported.id]);
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

describe("moveSegment", () => {
  it("moves a booking to another trip, keeping its id and widening the target", async () => {
    await moveSegment(asOwner(), trip.id, imported.id, other.id);
    expect(await segmentIds(trip.id)).toEqual([]);
    expect(await segmentIds(other.id)).toEqual([imported.id]);
    const moved = (await getDoc(doc(asOwner(), paths.segment(other.id, imported.id)))).data();
    expect(moved).toMatchObject({ tripId: other.id, title: imported.title, source: "gmail", sender: "cove.example" });
    // A move is no edit of the booking's details.
    expect(moved?.editedAt).toBeUndefined();
    expect(await readOther()).toMatchObject({ start: "2026-12-12", end: "2026-12-22" });
    expect(await readTrip()).toMatchObject({ start: "2026-12-12", end: "2026-12-14" });
  });

  it("moves a cancelled booking still cancelled, widening only the target's own dates", async () => {
    await seed(async (db) => {
      await updateDoc(doc(db, paths.segment(trip.id, imported.id)), { cancelledAt: "2026-11-05T09:00:00Z", cancelledBy: "m2" });
    });
    await moveSegment(asOwner(), trip.id, imported.id, other.id);
    expect(await segmentIds(other.id)).toEqual([imported.id]);
    const moved = (await getDoc(doc(asOwner(), paths.segment(other.id, imported.id)))).data();
    expect(moved).toMatchObject({ tripId: other.id, cancelledAt: "2026-11-05T09:00:00Z", cancelledBy: "m2" });
    expect(await readOther()).toMatchObject({ start: "2026-12-12", end: "2026-12-22", liveStart: "2026-12-20", liveEnd: "2026-12-22" });
    expect((await readOther())?.updatedAt).not.toBe(other.updatedAt);
    expect((await readTrip())?.updatedAt).not.toBe(trip.updatedAt);
  });

  it("moves the booking as it is now, not as the page last saw it", async () => {
    await saveSegment(asOwner(), trip.id, { ...imported, title: "Renamed meanwhile", end: "2026-12-16T11:00:00+00:00" }, imported);
    await moveSegment(asOwner(), trip.id, imported.id, other.id);
    const moved = (await getDoc(doc(asOwner(), paths.segment(other.id, imported.id)))).data();
    expect(moved).toMatchObject({ title: "Renamed meanwhile", end: "2026-12-16T11:00:00+00:00" });
    expect(await readOther()).toMatchObject({ start: "2026-12-12", end: "2026-12-22" });
  });

  it("refuses to move a booking that is gone, rather than resurrecting it", async () => {
    await deleteSegment(asOwner(), trip.id, imported.id);
    await expect(moveSegment(asOwner(), trip.id, imported.id, other.id)).rejects.toThrow(/no longer/);
    expect(await segmentIds(other.id)).toEqual([]);
  });

  it("refuses a target that is being deleted and leaves everything in place", async () => {
    await seed((db) => setDoc(doc(db, paths.trip(other.id)), { ...other, deleting: true }));
    await expect(moveSegment(asOwner(), trip.id, imported.id, other.id)).rejects.toThrow(/being deleted/);
    expect(await segmentIds(trip.id)).toEqual([imported.id]);
  });

  it("lets a sharee of both trips move a booking", async () => {
    await seed((db) => setDoc(doc(db, paths.trip(other.id)), { ...other, sharedWith: [partner.email] }));
    await moveSegment(as(partner), trip.id, imported.id, other.id);
    expect(await segmentIds(other.id)).toEqual([imported.id]);
  });
});

describe("mergeTrips", () => {
  it("moves every booking into the target, widens it and deletes the source", async () => {
    await saveSegment(asOwner(), trip.id, flight("2026-12-10"));
    const moved = await mergeTrips(asOwner(), trip.id, other.id);
    expect(moved).toBe(2);
    expect(await readTrip()).toBeUndefined();
    expect((await segmentIds(other.id)).length).toBe(2);
    expect(await readOther()).toMatchObject({ start: "2026-12-10", end: "2026-12-22", title: "Dublin", sharedWith: [] });
  });

  it("re-reads when a booking lands in the source between the read and the write", async () => {
    let raced = false;
    const moved = await mergeTrips(asOwner(), trip.id, other.id, {
      afterRead: async () => {
        if (raced) return;
        raced = true;
        await saveSegment(as(partner), trip.id, flight("2026-12-13"));
      },
    });
    expect(moved).toBe(2);
    expect((await segmentIds(other.id)).length).toBe(2);
    expect(await readTrip()).toBeUndefined();
  });

  it("is refused for a sharee, who may not delete the source", async () => {
    await seed((db) => setDoc(doc(db, paths.trip(other.id)), { ...other, sharedWith: [partner.email] }));
    await expect(mergeTrips(as(partner), trip.id, other.id)).rejects.toThrow();
    expect(await segmentIds(trip.id)).toEqual([imported.id]);
    expect(await readTrip()).toMatchObject({ title: "Liverpool" });
  });

  it("refuses to merge a trip into itself", async () => {
    await expect(mergeTrips(asOwner(), trip.id, trip.id)).rejects.toThrow(/different/);
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
