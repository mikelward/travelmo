import type { Device, ReminderNotification } from "@travelmo/core";
import type { Messaging, TokenMessage } from "firebase-admin/messaging";

// Reminders to phones, through Firebase Cloud Messaging with the Admin
// credential the parser already holds: no key of its own, and Messaging
// charges nothing. The app registers a phone's token under the user
// (users/{uid}/devices); a token Messaging no longer knows is reported
// "gone" so the caller drops it, as a lost browser subscription is.
//
// A data message, not a notification message: Messaging collapses
// notification messages queued for an offline phone under one key per
// app, so of a day's several trips only the last would arrive, while data
// messages queue as sent. The app draws each one in its reminders channel.

// "sent", or "gone" when the token is no longer registered. Anything else throws.
export type DeviceSender = (device: Device, notification: ReminderNotification) => Promise<"sent" | "gone">;

// A day's time to live, as for web push: the next run sends the news again.
const ttlMs = 24 * 60 * 60 * 1000;

// Messaging takes 4096 bytes of message; the core's notification is built
// for web push's 3993 and a token and the Android settings ride beside it
// here, so the body is cut to fit, by whole lines, the last replaced by a
// pointer to the page.
export const messagePayloadLimit = 4096;
const moreLine = "More on the trip page.";
const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

// What the app draws: the title and body, the trip's URL as the tap target,
// and a tag per trip so a later reminder for the same trip replaces the
// earlier one on the phone's shade (not in Messaging's queue).
export function reminderMessage(device: Device, notification: ReminderNotification): TokenMessage {
  const lines = notification.body.split("\n");
  const build = (kept: number): TokenMessage => ({
    token: device.token,
    data: {
      title: notification.title,
      body: kept === lines.length ? notification.body : [...lines.slice(0, kept), moreLine].join("\n"),
      url: notification.url,
      tag: notification.tag,
    },
    android: { ttl: ttlMs },
  });
  let kept = lines.length;
  let message = build(kept);
  while (kept > 1 && utf8Length(JSON.stringify(message)) > messagePayloadLimit) message = build(--kept);
  return message;
}

// The Admin SDK's codes for a token that will never work again.
const goneCodes = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

const isGone = (error: unknown): boolean => {
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  if (goneCodes.has(code)) return true;
  // A malformed token comes back as an argument error that names it.
  return code === "messaging/invalid-argument" && /registration token/i.test((error as Error).message ?? "");
};

export function fcmSender(messaging: Pick<Messaging, "send">): DeviceSender {
  return async (device, notification) => {
    try {
      await messaging.send(reminderMessage(device, notification));
      return "sent";
    } catch (error) {
      if (isGone(error)) return "gone";
      throw error;
    }
  };
}
