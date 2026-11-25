import { paths } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { firestoreChecklistIo } from "./checklist";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
// Invented users and trips in 2033, a year no other test writes to.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
const none = async () => [];
const logs: string[] = [];
const io = firestoreChecklistIo(
  db,
  {
    verifiedEmail: async () => undefined,
    addresses: none,
    pushSubscriptions: none,
    removePushSubscription: async () => {},
    devices: none,
    removeDevice: async () => {},
    trips: none,
    segments: none,
    travelers: none,
  },
  (_level, event) => logs.push(event),
);
const at = "2033-01-01T00:00:00Z";

describe("firestoreChecklistIo", () => {
  it("reads a person's reminders in slot order and their state for a trip, leaving out what does not parse", async () => {
    const uid = "cl-reader";
    await db.doc(paths.tripReminder(uid, "s10")).set({ id: "late", text: "Late", amount: 1, unit: "days", createdAt: at });
    await db.doc(paths.tripReminder(uid, "s2")).set({ id: "visa", text: "Apply for a visa", amount: 30, unit: "days", createdAt: at });
    await db.doc(paths.tripReminder(uid, "s3")).set({ id: "bad", text: "", amount: 1, unit: "days", createdAt: at });
    expect(await io.standing(uid)).toEqual([
      { id: "visa", text: "Apply for a visa", amount: 30, unit: "days" },
      { id: "late", text: "Late", amount: 1, unit: "days" },
    ]);
    expect(logs).toContain("checklist_entry_malformed");
    expect(await io.mine(uid, "cl-trip")).toEqual({ done: [], added: [] });
    await db.doc(paths.tripChecklist(uid, "cl-trip")).set({ done: ["visa"], updatedAt: at });
    await db.doc(paths.tripChecklistAddedSlot(uid, "cl-trip", "a0")).set({ id: "x1", text: "Pack", date: "2033-03-01", createdAt: at });
    expect(await io.mine(uid, "cl-trip")).toEqual({ done: ["visa"], added: [{ id: "x1", text: "Pack", date: "2033-03-01" }] });
  });

  it("finds the people with reminders on, with their corrections to home", async () => {
    await db.doc(paths.user("cl-on")).set({ reminders: { push: true }, homes: [{ city: "London", country: "GB", from: "2020-01-01" }] });
    await db.doc(paths.user("cl-off")).set({ reminders: { email: false } });
    const users = await io.users();
    expect(users.find((u) => u.uid === "cl-on")).toEqual({ uid: "cl-on", settings: { email: false, push: true }, homes: [{ city: "London", country: "GB", from: "2020-01-01" }] });
    expect(users.some((u) => u.uid === "cl-off")).toBe(false);
  });

  it("claims a reminder for one run at a time, keeps it once done, and never for a deleted account", async () => {
    const base = { id: "cl-u__cl-t__visa", uid: "cl-u", tripId: "cl-t", reminderId: "visa", ends: "2033-12-31" };
    const claimed = await io.claim(base, "2033-02-01T06:07:00.000Z");
    expect(claimed).toEqual({ ...base, attempts: 0, done: false, at: "2033-02-01T06:07:00.000Z" });
    expect(await io.claim(base, "2033-02-01T06:08:00.000Z")).toBeUndefined();
    await io.save({ ...claimed!, attempts: 1 });
    expect(await io.claim(base, "2033-02-01T06:09:00.000Z")).toMatchObject({ attempts: 1, done: false });
    await io.save({ ...claimed!, done: true });
    expect(await io.claim(base, "2033-02-02T06:07:00.000Z")).toBeUndefined();
    expect((await io.markers([base.id, "cl-none"])).get(base.id)).toMatchObject({ done: true });

    await db.doc(paths.deletedAccount("cl-gone")).set({ uid: "cl-gone", at });
    await expect(io.claim({ ...base, id: "cl-gone__cl-t__visa", uid: "cl-gone" }, "2033-02-01T06:07:00.000Z")).rejects.toThrow("was deleted");
    expect((await db.doc(paths.checklistReminder("cl-gone__cl-t__visa")).get()).exists).toBe(false);
  });

  it("sweeps the markers of trips that are over or gone, and keeps one whose trip moved later", async () => {
    const marker = (id: string, tripId: string) => ({ id, uid: "cl-s", tripId, reminderId: "r", ends: "2033-04-01", attempts: 0, done: true, at });
    await db.doc(paths.trip("cl-moved")).set({ id: "cl-moved", start: "2033-05-01", end: "2033-05-08" });
    await db.doc(paths.trip("cl-over")).set({ id: "cl-over", start: "2033-03-25", end: "2033-04-01" });
    await io.save(marker("cl-s__cl-moved__r", "cl-moved"));
    await io.save(marker("cl-s__cl-over__r", "cl-over"));
    await io.save(marker("cl-s__cl-gone__r", "cl-gone"));
    expect(await io.sweep("2033-04-02")).toBe(2);
    expect((await db.doc(paths.checklistReminder("cl-s__cl-moved__r")).get()).get("ends")).toBe("2033-05-08");
    expect((await db.doc(paths.checklistReminder("cl-s__cl-over__r")).get()).exists).toBe(false);
    expect((await db.doc(paths.checklistReminder("cl-s__cl-gone__r")).get()).exists).toBe(false);
  });
});
