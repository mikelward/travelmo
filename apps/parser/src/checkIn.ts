import {
  CheckedIn,
  checkInEmail,
  checkInNotification,
  checkInReminderCutoffMs,
  checkInReminderDue,
  checkInReminderWindow,
  flightStatusKey,
  paths,
  ReminderSettings,
  type PersonDoc,
  type Segment,
  type Trip,
  watchedTrip,
} from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import type { DeviceSender } from "./fcm";
import type { FlightIo } from "./flightStatus";
import type { Mailer } from "./mail";
import { log } from "./log";
import type { PushSender } from "./push";

// Reminders that online check-in is open (SPEC "Check-in reminders"): the
// every-minute flight-status job finds the flight bookings whose check-in
// has opened and that leave more than an hour from now, and tells the
// owner of each booking's trip and the people it is shared with, once per
// booking, by the channels they turned reminders on for. A marker per
// booking (`checkInReminders/{ownerUid__segmentId}`) remembers who was told,
// so reruns never repeat it; once nobody is left to try, the booking is
// done and later runs read only its marker.

export type CheckInMarker = {
  id: string;
  tripId: string;
  segmentId: string;
  // The booked departure in UTC, after which the marker is swept.
  departs: string;
  // Whom the reminder reached.
  sent: string[];
  // Runs in which some delivery failed and was left for the next run.
  attempts: number;
  // Nobody left to remind: later runs skip the booking.
  done: boolean;
  at: string;
};

export type CheckInIo = Pick<
  FlightIo,
  "flightSegments" | "trip" | "uidForEmail" | "pushSubscriptions" | "removePushSubscription" | "devices" | "removeDevice"
> & {
  // The person's reminder settings, or nothing without a user document.
  settings(uid: string): Promise<ReminderSettings | undefined>;
  verifiedEmail(uid: string): Promise<string | undefined>;
  // The people a person's bookings name, for the trips they're only watching.
  travelers(uid: string): Promise<PersonDoc[]>;
  // The bookings on a trip the person marked "I've checked in" (checkedIn.ts).
  checkedIn(uid: string, tripId: string): Promise<readonly string[]>;
  markers(ids: readonly string[]): Promise<Map<string, CheckInMarker>>;
  // Takes the reminders of one flight's bookings for this run, all or none,
  // so two runs never split a flight and each tell someone on two of its
  // bookings: every booking's marker (a new one where it has none), with
  // those not done claimed; nothing when another run holds any of them.
  claim(bases: readonly Pick<CheckInMarker, "id" | "tripId" | "segmentId" | "departs">[], now: string): Promise<CheckInMarker[] | undefined>;
  // Writes the marker and lets go of the claim.
  save(marker: CheckInMarker): Promise<void>;
  // Moves a marker with its booking (another trip, a new departure), so
  // the sweep finds the booking and keeps whom it reached.
  track(id: string, where: Pick<CheckInMarker, "tripId" | "departs">): Promise<void>;
  // Deletes the markers of flights that have left, keeping (with its new
  // departure) that of a booking moved later; returns how many went.
  sweep(now: string): Promise<number>;
};

export type CheckInChannels = { mail?: Mailer; push?: PushSender; fcm?: DeviceSender };

export type CheckInOptions = {
  now: string;
  // The time now, read for each claim, so a run slowed by earlier flights
  // still holds a later one for its whole lease; absent, `now`.
  clock?: () => string;
  origin: string;
  channels: CheckInChannels;
  log: (level: "INFO" | "WARNING" | "ERROR", event: string, fields: Record<string, unknown>) => void;
  // Whether a person may use the app (SPEC "Access"); absent, everyone may.
  approved?: (uid: string) => Promise<boolean>;
};

export type CheckInRun = { due: number; reminded: number; failed: number; swept: number };

// A delivery that failed is tried on the next runs, up to this many in all.
export const checkInMaxAttempts = 5;
// How long a run holds a booking's reminder, from when it took it: longer
// than telling the few people on one booking takes, each send bounded by
// its channel's timeouts (`smtpTransport`).
export const checkInClaimMs = 10 * 60_000;

// Keyed by the trip's owner and the booking, which keep when a booking
// moves to another of the owner's trips (merged, split or regrouped); a
// booking id alone is not unique across people (it comes from the email).
const utcDeparture = (segment: Pick<Segment, "start">) => new Date(Date.parse(segment.start)).toISOString();

export const checkInMarkerId = (ownerUid: string, segmentId: string) => `${ownerUid}__${segmentId}`;

// A due booking, where it is now.
type Booked = { segment: Segment; trip: Trip; id: string };

export async function sendCheckInReminders(io: CheckInIo, options: CheckInOptions): Promise<CheckInRun> {
  const run: CheckInRun = { due: 0, reminded: 0, failed: 0, swept: 0 };
  try {
    run.swept = await io.sweep(options.now);
  } catch (error) {
    // Left for the next run: stale markers only take room.
    options.log("WARNING", "check_in_sweep_failed", { reason: (error as Error).message });
  }
  const { fromLocal, toLocal } = checkInReminderWindow(options.now);
  const due = (await io.flightSegments(fromLocal, toLocal)).filter((s) => checkInReminderDue(s, options.now));
  if (!due.length) return run;
  const trips = new Map<string, Promise<Trip | undefined>>();
  const tripOf = (id: string) => {
    if (!trips.has(id)) {
      trips.set(
        id,
        io.trip(id).catch((error: unknown) => {
          // Its bookings wait for the next run.
          run.failed += 1;
          options.log("WARNING", "check_in_trip_unreadable", { tripId: id, reason: (error as Error).message });
          return undefined;
        }),
      );
    }
    return trips.get(id)!;
  };
  const booked: Booked[] = (await Promise.all(due.map(async (segment) => ({ segment, trip: await tripOf(segment.tripId) })))).flatMap(({ segment, trip }) =>
    trip && !trip.deleting ? [{ segment, trip, id: checkInMarkerId(trip.ownerUid, segment.id) }] : [],
  );
  if (!booked.length) return run;
  const markers = await io.markers(booked.map((b) => b.id));
  for (const { segment, id } of booked) {
    const marker = markers.get(id);
    const departs = utcDeparture(segment);
    if (!marker || (marker.tripId === segment.tripId && marker.departs === departs)) continue;
    try {
      await io.track(id, { tripId: segment.tripId, departs });
    } catch (error) {
      // Tried again by the next run while the booking is due.
      options.log("WARNING", "check_in_track_failed", { tripId: segment.tripId, segmentId: segment.id, reason: (error as Error).message });
    }
  }
  const isOpen = (b: Booked) => !markers.get(b.id)?.done;
  run.due = booked.filter(isOpen).length;
  // Bookings on the same flight (a couple's two bookings, each shared with
  // the other) remind each person once between them, done ones included:
  // a booking that arrives after the first one's reminder went tells only
  // those the first did not.
  const grouped = new Map<string, Booked[]>();
  for (const b of booked) {
    const key = flightStatusKey(b.segment) ?? b.id;
    grouped.set(key, [...(grouped.get(key) ?? []), b]);
  }
  const flights = [...grouped].filter(([, bookings]) => bookings.some(isOpen));
  for (const [key, bookings] of flights) {
    try {
      const outcome = await remindFlight(io, options, bookings);
      run.reminded += outcome.reminded;
      run.failed += outcome.failed;
    } catch (error) {
      run.failed += 1;
      // Claims lapse on their own, so the next run tries again.
      options.log("ERROR", "check_in_reminder_failed", { key, reason: (error as Error).message });
    }
  }
  return run;
}

async function remindFlight(
  io: CheckInIo,
  options: CheckInOptions,
  bookings: readonly Booked[],
): Promise<{ reminded: number; failed: number }> {
  const bases = bookings.map(({ segment, id }) => ({
    id,
    tripId: segment.tripId,
    segmentId: segment.id,
    departs: utcDeparture(segment),
  }));
  const markers = await io.claim(bases, options.clock?.() ?? options.now);
  if (!markers) return { reminded: 0, failed: 0 };
  const byId = new Map(markers.map((marker) => [marker.id, marker]));
  const claimed = bookings.flatMap(({ segment, trip, id }) => {
    const marker = byId.get(id);
    return marker && !marker.done ? [{ segment, trip, marker, failed: false }] : [];
  });
  if (!claimed.length) return { reminded: 0, failed: 0 };
  // Who is on the flight, by booking: each trip's owner and the people it
  // is shared with (by verified address). Someone on several bookings
  // hears of the one on their own trip.
  // Those a done booking of the flight reached count too.
  const told = new Set(markers.flatMap((marker) => marker.sent));
  const viewersOf = new Map<Trip, Promise<Set<string | undefined>>>();
  const viewers = (trip: Trip) => {
    if (!viewersOf.has(trip)) {
      viewersOf.set(trip, Promise.all(trip.sharedWith.map((email) => io.uidForEmail(email))).then((uids) => new Set([trip.ownerUid, ...uids])));
    }
    return viewersOf.get(trip)!;
  };
  // Every booking of the flight each person sees, done ones included, so
  // a mark on one whose reminder already went still counts.
  const seen = new Map<string, Segment[]>();
  for (const { segment, trip } of bookings) {
    for (const uid of await viewers(trip)) if (uid) seen.set(uid, [...(seen.get(uid) ?? []), segment]);
  }
  const people = new Map<string, { entries: typeof claimed; own?: (typeof claimed)[number] }>();
  for (const entry of claimed) {
    const { trip } = entry;
    for (const uid of await viewers(trip)) {
      if (!uid || told.has(uid)) continue;
      const person = people.get(uid) ?? { entries: [] };
      person.entries.push(entry);
      if (uid === trip.ownerUid) person.own ??= entry;
      people.set(uid, person);
    }
  }
  let reminded = 0;
  let failed = 0;
  for (const [uid, { entries, own }] of people) {
    if (!(await mayUse(options, uid))) continue;
    if (await checkedInFor(io, options, uid, seen.get(uid) ?? [])) continue;
    // Check-in is the traveler's to do, not someone only watching the trip
    // (by what each trip keeps of whom its bookings are for).
    if (await onlyWatching(io, options, uid, entries.map((entry) => entry.trip))) continue;
    const { segment } = own ?? entries[0]!;
    let outcome: Awaited<ReturnType<typeof deliver>>;
    try {
      outcome = await deliver(io, options, uid, segment);
    } catch (error) {
      // Their settings or browsers could not be read: tried again next run,
      // and the others on the flight are still told now.
      options.log("WARNING", "check_in_reminder_person_failed", { uid, tripId: segment.tripId, segmentId: segment.id, reason: (error as Error).message });
      outcome = "failed";
    }
    if (outcome === "delivered") {
      reminded += 1;
      for (const entry of entries) entry.marker.sent.push(uid);
    } else if (outcome === "failed") {
      failed += 1;
      for (const entry of entries) entry.failed = true;
    }
  }
  for (const { marker, failed: retry } of claimed) {
    const attempts = marker.attempts + (retry ? 1 : 0);
    const done = !retry || attempts >= checkInMaxAttempts;
    if (retry && done) options.log("WARNING", "check_in_reminder_dropped", { tripId: marker.tripId, segmentId: marker.segmentId, attempts });
    await io.save({ ...marker, sent: [...new Set(marker.sent)], attempts, done, at: options.now });
  }
  return { reminded, failed };
}

async function mayUse(options: CheckInOptions, uid: string): Promise<boolean> {
  if (!options.approved) return true;
  let approved: boolean;
  try {
    approved = await options.approved(uid);
  } catch (error) {
    // Left out, as unapproved, rather than ending the run for the rest.
    options.log("ERROR", "approval_check_failed", { uid, reason: (error as Error).message });
    return false;
  }
  if (!approved) options.log("INFO", "check_in_skipped_unapproved", { uid });
  return approved;
}

// Whether the person marked any of their bookings of the flight "I've
// checked in": they need no reminder. A mark that can't be read is taken
// as none, so a reminder too many goes rather than one missed.
// Whether the person is only watching every trip they'd be told of this
// flight for; when their people can't be read, they're told, as before.
async function onlyWatching(io: CheckInIo, options: CheckInOptions, uid: string, trips: readonly Trip[]): Promise<boolean> {
  try {
    const travelers = await io.travelers(uid);
    const watching = trips.every((trip) => watchedTrip(trip, undefined, travelers));
    if (watching) options.log("INFO", "check_in_skipped_watching", { uid, tripIds: trips.map((t) => t.id) });
    return watching;
  } catch (error) {
    options.log("WARNING", "check_in_people_unreadable", { uid, reason: (error as Error).message });
    return false;
  }
}

async function checkedInFor(io: CheckInIo, options: CheckInOptions, uid: string, segments: readonly Segment[]): Promise<boolean> {
  for (const tripId of new Set(segments.map((s) => s.tripId))) {
    let marked: readonly string[];
    try {
      marked = await io.checkedIn(uid, tripId);
    } catch (error) {
      options.log("WARNING", "check_in_mark_unreadable", { uid, tripId, reason: (error as Error).message });
      continue;
    }
    const segment = segments.find((s) => s.tripId === tripId && marked.includes(s.id));
    if (segment) {
      options.log("INFO", "check_in_skipped_checked_in", { uid, tripId, segmentId: segment.id });
      return true;
    }
  }
  return false;
}

const daySeconds = 24 * 60 * 60;

// Sends the reminder by the person's reminder channels: email when
// `reminders.email` is on and Google verified their address, and every
// browser and phone when `reminders.push` is. "delivered" once any took
// it; "failed" when every one failed in a way that may pass; "none" when
// the person has reminders off or nowhere to send them.
async function deliver(io: CheckInIo, options: CheckInOptions, uid: string, segment: Segment): Promise<"delivered" | "failed" | "none"> {
  const settings = await io.settings(uid);
  if (!settings?.email && !settings?.push) return "none";
  const { channels } = options;
  const notification = checkInNotification(segment, options);
  // A push service may hold it until online check-in usually closes.
  const left = Math.floor((Date.parse(segment.start) - checkInReminderCutoffMs - Date.parse(options.now)) / 1000);
  const ttl = Math.min(daySeconds, Math.max(60, left));
  const ids = { uid, tripId: segment.tripId, segmentId: segment.id };
  let delivered = false;
  let failed = false;
  // Where to send it, all read before anything is sent, and a channel that
  // can't be read is only that channel failing: a read that threw after a
  // send would leave the person untold on the marker, and the next run
  // would send it again.
  const lookup = async <T>(channel: string, read: () => Promise<T>, none: T): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      failed = true;
      options.log("WARNING", "check_in_lookup_failed", { uid, channel, reason: (error as Error).message });
      return none;
    }
  };
  const email = settings.email && channels.mail ? await lookup("mail", () => io.verifiedEmail(uid), undefined) : undefined;
  if (settings.email && channels.mail && !email && !failed) options.log("INFO", "reminder_no_verified_email", { uid });
  const subscriptions = settings.push && channels.push ? await lookup("push", () => io.pushSubscriptions(uid), []) : [];
  const devices = settings.push && channels.fcm ? await lookup("fcm", () => io.devices(uid), []) : [];
  if (email && channels.mail) {
    try {
      const { subject, text } = checkInEmail(segment, options);
      await channels.mail({ to: email, subject, text });
      delivered = true;
    } catch (error) {
      failed = true;
      options.log("WARNING", "check_in_mail_failed", { ...ids, reason: (error as Error).message });
    }
  }
  if (channels.push) {
    for (const { id, subscription } of subscriptions) {
      try {
        if ((await channels.push(subscription, notification, ttl)) === "gone") {
          await io.removePushSubscription(uid, id);
          options.log("INFO", "push_subscription_gone", { uid, id });
        } else delivered = true;
      } catch (error) {
        failed = true;
        options.log("WARNING", "check_in_push_failed", { ...ids, id, reason: (error as Error).message });
      }
    }
  }
  if (channels.fcm) {
    for (const { id, device } of devices) {
      try {
        if ((await channels.fcm(device, notification, ttl)) === "gone") {
          await io.removeDevice(uid, id);
          options.log("INFO", "push_device_gone", { uid, id });
        } else delivered = true;
      } catch (error) {
        failed = true;
        options.log("WARNING", "check_in_push_failed", { ...ids, id, reason: (error as Error).message });
      }
    }
  }
  if (delivered) options.log("INFO", "check_in_reminded", ids);
  return delivered ? "delivered" : failed ? "failed" : "none";
}

const sweepPage = 200;

export function firestoreCheckInIo(
  db: Firestore,
  people: Omit<CheckInIo, "markers" | "claim" | "save" | "track" | "sweep" | "settings" | "checkedIn">,
): CheckInIo {
  const parseMarker = (data: unknown): CheckInMarker | undefined => {
    const d = data as Partial<CheckInMarker> | undefined;
    if (!d || typeof d.id !== "string" || typeof d.departs !== "string") return undefined;
    return {
      id: d.id,
      tripId: String(d.tripId),
      segmentId: String(d.segmentId),
      departs: d.departs,
      sent: Array.isArray(d.sent) ? d.sent.filter((u): u is string => typeof u === "string") : [],
      attempts: typeof d.attempts === "number" ? d.attempts : 0,
      done: d.done === true,
      at: String(d.at),
    };
  };
  return {
    ...people,
    async settings(uid) {
      const parsed = ReminderSettings.safeParse((await db.doc(paths.user(uid)).get()).get("reminders"));
      return parsed.success ? parsed.data : undefined;
    },
    async checkedIn(uid, tripId) {
      const parsed = CheckedIn.safeParse((await db.doc(paths.checkedIn(uid, tripId)).get()).data() ?? {});
      if (parsed.success) return parsed.data.segmentIds;
      // Taken as no mark: the reminder goes.
      log("WARNING", "check_in_mark_malformed", { uid, tripId });
      return [];
    },
    async markers(ids) {
      if (!ids.length) return new Map();
      const snaps = await db.getAll(...ids.map((id) => db.doc(paths.checkInReminder(id))));
      return new Map(snaps.flatMap((s) => {
        const marker = parseMarker(s.data());
        return marker ? [[s.id, marker] as const] : [];
      }));
    },
    claim(bases, now) {
      const refs = bases.map((base) => db.doc(paths.checkInReminder(base.id)));
      return db.runTransaction(async (t) => {
        const snaps = refs.length ? await t.getAll(...refs) : [];
        const found = snaps.map((snap, i) => {
          const found = parseMarker(snap.data());
          // Where the booking is now, for the sweep, should it have moved.
          const marker = found ? { ...found, tripId: bases[i]!.tripId, segmentId: bases[i]!.segmentId } : { ...bases[i]!, sent: [], attempts: 0, done: false, at: now };
          const until = snap.get("claimUntil");
          return { marker, held: !marker.done && typeof until === "string" && until > now };
        });
        if (found.some((f) => f.held)) return undefined;
        const claimUntil = new Date(Date.parse(now) + checkInClaimMs).toISOString();
        found.forEach(({ marker }, i) => {
          if (!marker.done) t.set(refs[i]!, { ...marker, claimUntil });
        });
        return found.map((f) => f.marker);
      });
    },
    async track(id, where) {
      await db.doc(paths.checkInReminder(id)).update(where);
    },
    async save(marker) {
      // Set whole, which drops the claim.
      await db.doc(paths.checkInReminder(marker.id)).set(marker);
    },
    async sweep(now) {
      let swept = 0;
      for (;;) {
        const snap = await db.collection(paths.checkInReminders()).where("departs", "<", now).limit(sweepPage).get();
        if (snap.empty) return swept;
        // A booking moved to a later departure keeps its marker, moved
        // with it, so it is not reminded again; any other goes.
        const bookings = await db.getAll(...snap.docs.map((doc) => db.doc(paths.segment(String(doc.get("tripId")), String(doc.get("segmentId"))))));
        const batch = db.batch();
        snap.docs.forEach((doc, i) => {
          const start = bookings[i]!.get("start");
          const departs = typeof start === "string" && !Number.isNaN(Date.parse(start)) ? new Date(Date.parse(start)).toISOString() : undefined;
          if (departs && departs >= now) batch.update(doc.ref, { departs });
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
