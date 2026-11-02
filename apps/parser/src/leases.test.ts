import { paths } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { LeaseLost, UploadRunning, acquireUploadLease, leaseFree, releaseUploadLease, uploadLeaseMs, withUploadLease, type HeldLease, type Lease } from "./leases";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);

const t0 = Date.parse("2026-11-01T12:00:00Z");
const at = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();
let n = 0;
const unique = () => `u-${Date.now()}-${++n}`;

describe("leaseFree", () => {
  it("is free when absent or expired, and held until then", () => {
    expect(leaseFree(undefined, at(0))).toBe(true);
    expect(leaseFree({ holder: "a", expiresAt: at(1000) }, at(0))).toBe(false);
    expect(leaseFree({ holder: "a", expiresAt: at(1000) }, at(1000))).toBe(true);
  });
});

describe("upload leases", () => {
  it("grants one of two concurrent uploads, and the next once released", async () => {
    const uid = unique();
    const results = await Promise.all([acquireUploadLease(db, uid, "tripit", "a", at(0)), acquireUploadLease(db, uid, "tripit", "b", at(0))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? "a" : "b";
    // Another user, or another kind, is not held up.
    expect(await acquireUploadLease(db, unique(), "tripit", "c", at(0))).toBe(true);
    expect(await acquireUploadLease(db, uid, "ics", "c", at(0))).toBe(true);
    await releaseUploadLease(db, uid, "tripit", winner);
    expect(await acquireUploadLease(db, uid, "tripit", "d", at(1))).toBe(true);
  });

  it("lets an expired lease be taken over, and the old holder not release the new one", async () => {
    const uid = unique();
    await acquireUploadLease(db, uid, "tripit", "dead", at(0));
    expect(await acquireUploadLease(db, uid, "tripit", "next", at(uploadLeaseMs - 1))).toBe(false);
    expect(await acquireUploadLease(db, uid, "tripit", "next", at(uploadLeaseMs))).toBe(true);
    await releaseUploadLease(db, uid, "tripit", "dead");
    expect(await acquireUploadLease(db, uid, "tripit", "third", at(uploadLeaseMs + 1))).toBe(false);
  });

  // Starts an upload whose work waits until released; resolves once the
  // lease is held and the work has begun.
  async function holdUpload(uid: string, holder: string, options: Parameters<typeof withUploadLease>[5] = {}) {
    let lease!: HeldLease;
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>((ok) => (started = ok));
    const done = withUploadLease(db, uid, "tripit", holder, (held) => {
      lease = held;
      started();
      return new Promise<void>((ok) => (release = ok));
    }, options);
    await Promise.race([begun, done]);
    return { lease: () => lease, finish: async () => (release?.(), await done) };
  }

  // A renewal schedule the test triggers by hand.
  function manualRenewals() {
    let renew: (() => Promise<void>) | undefined;
    let stopped = false;
    return {
      schedule: (fn: () => Promise<void>) => ((renew = fn), () => void (stopped = true)),
      renewNow: () => renew!(),
      stopped: () => stopped,
    };
  }

  it("refuses a second upload while one runs, and frees the lease even when the work fails", async () => {
    const uid = unique();
    const upload = await holdUpload(uid, "a");
    try {
      await expect(withUploadLease(db, uid, "tripit", "b", async () => "never")).rejects.toThrow(UploadRunning);
    } finally {
      await upload.finish();
    }
    await expect(withUploadLease(db, uid, "tripit", "c", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withUploadLease(db, uid, "tripit", "d", async () => "ran")).toBe("ran");
  });

  it("renews the lease while a long upload runs, and stops renewing when it ends", async () => {
    const uid = unique();
    const ref = db.doc(paths.uploadLease(uid, "tripit"));
    let clock = at(0);
    const renewals = manualRenewals();
    const upload = await holdUpload(uid, "a", { now: () => clock, schedule: renewals.schedule });
    try {
      expect(((await ref.get()).data() as Lease).expiresAt).toBe(at(uploadLeaseMs));
      clock = at(uploadLeaseMs / 3);
      await renewals.renewNow();
      expect(((await ref.get()).data() as Lease).expiresAt).toBe(at(uploadLeaseMs / 3 + uploadLeaseMs));
      // Past the first expiry, the renewed lease still holds.
      clock = at(uploadLeaseMs + 1);
      expect(() => upload.lease().assertHeld()).not.toThrow();
    } finally {
      await upload.finish();
    }
    expect(renewals.stopped()).toBe(true);
    expect((await ref.get()).exists).toBe(false);
  });

  it("tells the work to stop once its lease is another upload's, or has run out", async () => {
    const uid = unique();
    const ref = db.doc(paths.uploadLease(uid, "tripit"));
    const renewals = manualRenewals();
    const upload = await holdUpload(uid, "a", { schedule: renewals.schedule });
    try {
      expect(() => upload.lease().assertHeld()).not.toThrow();
      // Another upload took it over (as after a stall past its expiry).
      await ref.set({ holder: "b", expiresAt: new Date(Date.now() + uploadLeaseMs).toISOString() });
      await renewals.renewNow();
      expect(() => upload.lease().assertHeld()).toThrow(LeaseLost);
    } finally {
      await upload.finish();
    }
    // The superseded upload leaves the new holder's lease alone.
    expect(((await ref.get()).data() as Lease).holder).toBe("b");

    // With no renewal, a lease past its expiry is not trusted either.
    let clock = at(0);
    await withUploadLease(db, unique(), "tripit", "c", async (held) => {
      clock = at(uploadLeaseMs);
      expect(() => held.assertHeld()).toThrow(LeaseLost);
    }, { now: () => clock, schedule: manualRenewals().schedule });
  });
});
