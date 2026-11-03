import { createHash, randomBytes } from "node:crypto";
import { exportCalendar, paths, Segment, Trip, type CalendarExport } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";

// The subscribable calendar of a user's trips. Its link carries a random
// token; only the token's hash is stored as a key, so the lookup collection
// never holds a working link.

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(24).toString("base64url");

// Trips that ended more than this long ago are left out: a calendar app
// holds the history it already has, and years of it would make every poll
// slow.
export const exportHistoryDays = 365;

export type ExportIo = {
  uidForToken: (tokenHash: string) => Promise<string | undefined>;
  // The user's verified email, for the trips shared with them.
  verifiedEmail: (uid: string) => Promise<string | undefined>;
  trips: (uid: string, email: string | undefined, endsOnOrAfter: string) => Promise<Trip[]>;
  segments: (tripId: string) => Promise<Segment[]>;
};

export const validToken = (token: string) => /^[A-Za-z0-9_-]{20,64}$/.test(token);

function daysBefore(instant: string, days: number): string {
  const d = new Date(instant);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// The calendar text for a link's token, or undefined for a link that is not
// (or no longer) anyone's.
export async function calendarForToken(
  token: string,
  io: ExportIo,
  options: { now: string; tripUrl: (tripId: string) => string },
): Promise<string | undefined> {
  if (!validToken(token)) return undefined;
  const uid = await io.uidForToken(hashToken(token));
  if (!uid) return undefined;
  const email = await io.verifiedEmail(uid);
  const trips = (await io.trips(uid, email, daysBefore(options.now, exportHistoryDays))).filter((t) => !t.deleting);
  const items = await Promise.all(trips.map(async (trip) => ({ trip, segments: await io.segments(trip.id) })));
  return exportCalendar(items, { stamp: options.now, tripUrl: options.tripUrl });
}

export function firestoreExportIo(db: Firestore, verifiedEmail: (uid: string) => Promise<string | undefined>): ExportIo {
  const parse = <T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }, data: unknown): T[] => {
    const r = schema.safeParse(data);
    return r.success ? [r.data] : [];
  };
  return {
    uidForToken: async (tokenHash) => {
      const snap = await db.doc(paths.calendarExportToken(tokenHash)).get();
      const uid = snap.get("uid");
      return typeof uid === "string" ? uid : undefined;
    },
    verifiedEmail,
    trips: async (uid, email, endsOnOrAfter) => {
      const queries = [db.collection(paths.trips()).where("ownerUid", "==", uid).where("end", ">=", endsOnOrAfter).get()];
      if (email) queries.push(db.collection(paths.trips()).where("sharedWith", "array-contains", email).where("end", ">=", endsOnOrAfter).get());
      const byId = new Map<string, Trip>();
      for (const snap of await Promise.all(queries)) for (const d of snap.docs) for (const t of parse(Trip, d.data())) byId.set(t.id, t);
      return [...byId.values()];
    },
    segments: async (tripId) => (await db.collection(paths.segments(tripId)).get()).docs.flatMap((d) => parse(Segment, d.data())),
  };
}

// Issues a new link, retiring the old one in the same transaction, so at
// most one works at a time.
export async function issueExport(db: Firestore, uid: string, now: string): Promise<CalendarExport> {
  const token = newToken();
  const record: CalendarExport = { token, createdAt: now };
  await db.runTransaction(async (tx) => {
    const ref = db.doc(paths.calendarExport(uid));
    const old = (await tx.get(ref)).get("token");
    if (typeof old === "string") tx.delete(db.doc(paths.calendarExportToken(hashToken(old))));
    tx.set(db.doc(paths.calendarExportToken(hashToken(token))), { uid, createdAt: now });
    tx.set(ref, record);
  });
  return record;
}

export async function stopExport(db: Firestore, uid: string): Promise<void> {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(paths.calendarExport(uid));
    const old = (await tx.get(ref)).get("token");
    if (typeof old === "string") tx.delete(db.doc(paths.calendarExportToken(hashToken(old))));
    tx.delete(ref);
  });
}
