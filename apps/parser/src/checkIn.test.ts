import type { PersonDoc, ReminderNotification, ReminderSettings, Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { checkInMaxAttempts, checkInMarkerId, sendCheckInReminders, type CheckInIo, type CheckInMarker, type CheckInOptions } from "./checkIn";
import type { StoredDevice, StoredSubscription } from "./reminders";

// An invented Emirates flight leaving Manchester at 09:00 local (+00:00) on
// 13 December, whose check-in opens two days before: booked on the owner's
// trip, shared with a partner, and on a friend's own trip.
const at = "2026-11-01T00:00:00Z";
const opens = "2026-12-11T09:00:00Z";
const trip = (id: string, ownerUid: string, sharedWith: string[] = []): Trip => ({
  id,
  title: id,
  start: "2026-12-13",
  end: "2026-12-20",
  ownerUid,
  sharedWith,
  createdAt: at,
  updatedAt: at,
});
const booking = (tripId: string, over: Partial<Segment> = {}): Segment => ({
  id: `${tripId}-f`,
  tripId,
  type: "flight",
  title: "EK 18 MAN to DXB",
  start: "2026-12-13T09:00:00+00:00",
  end: "2026-12-13T19:00:00+04:00",
  origin: { name: "Manchester", code: "MAN" },
  destination: { name: "Dubai International", city: "Dubai", code: "DXB" },
  confirmation: "EK1234",
  source: "manual",
  gmailMessageIds: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});

type Sent = { channel: "mail" | "push" | "fcm"; to: string; title: string; url?: string; ttl?: number };

function setup(
  options: {
    segments?: Segment[];
    trips?: Trip[];
    settings?: Record<string, ReminderSettings>;
    approved?: (uid: string) => Promise<boolean>;
    mailFails?: boolean;
    // The bookings each person marked "I've checked in", by uid and trip.
    checkedIn?: Record<string, Record<string, string[]>>;
    // The people each person's bookings name.
    people?: Record<string, PersonDoc[]>;
  } = {},
) {
  const segments = options.segments ?? [booking("t1"), booking("t2", { confirmation: "EK5678" })];
  const trips = new Map((options.trips ?? [trip("t1", "owner", ["partner@example.com", "stranger@example.com"]), trip("t2", "friend")]).map((t) => [t.id, t]));
  const settings = new Map(Object.entries(options.settings ?? { owner: { email: true, push: true }, partner: { push: true }, friend: { email: true } }));
  const markers = new Map<string, CheckInMarker & { claimUntil?: string }>();
  const subscriptions = new Map<string, StoredSubscription[]>([
    ["owner", [{ id: "s1", subscription: { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" }, createdAt: at } }]],
  ]);
  const devices = new Map<string, StoredDevice[]>([["partner", [{ id: "d1", device: { token: "fcm-1", platform: "android", createdAt: at } }]]]);
  const sent: Sent[] = [];
  const logs: string[] = [];
  const windows: [string, string][] = [];
  const io: CheckInIo = {
    flightSegments: async (from, to) => {
      windows.push([from, to]);
      return segments;
    },
    trip: async (id) => trips.get(id),
    uidForEmail: async (email) => (email === "partner@example.com" ? "partner" : undefined),
    settings: async (uid) => settings.get(uid),
    verifiedEmail: async (uid) => `${uid}@example.com`,
    checkedIn: async (uid, tripId) => options.checkedIn?.[uid]?.[tripId] ?? [],
    travelers: async (uid) => options.people?.[uid] ?? [],
    pushSubscriptions: async (uid) => subscriptions.get(uid) ?? [],
    removePushSubscription: async () => {},
    devices: async (uid) => devices.get(uid) ?? [],
    removeDevice: async () => {},
    markers: async (ids) => new Map(ids.flatMap((id) => (markers.has(id) ? [[id, markers.get(id)!] as const] : []))),
    claim: async (bases, now) => {
      const found = bases.map((base) => markers.get(base.id) ?? { ...base, sent: [], attempts: 0, done: false, at: now });
      if (found.some((m) => !m.done && (m.claimUntil ?? "") > now)) return undefined;
      const claimUntil = new Date(Date.parse(now) + 600_000).toISOString();
      for (const m of found) if (!m.done) markers.set(m.id, { ...m, claimUntil });
      return found.map(({ claimUntil: _held, ...m }) => ({ ...m, sent: [...m.sent] }));
    },
    save: async (marker) => void markers.set(marker.id, marker),
    track: async (id, where) => void markers.set(id, { ...markers.get(id)!, ...where }),
    sweep: async () => 0,
  };
  const optionsAt = (now: string, over: Partial<CheckInOptions> = {}): CheckInOptions => ({
    now,
    origin: "https://travelmo.example",
    channels: {
      mail: async ({ to, subject }) => {
        if (options.mailFails) throw new Error("SMTP down");
        sent.push({ channel: "mail", to, title: subject });
      },
      push: async (subscription, n: ReminderNotification, ttl) => {
        sent.push({ channel: "push", to: subscription.endpoint, title: n.title, url: n.url, ...(ttl === undefined ? {} : { ttl }) });
        return "sent";
      },
      fcm: async (device, n: ReminderNotification, ttl) => {
        sent.push({ channel: "fcm", to: device.token, title: n.title, url: n.url, ...(ttl === undefined ? {} : { ttl }) });
        return "sent";
      },
    },
    log: (_level, event) => logs.push(event),
    ...(options.approved ? { approved: options.approved } : {}),
    ...over,
  });
  return { io, optionsAt, sent, logs, markers, windows, settings };
}

describe("sendCheckInReminders", () => {
  it("sends nothing before the airline's check-in opens", async () => {
    const { io, optionsAt, sent } = setup();
    const run = await sendCheckInReminders(io, optionsAt("2026-12-11T08:59:00Z"));
    expect(run).toMatchObject({ due: 0, reminded: 0 });
    expect(sent).toEqual([]);
  });

  it("reminds each person on the flight once, by the channels they turned on", async () => {
    const { io, optionsAt, sent, markers, windows } = setup();
    const run = await sendCheckInReminders(io, optionsAt(opens));
    expect(run).toMatchObject({ due: 2, reminded: 3, failed: 0 });
    // The owner by email and browser, the partner on their phone, the friend
    // by email; the stranger never signed in, so nobody to tell.
    expect(sent.map(({ channel, to }) => `${channel} ${to}`).sort()).toEqual([
      "fcm fcm-1",
      "mail friend@example.com",
      "mail owner@example.com",
      "push https://push.example/1",
    ]);
    expect(new Set(sent.map((s) => s.title))).toEqual(new Set(["Check in for EK 18 to Dubai"]));
    // A tap opens the airline's site, held until an hour before departure.
    expect(sent.find((s) => s.channel === "push")).toMatchObject({ url: "https://www.emirates.com/", ttl: 86400 });
    expect(markers.get(checkInMarkerId("owner", booking("t1").id))).toMatchObject({ sent: ["owner", "partner"], done: true });
    expect(markers.get(checkInMarkerId("friend", booking("t2").id))).toMatchObject({ sent: ["friend"], done: true });
    // The bookings read leave from an hour to two days ahead, in any offset.
    expect(windows).toEqual([["2026-12-10T22:00", "2026-12-13T23:00"]]);

    // Every later run reads the markers and sends nothing more.
    sent.length = 0;
    expect(await sendCheckInReminders(io, optionsAt("2026-12-11T09:01:00Z"))).toMatchObject({ due: 0, reminded: 0 });
    expect(await sendCheckInReminders(io, optionsAt("2026-12-12T20:00:00Z"))).toMatchObject({ due: 0, reminded: 0 });
    expect(sent).toEqual([]);
  });

  it("skips whoever marked the flight checked in, and only them", async () => {
    // The partner checked in, by the owner's booking shared with them.
    const { io, optionsAt, sent, logs, markers } = setup({ checkedIn: { partner: { t1: ["t1-f"] } } });
    const run = await sendCheckInReminders(io, optionsAt(opens));
    expect(run).toMatchObject({ due: 2, reminded: 2, failed: 0 });
    expect(sent.map(({ channel, to }) => `${channel} ${to}`).sort()).toEqual(["mail friend@example.com", "mail owner@example.com", "push https://push.example/1"]);
    expect(logs).toContain("check_in_skipped_checked_in");
    // Done for the booking: a later run tells nobody, the partner included.
    expect(markers.get(checkInMarkerId("owner", booking("t1").id))).toMatchObject({ sent: ["owner"], done: true });
  });

  it("skips someone only watching the trip the flight is on, and only them", async () => {
    // The friend's trip is their mum's: none of its travelers is the friend.
    const person = (id: string, name: string, direct: number): PersonDoc => ({ id, name, aliases: [], bookings: 1, direct, createdAt: at, updatedAt: at });
    const { io, optionsAt, sent, logs } = setup({
      trips: [trip("t1", "owner", ["partner@example.com"]), { ...trip("t2", "friend"), travelers: ["Pat Example"] }],
      people: { friend: [person("me", "Sam Example", 3), person("mum", "Pat Example", 0)] },
    });
    const run = await sendCheckInReminders(io, optionsAt(opens));
    expect(run).toMatchObject({ due: 2, failed: 0 });
    expect(sent.map(({ to }) => to)).not.toContain("friend@example.com");
    expect(sent.map(({ to }) => to)).toContain("owner@example.com");
    expect(logs).toContain("check_in_skipped_watching");
  });

  it("still skips them when another booking of the flight arrives later", async () => {
    // The partner checked in on the owner's booking, whose reminder went;
    // then a friend shares their own booking of the flight with them.
    const segments = [booking("t1")];
    const { io, optionsAt, sent } = setup({
      segments,
      trips: [trip("t1", "owner", ["partner@example.com"]), trip("t2", "friend", ["partner@example.com"])],
      checkedIn: { partner: { t1: ["t1-f"] } },
    });
    await sendCheckInReminders(io, optionsAt(opens));
    segments.push(booking("t2", { confirmation: "EK5678" }));
    sent.length = 0;
    expect(await sendCheckInReminders(io, optionsAt("2026-12-11T10:00:00Z"))).toMatchObject({ reminded: 1 });
    expect(sent.map(({ channel, to }) => `${channel} ${to}`)).toEqual(["mail friend@example.com"]);
  });

  it("reminds anyway when the mark can't be read", async () => {
    const { io, optionsAt, sent, logs } = setup();
    const unreadable: CheckInIo = { ...io, checkedIn: async () => Promise.reject(new Error("unavailable")) };
    expect(await sendCheckInReminders(unreadable, optionsAt(opens))).toMatchObject({ reminded: 3 });
    expect(sent).toHaveLength(4);
    expect(logs).toContain("check_in_mark_unreadable");
  });

  it("reminds someone on two bookings of the same flight once, of their own", async () => {
    // A couple's bookings of the same flight, each shared with the other.
    const { io, optionsAt, sent, markers } = setup({
      trips: [trip("t1", "owner", ["partner@example.com"]), trip("t2", "partner", ["owner@example.com"])],
      settings: { owner: { email: true }, partner: { email: true } },
    });
    const ioBoth: CheckInIo = { ...io, uidForEmail: async (email) => email.split("@")[0] };
    await sendCheckInReminders(ioBoth, optionsAt(opens));
    expect(sent.map((s) => s.to).sort()).toEqual(["owner@example.com", "partner@example.com"]);
    expect(markers.get(checkInMarkerId("owner", booking("t1").id))?.sent.sort()).toEqual(["owner", "partner"]);
    expect(markers.get(checkInMarkerId("partner", booking("t2").id))?.sent.sort()).toEqual(["owner", "partner"]);
  });

  it("reminds a flight booked after its check-in opened at once, but not within the hour before departure", async () => {
    const late = setup();
    expect(await sendCheckInReminders(late.io, late.optionsAt("2026-12-13T07:59:00Z"))).toMatchObject({ reminded: 3 });
    const tooLate = setup();
    expect(await sendCheckInReminders(tooLate.io, tooLate.optionsAt("2026-12-13T08:00:00Z"))).toMatchObject({ due: 0, reminded: 0 });
    const departed = setup();
    expect(await sendCheckInReminders(departed.io, departed.optionsAt("2026-12-13T10:00:00Z"))).toMatchObject({ due: 0 });
    expect([...tooLate.sent, ...departed.sent]).toEqual([]);
  });

  it("reads the departure in its own offset", async () => {
    // 09:00 in New York (-05:00) is 14:00Z, so check-in opens at 14:00Z on the 11th.
    const { io, optionsAt } = setup({ segments: [booking("t1", { start: "2026-12-13T09:00:00-05:00" })] });
    expect(await sendCheckInReminders(io, optionsAt("2026-12-11T13:59:00Z"))).toMatchObject({ due: 0 });
    expect(await sendCheckInReminders(io, optionsAt("2026-12-11T14:00:00Z"))).toMatchObject({ due: 1, reminded: 2 });
  });

  it("leaves out people not approved, and those whose approval cannot be told", async () => {
    const { io, optionsAt, sent, logs, markers } = setup({
      approved: async (uid) => {
        if (uid === "friend") throw new Error("Auth unreachable");
        return uid === "owner";
      },
    });
    await sendCheckInReminders(io, optionsAt(opens));
    expect(new Set(sent.map((s) => s.to))).toEqual(new Set(["owner@example.com", "https://push.example/1"]));
    expect(logs).toContain("check_in_skipped_unapproved");
    expect(logs).toContain("approval_check_failed");
    expect(markers.get(checkInMarkerId("owner", booking("t1").id))).toMatchObject({ sent: ["owner"], done: true });
  });

  it("sends nothing to someone with reminders off", async () => {
    const { io, optionsAt, sent, markers } = setup({ settings: { owner: { email: false, push: false } } });
    await sendCheckInReminders(io, optionsAt(opens));
    expect(sent).toEqual([]);
    expect(markers.get(checkInMarkerId("owner", booking("t1").id))).toMatchObject({ sent: [], done: true });
  });

  it("tries a failed delivery again on later runs, a few times", async () => {
    const { io, optionsAt, sent, markers, logs } = setup({
      segments: [booking("t2")],
      settings: { friend: { email: true } },
      mailFails: true,
    });
    for (let i = 0; i < checkInMaxAttempts; i++) {
      const run = await sendCheckInReminders(io, optionsAt(new Date(Date.parse(opens) + i * 180_000).toISOString()));
      expect(run).toMatchObject({ due: 1, failed: 1 });
    }
    expect(markers.get(checkInMarkerId("friend", booking("t2").id))).toMatchObject({ attempts: checkInMaxAttempts, done: true, sent: [] });
    expect(logs).toContain("check_in_mail_failed");
    expect(logs).toContain("check_in_reminder_dropped");
    expect(await sendCheckInReminders(io, optionsAt("2026-12-11T12:00:00Z"))).toMatchObject({ due: 0 });
    expect(sent).toEqual([]);
  });

  it("still tells the others when one person's settings cannot be read, and tries that person again", async () => {
    const { io, optionsAt, sent, markers, logs } = setup({ segments: [booking("t1")] });
    let broken = true;
    const flaky: CheckInIo = {
      ...io,
      settings: async (uid) => {
        if (uid === "owner" && broken) throw new Error("Firestore unavailable");
        return io.settings(uid);
      },
    };
    expect(await sendCheckInReminders(flaky, optionsAt(opens))).toMatchObject({ reminded: 1, failed: 1 });
    expect(sent.map((s) => s.to)).toEqual(["fcm-1"]);
    expect(logs).toContain("check_in_reminder_person_failed");
    expect(markers.get(checkInMarkerId("owner", booking("t1").id))).toMatchObject({ sent: ["partner"], attempts: 1, done: false });
    broken = false;
    sent.length = 0;
    expect(await sendCheckInReminders(flaky, optionsAt("2026-12-11T09:03:00Z"))).toMatchObject({ reminded: 1, failed: 0 });
    expect(sent.map((s) => s.to).sort()).toEqual(["https://push.example/1", "owner@example.com"]);
    expect(markers.get(checkInMarkerId("owner", booking("t1").id))).toMatchObject({ sent: ["partner", "owner"], done: true });
  });

  it("leaves out a cancelled booking", async () => {
    const { io, optionsAt, sent } = setup({ segments: [booking("t2", { cancelledAt: "2026-12-01T00:00:00Z" })] });
    expect(await sendCheckInReminders(io, optionsAt(opens))).toMatchObject({ due: 0, reminded: 0 });
    expect(sent).toEqual([]);
  });

  it("takes each booking's claim at the time it is taken, not when the run began", async () => {
    // A run slowed by its earlier flights: the claim on a later one must
    // still stand for its whole lease, so an overlapping run can't take it.
    const { io, optionsAt } = setup({ segments: [booking("t1"), booking("t2", { title: "EK 20 MAN to DXB" })] });
    const claims: string[] = [];
    const times = ["2026-12-11T09:00:00.000Z", "2026-12-11T09:05:00.000Z"];
    const timed: CheckInIo = { ...io, claim: async (bases, now) => (claims.push(now), io.claim(bases, now)) };
    await sendCheckInReminders(timed, optionsAt(opens, { clock: () => times[claims.length] ?? times[1]! }));
    expect(claims).toEqual(times);
  });

  it("tells someone on two bookings of a flight once, though two runs race for it", async () => {
    // Each run could take one booking if they were claimed one at a time,
    // and each would then tell the owner of theirs.
    const { io, optionsAt, sent } = setup({
      trips: [trip("t1", "owner"), trip("t2", "friend", ["owner@example.com"])],
      settings: { owner: { email: true }, friend: { email: true } },
    });
    const shared: CheckInIo = { ...io, uidForEmail: async (email) => (email === "owner@example.com" ? "owner" : undefined) };
    await Promise.all([sendCheckInReminders(shared, optionsAt(opens)), sendCheckInReminders(shared, optionsAt(opens))]);
    expect(sent.map((s) => s.to).sort()).toEqual(["friend@example.com", "owner@example.com"]);
  });

  it("doesn't tell someone again of a flight when a second booking of it arrives later", async () => {
    const segments = [booking("t1")];
    const { io, optionsAt, sent } = setup({
      segments,
      trips: [trip("t1", "owner"), trip("t2", "friend", ["owner@example.com"])],
      settings: { owner: { email: true }, friend: { email: true } },
    });
    const shared: CheckInIo = { ...io, uidForEmail: async (email) => (email === "owner@example.com" ? "owner" : undefined) };
    await sendCheckInReminders(shared, optionsAt(opens));
    segments.push(booking("t2", { confirmation: "EK5678" }));
    await sendCheckInReminders(shared, optionsAt("2026-12-11T10:00:00Z"));
    expect(sent.map((s) => s.to)).toEqual(["owner@example.com", "friend@example.com"]);
  });

  it("doesn't tell anyone again when a booking moves to another of its owner's trips", async () => {
    // Trips are merged, split and regrouped by hand and on import; the
    // booking keeps its id and its owner.
    const segments = [booking("t1")];
    const { io, optionsAt, sent } = setup({ segments, trips: [trip("t1", "owner"), trip("t3", "owner")], settings: { owner: { email: true } } });
    await sendCheckInReminders(io, optionsAt(opens));
    segments[0] = booking("t3", { id: booking("t1").id });
    await sendCheckInReminders(io, optionsAt("2026-12-11T10:00:00Z"));
    expect(sent.map((s) => s.to)).toEqual(["owner@example.com"]);
  });

  it("keeps a reminded booking's marker where the booking is and when it leaves, for the sweep", async () => {
    // Moved to another trip and put back a day: the sweep must find it at
    // its new place, not delete its history at the old departure.
    const segments = [booking("t1")];
    const { io, optionsAt, sent, markers } = setup({ segments, trips: [trip("t1", "owner"), trip("t3", "owner")], settings: { owner: { email: true } } });
    await sendCheckInReminders(io, optionsAt(opens));
    segments[0] = booking("t3", { id: booking("t1").id, start: "2026-12-14T09:00:00+00:00" });
    await sendCheckInReminders(io, optionsAt("2026-12-12T10:00:00Z"));
    expect(sent).toHaveLength(1);
    expect(markers.get(checkInMarkerId("owner", booking("t1").id))).toMatchObject({ tripId: "t3", departs: "2026-12-14T09:00:00.000Z", done: true });
  });

  it("keeps an email that went when the person's phones cannot be read, and does not send it again", async () => {
    const { io, optionsAt, sent, markers } = setup({ segments: [booking("t2")], settings: { friend: { email: true, push: true } } });
    const flaky: CheckInIo = {
      ...io,
      devices: async () => {
        throw new Error("Firestore unavailable");
      },
    };
    await sendCheckInReminders(flaky, optionsAt(opens));
    await sendCheckInReminders(flaky, optionsAt("2026-12-11T09:15:00Z"));
    expect(sent.map((s) => s.to)).toEqual(["friend@example.com"]);
    expect(markers.get(checkInMarkerId("friend", booking("t2").id))).toMatchObject({ sent: ["friend"] });
  });

  it("lets one run at a time take a booking", async () => {
    const { io, optionsAt, sent } = setup({ segments: [booking("t2")], settings: { friend: { email: true } } });
    const held: CheckInIo = { ...io, claim: async () => undefined };
    expect(await sendCheckInReminders(held, optionsAt(opens))).toMatchObject({ due: 1, reminded: 0 });
    expect(sent).toEqual([]);
  });

  it("skips a trip being deleted, and carries on past a booking that fails", async () => {
    const { io, optionsAt, sent, logs } = setup({ trips: [{ ...trip("t1", "owner"), deleting: true }, trip("t2", "friend")] });
    const broken: CheckInIo = {
      ...io,
      flightSegments: async () => [booking("t1"), booking("t2", { title: "QF 1 MAN to SYD" }), booking("t3", { title: "BA 1 MAN to LHR" })],
      trip: async (id) => {
        if (id === "t3") throw new Error("Firestore unavailable");
        return io.trip(id);
      },
    };
    const run = await sendCheckInReminders(broken, optionsAt("2026-12-12T12:00:00Z"));
    expect(sent.map((s) => s.to)).toEqual(["friend@example.com"]);
    expect(run.failed).toBe(1);
    expect(logs).toContain("check_in_trip_unreadable");
  });
});
