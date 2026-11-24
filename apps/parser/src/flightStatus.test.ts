import type { FlightStatus, ReminderNotification, Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import type { AeroFlight } from "./aeroapi";
import type { LiveFlightUpdate } from "./fcm";
import { canSeeTrip, checkFlights, flightWindow, retryPendingNews, type FlightIo, type FlightOptions, type PendingNews } from "./flightStatus";
import type { StoredDevice, StoredSubscription } from "./reminders";

// An invented flight, leaving Sydney at 09:00 local (22:00Z the day before),
// booked on two trips: one owner's, shared with a partner, and a friend's.
const at = "2026-11-01T00:00:00Z";
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
  title: "XX 100 SYD to SIN",
  start: "2026-12-13T09:00:00+11:00",
  end: "2026-12-13T15:30:00+08:00",
  origin: { name: "Sydney", code: "SYD" },
  source: "manual",
  gmailMessageIds: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});
const answer = (over: Partial<AeroFlight> = {}): AeroFlight => ({
  origin: { code_iata: "SYD" },
  scheduled_out: "2026-12-12T22:00:00Z",
  scheduled_in: "2026-12-13T07:30:00Z",
  gate_origin: "8",
  terminal_origin: "1",
  ...over,
});
const key = "XX100_2026-12-13_SYD";

function setup(options: { segments?: Segment[]; trips?: Trip[]; flights?: () => AeroFlight[]; limit?: number } = {}) {
  const segments = options.segments ?? [booking("t1"), booking("t2")];
  const trips = new Map((options.trips ?? [trip("t1", "owner", ["partner@example.com"]), trip("t2", "friend")]).map((t) => [t.id, t]));
  const statuses = new Map<string, FlightStatus>();
  const claims = new Map<string, string>();
  const pending = new Map<string, PendingNews>();
  const subscriptions = new Map<string, StoredSubscription[]>([
    ["owner", [{ id: "s1", subscription: { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" }, createdAt: at } }]],
  ]);
  const devices = new Map<string, StoredDevice[]>([
    ["partner", [{ id: "d1", device: { token: "fcm-1", platform: "android", createdAt: at } }]],
    ["friend", [{ id: "d2", device: { token: "fcm-2", platform: "android", createdAt: at } }]],
  ]);
  let calls = 0;
  const queries: [string, string, string][] = [];
  const windows: [string, string][] = [];
  const pushed: [string, ReminderNotification][] = [];
  const live: [string, LiveFlightUpdate][] = [];
  const logs: string[] = [];
  const io: FlightIo = {
    flightSegments: async (from, to) => {
      windows.push([from, to]);
      return segments;
    },
    trip: async (id) => trips.get(id),
    status: async (k) => statuses.get(k),
    claim: async (k, before, now) => {
      if (statuses.get(k)?.checkedAt !== before?.checkedAt || (claims.get(k) ?? "") > now) return false;
      claims.set(k, new Date(Date.parse(now) + 30_000).toISOString());
      return true;
    },
    saveStatus: async (k, before, after) => {
      if (statuses.get(k)?.checkedAt !== before?.checkedAt) return false;
      statuses.set(k, after);
      return true;
    },
    reserve: async () => {
      if (calls >= (options.limit ?? 100)) return false;
      calls += 1;
      return true;
    },
    uidForEmail: async (email) => (email === "partner@example.com" ? "partner" : undefined),
    pushSubscriptions: async (uid) => subscriptions.get(uid) ?? [],
    removePushSubscription: async (uid, id) => {
      subscriptions.set(uid, (subscriptions.get(uid) ?? []).filter((s) => s.id !== id));
    },
    devices: async (uid) => devices.get(uid) ?? [],
    removeDevice: async (uid, id) => {
      devices.set(uid, (devices.get(uid) ?? []).filter((d) => d.id !== id));
    },
    pendingNews: async () => [...pending.values()],
    savePendingNews: async (p, ifAt) => {
      if (ifAt === undefined || pending.get(p.id)?.at === ifAt) pending.set(p.id, p);
    },
    dropPendingNews: async (id, ifAt) => {
      if (ifAt === undefined || pending.get(id)?.at === ifAt) pending.delete(id);
    },
  };
  const options_ = (now: string, over: Partial<FlightOptions> = {}): FlightOptions => ({
    lookup: async (ident, from, to) => {
      queries.push([ident, from, to]);
      return options.flights ? options.flights() : [answer()];
    },
    limit: options.limit ?? 100,
    now,
    origin: "https://travelmo.example",
    channels: {
      push: async (subscription, n) => {
        pushed.push([subscription.endpoint, n]);
        return "sent";
      },
      fcm: async (device, n) => {
        pushed.push([device.token, n]);
        return device.token === "fcm-2" ? "gone" : "sent";
      },
      live: async (device, update) => {
        live.push([device.token, update]);
        return "sent";
      },
    },
    log: (_level, event) => logs.push(event),
    ...over,
  });
  return { io, options: options_, statuses, queries, windows, pushed, live, logs, devices, pending };
}

describe("Live Updates", () => {
  it("sends every phone on the flight the status and its own booking after each look, news or not", async () => {
    const t = setup();
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"));
    // The friend's phone was gone after the news, so only the partner's is left.
    expect(t.live.map(([to]) => to)).toEqual(["fcm-1"]);
    expect(t.live[0]![1]).toMatchObject({
      key,
      status: { found: true, departureGate: "8", departureTerminal: "1" },
      booking: { title: "XX 100 SYD to SIN", start: "2026-12-13T09:00:00+11:00", end: "2026-12-13T15:30:00+08:00" },
      url: "https://travelmo.example/trips/t1",
    });
    // Nothing new a minute later: no news, but the Live Update goes again.
    await checkFlights(t.io, t.options("2026-12-12T21:01:00Z"));
    expect(t.pushed).toHaveLength(3);
    expect(t.live.map(([to]) => to)).toEqual(["fcm-1", "fcm-1"]);
  });

  it("sends none for a look from an open trip page before the watch begins", async () => {
    const t = setup();
    await checkFlights(t.io, t.options("2026-12-12T16:30:00Z"), { tripId: "t1" });
    expect(t.live).toEqual([]);
  });

  it("sends a cancellation once, so the phone takes it down", async () => {
    let cancelled = false;
    const t = setup({ flights: () => [answer({ cancelled })] });
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"));
    cancelled = true;
    await checkFlights(t.io, t.options("2026-12-12T21:01:00Z"));
    expect(t.live.map(([, u]) => u.status.cancelled ?? false)).toEqual([false, true]);
  });

  it("sends one last update when a delay ends the watch, so the phone takes it down", async () => {
    let out = "2026-12-12T22:00:00Z";
    const t = setup({ flights: () => [answer({ estimated_out: out })] });
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"));
    out = "2026-12-13T02:00:00Z";
    await checkFlights(t.io, t.options("2026-12-12T21:01:00Z"));
    expect(t.live.map(([, u]) => u.status.estimatedOut)).toEqual(["2026-12-12T22:00:00Z", "2026-12-13T02:00:00Z"]);
  });

  it("leaves out people who may not use the app", async () => {
    const t = setup();
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z", { approved: async (uid) => uid !== "partner" }));
    expect(t.live).toEqual([]);
  });
});

describe("checkFlights", () => {
  it("looks once for everyone on the flight, keeps the answer and tells each of them once", async () => {
    const t = setup();
    const run = await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"));
    expect(run).toEqual({ flights: 1, checked: 1, notified: 2, failed: 0, capped: false });
    expect(t.queries).toEqual([["XX100", "2026-12-12T10:00:00Z", "2026-12-13T10:00:00Z"]]);
    expect(t.statuses.get(key)).toMatchObject({ ident: "XX100", date: "2026-12-13", origin: "SYD", found: true, departureGate: "8" });
    expect(t.pushed.map(([to]) => to)).toEqual(["https://push.example/1", "fcm-1", "fcm-2"]);
    expect(t.pushed[0]![1]).toEqual({
      title: "XX 100 SYD to SIN",
      body: "Departs from terminal 1, gate 8",
      url: "https://travelmo.example/trips/t1",
      tag: `flight-${key}`,
    });
    // The friend's phone was gone: forgotten, and not counted as reached.
    expect(t.devices.get("friend")).toEqual([]);
  });

  it("tells only the people who may use the app (SPEC \"Access\")", async () => {
    const t = setup();
    const run = await checkFlights(t.io, t.options("2026-12-12T21:00:00Z", { approved: async (uid) => uid !== "partner" }));
    // The owner is told; the partner isn't approved, and the friend's only phone is gone.
    expect(run.notified).toBe(1);
    expect(t.pushed.map(([to]) => to)).toEqual(["https://push.example/1", "fcm-2"]);
    expect(t.logs).toContain("flight_status_skipped_unapproved");
  });

  it("leaves out someone whose approval can't be looked up and tells the rest", async () => {
    const t = setup();
    const approved = async (uid: string) => {
      if (uid === "partner") throw new Error("auth/user-not-found");
      return true;
    };
    const run = await checkFlights(t.io, t.options("2026-12-12T21:00:00Z", { approved }));
    expect(run).toMatchObject({ notified: 1, failed: 0 });
    expect(t.logs).toContain("approval_check_failed");
  });

  it("waits for the next look, and says nothing when nothing changed", async () => {
    const t = setup();
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"));
    expect(await checkFlights(t.io, t.options("2026-12-12T21:00:30Z"))).toMatchObject({ checked: 0, notified: 0 });
    expect(await checkFlights(t.io, t.options("2026-12-12T21:01:00Z"))).toMatchObject({ checked: 1, notified: 0 });
    expect(t.queries).toHaveLength(2);
  });

  it("tells of a gate change", async () => {
    let gate = "8";
    const t = setup({ flights: () => [answer({ gate_origin: gate })] });
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"));
    gate = "9";
    t.pushed.length = 0;
    await checkFlights(t.io, t.options("2026-12-12T21:01:00Z"));
    expect(t.pushed[0]![1].body).toBe("Now departs from terminal 1, gate 9 (was terminal 1, gate 8)");
  });

  it("tells of a delay once, by Sydney's clock, and of a cancellation", async () => {
    let flight = answer({ estimated_out: "2026-12-12T22:40:00Z" });
    const t = setup({ flights: () => [flight] });
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"));
    expect(t.pushed[0]![1].body).toBe("Leaves 40 min late, at 09:40\nDeparts from terminal 1, gate 8");
    expect(t.statuses.get(key)?.noticedOut).toBe("2026-12-12T22:40:00Z");
    // Five more minutes is not news yet.
    flight = answer({ estimated_out: "2026-12-12T22:45:00Z" });
    t.pushed.length = 0;
    await checkFlights(t.io, t.options("2026-12-12T21:01:00Z"));
    expect(t.pushed).toEqual([]);
    // Back on time is news.
    flight = answer({ estimated_out: "2026-12-12T22:00:00Z" });
    await checkFlights(t.io, t.options("2026-12-12T21:02:00Z"));
    expect(t.pushed[0]![1].body).toBe("Now leaves on time, at 09:00");
    t.pushed.length = 0;
    flight = answer({ estimated_out: "2026-12-12T22:45:00Z", cancelled: true });
    await checkFlights(t.io, t.options("2026-12-12T21:03:00Z"));
    expect(t.pushed[0]![1].body).toBe("Flight cancelled");
  });

  it("does not look before the window, and asks AeroAPI nothing for a booking with no flight number", async () => {
    const t = setup({ segments: [booking("t1"), booking("t2", { title: "Flight to SIN" })] });
    expect(await checkFlights(t.io, t.options("2026-12-12T19:00:00Z"))).toMatchObject({ flights: 1, checked: 0 });
    expect(t.queries).toEqual([]);
  });

  it("asks AeroAPI nothing for a cancelled booking", async () => {
    const t = setup({ segments: [booking("t1", { cancelledAt: at, cancelledBy: "m1" })] });
    expect(await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"))).toMatchObject({ flights: 0, checked: 0 });
    expect(t.queries).toEqual([]);
  });

  it("asks only about the open trip's flights, from six hours before, once a minute", async () => {
    const t = setup({ segments: [booking("t1"), booking("t3", { title: "YY 200 SYD to AKL" })], trips: [trip("t1", "owner"), trip("t3", "owner")] });
    const run = await checkFlights(t.io, t.options("2026-12-12T16:30:00Z"), { tripId: "t1" });
    expect(run).toMatchObject({ flights: 1, checked: 1 });
    expect(t.queries.map(([ident]) => ident)).toEqual(["XX100"]);
    expect(await checkFlights(t.io, t.options("2026-12-12T16:30:30Z"), { tripId: "t1" })).toMatchObject({ checked: 0 });
  });

  it("stops for the day at the cap", async () => {
    const t = setup({ limit: 0 });
    expect(await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"))).toMatchObject({ checked: 0, capped: true });
    expect(t.logs).toContain("flight_status_capped");
  });

  it("logs a failed look and carries on with the next flight", async () => {
    const t = setup({ segments: [booking("t1"), booking("t2", { title: "YY 200 SYD to AKL" })] });
    const run = await checkFlights(
      t.io,
      t.options("2026-12-12T21:00:00Z", {
        lookup: async (ident) => {
          if (ident === "XX100") throw new Error("AeroAPI HTTP_500");
          return [answer()];
        },
      }),
    );
    expect(run).toMatchObject({ flights: 2, checked: 1, failed: 1 });
    expect(t.logs).toContain("flight_status_failed");
  });

  it("stamps a claim when it is made, not when a long run began", async () => {
    const t = setup();
    const claimed: string[] = [];
    const io: FlightIo = {
      ...t.io,
      claim: async (k, before, now) => {
        claimed.push(now);
        return t.io.claim(k, before, now);
      },
    };
    await checkFlights(io, t.options("2026-12-12T21:00:00Z", { clock: () => "2026-12-12T21:00:45Z" }));
    expect(claimed).toEqual(["2026-12-12T21:00:45Z"]);
    expect(t.statuses.get(key)?.checkedAt).toBe("2026-12-12T21:00:45Z");
  });

  it("makes one call between looks that overlap", async () => {
    const t = setup();
    const [job, page] = await Promise.all([
      checkFlights(t.io, t.options("2026-12-12T21:00:00Z")),
      checkFlights(t.io, t.options("2026-12-12T21:00:00Z"), { tripId: "t1" }),
    ]);
    expect(job.checked + page.checked).toBe(1);
    expect(t.queries).toHaveLength(1);
  });

  it("keeps a gate the service lost for a look, and says nothing when it returns", async () => {
    let gate: string | null = "8";
    const t = setup({ flights: () => [answer({ gate_origin: gate })] });
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z"));
    gate = null;
    await checkFlights(t.io, t.options("2026-12-12T21:01:00Z"));
    expect(t.statuses.get(key)?.departureGate).toBe("8");
    gate = "8";
    t.pushed.length = 0;
    await checkFlights(t.io, t.options("2026-12-12T21:02:00Z"));
    expect(t.pushed).toEqual([]);
  });

  it("does not send news another look already sent", async () => {
    const t = setup();
    const io: FlightIo = { ...t.io, saveStatus: async () => false };
    expect(await checkFlights(io, t.options("2026-12-12T21:00:00Z"))).toMatchObject({ checked: 1, notified: 0 });
    expect(t.pushed).toEqual([]);
  });
});

describe("retryPendingNews", () => {
  const down = async () => {
    throw new Error("socket hang up");
  };

  it("keeps who is owed news no browser or phone took, and tells them on a later run", async () => {
    const t = setup();
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z", { channels: { push: down, fcm: down } }));
    expect([...t.pending.keys()].sort()).toEqual([`${key}__friend`, `${key}__owner`, `${key}__partner`]);
    expect(t.logs).toContain("flight_status_news_pending");
    const sent = await retryPendingNews(t.io, t.options("2026-12-12T21:01:00Z"));
    // The friend's only phone was gone: nowhere to send it, so it is dropped unsent.
    expect(sent).toEqual({ delivered: 2, dropped: 0 });
    expect(t.pending.size).toBe(0);
    expect(t.pushed.map(([to, n]) => [to, n.body, n.tag])).toEqual([
      ["https://push.example/1", "Departs from terminal 1, gate 8", `flight-${key}`],
      ["fcm-1", "Departs from terminal 1, gate 8", `flight-${key}`],
      ["fcm-2", "Departs from terminal 1, gate 8", `flight-${key}`],
    ]);
  });

  it("drops news owed to someone whose access was revoked since", async () => {
    const t = setup();
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z", { channels: { push: down, fcm: down } }));
    const sent = await retryPendingNews(t.io, t.options("2026-12-12T21:01:00Z", { approved: async (uid) => uid !== "partner" }));
    // The owner is told; the partner's news is dropped; the friend's only phone is gone.
    expect(sent).toEqual({ delivered: 1, dropped: 1 });
    expect(t.pending.size).toBe(0);
    expect(t.logs).toContain("flight_status_skipped_unapproved");
  });

  it("tells where the flight is now, not where it was when the news failed", async () => {
    let gate = "8";
    const t = setup({ flights: () => [answer({ gate_origin: gate })] });
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z", { channels: { push: down, fcm: down } }));
    gate = "9";
    // The change to gate 9 reaches the owner from an open trip page...
    await checkFlights(t.io, t.options("2026-12-12T21:01:00Z"), { tripId: "t1" });
    expect(t.pending.has(`${key}__owner`)).toBe(false);
    // ...and a retry for anyone still owed news says gate 9 too.
    t.pending.set(`${key}__late`, { id: `${key}__late`, uid: "partner", key, title: "XX 100 SYD to SIN", url: "u", tag: `flight-${key}`, attempts: 1, at: "2026-12-12T21:00:00Z" });
    t.pushed.length = 0;
    await retryPendingNews(t.io, t.options("2026-12-12T21:02:00Z"));
    expect(t.pushed.map(([, n]) => n.body)).toEqual(["Departs from terminal 1, gate 9"]);
  });

  it("never drops news a newer failure left while a retry was sending", async () => {
    const t = setup();
    const older = { id: `${key}__owner`, uid: "owner", key, title: "XX 100 SYD to SIN", url: "u", tag: `flight-${key}`, attempts: 1, at: "2026-12-12T21:00:00Z" };
    t.pending.set(older.id, older);
    const newer = { ...older, at: "2026-12-12T21:01:00Z" };
    // While the retry sends, a newer look fails to reach the owner and leaves its own entry.
    const io: FlightIo = {
      ...t.io,
      status: async () => {
        t.pending.set(newer.id, newer);
        return { ident: "XX100", date: "2026-12-13", found: true, departureGate: "9", checkedAt: "2026-12-12T21:01:00Z" };
      },
    };
    await retryPendingNews(io, t.options("2026-12-12T21:01:30Z"));
    expect(t.pending.get(newer.id)).toEqual(newer);
  });

  it("tries again while the news is fresh, then gives up", async () => {
    const t = setup();
    await checkFlights(t.io, t.options("2026-12-12T21:00:00Z", { channels: { push: down, fcm: down } }));
    await retryPendingNews(t.io, t.options("2026-12-12T21:01:00Z", { channels: { push: down, fcm: down } }));
    expect(t.pending.get(`${key}__owner`)?.attempts).toBe(2);
    expect(await retryPendingNews(t.io, t.options("2026-12-12T21:31:00Z"))).toEqual({ delivered: 0, dropped: 3 });
    expect(t.pending.size).toBe(0);
    expect(t.pushed).toEqual([]);
  });

  it("asks the push services to hold flight news for half an hour at most", async () => {
    const t = setup();
    const ttls: (number | undefined)[] = [];
    await checkFlights(
      t.io,
      t.options("2026-12-12T21:00:00Z", {
        channels: {
          push: async (_s, _n, ttl) => {
            ttls.push(ttl);
            return "sent";
          },
        },
      }),
    );
    expect(ttls).toEqual([1800]);
  });
});

describe("flightWindow", () => {
  it("covers every booking a look could be due for, in any offset", () => {
    expect(flightWindow("2026-12-12T21:00:00Z")).toEqual({ fromLocal: "2026-12-11T03:00", toLocal: "2026-12-13T17:00" });
  });
});

describe("canSeeTrip", () => {
  it("lets in the owner and the people it is shared with by any of their addresses", () => {
    const shared = trip("t1", "owner", ["partner@example.com", "work@company.example"]);
    expect(canSeeTrip(shared, "owner", [])).toBe(true);
    expect(canSeeTrip(shared, "partner", ["partner@example.com"])).toBe(true);
    // Shared with an address the person linked, not the one they sign in with.
    expect(canSeeTrip(shared, "worker", ["worker@example.com", "work@company.example"])).toBe(true);
    expect(canSeeTrip(shared, "stranger", [])).toBe(false);
    expect(canSeeTrip(shared, "stranger", ["stranger@example.com"])).toBe(false);
  });
});
