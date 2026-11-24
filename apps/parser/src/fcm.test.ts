import type { ReminderNotification } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { fcmLiveSender, fcmSender, liveMessage, messagePayloadLimit, reminderMessage } from "./fcm";

const device = { token: "fcm-token-1", platform: "android" as const, createdAt: "2026-11-07T00:00:00Z" };
const notification: ReminderNotification = {
  title: "Before your trip to Paris",
  body: "Starts in 3 days, 10–14 Nov.\nYour passport runs out too soon.",
  url: "https://travelmo.example/trips/paris",
  tag: "reminder-paris",
};

const failing = (code: string, message = "nope") => ({
  send: async () => {
    throw Object.assign(new Error(message), { code });
  },
});

describe("fcmSender", () => {
  it("sends the notification to the token as data the app draws, never a collapsible notification message", async () => {
    const sent: unknown[] = [];
    const send = fcmSender({
      send: async (message) => {
        sent.push(message);
        return "projects/p/messages/1";
      },
    });
    expect(await send(device, notification)).toBe("sent");
    expect(sent).toEqual([reminderMessage(device, notification)]);
    const message = reminderMessage(device, notification);
    expect(message.token).toBe("fcm-token-1");
    expect(message.notification).toBeUndefined();
    expect(message.data).toEqual({ title: notification.title, body: notification.body, url: notification.url, tag: notification.tag });
    expect(message.android).toEqual({ ttl: 86_400_000 });
  });

  it("names a check-in reminder's booking, for the app's action", () => {
    const checkIn = { ...notification, checkedIn: { tripId: "paris", segmentId: "f1" } };
    expect(reminderMessage(device, checkIn).data).toMatchObject({ checkedInTripId: "paris", checkedInSegmentId: "f1" });
  });

  it("lets news that soon goes stale ask for a shorter life", async () => {
    const sent: { android?: unknown }[] = [];
    const send = fcmSender({
      send: async (message) => {
        sent.push(message);
        return "projects/p/messages/1";
      },
    });
    await send(device, notification, 1800);
    expect(sent[0]!.android).toEqual({ ttl: 1_800_000 });
  });

  it("cuts a body that would overflow Messaging's payload to whole lines and a pointer to the page", async () => {
    // A notification at the web push budget, with a long token beside it.
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}: a passport or visa that runs out too soon for this trip.`);
    const long = { ...notification, body: ["Starts in 3 days, 10–14 Nov.", ...lines].join("\n") };
    const longToken = { ...device, token: "t".repeat(170) };
    const message = reminderMessage(longToken, long);
    const size = new TextEncoder().encode(JSON.stringify(message)).length;
    expect(size).toBeLessThanOrEqual(messagePayloadLimit);
    expect(size).toBeGreaterThan(messagePayloadLimit - 200);
    const body = message.data!.body!;
    expect(body.startsWith("Starts in 3 days, 10–14 Nov.\nLine 1:")).toBe(true);
    expect(body.endsWith("\nMore on the trip page.")).toBe(true);
    expect(body).not.toContain("Line 60");
    // Only whole lines go: the last kept line is intact.
    const keptLines = body.split("\n");
    expect(keptLines.at(-2)).toMatch(/^Line \d+: a passport or visa that runs out too soon for this trip\.$/);
  });

  it("reports a token Messaging no longer knows as gone", async () => {
    expect(await fcmSender(failing("messaging/registration-token-not-registered"))(device, notification)).toBe("gone");
    expect(await fcmSender(failing("messaging/invalid-registration-token"))(device, notification)).toBe("gone");
    expect(await fcmSender(failing("messaging/invalid-argument", "The registration token is not a valid FCM registration token"))(device, notification)).toBe("gone");
  });

  it("throws anything else, so the day's news waits for tomorrow", async () => {
    await expect(fcmSender(failing("messaging/internal-error"))(device, notification)).rejects.toThrow("nope");
    await expect(fcmSender(failing("messaging/invalid-argument", "notification.title is too long"))(device, notification)).rejects.toThrow();
    await expect(fcmSender({ send: async () => Promise.reject(new Error("socket hang up")) })(device, notification)).rejects.toThrow("socket hang up");
  });
});

describe("fcmLiveSender", () => {
  const update = {
    key: "XX100_2026-12-13_SYD",
    status: { ident: "XX100", date: "2026-12-13", origin: "SYD", found: true, departureGate: "8", departureTerminal: "1", cancelled: false, checkedAt: "2026-12-12T21:00:00Z" },
    booking: { title: "XX 100 SYD to SIN", start: "2026-12-13T09:00:00+11:00", end: "2026-12-13T15:30:00+08:00", destination: { name: "Singapore", code: "SIN" } },
    url: "https://travelmo.example/trips/t1",
  };

  it("sends the status and booking as strings, collapsing a queue of them into the newest", async () => {
    const sent: unknown[] = [];
    const send = fcmLiveSender({
      send: async (message) => {
        sent.push(message);
        return "projects/p/messages/1";
      },
    });
    expect(await send(device, update)).toBe("sent");
    expect(sent).toEqual([liveMessage(device, update)]);
    expect(liveMessage(device, update)).toEqual({
      token: "fcm-token-1",
      data: {
        kind: "live",
        tag: "live-XX100_2026-12-13_SYD",
        key: "XX100_2026-12-13_SYD",
        title: "XX 100 SYD to SIN",
        url: "https://travelmo.example/trips/t1",
        start: "2026-12-13T09:00:00+11:00",
        end: "2026-12-13T15:30:00+08:00",
        destination: "SIN",
        ident: "XX100",
        date: "2026-12-13",
        origin: "SYD",
        found: "true",
        departureGate: "8",
        departureTerminal: "1",
        cancelled: "false",
        checkedAt: "2026-12-12T21:00:00Z",
      },
      android: { ttl: 900_000, priority: "high", collapseKey: "live-XX100_2026-12-13_SYD" },
    });
  });

  it("reports a token Messaging no longer knows as gone", async () => {
    expect(await fcmLiveSender(failing("messaging/registration-token-not-registered"))(device, update)).toBe("gone");
  });
});
