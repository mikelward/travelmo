import { Agent } from "node:https";
import { describe, expect, it } from "vitest";
import { pushConfig, webPushSender } from "./push";
import { FeedUrlRefused } from "./safefetch";

const subscription = { endpoint: "https://push.example/s/1", keys: { p256dh: "p", auth: "a" }, createdAt: "2026-11-01T00:00:00Z" };
const notification = { title: "Before your trip to Dubai", body: "Starts in 19 days.", url: "https://travelmo.example/trips/d", tag: "reminder-d" };

describe("pushConfig", () => {
  it("is off without a private key, and refuses half a setup", () => {
    expect(pushConfig({})).toBeUndefined();
    expect(pushConfig({ VAPID_PRIVATE_KEY: "priv", VAPID_PUBLIC_KEY: "pub", VAPID_SUBJECT: "mailto:ops@example" })).toEqual({
      privateKey: "priv",
      publicKey: "pub",
      subject: "mailto:ops@example",
    });
    expect(() => pushConfig({ VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:ops@example" })).toThrow("VAPID_PUBLIC_KEY");
    expect(() => pushConfig({ VAPID_PRIVATE_KEY: "priv", VAPID_PUBLIC_KEY: "pub", VAPID_SUBJECT: "ops@example" })).toThrow("VAPID_SUBJECT");
  });
});

describe("webPushSender", () => {
  const config = { privateKey: "priv", publicKey: "pub", subject: "https://travelmo.example" };

  it("sends the notification as JSON, signed, with a day to live and a socket timeout, through an agent that connects to public addresses only", async () => {
    const calls: unknown[][] = [];
    const sender = webPushSender(config, async (...args: unknown[]) => {
      calls.push(args);
      return { statusCode: 201, body: "", headers: {} };
    });
    expect(await sender(subscription, notification)).toBe("sent");
    expect(calls).toEqual([
      [
        subscription,
        JSON.stringify(notification),
        { vapidDetails: { subject: config.subject, publicKey: "pub", privateKey: "priv" }, TTL: 86400, agent: expect.any(Agent), timeout: 10_000 },
      ],
    ]);
  });

  it("drops a subscription whose endpoint is not a public https address, without a request", async () => {
    const calls: unknown[][] = [];
    const sender = webPushSender(config, async (...args: unknown[]) => {
      calls.push(args);
      return { statusCode: 201, body: "", headers: {} };
    });
    for (const endpoint of ["http://push.example/s/1", "https://10.0.0.5/s/1", "https://metadata.google.internal/s/1", "https://push.example:8443/s/1"]) {
      expect(await sender({ ...subscription, endpoint }, notification)).toBe("gone");
    }
    expect(calls).toEqual([]);
    // A name that resolves to a private address is refused at the connection.
    const refused = webPushSender(config, async () => {
      throw new FeedUrlRefused("That address is on a private network.");
    });
    expect(await refused(subscription, notification)).toBe("gone");
  });

  it("reports a subscription the push service has dropped, and throws anything else", async () => {
    const failing = (statusCode: number) =>
      webPushSender(config, async () => {
        throw Object.assign(new Error(`Received unexpected response code ${statusCode}`), { statusCode });
      });
    expect(await failing(410)(subscription, notification)).toBe("gone");
    expect(await failing(404)(subscription, notification)).toBe("gone");
    await expect(failing(500)(subscription, notification)).rejects.toThrow("500");
  });
});
