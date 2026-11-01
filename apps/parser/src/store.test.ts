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

  it("refuses a live processing claim but takes over an expired one", async () => {
    const id = unique();
    expect(await store.claimMessage("u1", id, at(0))).toBe(true);
    expect(await store.claimMessage("u1", id, at(claimLeaseMs - 1))).toBe(false);
    expect(await store.claimMessage("u1", id, at(claimLeaseMs + 1))).toBe(true);
    expect((await db.doc(paths.parsedMessage("u1", id)).get()).data()?.processedAt).toBe(at(claimLeaseMs + 1));
  });
});
