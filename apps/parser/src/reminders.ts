import {
  dueForReminders,
  newLines,
  paths,
  peopleDocuments,
  PushSubscription,
  reminderEmail,
  reminderLines,
  reminderNotifications,
  Segment,
  TravelProfile,
  Trip,
  type ReminderLookups,
  type ReminderSettings,
  type TripReminder,
} from "@travelmo/core";
import { Filter, type Firestore } from "firebase-admin/firestore";
import type { Mailer } from "./mail";
import type { PushSender } from "./push";

// The daily reminder run: for everyone who turned reminders on, the
// document warnings and entry requirements of their trips starting within
// a month, each line sent once (a log per trip remembers what went out),
// all of a day's news in one email and one notification per trip to every
// browser that subscribed, as the person chose.

export type ReminderUser = { uid: string; settings: ReminderSettings };
export type StoredSubscription = { id: string; subscription: PushSubscription };

export type ReminderIo = {
  // Users with reminders on, by email or push.
  users(): Promise<ReminderUser[]>;
  verifiedEmail(uid: string): Promise<string | undefined>;
  pushSubscriptions(uid: string): Promise<StoredSubscription[]>;
  removePushSubscription(uid: string, id: string): Promise<void>;
  // The user's own trips and those shared with them, ending on or after the day.
  trips(uid: string, email: string | undefined, endsOnOrAfter: string): Promise<Trip[]>;
  segments(tripId: string): Promise<Segment[]>;
  ownProfile(uid: string): Promise<TravelProfile | undefined>;
  sharedProfiles(email: string | undefined): Promise<TravelProfile[]>;
  sentLines(uid: string, tripId: string): Promise<string[]>;
  markSent(uid: string, tripId: string, lines: readonly string[], at: string): Promise<void>;
};

export type ReminderRun = { users: number; mailed: number; pushed: number; lines: number; skipped: number; failed: number };

// The ways out; either may be off (no SMTP, no VAPID keys).
export type ReminderChannels = { mail?: Mailer; push?: PushSender };

export type ReminderOptions = {
  now: string;
  origin: string;
  lookups: ReminderLookups;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export async function sendReminders(io: ReminderIo, channels: ReminderChannels, options: ReminderOptions): Promise<ReminderRun> {
  const run: ReminderRun = { users: 0, mailed: 0, pushed: 0, lines: 0, skipped: 0, failed: 0 };
  const today = options.now.slice(0, 10);
  for (const { uid, settings } of await io.users()) {
    run.users += 1;
    try {
      // Email wants a verified address; push wants a subscribed browser.
      // Someone with neither is skipped, with the reason, before any reads.
      let email = settings.email && channels.mail ? await io.verifiedEmail(uid) : undefined;
      if (settings.email && channels.mail && !email) options.log("reminder_no_verified_email", { uid });
      const subscriptions = settings.push && channels.push ? await io.pushSubscriptions(uid) : [];
      if (!email && !subscriptions.length) {
        run.skipped += 1;
        continue;
      }
      // The trips shared with the person are found by their address, whether
      // or not they want mail.
      email ??= await io.verifiedEmail(uid);
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
      const lines = reminders.reduce((n, r) => n + r.lines.length, 0);
      // Every channel goes before anything is marked sent: a failure here
      // leaves the day's news for tomorrow, on every channel, and so does a
      // day on which nothing took it (every browser gone).
      let delivered = false;
      if (settings.email && channels.mail && email) {
        const { subject, text } = reminderEmail(reminders, { origin: options.origin, today });
        await channels.mail({ to: email, subject, text });
        delivered = true;
        run.mailed += 1;
        options.log("reminder_mailed", { uid, trips: reminders.length, lines });
      }
      if (subscriptions.length && channels.push) {
        const notifications = reminderNotifications(reminders, { origin: options.origin, today });
        let browsers = 0;
        for (const { id, subscription } of subscriptions) {
          const outcomes = await Promise.all(notifications.map((n) => channels.push!(subscription, n)));
          if (outcomes.includes("gone")) {
            await io.removePushSubscription(uid, id);
            options.log("push_subscription_gone", { uid, id });
          } else browsers += 1;
        }
        if (browsers) {
          delivered = true;
          run.pushed += 1;
          options.log("reminder_pushed", { uid, trips: reminders.length, lines, browsers });
        }
      }
      if (!delivered) {
        run.skipped += 1;
        options.log("reminder_undelivered", { uid, trips: reminders.length, lines });
        continue;
      }
      for (const { trip, lines } of reminders) await io.markSent(uid, trip.id, lines, options.now);
      run.lines += lines;
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
      const snap = await db
        .collection("users")
        .where(Filter.or(Filter.where("reminders.email", "==", true), Filter.where("reminders.push", "==", true)))
        .get();
      return snap.docs.map((d) => {
        const r = d.get("reminders") as Record<string, unknown>;
        return { uid: d.id, settings: { email: r.email === true, push: r.push === true } };
      });
    },
    verifiedEmail,
    async pushSubscriptions(uid) {
      const snap = await db.collection(paths.pushSubscriptions(uid)).get();
      return snap.docs.flatMap((d) => parse(PushSubscription, d.data()).map((subscription) => ({ id: d.id, subscription })));
    },
    async removePushSubscription(uid, id) {
      await db.doc(paths.pushSubscription(uid, id)).delete();
    },
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
