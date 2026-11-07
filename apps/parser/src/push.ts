import type { PushSubscription, ReminderNotification } from "@travelmo/core";
import { Agent } from "node:https";
import { sendNotification } from "web-push";
import { FeedUrlRefused, normalizeFeedUrl, publicOnlyLookup } from "./safefetch";

// Web push for reminders, signed with the app's VAPID key pair. Without
// VAPID_PRIVATE_KEY the sender is off and the browser switch in Settings
// has no effect, which the README says. The push services (the browsers'
// own) charge nothing; `web-push` is MPL-2.0.
//
// A subscription's endpoint is whatever the browser wrote, so it is held
// to the same rule as a calendar feed link: https on the standard port, to
// a public address, checked at the connection. One that fails is treated
// as gone, like one the push service no longer knows, and dropped.

export type PushConfig = { publicKey: string; privateKey: string; subject: string };

// "sent", or "gone" when the push service says the subscription no longer
// exists, so the caller can drop it. Anything else throws.
export type PushSender = (subscription: PushSubscription, notification: ReminderNotification) => Promise<"sent" | "gone">;

type Env = Record<string, string | undefined>;

// The VAPID settings from the environment, or nothing without a private key.
// The subject is the contact the push services may use: a mailto: or https: URL.
export function pushConfig(env: Env): PushConfig | undefined {
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!privateKey) return undefined;
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) throw new Error("VAPID_PUBLIC_KEY is required with VAPID_PRIVATE_KEY");
  const subject = env.VAPID_SUBJECT?.trim();
  if (!subject || !/^(mailto:|https:\/\/)/.test(subject)) throw new Error("VAPID_SUBJECT must be a mailto: or https: URL");
  return { publicKey, privateKey, subject };
}

// A day's time to live: a reminder not delivered by the next run is stale,
// since that run sends the news again.
const ttlSeconds = 24 * 60 * 60;

// How long a push service may go quiet on one request before it is dropped,
// so one endpoint cannot stall the day's run for everyone after it.
const socketTimeoutMs = 10_000;

type Send = typeof sendNotification;

const isGone = (error: unknown): boolean => {
  if (error instanceof FeedUrlRefused) return true;
  const status = (error as { statusCode?: unknown }).statusCode;
  return status === 404 || status === 410;
};

export function webPushSender(config: PushConfig, send: Send = sendNotification): PushSender {
  const vapidDetails = { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey };
  const agent = new Agent({ lookup: publicOnlyLookup() });
  return async (subscription, notification) => {
    try {
      normalizeFeedUrl(subscription.endpoint);
      await send(subscription, JSON.stringify(notification), { vapidDetails, TTL: ttlSeconds, agent, timeout: socketTimeoutMs });
      return "sent";
    } catch (error) {
      if (isGone(error)) return "gone";
      throw error;
    }
  };
}
