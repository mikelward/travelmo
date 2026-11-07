import {
  dueForReminders,
  newLines,
  paths,
  peopleDocuments,
  reminderEmail,
  reminderLines,
  Segment,
  TravelProfile,
  Trip,
  type ReminderLookups,
  type TripReminder,
} from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import type { Mailer } from "./mail";

// The daily reminder run: for everyone who turned email reminders on, the
// document warnings and entry requirements of their trips starting within
// a month, each line mailed once (a log per trip remembers what went out),
// all of a day's news in one email.

export type ReminderIo = {
  // Users with reminders by email on.
  users(): Promise<string[]>;
  verifiedEmail(uid: string): Promise<string | undefined>;
  // The user's own trips and those shared with them, ending on or after the day.
  trips(uid: string, email: string | undefined, endsOnOrAfter: string): Promise<Trip[]>;
  segments(tripId: string): Promise<Segment[]>;
  ownProfile(uid: string): Promise<TravelProfile | undefined>;
  sharedProfiles(email: string | undefined): Promise<TravelProfile[]>;
  sentLines(uid: string, tripId: string): Promise<string[]>;
  markSent(uid: string, tripId: string, lines: readonly string[], at: string): Promise<void>;
};

export type ReminderRun = { users: number; mailed: number; lines: number; skipped: number; failed: number };

export type ReminderOptions = {
  now: string;
  origin: string;
  lookups: ReminderLookups;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export async function sendReminders(io: ReminderIo, mail: Mailer, options: ReminderOptions): Promise<ReminderRun> {
  const run: ReminderRun = { users: 0, mailed: 0, lines: 0, skipped: 0, failed: 0 };
  const today = options.now.slice(0, 10);
  for (const uid of await io.users()) {
    run.users += 1;
    try {
      const email = await io.verifiedEmail(uid);
      if (!email) {
        run.skipped += 1;
        options.log("reminder_no_verified_email", { uid });
        continue;
      }
      const [own, shared, trips] = await Promise.all([io.ownProfile(uid), io.sharedProfiles(email), io.trips(uid, email, today)]);
      const people = peopleDocuments(own, shared, uid);
      if (!people.length) continue;
      const reminders: TripReminder[] = [];
      for (const trip of dueForReminders(trips, today)) {
        const [segments, sent] = await Promise.all([io.segments(trip.id), io.sentLines(uid, trip.id)]);
        const lines = newLines(reminderLines(people, trip, segments, today, options.lookups), sent);
        if (lines.length) reminders.push({ trip, lines });
      }
      if (!reminders.length) continue;
      const { subject, text } = reminderEmail(reminders, { origin: options.origin, today });
      await mail({ to: email, subject, text });
      for (const { trip, lines } of reminders) await io.markSent(uid, trip.id, lines, options.now);
      run.mailed += 1;
      run.lines += reminders.reduce((n, r) => n + r.lines.length, 0);
      options.log("reminder_mailed", { uid, trips: reminders.length, lines: reminders.reduce((n, r) => n + r.lines.length, 0) });
    } catch (error) {
      run.failed += 1;
      options.log("reminder_failed", { uid, reason: (error as Error).message });
    }
  }
  return run;
}

export function firestoreReminderIo(db: Firestore, verifiedEmail: (uid: string) => Promise<string | undefined>): ReminderIo {
  const parse = <T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }, data: unknown): T[] => {
    const r = schema.safeParse(data);
    return r.success ? [r.data] : [];
  };
  return {
    async users() {
      const snap = await db.collection("users").where("reminders.email", "==", true).get();
      return snap.docs.map((d) => d.id);
    },
    verifiedEmail,
    async trips(uid, email, endsOnOrAfter) {
      const queries = [db.collection(paths.trips()).where("ownerUid", "==", uid).where("end", ">=", endsOnOrAfter).get()];
      if (email) queries.push(db.collection(paths.trips()).where("sharedWith", "array-contains", email).where("end", ">=", endsOnOrAfter).get());
      const byId = new Map<string, Trip>();
      for (const snap of await Promise.all(queries)) for (const d of snap.docs) for (const t of parse(Trip, d.data())) byId.set(t.id, t);
      return [...byId.values()];
    },
    segments: async (tripId) => (await db.collection(paths.segments(tripId)).get()).docs.flatMap((d) => parse(Segment, d.data())),
    async ownProfile(uid) {
      const snap = await db.doc(paths.travelProfile(uid)).get();
      return snap.exists ? parse(TravelProfile, snap.data())[0] : undefined;
    },
    async sharedProfiles(email) {
      if (!email) return [];
      const snap = await db.collectionGroup("travelProfile").where("trustedEmails", "array-contains", email).get();
      return snap.docs.flatMap((d) => parse(TravelProfile, d.data()));
    },
    async sentLines(uid, tripId) {
      const snap = await db.doc(paths.reminderLog(uid, tripId)).get();
      const sent = snap.get("sent");
      return Array.isArray(sent) ? sent.filter((l): l is string => typeof l === "string") : [];
    },
    async markSent(uid, tripId, lines, at) {
      const ref = db.doc(paths.reminderLog(uid, tripId));
      await db.runTransaction(async (t) => {
        const before = (await t.get(ref)).get("sent");
        const sent = Array.isArray(before) ? before.filter((l): l is string => typeof l === "string") : [];
        t.set(ref, { sent: [...new Set([...sent, ...lines])], at });
      });
    },
  };
}
