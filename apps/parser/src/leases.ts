import { paths } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";

// An upload of a kind (a TripIt export) is one to one in its matching only
// within itself: two running at once each keep their own record of which
// existing bookings they matched, and can both match one, dropping a room.
// So one runs at a time per user. The lease expires on its own, so a worker
// that dies mid-upload does not lock the user out for long.

export const uploadLeaseMs = 15 * 60 * 1000;

export type Lease = { holder: string; expiresAt: string };

export class UploadRunning extends Error {
  constructor() {
    super("Another import of this kind is still running; try again when it has finished.");
  }
}

export function leaseFree(existing: Lease | undefined, now: string): boolean {
  return !existing || Date.parse(existing.expiresAt) <= Date.parse(now);
}

export async function acquireUploadLease(db: Firestore, uid: string, kind: string, holder: string, now: string): Promise<boolean> {
  const ref = db.doc(paths.uploadLease(uid, kind));
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!leaseFree(snap.exists ? (snap.data() as Lease) : undefined, now)) return false;
    t.set(ref, { holder, expiresAt: new Date(Date.parse(now) + uploadLeaseMs).toISOString() } satisfies Lease);
    return true;
  });
}

// Only the holder releases: a lease that expired and was taken over by
// another upload stays with that one.
export async function releaseUploadLease(db: Firestore, uid: string, kind: string, holder: string): Promise<void> {
  const ref = db.doc(paths.uploadLease(uid, kind));
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (snap.exists && (snap.data() as Lease).holder === holder) t.delete(ref);
  });
}

function everyThirdOfLease(renew: () => Promise<void>): () => void {
  const timer = setInterval(() => void renew(), uploadLeaseMs / 3);
  return () => clearInterval(timer);
}

export class LeaseLost extends Error {
  constructor() {
    super("This import was superseded by another; its finished items are kept.");
  }
}

export type HeldLease = {
  // Throws LeaseLost once the lease may be another upload's: a renewal found
  // it taken, or it ran out with no renewal (a stalled process).
  assertHeld(): void;
};

// Moves a held lease's expiry on; false when it is no longer ours.
export async function renewUploadLease(db: Firestore, uid: string, kind: string, holder: string, now: string): Promise<string | undefined> {
  const ref = db.doc(paths.uploadLease(uid, kind));
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists || (snap.data() as Lease).holder !== holder) return undefined;
    const expiresAt = new Date(Date.parse(now) + uploadLeaseMs).toISOString();
    t.set(ref, { holder, expiresAt } satisfies Lease);
    return expiresAt;
  });
}

// Runs `work` holding the user's lease for `kind`, or refuses at once. The
// lease is renewed while the work runs, so a long upload keeps it; the work
// checks `assertHeld` between items and stops if it was ever lost.
export async function withUploadLease<T>(
  db: Firestore,
  uid: string,
  kind: string,
  holder: string,
  work: (lease: HeldLease) => Promise<T>,
  options: {
    now?: () => string;
    // How renewals are timed: by default every third of the lease. Given
    // `renew`, returns a way to stop them. Tests drive it by hand.
    schedule?: (renew: () => Promise<void>) => () => void;
  } = {},
): Promise<T> {
  const now = options.now ?? (() => new Date().toISOString());
  const started = now();
  if (!(await acquireUploadLease(db, uid, kind, holder, started))) throw new UploadRunning();
  let expiresAt = new Date(Date.parse(started) + uploadLeaseMs).toISOString();
  let lost = false;
  const renew = async () => {
    try {
      const next = await renewUploadLease(db, uid, kind, holder, now());
      if (next) expiresAt = next;
      else lost = true;
    } catch (error) {
      // A renewal that could not be made is not a loss yet: the lease still
      // runs to its expiry, which assertHeld checks.
      console.error(JSON.stringify({ severity: "WARNING", event: "lease_renew_failed", kind, reason: (error as Error).message }));
    }
  };
  const stop = (options.schedule ?? everyThirdOfLease)(renew);
  const lease: HeldLease = {
    assertHeld() {
      if (lost || Date.parse(now()) >= Date.parse(expiresAt)) throw new LeaseLost();
    },
  };
  try {
    return await work(lease);
  } finally {
    stop();
    await releaseUploadLease(db, uid, kind, holder);
  }
}
