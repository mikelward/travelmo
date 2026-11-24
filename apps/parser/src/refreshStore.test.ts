import { paths } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { changeRefresh, dropStaleRefresh } from "./refreshStore";
import { firestoreStore } from "./store";
import { resetTrips } from "./tripsReset";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);

const at = "2027-01-05T10:00:00Z";
const progress = { scanned: 3, imported: 1, failed: 0, done: false, updatedAt: at, run: "r1", step: 1, running: true, total: 9 };

describe("changeRefresh", () => {
  it("keeps the progress on the user's document under the current generation", async () => {
    const uid = "refresh-store-u1";
    await db.doc(paths.user(uid)).set({ email: "owner@example.com" });
    const changed = await changeRefresh(db, uid, (current, generation) => ({ next: progress, result: { current, generation } }));
    expect(changed).toEqual({ state: undefined, generation: 0, result: { current: undefined, generation: 0 } });
    expect((await db.doc(paths.user(uid)).get()).get("refresh")).toEqual({ ...progress, generation: 0 });
    const seen = await changeRefresh(db, uid, (current) => ({ result: current }));
    expect(seen?.result).toMatchObject({ scanned: 3, total: 9, run: "r1" });
  });

  it("counts progress from before a reset as none, and a reset takes it off Settings", async () => {
    const uid = "refresh-store-u2";
    await db.doc(paths.user(uid)).set({ email: "owner@example.com" });
    await changeRefresh(db, uid, () => ({ next: progress, result: undefined }));

    await resetTrips(db, uid, () => {});

    expect((await db.doc(paths.user(uid)).get()).get("refresh")).toBeUndefined();
    const generation = await firestoreStore(db).resetGeneration(uid);
    expect(generation).toBeGreaterThan(0);
    // A message of the old refresh arriving late finds nothing to carry on.
    await db.doc(paths.user(uid)).update({ refresh: { ...progress, generation: 0 } });
    expect((await changeRefresh(db, uid, (current) => ({ result: current })))?.result).toBeUndefined();
    // A refresh started since stays.
    await changeRefresh(db, uid, () => ({ next: progress, result: undefined }));
    expect(await dropStaleRefresh(db, uid)).toBe(false);
    expect((await db.doc(paths.user(uid)).get()).get("refresh")).toMatchObject({ generation });
  });

  it("does nothing for an account whose document is gone", async () => {
    expect(await changeRefresh(db, "refresh-store-gone", () => ({ next: progress, result: 1 }))).toBeUndefined();
    expect((await db.doc(paths.user("refresh-store-gone")).get()).exists).toBe(false);
  });
});

describe("importedRecords", () => {
  it("lists the records that made bookings, in order of id, after a given one", async () => {
    const uid = "refresh-store-u3";
    const record = (messageId: string, outcome: string) => ({ messageId, uid, outcome, segmentIds: [], processedAt: at });
    for (const [id, outcome] of [["c", "imported"], ["a", "imported"], ["b", "not_booking"], ["d", "imported"]] as const) {
      await db.doc(paths.parsedMessage(uid, id)).set(record(id, outcome));
    }
    const store = firestoreStore(db);
    expect((await store.importedRecords(uid, undefined, 10)).map((r) => r.messageId)).toEqual(["a", "c", "d"]);
    expect((await store.importedRecords(uid, "a", 1)).map((r) => r.messageId)).toEqual(["c"]);
  });

  it("passes over a record that no longer parses without cutting the page short", async () => {
    const uid = "refresh-store-u4";
    const record = (messageId: string) => ({ messageId, uid, outcome: "imported", segmentIds: [], processedAt: at });
    for (const id of ["a", "c", "d", "e"]) await db.doc(paths.parsedMessage(uid, id)).set(record(id));
    await db.doc(paths.parsedMessage(uid, "b")).set({ outcome: "imported", junk: true });
    const store = firestoreStore(db);
    // A short page would read as the end; this one is full.
    expect((await store.importedRecords(uid, undefined, 2)).map((r) => r.messageId)).toEqual(["a", "c"]);
    expect((await store.importedRecords(uid, "c", 2)).map((r) => r.messageId)).toEqual(["d", "e"]);
    expect((await store.importedRecords(uid, "e", 2)).map((r) => r.messageId)).toEqual([]);
  });
});
