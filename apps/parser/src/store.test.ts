import { paths } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { claimLeaseMs } from "./importer";
import { firestoreStore } from "./store";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const store = firestoreStore(db);

const t0 = Date.parse("2026-11-01T12:00:00Z");
const at = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();
let n = 0;
const unique = () => `m-${Date.now()}-${++n}`;

describe("firestoreStore.claimMessage", () => {
  it("grants one of two concurrent claims", async () => {
    const id = unique();
    const results = await Promise.all([store.claimMessage("u1", id, at(0)), store.claimMessage("u1", id, at(0))]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses a message with an outcome, even long after", async () => {
    const id = unique();
    await store.claimMessage("u1", id, at(0));
    await store.setParsed({ messageId: id, uid: "u1", outcome: "imported", segmentIds: [], processedAt: at(1) });
    expect(await store.claimMessage("u1", id, at(claimLeaseMs * 10))).toBe(false);
  });

  it("reclaims a finished record but not a live claim, and one of two concurrent reclaims wins", async () => {
    const id = unique();
    await store.claimMessage("u1", id, at(0));
    expect(await store.reclaimMessage("u1", id, at(1000))).toBe(false);
    await store.setParsed({ messageId: id, uid: "u1", outcome: "filtered", segmentIds: [], processedAt: at(2000) });
    const results = await Promise.all([store.reclaimMessage("u1", id, at(3000)), store.reclaimMessage("u1", id, at(3000))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.doc(paths.parsedMessage("u1", id)).get()).data()?.outcome).toBe("processing");
  });

  it("refuses a live processing claim but takes over an expired one", async () => {
    const id = unique();
    expect(await store.claimMessage("u1", id, at(0))).toBe(true);
    expect(await store.claimMessage("u1", id, at(claimLeaseMs - 1))).toBe(false);
    expect(await store.claimMessage("u1", id, at(claimLeaseMs + 1))).toBe(true);
    expect((await db.doc(paths.parsedMessage("u1", id)).get()).data()?.processedAt).toBe(at(claimLeaseMs + 1));
  });
});

describe("firestoreStore.retryMessage", () => {
  it("claims a failed record again but nothing else that finished", async () => {
    const failed = unique();
    await store.claimMessage("u1", failed, at(0));
    await store.setParsed({ messageId: failed, uid: "u1", outcome: "failed", segmentIds: [], processedAt: at(1) });
    expect(await store.retryMessage("u1", failed, at(2))).toBe(true);
    const judged = unique();
    await store.claimMessage("u1", judged, at(0));
    await store.setParsed({ messageId: judged, uid: "u1", outcome: "not_booking", segmentIds: [], processedAt: at(1) });
    expect(await store.retryMessage("u1", judged, at(2))).toBe(false);
  });
});

describe("firestoreStore examples", () => {
  it("starts empty and keeps every example saved concurrently, per kind", async () => {
    const uid = unique();
    expect(await store.examples(uid)).toEqual({ bookings: [], others: [] });
    await Promise.all([
      store.saveExample(uid, "bookings", { subject: "a", vector: [1, 0] }),
      store.saveExample(uid, "bookings", { subject: "b", vector: [0, 1] }),
      store.saveExample(uid, "others", { subject: "c", vector: [1, 1] }),
    ]);
    const examples = await store.examples(uid);
    expect(examples.bookings.map((e) => e.subject).sort()).toEqual(["a", "b"]);
    expect(examples.others).toEqual([{ subject: "c", vector: [1, 1] }]);
  });
});

describe("firestoreStore.withUserLock", () => {
  it("lists a trip's segments inside the transaction, as duplicate detection needs", async () => {
    const uid = unique();
    const tripId = `t-${uid}`;
    const now = at(0);
    await store.withUserLock(uid, async (tx) => {
      tx.createTrip({ id: tripId, title: "T", start: "2030-01-01", end: "2030-01-02", ownerUid: uid, sharedWith: [], createdAt: now, updatedAt: now });
      tx.putSegment({ id: "s1", tripId, type: "other", title: "S", start: "2030-01-01T10:00:00+00:00", source: "tripit", gmailMessageIds: [], createdAt: now, updatedAt: now });
    });
    const listed = await store.withUserLock(uid, (tx) => tx.listSegments(tripId));
    expect(listed).toMatchObject([{ id: "s1", source: "tripit" }]);
    const ref = { kind: "gmail" as const, id: "m9", label: "Your booking", at: at(5000) };
    await Promise.all([
      store.withUserLock(uid, async (tx) => tx.addSource(tripId, "s1", ref)),
      store.withUserLock(uid, async (tx) => tx.addSource(tripId, "s1", { ...ref, id: "m10" })),
    ]);
    const after = await store.withUserLock(uid, (tx) => tx.listSegments(tripId));
    expect(after[0]?.sources?.map((s) => s.id).sort()).toEqual(["m10", "m9"]);
    // The trip's revision moves too, so a merge that read the old booking retries.
    expect((await db.doc(paths.trip(tripId)).get()).data()?.updatedAt).toBe(at(5000));
  });
});
