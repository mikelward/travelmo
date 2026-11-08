"use client";

import { paths, stableHash } from "@travelmo/core";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "./firebase";
import { serviceWorkerEnabled } from "./offline";

// Reminders as notifications in this browser: the Push API's subscription,
// kept under the user (users/{uid}/pushSubscriptions) for the parser to
// send to, and `reminders.push` on the user document while any browser of
// theirs is subscribed. The parser signs with the private half of the key
// whose public half ships here.

export const vapidPublicKey = (): string | undefined => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined;

// Subscribing needs the worker, which runs in production builds only, the
// Push API, and a key to subscribe with.
export function pushSupported(): boolean {
  return serviceWorkerEnabled && typeof window !== "undefined" && "PushManager" in window && "Notification" in window && vapidPublicKey() !== undefined;
}

// A VAPID public key is URL-safe base64; subscribe wants the bytes.
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = key + "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// The document id for an endpoint: the same from any tab, so a browser
// subscribing twice writes one document.
export const subscriptionId = (endpoint: string): string => stableHash(endpoint);

// What the Push API hands out, as the parser's schema stores it.
export function storedSubscription(subscription: PushSubscription, now: string): { endpoint: string; keys: { p256dh: string; auth: string }; createdAt: string } {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error("The browser's subscription has no keys");
  return { endpoint: json.endpoint, keys: { p256dh, auth }, createdAt: now };
}

export type PushState = "unsupported" | "off" | "on";

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

// Whether this browser is subscribed for this account: the browser's
// subscription, recorded under this user. Another account on the same
// browser may have subscribed; that is theirs, not this one's. Read once
// the worker is ready; the server and the first client render show nothing.
export function usePushState(uid: string): PushState | undefined {
  const [state, setState] = useState<PushState | undefined>(() => (pushSupported() ? undefined : "unsupported"));
  useEffect(() => {
    if (!pushSupported()) return;
    let current = true;
    currentSubscription()
      .then(async (s) => (s ? (await getDoc(doc(firestore(), paths.pushSubscription(uid, subscriptionId(s.endpoint))))).exists() : false))
      .then((on) => current && setState(on ? "on" : "off"))
      .catch((error) => {
        console.error("Push subscription unreadable", error);
        if (current) setState("off");
      });
    return () => {
      current = false;
    };
  }, [uid]);
  return state;
}

// Asks the browser, subscribes, and records the subscription; "denied" when
// the person refused or the browser blocks the site, which it remembers.
export async function subscribePush(uid: string, now = new Date().toISOString()): Promise<"on" | "denied"> {
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey()!) }));
  const stored = storedSubscription(subscription, now);
  const db = firestore();
  await setDoc(doc(db, paths.pushSubscription(uid, subscriptionId(stored.endpoint))), stored);
  await setDoc(doc(db, paths.user(uid)), { reminders: { push: true } }, { merge: true });
  return "on";
}

// Forgets this browser for this account; the setting goes off with the
// last browser, unless a phone (users/{uid}/devices, the Android app's) is
// still registered. The browser's own subscription stays: another account
// on the same browser may have recorded it too, and nothing is sent to a
// subscription no account holds.
export async function unsubscribePush(uid: string): Promise<void> {
  const subscription = await currentSubscription();
  const db = firestore();
  if (subscription) await deleteDoc(doc(db, paths.pushSubscription(uid, subscriptionId(subscription.endpoint))));
  const [remaining, devices] = await Promise.all([getDocs(collection(db, paths.pushSubscriptions(uid))), getDocs(collection(db, paths.devices(uid)))]);
  if (remaining.empty && devices.empty) await setDoc(doc(db, paths.user(uid)), { reminders: { push: false } }, { merge: true });
}
