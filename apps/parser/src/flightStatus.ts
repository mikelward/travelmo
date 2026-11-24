import {
  flightCheckDue,
  flightCheckInterval,
  flightRefreshDue,
  flightStatusKey,
  isCancelled,
  flightStatusLines,
  flightStatusNews,
  FlightStatus,
  keepKnownPlaces,
  giveUpAfterMs,
  noticeDeparture,
  paths,
  refreshBeforeDepartureMs,
  Segment,
  sharedWithAny,
  Trip,
  type ReminderNotification,
} from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { lookupWindow, matchFlight, statusFromFlight, type FlightLookup } from "./aeroapi";
import type { DeviceSender, LiveSender } from "./fcm";
import type { PushSender } from "./push";
import type { StoredDevice, StoredSubscription } from "./reminders";

// Live gates, carousels, delays, cancellations and diversions: every minute Cloud Scheduler calls the job,
// which finds the flight bookings near departure or arrival, asks AeroAPI
// about each flight once for everyone booked on it (when flightCheckDue
// says it is time), keeps the answer in `flightStatus/{key}` and sends what
// is new to the browsers and phones of everyone whose trip holds the
// flight. An open trip page asks for its own flights the same way, at most
// once a minute each. A daily cap bounds the bill whatever happens.

export type FlightIo = {
  // Flight bookings whose start, as written in local time, lies between
  // two local wall-clock times ("2026-12-12T09:00").
  flightSegments(fromLocal: string, toLocal: string): Promise<Segment[]>;
  trip(tripId: string): Promise<Trip | undefined>;
  status(key: string): Promise<FlightStatus | undefined>;
  // Claims the next look at a flight before paying for it: true for one
  // caller only while the status is still `before` and no other claim
  // made since `now` minus claimMs stands, so overlapping looks (the job
  // and open trip pages) make one call between them.
  claim(key: string, before: FlightStatus | undefined, now: string): Promise<boolean>;
  // Writes the status unless another look wrote one since `before` was
  // read (by its checkedAt); false then, so its news is not sent twice.
  saveStatus(key: string, before: FlightStatus | undefined, after: FlightStatus): Promise<boolean>;
  // Takes one of the day's calls; false when the day's budget is spent.
  reserve(day: string, limit: number): Promise<boolean>;
  // Whose account a verified address is, for the people a trip is shared with.
  uidForEmail(email: string): Promise<string | undefined>;
  pushSubscriptions(uid: string): Promise<StoredSubscription[]>;
  removePushSubscription(uid: string, id: string): Promise<void>;
  devices(uid: string): Promise<StoredDevice[]>;
  removeDevice(uid: string, id: string): Promise<void>;
  // News waiting for another try (retryPendingNews); one per flight and
  // person, a newer one replacing it.
  pendingNews(): Promise<PendingNews[]>;
  // With `ifAt`, only while the stored entry is still the one written at
  // that time: a retry never undoes a newer entry for the same news.
  savePendingNews(pending: PendingNews, ifAt?: string): Promise<void>;
  dropPendingNews(id: string, ifAt?: string): Promise<void>;
};

// Who is owed news of a flight: the notification's title, tap target and
// tag. Its body is built from the flight's status when it is sent, so a
// retry never gives a gate a later look has replaced.
export type PendingNews = { id: string; uid: string; key: string; title: string; url: string; tag: string; attempts: number; at: string };

// `live` sends phones the flight's Live Update after each look (fcm.ts).
export type FlightChannels = { push?: PushSender; fcm?: DeviceSender; live?: LiveSender };

export type FlightOptions = {
  lookup: FlightLookup;
  limit: number;
  // When the run started; `clock`, when given, is read again for each
  // flight, so a claim and an answer are stamped when they happen, not
  // when a long run began.
  now: string;
  clock?: () => string;
  origin: string;
  channels: FlightChannels;
  log: (level: "INFO" | "WARNING" | "ERROR", event: string, fields: Record<string, unknown>) => void;
  // Whether a person may use the app (SPEC "Access"): news goes only to
  // those who may. Absent, everyone on the trip may.
  approved?: (uid: string) => Promise<boolean>;
};

export type FlightRun = { flights: number; checked: number; notified: number; failed: number; capped: boolean };

// Whether phones get the flight's Live Update after this look: while the
// scheduled job watches it (from two hours before departure to 45 minutes
// after landing), and once more when this look ends the watch (cancelled,
// or a delay putting departure more than two hours off), so the phone
// takes down what it shows. A look from an open trip page before the
// watch begins sends none.
export function liveUpdateDue(segment: Segment, before: FlightStatus | undefined, after: FlightStatus, now: string): boolean {
  const watched = (status: FlightStatus | undefined) => Boolean(status?.found) && flightCheckInterval(segment, status, now) !== undefined;
  return watched(after) || watched(before);
}

const current = (options: Pick<FlightOptions, "now" | "clock">): string => options.clock?.() ?? options.now;

const hour = 60 * 60_000;
// How long a claim on a flight's next look stands: longer than a lookup
// takes (AeroAPI's timeout is 10 s), so a look that died frees it soon.
export const claimMs = 30_000;
// Local wall-clock time is UTC moved by at most 12 hours back or 14 on.
const localBound = (ms: number) => new Date(ms).toISOString().slice(0, 16);

// The flight bookings any look could be due for now: from those booked to
// leave six hours ahead (an open trip page's earliest) back to those the
// scheduled job gives up on, widened by every offset a place can have.
export function flightWindow(now: string): { fromLocal: string; toLocal: string } {
  const at = Date.parse(now);
  return { fromLocal: localBound(at - giveUpAfterMs - 12 * hour), toLocal: localBound(at + refreshBeforeDepartureMs + 14 * hour) };
}

type Flight = { key: string; segments: Segment[] };

function flightsOf(segments: readonly Segment[]): Flight[] {
  const byKey = new Map<string, Segment[]>();
  for (const segment of segments) {
    // A cancelled booking's flight is no one's to look up (each look is paid).
    if (isCancelled(segment)) continue;
    const key = flightStatusKey(segment);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), segment]);
  }
  return [...byKey].map(([key, list]) => ({ key, segments: list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)) }));
}

// Looks at the flights due a look: all of them (the scheduled job), or the
// flights of one trip someone has open (`tripId`), and sends what is new.
export async function checkFlights(io: FlightIo, options: FlightOptions, only?: { tripId: string }): Promise<FlightRun> {
  const run: FlightRun = { flights: 0, checked: 0, notified: 0, failed: 0, capped: false };
  const { fromLocal, toLocal } = flightWindow(options.now);
  const day = options.now.slice(0, 10);
  const trips = new Map<string, Promise<Trip | undefined>>();
  const tripOf = (id: string) => {
    let trip = trips.get(id);
    if (!trip) {
      trip = io.trip(id);
      trips.set(id, trip);
    }
    return trip;
  };
  for (const flight of flightsOf(await io.flightSegments(fromLocal, toLocal))) {
    if (only && !flight.segments.some((s) => s.tripId === only.tripId)) continue;
    run.flights += 1;
    const [first] = flight.segments;
    try {
      const before = await io.status(flight.key);
      const now = current(options);
      const due = only ? flightRefreshDue(first!, before, now) : flightCheckDue(first!, before, now);
      if (!due) continue;
      if (!(await io.claim(flight.key, before, now))) continue;
      if (!(await io.reserve(day, options.limit))) {
        run.capped = true;
        options.log("WARNING", "flight_status_capped", { day, limit: options.limit });
        break;
      }
      const { from, to } = lookupWindow(first!.start);
      const [ident, date, origin] = flight.key.split("_");
      const match = matchFlight(await options.lookup(ident!, from, to), first!);
      const answer = statusFromFlight(match, { ident: ident!, date: date!, ...(origin ? { origin } : {}) }, current(options));
      const after = noticeDeparture(before, keepKnownPlaces(before, answer));
      run.checked += 1;
      if (!(await io.saveStatus(flight.key, before, after))) continue;
      const news = flightStatusNews(before, after, first);
      const live = Boolean(options.channels.live) && liveUpdateDue(first!, before, after, current(options));
      if (!news.length && !live) continue;
      const people = await recipients(io, options, flight, tripOf, news.length > 0);
      if (news.length) run.notified += await notify(io, options, flight, news, people);
      if (live) await sendLive(io, options, flight.key, after, people);
    } catch (error) {
      run.failed += 1;
      options.log("ERROR", "flight_status_failed", { key: flight.key, reason: (error as Error).message });
    }
  }
  return run;
}

// Who hears of a flight: the owners of the trips holding it and the
// people they are shared with, once each with their own booking of it,
// leaving out anyone who may not use the app. `logSkips` is false for a
// look with only a Live Update to send, which comes every minute.
async function recipients(
  io: FlightIo,
  options: FlightOptions,
  flight: Flight,
  tripOf: (id: string) => Promise<Trip | undefined>,
  logSkips: boolean,
): Promise<Map<string, Segment>> {
  const people = new Map<string, Segment>();
  for (const segment of flight.segments) {
    const trip = await tripOf(segment.tripId);
    if (!trip || trip.deleting) continue;
    const uids = [trip.ownerUid, ...(await Promise.all(trip.sharedWith.map((email) => io.uidForEmail(email))))];
    for (const uid of uids) if (uid && !people.has(uid)) people.set(uid, segment);
  }
  if (!options.approved) return people;
  for (const uid of [...people.keys()]) {
    let approved: boolean;
    try {
      approved = await options.approved(uid);
    } catch (error) {
      // Left out, as unapproved, rather than ending the run for the rest.
      options.log("ERROR", "approval_check_failed", { uid, reason: (error as Error).message });
      approved = false;
    }
    if (approved) continue;
    people.delete(uid);
    if (logSkips) options.log("INFO", "flight_status_skipped_unapproved", { uid, key: flight.key });
  }
  return people;
}

// The news goes to everyone whose trip holds the flight, once each, on
// every browser and phone they turned notifications on for. Returns how
// many were reached.
async function notify(io: FlightIo, options: FlightOptions, flight: Flight, news: readonly string[], people: Map<string, Segment>): Promise<number> {
  let reached = 0;
  for (const [uid, segment] of people) {
    const notification: ReminderNotification = {
      title: segment.title,
      body: news.join("\n"),
      url: `${options.origin}/trips/${segment.tripId}`,
      tag: `flight-${flight.key}`,
    };
    const outcome = await deliver(io, options, uid, notification);
    if (outcome === "delivered") {
      reached += 1;
      // Anything still owed them for the flight is said by this.
      await io.dropPendingNews(pendingId(flight.key, uid));
      options.log("INFO", "flight_status_notified", { uid, key: flight.key, lines: news.length });
    } else if (outcome === "failed") {
      // Every send failed for a reason that may pass: the news waits for
      // the next run rather than being lost with the status already saved.
      const { title, url, tag } = notification;
      await io.savePendingNews({ id: pendingId(flight.key, uid), uid, key: flight.key, title, url, tag, attempts: 1, at: current(options) });
      options.log("WARNING", "flight_status_news_pending", { uid, key: flight.key });
    }
  }
  return reached;
}

// The Live Update goes to every phone of everyone on the flight. A failed
// send is not tried again: the next look, a minute or a quarter of an hour
// on, sends a newer one.
async function sendLive(io: FlightIo, options: FlightOptions, key: string, status: FlightStatus, people: Map<string, Segment>): Promise<void> {
  const send = options.channels.live!;
  for (const [uid, segment] of people) {
    const update = {
      key,
      status,
      booking: { title: segment.title, start: segment.start, ...(segment.end ? { end: segment.end } : {}), ...(segment.destination ? { destination: segment.destination } : {}) },
      url: `${options.origin}/trips/${segment.tripId}`,
    };
    for (const { id, device } of await io.devices(uid)) {
      try {
        if ((await send(device, update)) === "gone") {
          await io.removeDevice(uid, id);
          options.log("INFO", "push_device_gone", { uid, id });
        }
      } catch (error) {
        options.log("WARNING", "flight_live_update_failed", { uid, id, key, reason: (error as Error).message });
      }
    }
  }
}

const pendingId = (key: string, uid: string) => `${key}__${uid}`;

// How long a push service may hold flight news for an offline browser or
// phone: directions to a gate are no use once the flight has gone.
export const flightNewsTtlSeconds = 30 * 60;

// Sends one notification to every browser and phone the person turned
// notifications on for, forgetting those the services report gone.
// "delivered" once any took it; "failed" when every one failed in a way
// that may pass; "none" when the person has nowhere to send it.
async function deliver(io: FlightIo, options: FlightOptions, uid: string, notification: ReminderNotification): Promise<"delivered" | "failed" | "none"> {
  let delivered = false;
  let failed = false;
  if (options.channels.push) {
    for (const { id, subscription } of await io.pushSubscriptions(uid)) {
      try {
        if ((await options.channels.push(subscription, notification, flightNewsTtlSeconds)) === "gone") {
          await io.removePushSubscription(uid, id);
          options.log("INFO", "push_subscription_gone", { uid, id });
        } else delivered = true;
      } catch (error) {
        failed = true;
        options.log("WARNING", "flight_push_failed", { uid, id, reason: (error as Error).message });
      }
    }
  }
  if (options.channels.fcm) {
    for (const { id, device } of await io.devices(uid)) {
      try {
        if ((await options.channels.fcm(device, notification, flightNewsTtlSeconds)) === "gone") {
          await io.removeDevice(uid, id);
          options.log("INFO", "push_device_gone", { uid, id });
        } else delivered = true;
      } catch (error) {
        failed = true;
        options.log("WARNING", "flight_push_failed", { uid, id, reason: (error as Error).message });
      }
    }
  }
  return delivered ? "delivered" : failed ? "failed" : "none";
}

// News no browser or phone of a person took, a gate change being worth
// another try while it is still news: tried again each scheduled run, for
// half an hour or five tries, whichever comes first, saying where the
// flight leaves from, arrives at and where the bags come out as its status
// says then, never the words that failed.
export const pendingNewsMaxAgeMs = 30 * 60_000;
export const pendingNewsMaxAttempts = 5;

export async function retryPendingNews(io: FlightIo, options: FlightOptions): Promise<{ delivered: number; dropped: number }> {
  const result = { delivered: 0, dropped: 0 };
  for (const pending of await io.pendingNews()) {
    try {
      if (Date.parse(current(options)) - Date.parse(pending.at) > pendingNewsMaxAgeMs || pending.attempts >= pendingNewsMaxAttempts) {
        await io.dropPendingNews(pending.id, pending.at);
        result.dropped += 1;
        options.log("WARNING", "flight_status_news_dropped", { uid: pending.uid, key: pending.key, attempts: pending.attempts });
        continue;
      }
      // Access revoked since the news was owed: it is dropped, not sent.
      if (options.approved && !(await options.approved(pending.uid))) {
        await io.dropPendingNews(pending.id, pending.at);
        result.dropped += 1;
        options.log("INFO", "flight_status_skipped_unapproved", { uid: pending.uid, key: pending.key });
        continue;
      }
      const lines = flightStatusLines(await io.status(pending.key));
      if (!lines.length) {
        await io.dropPendingNews(pending.id, pending.at);
        continue;
      }
      const notification = { title: pending.title, body: lines.join("\n"), url: pending.url, tag: pending.tag };
      const outcome = await deliver(io, options, pending.uid, notification);
      if (outcome === "failed") {
        await io.savePendingNews({ ...pending, attempts: pending.attempts + 1 }, pending.at);
        continue;
      }
      await io.dropPendingNews(pending.id, pending.at);
      if (outcome === "delivered") {
        result.delivered += 1;
        options.log("INFO", "flight_status_notified", { uid: pending.uid, key: pending.key, retried: pending.attempts });
      }
    } catch (error) {
      options.log("ERROR", "flight_status_news_retry_failed", { uid: pending.uid, key: pending.key, reason: (error as Error).message });
    }
  }
  return result;
}

// Whether the signed-in person may see the trip: its owner, or someone it
// is shared with by any of their addresses (verified sign-in or linked).
export function canSeeTrip(trip: Trip, uid: string, addresses: readonly string[]): boolean {
  return trip.ownerUid === uid || sharedWithAny(trip.sharedWith, addresses);
}

export function firestoreFlightIo(
  db: Firestore,
  people: Pick<FlightIo, "uidForEmail" | "pushSubscriptions" | "removePushSubscription" | "devices" | "removeDevice">,
): FlightIo {
  return {
    ...people,
    async flightSegments(fromLocal, toLocal) {
      const snap = await db
        .collectionGroup("segments")
        .where("type", "==", "flight")
        .where("start", ">=", fromLocal)
        .where("start", "<=", `${toLocal}`)
        .get();
      return snap.docs.flatMap((d) => {
        const parsed = Segment.safeParse(d.data());
        return parsed.success ? [parsed.data] : [];
      });
    },
    async trip(tripId) {
      const snap = await db.doc(paths.trip(tripId)).get();
      const parsed = Trip.safeParse(snap.data());
      return parsed.success ? parsed.data : undefined;
    },
    async pendingNews() {
      const snap = await db.collection(paths.flightStatusNews()).get();
      return snap.docs.map((d) => d.data() as PendingNews);
    },
    async savePendingNews(pending, ifAt) {
      const ref = db.doc(paths.flightStatusNewsEntry(pending.id));
      if (ifAt === undefined) return void (await ref.set(pending));
      await db.runTransaction(async (t) => {
        if ((await t.get(ref)).get("at") === ifAt) t.set(ref, pending);
      });
    },
    async dropPendingNews(id, ifAt) {
      const ref = db.doc(paths.flightStatusNewsEntry(id));
      if (ifAt === undefined) return void (await ref.delete());
      await db.runTransaction(async (t) => {
        if ((await t.get(ref)).get("at") === ifAt) t.delete(ref);
      });
    },
    async status(key) {
      const parsed = FlightStatus.safeParse((await db.doc(paths.flightStatus(key)).get()).data());
      return parsed.success ? parsed.data : undefined;
    },
    claim(key, before, now) {
      const statusRef = db.doc(paths.flightStatus(key));
      const claimRef = db.doc(paths.flightStatusClaim(key));
      return db.runTransaction(async (t) => {
        const [status, claim] = await Promise.all([t.get(statusRef), t.get(claimRef)]);
        const current = FlightStatus.safeParse(status.data());
        if ((current.success ? current.data.checkedAt : undefined) !== before?.checkedAt) return false;
        const until = claim.get("until");
        if (typeof until === "string" && until > now) return false;
        t.set(claimRef, { until: new Date(Date.parse(now) + claimMs).toISOString() });
        return true;
      });
    },
    saveStatus(key, before, after) {
      const ref = db.doc(paths.flightStatus(key));
      return db.runTransaction(async (t) => {
        const current = FlightStatus.safeParse((await t.get(ref)).data());
        if ((current.success ? current.data.checkedAt : undefined) !== before?.checkedAt) return false;
        t.set(ref, after);
        return true;
      });
    },
    reserve(day, limit) {
      const ref = db.doc(paths.flightStatusBudget(day));
      return db.runTransaction(async (t) => {
        const calls = ((await t.get(ref)).data()?.calls as number | undefined) ?? 0;
        if (calls >= limit) return false;
        t.set(ref, { calls: calls + 1 }, { merge: true });
        return true;
      });
    },
  };
}

// Calls a day across every user: about 200 a flight at a minute apart
// around departure and arrival, so a few flights' worth, at most about
// $5 a day.
export const defaultFlightStatusDailyLimit = 1000;
