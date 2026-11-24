import type { Device, FlightStatus, ReminderNotification, Segment } from "@travelmo/core";
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
// `ttlSeconds` is how long Messaging may hold it for an offline phone; a
// day by default.
export type DeviceSender = (device: Device, notification: ReminderNotification, ttlSeconds?: number) => Promise<"sent" | "gone">;

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
// A check-in reminder also names its booking, for the "I've checked in"
// action.
export function reminderMessage(device: Device, notification: ReminderNotification, ttl = ttlMs): TokenMessage {
  const lines = notification.body.split("\n");
  const build = (kept: number): TokenMessage => ({
    token: device.token,
    data: {
      title: notification.title,
      body: kept === lines.length ? notification.body : [...lines.slice(0, kept), moreLine].join("\n"),
      url: notification.url,
      tag: notification.tag,
      // A check-in reminder's booking, for the app's "I've checked in" action.
      ...(notification.checkedIn ? { checkedInTripId: notification.checkedIn.tripId, checkedInSegmentId: notification.checkedIn.segmentId } : {}),
    },
    android: { ttl },
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
  return (device, notification, ttlSeconds) =>
    sendOrGone(() => messaging.send(reminderMessage(device, notification, ttlSeconds === undefined ? ttlMs : ttlSeconds * 1000)));
}

// A flight's Live Update on a phone: an ongoing notification for the flight,
// with the terminal and gate, the landing time or the carousel in the status
// bar, which the app draws from the flight's status and the person's booking.
// Sent after every look while the parser watches the flight, so it moves on
// from the gate to the landing to the bags without anything changing.
export type LiveFlightUpdate = {
  key: string;
  status: FlightStatus;
  booking: Pick<Segment, "title" | "start" | "end" | "destination">;
  url: string;
};

export type LiveSender = (device: Device, update: LiveFlightUpdate) => Promise<"sent" | "gone">;

// A look comes a minute after the last at most; one this old is stale
// enough that the next replaces it, and one queued for a phone that was
// off collapses into the newest.
const liveTtlMs = 15 * 60_000;

// Data, all strings: the status's fields as stored, beside the booking's
// times (their offsets give the airports' clocks) and the trip's URL.
export function liveMessage(device: Device, update: LiveFlightUpdate): TokenMessage {
  const tag = `live-${update.key}`;
  const fields: Record<string, string | undefined> = {
    kind: "live",
    tag,
    key: update.key,
    title: update.booking.title,
    url: update.url,
    start: update.booking.start,
    end: update.booking.end,
    destination: update.booking.destination?.code,
    ...Object.fromEntries(Object.entries(update.status).map(([name, value]) => [name, value === undefined ? undefined : String(value)])),
  };
  const data = Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined));
  // High priority: the phone draws a notification for each, so Android lets
  // it through Doze at once rather than with the next maintenance window.
  return { token: device.token, data, android: { ttl: liveTtlMs, priority: "high", collapseKey: tag } };
}

const sendOrGone = async (send: () => Promise<unknown>): Promise<"sent" | "gone"> => {
  try {
    await send();
    return "sent";
  } catch (error) {
    if (isGone(error)) return "gone";
    throw error;
  }
};

export function fcmLiveSender(messaging: Pick<Messaging, "send">): LiveSender {
  return (device, update) => sendOrGone(() => messaging.send(liveMessage(device, update)));
}
