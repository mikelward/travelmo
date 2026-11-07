import type { Segment, TravelProfile, Trip } from "@travelmo/core";
import { visaTable } from "@travelmo/core/visaRules";
import { airportPlace } from "@travelmo/core/airportPlaces";
import { describe, expect, it } from "vitest";
import type { Mail } from "./mail";
import type { PushSender } from "./push";
import { sendReminders, type ReminderIo, type ReminderUser, type StoredSubscription } from "./reminders";

// Invented people, trips and documents. Today is 1 Nov 2026.
const now = "2026-11-01T06:07:00Z";
const at = "2026-10-01T00:00:00Z";
const trip = (id: string, ownerUid: string, start: string, end: string, over: Partial<Trip> = {}): Trip => ({
  id,
  title: id,
  start,
  end,
  ownerUid,
  sharedWith: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});
const flight = (tripId: string, to: string, toCountry: string): Segment => ({
  id: `${tripId}-f`,
  tripId,
  type: "flight",
  title: `XX 1 MAN to ${to}`,
  start: "2026-11-20T09:00:00+00:00",
  end: "2026-11-20T19:00:00+04:00",
  origin: { name: "Manchester", code: "MAN", country: "GB" },
  destination: { name: to, code: to, country: toCountry },
  source: "manual",
  gmailMessageIds: [],
  createdAt: at,
  updatedAt: at,
});
const profile = (uid: string, expires: string): TravelProfile => ({
  ownerUid: uid,
  trustedEmails: [],
  travelers: [],
  loyalty: [],
  documents: [{ title: "Passport", fields: [{ label: "Nationality", value: "GB" }, { label: "Expiration date", value: expires }] }],
});

const subscription = (n: number) => ({ id: `s${n}`, subscription: { endpoint: `https://push.example/${n}`, keys: { p256dh: "p", auth: "a" }, createdAt: at } });

function setup(
  options: {
    trips?: Trip[];
    segments?: Segment[];
    profiles?: Record<string, TravelProfile>;
    emails?: Record<string, string>;
    users?: (string | ReminderUser)[];
    subscriptions?: Record<string, StoredSubscription[]>;
    push?: PushSender;
  } = {},
) {
  const users = (options.users ?? ["u1"]).map((u) => (typeof u === "string" ? { uid: u, settings: { email: true } } : u));
  const emails = options.emails ?? { u1: "traveler@example" };
  const subscriptions = new Map(Object.entries(options.subscriptions ?? {}));
  const sent = new Map<string, string[]>();
  const mails: Mail[] = [];
  const pushes: [string, string][] = [];
  const logs: [string, Record<string, unknown>][] = [];
  const io: ReminderIo = {
    users: async () => users,
    verifiedEmail: async (uid) => emails[uid],
    pushSubscriptions: async (uid) => subscriptions.get(uid) ?? [],
    removePushSubscription: async (uid, id) => {
      subscriptions.set(uid, (subscriptions.get(uid) ?? []).filter((s) => s.id !== id));
    },
    trips: async (uid, email, endsOnOrAfter) =>
      (options.trips ?? []).filter((t) => (t.ownerUid === uid || (email && t.sharedWith.includes(email))) && t.end >= endsOnOrAfter),
    segments: async (tripId) => (options.segments ?? []).filter((s) => s.tripId === tripId),
    ownProfile: async (uid) => options.profiles?.[uid],
    sharedProfiles: async (email) => Object.values(options.profiles ?? {}).filter((p) => email && p.trustedEmails.includes(email)),
    sentLines: async (uid, tripId) => sent.get(`${uid}/${tripId}`) ?? [],
    markSent: async (uid, tripId, lines) => {
      sent.set(`${uid}/${tripId}`, [...(sent.get(`${uid}/${tripId}`) ?? []), ...lines]);
    },
  };
  const mail = async (m: Mail) => void mails.push(m);
  const push: PushSender =
    options.push ??
    (async (s, n) => {
      pushes.push([s.endpoint, n.title]);
      return "sent";
    });
  const run = () => sendReminders(io, { mail, push }, { now, origin: "https://travelmo.example", lookups: { airportPlace, visaTable }, log: (e, f) => logs.push([e, f]) });
  return { io, mails, pushes, logs, sent, subscriptions, run };
}

describe("sendReminders", () => {
  it("mails the warnings and entry needs of a trip within a month, once", async () => {
    // Dubai on a British passport asks something of the traveler, whichever the
    // table says, unless it is visa-free there: the test reads the table.
    const { mails, run, logs } = setup({
      trips: [trip("Dubai", "u1", "2026-11-20", "2026-11-25"), trip("Far", "u1", "2027-03-01", "2027-03-05")],
      segments: [flight("Dubai", "DXB", "AE")],
      // Expires a month after the trip: within the six-month margin.
      profiles: { u1: profile("u1", "2026-12-30") },
    });
    expect(await run()).toEqual({ users: 1, mailed: 1, pushed: 0, lines: expect.any(Number), skipped: 0, failed: 0 });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("traveler@example");
    expect(mails[0]!.subject).toBe("Before your trip to Dubai");
    expect(mails[0]!.text).toContain("Dubai (20–25 Nov 2026), starts in 19 days:");
    expect(mails[0]!.text).toContain("  - Your passport expires on 30 Dec 2026, 1 month after this trip ends; many countries require six months’ validity.");
    expect(mails[0]!.text).toContain("https://travelmo.example/trips/Dubai");
    expect(mails[0]!.text).toContain("https://travelmo.example/settings");
    expect(mails[0]!.text).not.toContain("Far");
    expect(logs.map(([e]) => e)).toEqual(["reminder_mailed"]);
    // Nothing new the next day.
    expect(await run()).toEqual({ users: 1, mailed: 0, pushed: 0, lines: 0, skipped: 0, failed: 0 });
    expect(mails).toHaveLength(1);
  });

  it("notifies every subscribed browser once per trip, drops a subscription the push service lost, and needs no email for it", async () => {
    const { run, mails, pushes, subscriptions, logs } = setup({
      users: [{ uid: "u1", settings: { push: true } }],
      emails: {},
      trips: [trip("Dubai", "u1", "2026-11-20", "2026-11-25"), trip("Paris", "u1", "2026-11-05", "2026-11-07")],
      segments: [flight("Dubai", "DXB", "AE"), flight("Paris", "CDG", "FR")],
      profiles: { u1: profile("u1", "2026-11-26") },
      subscriptions: { u1: [subscription(1), subscription(2)] },
    });
    expect(await run()).toEqual({ users: 1, mailed: 0, pushed: 1, lines: expect.any(Number), skipped: 0, failed: 0 });
    expect(mails).toEqual([]);
    expect(pushes).toEqual([
      ["https://push.example/1", "Before your trip to Paris"],
      ["https://push.example/1", "Before your trip to Dubai"],
      ["https://push.example/2", "Before your trip to Paris"],
      ["https://push.example/2", "Before your trip to Dubai"],
    ]);
    expect(logs.map(([e]) => e)).toEqual(["reminder_pushed"]);
    expect(await run()).toMatchObject({ pushed: 0, lines: 0 });

    const gone = setup({
      users: [{ uid: "u1", settings: { email: true, push: true } }],
      trips: [trip("Dubai", "u1", "2026-11-20", "2026-11-25")],
      segments: [flight("Dubai", "DXB", "AE")],
      profiles: { u1: profile("u1", "2026-11-26") },
      subscriptions: { u1: [subscription(1), subscription(2)] },
      push: async (s) => (s.endpoint.endsWith("/1") ? "gone" : "sent"),
    });
    expect(await gone.run()).toMatchObject({ mailed: 1, pushed: 1, failed: 0 });
    expect(gone.subscriptions.get("u1")).toEqual([subscription(2)]);
    expect(gone.logs.map(([e]) => e)).toEqual(["reminder_mailed", "push_subscription_gone", "reminder_pushed"]);
    expect(subscriptions.get("u1")).toHaveLength(2);
  });

  it("marks nothing sent when every browser is gone, so a new browser gets the news", async () => {
    const { run, sent, subscriptions, logs } = setup({
      users: [{ uid: "u1", settings: { push: true } }],
      emails: {},
      trips: [trip("Dubai", "u1", "2026-11-20", "2026-11-25")],
      segments: [flight("Dubai", "DXB", "AE")],
      profiles: { u1: profile("u1", "2026-11-26") },
      subscriptions: { u1: [subscription(1)] },
      push: async () => "gone",
    });
    expect(await run()).toEqual({ users: 1, mailed: 0, pushed: 0, lines: 0, skipped: 1, failed: 0 });
    expect(subscriptions.get("u1")).toEqual([]);
    expect(sent.size).toBe(0);
    expect(logs.map(([e]) => e)).toEqual(["push_subscription_gone", "reminder_undelivered"]);
  });

  it("holds the day's news for tomorrow when a push fails, even after the email went", async () => {
    const { run, mails, sent, logs } = setup({
      users: [{ uid: "u1", settings: { email: true, push: true } }],
      trips: [trip("Dubai", "u1", "2026-11-20", "2026-11-25")],
      segments: [flight("Dubai", "DXB", "AE")],
      profiles: { u1: profile("u1", "2026-11-26") },
      subscriptions: { u1: [subscription(1)] },
      push: async () => {
        throw new Error("push service 500");
      },
    });
    expect(await run()).toMatchObject({ mailed: 1, pushed: 0, failed: 1 });
    expect(mails).toHaveLength(1);
    expect(sent.size).toBe(0);
    expect(logs.at(-1)).toEqual(["reminder_failed", { uid: "u1", reason: "push service 500" }]);
  });

  it("mails what is new since, across trips, in one email", async () => {
    const { mails, run, sent } = setup({
      trips: [trip("Dubai", "u1", "2026-11-20", "2026-11-25"), trip("Paris", "u1", "2026-11-05", "2026-11-07")],
      segments: [flight("Dubai", "DXB", "AE"), flight("Paris", "CDG", "FR")],
      profiles: { u1: profile("u1", "2026-11-26") },
    });
    sent.set("u1/Paris", ["Your passport expires on 26 Nov 2026, 19 days after this trip ends; many countries require six months’ validity."]);
    await run();
    expect(mails).toHaveLength(1);
    // Paris's only line was already sent; Dubai's are new.
    expect(mails[0]!.subject).toBe("Before your trip to Dubai");
    expect(mails[0]!.text).not.toContain("Paris");
  });

  it("skips a user without a verified email, keeps going past one whose mail fails, and sends nothing to someone with no documents", async () => {
    const { run, logs, mails } = setup({
      users: ["u0", "u1", "u2"],
      emails: { u1: "traveler@example", u2: "other@example" },
      trips: [trip("Dubai", "u1", "2026-11-20", "2026-11-25"), trip("Rome", "u2", "2026-11-10", "2026-11-12")],
      segments: [flight("Dubai", "DXB", "AE"), flight("Rome", "FCO", "IT")],
      profiles: { u1: profile("u1", "2026-11-26") },
    });
    expect(await run()).toEqual({ users: 3, mailed: 1, pushed: 0, lines: expect.any(Number), skipped: 1, failed: 0 });
    expect(mails.map((m) => m.to)).toEqual(["traveler@example"]);
    expect(logs.map(([e]) => e)).toEqual(["reminder_no_verified_email", "reminder_mailed"]);

    const failing = setup({ trips: [trip("Dubai", "u1", "2026-11-20", "2026-11-25")], segments: [flight("Dubai", "DXB", "AE")], profiles: { u1: profile("u1", "2026-11-26") } });
    const broken = async () => {
      throw new Error("smtp down");
    };
    const result = await sendReminders(failing.io, { mail: broken }, { now, origin: "https://travelmo.example", lookups: {}, log: (e, f) => failing.logs.push([e, f]) });
    expect(result).toEqual({ users: 1, mailed: 0, pushed: 0, lines: 0, skipped: 0, failed: 1 });
    expect(failing.logs).toEqual([["reminder_failed", { uid: "u1", reason: "smtp down" }]]);
    // Nothing was marked sent, so tomorrow tries again.
    expect(failing.sent.size).toBe(0);
  });
});
