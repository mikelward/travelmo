import type { OneOffReminder, ReminderNotification, Segment, StandingReminder, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { checklistMaxAttempts, checklistMarkerId, sendChecklistReminders, type ChecklistIo, type ChecklistMarker, type ChecklistUser } from "./checklist";
import type { ReminderChannels, StoredDevice, StoredSubscription } from "./reminders";

// An invented week in Lisbon from London, 12 to 19 December, for "owner",
// with a standing reminder to apply for a visa 30 days before (due 12
// November) and one to pack the adapter a day before (11 December).
const at = "2026-11-01T00:00:00Z";
const lhr = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
const lis = { name: "Lisbon", code: "LIS", city: "Lisbon", country: "PT" };
const man = { name: "Manchester", code: "MAN", city: "Manchester", country: "GB" };
const trip = (id: string, over: Partial<Trip> = {}): Trip => ({ id, title: "Lisbon", start: "2026-12-12", end: "2026-12-19", ownerUid: "owner", sharedWith: [], createdAt: at, updatedAt: at, ...over });
const flight = (tripId: string, id: string, start: string, origin: typeof lhr, destination: typeof lhr, over: Partial<Segment> = {}): Segment => ({
  id,
  tripId,
  type: "flight",
  title: id,
  start,
  origin,
  destination,
  source: "manual",
  gmailMessageIds: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});
const abroad = (tripId: string, over: Partial<Segment> = {}) => [
  flight(tripId, "out", "2026-12-12T08:00:00+00:00", lhr, lis, over),
  flight(tripId, "back", "2026-12-19T12:30:00+00:00", lis, lhr, over),
];
const visa: StandingReminder = { id: "visa", text: "Apply for a visa", amount: 30, unit: "days" };
const adapter: StandingReminder = { id: "adapter", text: "Pack the adapter", amount: 1, unit: "days" };

type Sent = { channel: "mail" | "push" | "fcm"; to: string; title: string; url?: string };

function setup(
  options: {
    users?: ChecklistUser[];
    trips?: Trip[];
    segments?: Record<string, Segment[]>;
    standing?: StandingReminder[];
    mine?: Record<string, { done: string[]; added: OneOffReminder[] }>;
    mailFails?: boolean;
    verified?: boolean;
  } = {},
) {
  const users = options.users ?? [{ uid: "owner", settings: { email: true, push: true }, homes: [] }];
  const trips = options.trips ?? [trip("t1")];
  const segments = options.segments ?? { t1: abroad("t1") };
  const markers = new Map<string, ChecklistMarker & { claimUntil?: string }>();
  const subscriptions = new Map<string, StoredSubscription[]>([["owner", [{ id: "s1", subscription: { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" }, createdAt: at } }]]]);
  const devices = new Map<string, StoredDevice[]>([["owner", [{ id: "d1", device: { token: "fcm-1", platform: "android", createdAt: at } }]]]);
  const sent: Sent[] = [];
  const logs: string[] = [];
  const reads: string[] = [];
  const io: ChecklistIo = {
    users: async () => users,
    verifiedEmail: async (uid) => (options.verified === false ? undefined : `${uid}@example.com`),
    addresses: async (uid) => [`${uid}@example.com`],
    pushSubscriptions: async (uid) => subscriptions.get(uid) ?? [],
    removePushSubscription: async () => {},
    devices: async (uid) => devices.get(uid) ?? [],
    removeDevice: async () => {},
    trips: async (_uid, _addresses, endsOnOrAfter) => trips.filter((t) => t.end >= endsOnOrAfter),
    segments: async (tripId) => {
      reads.push(tripId);
      return segments[tripId] ?? [];
    },
    standing: async () => options.standing ?? [visa, adapter],
    mine: async (_uid, tripId) => options.mine?.[tripId] ?? { done: [], added: [] },
    markers: async (ids) => new Map(ids.flatMap((id) => (markers.has(id) ? [[id, markers.get(id)!] as const] : []))),
    claim: async (base, now) => {
      const found = markers.get(base.id);
      if (found?.done || (found?.claimUntil ?? "") > now) return undefined;
      const marker = found ?? { ...base, attempts: 0, done: false, at: now };
      markers.set(base.id, { ...marker, claimUntil: new Date(Date.parse(now) + 600_000).toISOString() });
      const { claimUntil: _held, ...rest } = marker as ChecklistMarker & { claimUntil?: string };
      return rest;
    },
    save: async (marker) => void markers.set(marker.id, marker),
    sweep: async () => 0,
  };
  const channels: ReminderChannels = {
    mail: async ({ to, subject }) => {
      if (options.mailFails) throw new Error("SMTP down");
      sent.push({ channel: "mail", to, title: subject });
    },
    push: async (subscription, n: ReminderNotification) => {
      sent.push({ channel: "push", to: subscription.endpoint, title: n.title, url: n.url });
      return "sent";
    },
    fcm: async (device, n: ReminderNotification) => {
      sent.push({ channel: "fcm", to: device.token, title: n.title, url: n.url });
      return "sent";
    },
  };
  const run = (now: string, over: Partial<ReminderChannels> | undefined = undefined, clock?: () => string) =>
    sendChecklistReminders(io, over ?? channels, { now, ...(clock ? { clock } : {}), origin: "https://travelmo.example", log: (_level, event) => logs.push(event) });
  return { io, run, sent, logs, markers, reads, subscriptions, devices };
}

describe("sendChecklistReminders", () => {
  it("sends nothing before a reminder is due, and reads no bookings for it", async () => {
    const { run, sent, reads } = setup();
    expect(await run("2026-11-11T06:07:00Z")).toMatchObject({ due: 0, sent: 0 });
    expect(sent).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("sends a due reminder once, by every channel the person turned on, opening the trip", async () => {
    const { run, sent, markers } = setup();
    expect(await run("2026-11-12T06:07:00Z")).toMatchObject({ users: 1, due: 1, sent: 1, failed: 0 });
    expect(sent).toEqual([
      { channel: "mail", to: "owner@example.com", title: "Apply for a visa — Lisbon trip in 30 days" },
      { channel: "push", to: "https://push.example/1", title: "Apply for a visa", url: "https://travelmo.example/trips/t1" },
      { channel: "fcm", to: "fcm-1", title: "Apply for a visa", url: "https://travelmo.example/trips/t1" },
    ]);
    expect(markers.get(checklistMarkerId("owner", "t1", "visa"))).toMatchObject({ uid: "owner", tripId: "t1", reminderId: "visa", ends: "2026-12-19", done: true, attempts: 0 });
    // The next day's run sends it no more.
    sent.length = 0;
    expect(await run("2026-11-13T06:07:00Z")).toMatchObject({ due: 0, sent: 0 });
    expect(sent).toEqual([]);
  });

  it("sends only by the channels turned on", async () => {
    const { run, sent } = setup({ users: [{ uid: "owner", settings: { push: true }, homes: [] }] });
    await run("2026-11-12T06:07:00Z");
    expect(sent.map((s) => s.channel)).toEqual(["push", "fcm"]);
  });

  it("sends at once what a trip booked late is already due, and nothing once it started", async () => {
    const { run, sent } = setup();
    expect(await run("2026-12-11T06:07:00Z")).toMatchObject({ due: 2, sent: 2 });
    expect(sent.filter((s) => s.channel === "mail").map((s) => s.title)).toEqual([
      "Apply for a visa — Lisbon trip tomorrow",
      "Pack the adapter — Lisbon trip tomorrow",
    ]);
    const later = setup();
    expect(await later.run("2026-12-13T06:07:00Z")).toMatchObject({ due: 0, sent: 0 });
  });

  it("skips what was ticked off, and a trip at home, but sends a one-off whatever the trip", async () => {
    const home = [flight("t2", "north", "2026-12-12T08:00:00+00:00", lhr, man), flight("t2", "south", "2026-12-19T08:00:00+00:00", man, lhr)];
    const { run, sent } = setup({
      trips: [trip("t1"), trip("t2", { title: "Manchester" })],
      segments: { t1: abroad("t1"), t2: home },
      mine: { t1: { done: ["visa"], added: [] }, t2: { done: [], added: [{ id: "x1", text: "Book a table", date: "2026-11-12" }] } },
    });
    expect(await run("2026-11-12T06:07:00Z")).toMatchObject({ due: 1, sent: 1 });
    expect(sent.filter((s) => s.channel === "mail").map((s) => s.title)).toEqual(["Book a table — Manchester trip in 30 days"]);
  });

  it("counts a trip abroad from where Profile says home is, and not one whose bookings were all cancelled", async () => {
    // A one-way flight says nothing of home; a correction does.
    const oneWay = { t1: [flight("t1", "out", "2026-12-12T08:00:00+00:00", lhr, lis)] };
    const unknown = setup({ segments: oneWay });
    expect(await unknown.run("2026-11-12T06:07:00Z")).toMatchObject({ due: 0 });
    const corrected = setup({ segments: oneWay, users: [{ uid: "owner", settings: { email: true }, homes: [{ city: "London", country: "GB", from: "2020-01-01" }] }] });
    expect(await corrected.run("2026-11-12T06:07:00Z")).toMatchObject({ due: 1, sent: 1 });
    const cancelled = setup({ segments: { t1: abroad("t1", { cancelledAt: at }) } });
    expect(await cancelled.run("2026-11-12T06:07:00Z")).toMatchObject({ due: 0 });
  });

  it("skips someone with nowhere to send before reading their trips", async () => {
    const { run, sent, reads, logs } = setup({ users: [{ uid: "owner", settings: { email: true }, homes: [] }], verified: false });
    expect(await run("2026-11-12T06:07:00Z")).toMatchObject({ skipped: 1, due: 0 });
    expect(sent).toEqual([]);
    expect(reads).toEqual([]);
    expect(logs).toContain("reminder_no_verified_email");
  });

  it("tries a failed delivery again on the next runs, five in all, then gives up", async () => {
    const { run, markers, logs } = setup({ users: [{ uid: "owner", settings: { email: true }, homes: [] }], mailFails: true });
    const id = checklistMarkerId("owner", "t1", "visa");
    for (let day = 12; day < 12 + checklistMaxAttempts; day++) {
      expect(await run(`2026-11-${day}T06:07:00Z`)).toMatchObject({ due: 1, failed: 1 });
    }
    expect(markers.get(id)).toMatchObject({ attempts: checklistMaxAttempts, done: true });
    expect(logs).toContain("checklist_mail_failed");
    expect(logs).toContain("checklist_reminder_dropped");
    expect(await run("2026-11-20T06:07:00Z")).toMatchObject({ due: 0 });
  });

  it("leaves a reminder another run holds to that run", async () => {
    const { run, io, sent } = setup();
    await io.claim({ id: checklistMarkerId("owner", "t1", "visa"), uid: "owner", tripId: "t1", reminderId: "visa", ends: "2026-12-19" }, "2026-11-12T06:06:00Z");
    expect(await run("2026-11-12T06:07:00Z")).toMatchObject({ due: 1, sent: 0 });
    expect(sent).toEqual([]);
  });

  it("takes each claim at the time it's taken, not when the run started", async () => {
    const { run, io, sent, markers } = setup({ users: [{ uid: "owner", settings: { email: true }, homes: [] }] });
    const id = checklistMarkerId("owner", "t1", "visa");
    await io.claim({ id, uid: "owner", tripId: "t1", reminderId: "visa", ends: "2026-12-19" }, "2026-11-12T06:06:00Z");
    // The other run's lease ran out at 06:16; this run reaches the reminder at 06:20.
    expect(await run("2026-11-12T06:07:00Z", undefined, () => "2026-11-12T06:20:00.000Z")).toMatchObject({ due: 1, sent: 1 });
    expect(sent.map((s) => s.channel)).toEqual(["mail"]);
    expect(markers.get(id)).toMatchObject({ done: true });
  });

  it("goes on to the next person when one fails, logging by uid alone", async () => {
    const users = [
      { uid: "broken", settings: { email: true }, homes: [] },
      { uid: "owner", settings: { email: true }, homes: [] },
    ];
    const { io, run, sent, logs } = setup({ users });
    const standing = io.standing;
    io.standing = async (uid) => {
      if (uid === "broken") throw new Error("unavailable");
      return standing(uid);
    };
    expect(await run("2026-11-12T06:07:00Z")).toMatchObject({ users: 2, failed: 1, sent: 1 });
    expect(sent.map((s) => s.to)).toEqual(["owner@example.com"]);
    expect(logs).toContain("checklist_reminder_failed");
  });
});
