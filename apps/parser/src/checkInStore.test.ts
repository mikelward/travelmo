import { paths } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { firestoreCheckInIo } from "./checkIn";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
// Invented bookings in 2032, a year no other test writes to.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
const none = async () => [];
const io = firestoreCheckInIo(db, {
  flightSegments: none,
  trip: async () => undefined,
  uidForEmail: async () => undefined,
  verifiedEmail: async () => undefined,
  pushSubscriptions: none,
  removePushSubscription: async () => {},
  devices: none,
  removeDevice: async () => {},
});

describe("firestoreCheckInIo", () => {
  it("claims a flight's bookings for one run at a time, all or none, and keeps whom they reached", async () => {
    const base = { id: "ci-trip__ci-f", tripId: "ci-trip", segmentId: "ci-f", departs: "2032-03-12T09:00:00.000Z" };
    const other = { ...base, id: "ci-trip2__ci-f", tripId: "ci-trip2" };
    expect(await io.markers([base.id])).toEqual(new Map());
    const claimed = await io.claim([base], "2032-03-10T09:00:00.000Z");
    expect(claimed).toEqual([{ ...base, sent: [], attempts: 0, done: false, at: "2032-03-10T09:00:00.000Z" }]);
    // Held for its lease against another run, and so is the rest of the
    // flight: a run can't take the other booking alone.
    expect(await io.claim([base], "2032-03-10T09:01:00.000Z")).toBeUndefined();
    expect(await io.claim([base, other], "2032-03-10T09:01:00.000Z")).toBeUndefined();
    expect((await io.markers([other.id])).has(other.id)).toBe(false);
    await io.save({ ...claimed![0]!, sent: ["u1"], attempts: 1, at: "2032-03-10T09:00:30.000Z" });
    // Saving lets go: the next run may try again, and sees who was told.
    expect(await io.claim([base], "2032-03-10T09:01:00.000Z")).toMatchObject([{ sent: ["u1"], attempts: 1, done: false }]);
    await io.save({ ...claimed![0]!, sent: ["u1", "u2"], done: true, at: "2032-03-10T09:01:30.000Z" });
    expect((await io.markers([base.id, "ci-none"])).get(base.id)).toMatchObject({ sent: ["u1", "u2"], done: true });
    // A done booking is never held, and still says whom it reached.
    expect(await io.claim([base, other], "2032-03-10T10:00:00.000Z")).toMatchObject([
      { id: base.id, sent: ["u1", "u2"], done: true },
      { id: other.id, sent: [], done: false },
    ]);
  });

  it("sweeps the markers of flights that have left", async () => {
    const marker = (id: string, departs: string) => ({ id, tripId: "ci-sweep", segmentId: id, departs, sent: [], attempts: 0, done: true, at: departs });
    await io.save(marker("ci-sweep__gone", "2032-04-01T08:00:00.000Z"));
    await io.save(marker("ci-sweep__ahead", "2032-04-01T12:00:00.000Z"));
    expect(await io.sweep("2032-04-01T10:00:00.000Z")).toBeGreaterThanOrEqual(1);
    expect((await db.doc(paths.checkInReminder("ci-sweep__gone")).get()).exists).toBe(false);
    expect((await db.doc(paths.checkInReminder("ci-sweep__ahead")).get()).exists).toBe(true);
  });

  it("keeps the marker of a flight moved later, with its new departure", async () => {
    // Swept at the old time, the booking would be reminded again.
    await db.doc(paths.segment("ci-sweep", "ci-sweep__moved")).set({ start: "2032-04-02T09:00:00+00:00" });
    await io.save({ id: "ci-sweep__moved", tripId: "ci-sweep", segmentId: "ci-sweep__moved", departs: "2032-04-01T09:00:00.000Z", sent: ["u1"], attempts: 0, done: true, at: "x" });
    await io.sweep("2032-04-01T10:00:00.000Z");
    expect((await db.doc(paths.checkInReminder("ci-sweep__moved")).get()).data()).toMatchObject({ departs: "2032-04-02T09:00:00.000Z", sent: ["u1"], done: true });
  });

  it("reads a person's reminder settings", async () => {
    await db.doc(paths.user("ci-user")).set({ reminders: { email: true } });
    expect(await io.settings("ci-user")).toEqual({ email: true });
    expect(await io.settings("ci-nobody")).toBeUndefined();
  });

  it("reads the flights a person marked checked in on a trip", async () => {
    await db.doc(paths.checkedIn("ci-user", "ci-trip")).set({ segmentIds: ["ci-f", 7], updatedAt: "2032-03-11T09:00:00Z" });
    expect(await io.checkedIn("ci-user", "ci-trip")).toEqual(["ci-f"]);
    expect(await io.checkedIn("ci-user", "ci-none")).toEqual([]);
  });
});
