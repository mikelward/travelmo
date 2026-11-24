import {
  tripCancelled,
  bySlot,
  checklistEmail,
  checklistNotification,
  displayBounds,
  dueEntries,
  HomeCorrection,
  isInternational,
  maxHomeCorrections,
  maxStandingReminders,
  maxTripReminders,
  OneOffReminder,
  paths,
  StandingReminder,
  TripChecklist,
  tripChecklist,
  type ChecklistEntry,
  type PlaceLookup,
  type ReminderSettings,
  type Segment,
  type Trip,
} from "@travelmo/core";
import { Filter, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { refuseIfDeleted } from "./deleted";
import type { ReminderChannels, ReminderIo } from "./reminders";

// The traveler's own reminders before a trip (SPEC "Before you go"): the
// daily reminder run sends each due one that is not ticked off ("Apply for
// a visa — Lisbon trip in 30 days") once, by the channels the person turned
// reminders on for, to that person alone. A marker per person, trip and
// reminder (`checklistReminders/{uid__tripId__reminderId}`, the parser's
// alone) remembers it went, as checkIn.ts does for check-in reminders: a
// run claims it first, so overlapping runs never both send, and a delivery
// that failed on every channel is tried again by the next runs, five in all.

export type ChecklistMarker = {
  id: string;
  uid: string;
  tripId: string;
  reminderId: string;
  // The trip's last day, after which the marker is swept.
  ends: string;
  // Runs in which delivery failed and was left for the next run.
  attempts: number;
  // Sent, or given up on: later runs skip it.
  done: boolean;
  at: string;
};

export type ChecklistUser = { uid: string; settings: ReminderSettings; homes: HomeCorrection[] };

export type ChecklistIo = Pick<
  ReminderIo,
  "verifiedEmail" | "addresses" | "pushSubscriptions" | "removePushSubscription" | "devices" | "removeDevice" | "trips" | "segments"
> & {
  // Users with reminders on, by email or push, with their corrections to where home was.
  users(): Promise<ChecklistUser[]>;
  // Their reminders before every international trip.
  standing(uid: string): Promise<StandingReminder[]>;
  // What they ticked off on a trip and the one-offs they added to it.
  mine(uid: string, tripId: string): Promise<{ done: string[]; added: OneOffReminder[] }>;
  markers(ids: readonly string[]): Promise<Map<string, ChecklistMarker>>;
  // Takes a reminder for this run: its marker (a new one where it has
  // none), or nothing when it is done or another run holds it.
  claim(base: Pick<ChecklistMarker, "id" | "uid" | "tripId" | "reminderId" | "ends">, now: string): Promise<ChecklistMarker | undefined>;
  // Writes the marker and lets go of the claim.
  save(marker: ChecklistMarker): Promise<void>;
  // Deletes the markers of trips that are over or gone; returns how many went.
  sweep(today: string): Promise<number>;
};

export type ChecklistRun = { users: number; due: number; sent: number; failed: number; skipped: number; swept: number };

export type ChecklistOptions = {
  now: string;
  // The time each claim is taken at; a run can outlast a claim's lease.
  clock?: () => string;
  origin: string;
  lookup?: PlaceLookup;
  log: (level: "INFO" | "WARNING" | "ERROR", event: string, fields: Record<string, unknown>) => void;
};

// A delivery that failed is tried on the next runs, up to this many in all.
export const checklistMaxAttempts = 5;
// How long a run holds a reminder, from when it took it: far longer than
// sending one takes, each send bounded by its channel's timeouts.
export const checklistClaimMs = 10 * 60_000;

export const checklistMarkerId = (uid: string, tripId: string, reminderId: string) => `${uid}__${tripId}__${reminderId}`;

const daySeconds = 24 * 60 * 60;

type Due = { trip: Trip; entry: ChecklistEntry };

export async function sendChecklistReminders(io: ChecklistIo, channels: ReminderChannels, options: ChecklistOptions): Promise<ChecklistRun> {
  const run: ChecklistRun = { users: 0, due: 0, sent: 0, failed: 0, skipped: 0, swept: 0 };
  const today = options.now.slice(0, 10);
  try {
    run.swept = await io.sweep(today);
  } catch (error) {
    // Left for the next run: stale markers only take room.
    options.log("WARNING", "checklist_sweep_failed", { reason: (error as Error).message });
  }
  for (const user of await io.users()) {
    run.users += 1;
    try {
      const outcome = await remindUser(io, channels, options, user, today);
      run.due += outcome.due;
      run.sent += outcome.sent;
      run.failed += outcome.failed;
      run.skipped += outcome.skipped;
    } catch (error) {
      // Claims lapse on their own, so the next run tries again.
      run.failed += 1;
      options.log("ERROR", "checklist_reminder_failed", { uid: user.uid, reason: (error as Error).message });
    }
  }
  return run;
}

async function remindUser(
  io: ChecklistIo,
  channels: ReminderChannels,
  options: ChecklistOptions,
  { uid, settings, homes }: ChecklistUser,
  today: string,
): Promise<{ due: number; sent: number; failed: number; skipped: number }> {
  const outcome = { due: 0, sent: 0, failed: 0, skipped: 0 };
  // Where to send, all read before anything is: someone with nowhere to
  // send is skipped before their trips are read.
  const email = settings.email && channels.mail ? await io.verifiedEmail(uid) : undefined;
  if (settings.email && channels.mail && !email) options.log("INFO", "reminder_no_verified_email", { uid });
  const subscriptions = settings.push && channels.push ? await io.pushSubscriptions(uid) : [];
  const devices = settings.push && channels.fcm ? await io.devices(uid) : [];
  if (!email && !subscriptions.length && !devices.length) {
    outcome.skipped += 1;
    return outcome;
  }
  const standing = await io.standing(uid);
  const trips = (await io.trips(uid, await io.addresses(uid), today)).filter((t) => !t.deleting && displayBounds(t).start >= today);
  const due: Due[] = [];
  for (const trip of trips) {
    const mine = await io.mine(uid, trip.id);
    // Whether anything could be due before reading the bookings: the
    // standing reminders as if the trip went abroad.
    if (!dueEntries(trip, tripChecklist(trip, standing, mine, true), today).length) continue;
    const segments: Segment[] = await io.segments(trip.id);
    // A trip cancelled, or whose every booking was, isn't happening.
    if (tripCancelled(trip, segments)) continue;
    const international = isInternational(trip, segments, homes, options.lookup);
    for (const entry of dueEntries(trip, tripChecklist(trip, standing, mine, international), today)) due.push({ trip, entry });
  }
  if (!due.length) return outcome;
  const ids = due.map(({ trip, entry }) => checklistMarkerId(uid, trip.id, entry.id));
  const markers = await io.markers(ids);
  const open = due.filter((_, i) => !markers.get(ids[i]!)?.done);
  outcome.due = open.length;
  for (const item of open) {
    const { trip, entry } = item;
    const base = { id: checklistMarkerId(uid, trip.id, entry.id), uid, tripId: trip.id, reminderId: entry.id, ends: displayBounds(trip).end };
    const marker = await io.claim(base, options.clock?.() ?? options.now);
    if (!marker) continue;
    const delivered = await deliver(io, channels, options, { uid, email, subscriptions, devices }, item);
    const attempts = marker.attempts + (delivered ? 0 : 1);
    const done = delivered || attempts >= checklistMaxAttempts;
    if (!delivered && done) options.log("WARNING", "checklist_reminder_dropped", { uid, tripId: trip.id, reminderId: entry.id, attempts });
    await io.save({ ...marker, ends: base.ends, attempts, done, at: options.now });
    if (delivered) outcome.sent += 1;
    else outcome.failed += 1;
  }
  return outcome;
}

type Where = {
  uid: string;
  email: string | undefined;
  subscriptions: Awaited<ReturnType<ChecklistIo["pushSubscriptions"]>>;
  devices: Awaited<ReturnType<ChecklistIo["devices"]>>;
};

// Sends one reminder everywhere the person asked; true once any channel took
// it. A channel that fails is logged by the ids alone, never the words.
async function deliver(io: ChecklistIo, channels: ReminderChannels, options: ChecklistOptions, where: Where, { trip, entry }: Due): Promise<boolean> {
  const ids = { uid: where.uid, tripId: trip.id, reminderId: entry.id };
  const message = { origin: options.origin, today: options.now.slice(0, 10) };
  let delivered = false;
  if (where.email && channels.mail) {
    try {
      const { subject, text } = checklistEmail({ trip, entry }, message);
      await channels.mail({ to: where.email, subject, text });
      delivered = true;
    } catch (error) {
      options.log("WARNING", "checklist_mail_failed", { ...ids, reason: (error as Error).message });
    }
  }
  const notification = checklistNotification({ trip, entry }, message);
  if (channels.push) {
    for (const { id, subscription } of where.subscriptions) {
      try {
        if ((await channels.push(subscription, notification, daySeconds)) === "gone") {
          await io.removePushSubscription(where.uid, id);
          options.log("INFO", "push_subscription_gone", { uid: where.uid, id });
        } else delivered = true;
      } catch (error) {
        options.log("WARNING", "checklist_push_failed", { ...ids, id, reason: (error as Error).message });
      }
    }
  }
  if (channels.fcm) {
    for (const { id, device } of where.devices) {
      try {
        if ((await channels.fcm(device, notification, daySeconds)) === "gone") {
          await io.removeDevice(where.uid, id);
          options.log("INFO", "push_device_gone", { uid: where.uid, id });
        } else delivered = true;
      } catch (error) {
        options.log("WARNING", "checklist_push_failed", { ...ids, id, reason: (error as Error).message });
      }
    }
  }
  if (delivered) options.log("INFO", "checklist_reminded", ids);
  return delivered;
}

const sweepPage = 200;
const Homes = z.array(HomeCorrection).max(maxHomeCorrections);

export function firestoreChecklistIo(
  db: Firestore,
  base: Omit<ChecklistIo, "users" | "standing" | "mine" | "markers" | "claim" | "save" | "sweep">,
  log: ChecklistOptions["log"],
): ChecklistIo {
  const parseMarker = (data: unknown): ChecklistMarker | undefined => {
    const d = data as Partial<ChecklistMarker> | undefined;
    if (!d || typeof d.id !== "string" || typeof d.uid !== "string") return undefined;
    return {
      id: d.id,
      uid: d.uid,
      tripId: String(d.tripId),
      reminderId: String(d.reminderId),
      ends: String(d.ends),
      attempts: typeof d.attempts === "number" ? d.attempts : 0,
      done: d.done === true,
      at: String(d.at),
    };
  };
  // Documents in slots, in slot order, those that do not parse left out.
  const slotted = async <T>(path: string, schema: z.ZodType<T>, max: number): Promise<T[]> => {
    const snap = await db.collection(path).get();
    return snap.docs
      .map((d) => ({ slot: d.id, parsed: schema.safeParse(d.data()) }))
      .sort(bySlot)
      .flatMap(({ slot, parsed }) => {
        if (parsed.success) return [parsed.data];
        log("WARNING", "checklist_entry_malformed", { path: `${path}/${slot}` });
        return [];
      })
      .slice(0, max);
  };
  return {
    ...base,
    async users() {
      const snap = await db
        .collection("users")
        .where(Filter.or(Filter.where("reminders.email", "==", true), Filter.where("reminders.push", "==", true)))
        .get();
      return snap.docs.map((d) => {
        const r = d.get("reminders") as Record<string, unknown>;
        // A list that does not parse is logged and ignored, as imports do.
        const homes = Homes.safeParse(d.get("homes") ?? []);
        if (!homes.success) log("WARNING", "home_overrides_malformed", { uid: d.id, issues: homes.error.issues.length });
        return { uid: d.id, settings: { email: r.email === true, push: r.push === true }, homes: homes.success ? homes.data : [] };
      });
    },
    standing: (uid) => slotted(paths.tripReminders(uid), StandingReminder, maxStandingReminders),
    async mine(uid, tripId) {
      const [snap, added] = await Promise.all([db.doc(paths.tripChecklist(uid, tripId)).get(), slotted(paths.tripChecklistAdded(uid, tripId), OneOffReminder, maxTripReminders)]);
      const parsed = TripChecklist.safeParse(snap.data() ?? {});
      if (!parsed.success) log("WARNING", "checklist_malformed", { uid, tripId });
      return { done: parsed.success ? parsed.data.done : [], added };
    },
    async markers(ids) {
      if (!ids.length) return new Map();
      const snaps = await db.getAll(...ids.map((id) => db.doc(paths.checklistReminder(id))));
      return new Map(
        snaps.flatMap((s) => {
          const marker = parseMarker(s.data());
          return marker ? [[s.id, marker] as const] : [];
        }),
      );
    },
    claim(base, now) {
      const ref = db.doc(paths.checklistReminder(base.id));
      return db.runTransaction(async (t) => {
        // Never a marker naming someone whose account is being deleted.
        await refuseIfDeleted(db, t, base.uid);
        const snap = await t.get(ref);
        const found = parseMarker(snap.data());
        if (found?.done) return undefined;
        const until = snap.get("claimUntil");
        if (typeof until === "string" && until > now) return undefined;
        const marker = found ?? { ...base, attempts: 0, done: false, at: now };
        t.set(ref, { ...marker, claimUntil: new Date(Date.parse(now) + checklistClaimMs).toISOString() });
        return marker;
      });
    },
    async save(marker) {
      const ref = db.doc(paths.checklistReminder(marker.id));
      await db.runTransaction(async (t) => {
        await refuseIfDeleted(db, t, marker.uid);
        // Set whole, which drops the claim.
        t.set(ref, marker);
      });
    },
    async sweep(today) {
      let swept = 0;
      for (;;) {
        const snap = await db.collection(paths.checklistReminders()).where("ends", "<", today).limit(sweepPage).get();
        if (snap.empty) return swept;
        // A trip moved later keeps its markers, moved with it, so nothing
        // is sent twice; any other goes.
        const trips = await db.getAll(...snap.docs.map((doc) => db.doc(paths.trip(String(doc.get("tripId"))))));
        const batch = db.batch();
        snap.docs.forEach((doc, i) => {
          const trip = trips[i]!;
          // When the person travels (displayBounds): the live end, else the trip's own.
          const end = trip.get("liveEnd") ?? trip.get("end");
          if (trip.exists && trip.get("deleting") !== true && typeof end === "string" && end >= today) batch.update(doc.ref, { ends: end });
          else {
            batch.delete(doc.ref);
            swept += 1;
          }
        });
        await batch.commit();
        if (snap.size < sweepPage) return swept;
      }
    },
  };
}
