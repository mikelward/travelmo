import type { ReminderNotification } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { fcmSender, messagePayloadLimit, reminderMessage } from "./fcm";

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
