import { paths, type FlightStatus, type Segment } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { firestoreFlightIo, flightWindow } from "./flightStatus";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
// Invented bookings in 2031, a year no other test writes to.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
const none = async () => [];
const io = firestoreFlightIo(db, {
  uidForEmail: async () => undefined,
  pushSubscriptions: none,
  removePushSubscription: async () => {},
  devices: none,
  removeDevice: async () => {},
});

const at = "2031-01-01T00:00:00Z";
const booking = (id: string, type: Segment["type"], start: string): Segment => ({
  id,
  tripId: "fs-trip",
  type,
  title: "XX 100 SYD to SIN",
  start,
  source: "manual",
  gmailMessageIds: [],
  createdAt: at,
  updatedAt: at,
});

describe("firestoreFlightIo", () => {
  it("finds the flight bookings whose local start lies in the window, in any offset", async () => {
    const { fromLocal, toLocal } = flightWindow("2031-03-10T12:00:00Z");
    const bookings = [
      booking("early", "flight", "2031-03-08T17:59:00-12:00"),
      booking("sydney", "flight", "2031-03-11T07:00:00+11:00"),
      booking("late", "flight", `${toLocal}:00+14:00`),
      booking("next-week", "flight", "2031-03-17T09:00:00+00:00"),
      booking("hotel", "lodging", "2031-03-10T15:00:00+00:00"),
    ];
    for (const b of bookings) await db.doc(paths.segment(b.tripId, b.id)).set(b);
    const found = await io.flightSegments(fromLocal, toLocal);
    expect(found.map((s) => s.id).sort()).toEqual(["late", "sydney"]);
  });

  it("saves a status only over the one it read, and keeps the daily count", async () => {
    const key = "XX100_2031-03-11_SYD";
    const status = (checkedAt: string): FlightStatus => ({ ident: "XX100", date: "2031-03-11", origin: "SYD", found: true, checkedAt });
    expect(await io.status(key)).toBeUndefined();
    expect(await io.saveStatus(key, undefined, status("2031-03-10T20:00:00Z"))).toBe(true);
    expect(await io.saveStatus(key, undefined, status("2031-03-10T20:00:01Z"))).toBe(false);
    expect(await io.saveStatus(key, status("2031-03-10T20:00:00Z"), status("2031-03-10T20:01:00Z"))).toBe(true);
    expect(await io.status(key)).toEqual(status("2031-03-10T20:01:00Z"));
    // One claim at a time on the status as read, until it lapses.
    const read = await io.status(key);
    expect(await io.claim(key, read, "2031-03-10T20:02:00Z")).toBe(true);
    expect(await io.claim(key, read, "2031-03-10T20:02:10Z")).toBe(false);
    expect(await io.claim(key, read, "2031-03-10T20:02:31Z")).toBe(true);
    expect(await io.claim(key, status("2031-03-10T20:00:00Z"), "2031-03-10T20:03:31Z")).toBe(false);
    expect(await io.reserve("2031-03-10", 2)).toBe(true);
    expect(await io.reserve("2031-03-10", 2)).toBe(true);
    expect(await io.reserve("2031-03-10", 2)).toBe(false);
  });

  it("keeps news waiting for another try until it is dropped", async () => {
    const pending = {
      id: "XX100_2031-03-11_SYD__u1",
      uid: "u1",
      key: "XX100_2031-03-11_SYD",
      title: "XX 100 SYD to SIN",
      url: "https://travelmo.example/trips/t1",
      tag: "flight-XX100_2031-03-11_SYD",
      attempts: 1,
      at: "2031-03-10T20:00:00Z",
    };
    await io.savePendingNews(pending);
    expect(await io.pendingNews()).toContainEqual(pending);
    // Only the entry written at the time given is replaced or dropped.
    const newer = { ...pending, at: "2031-03-10T20:01:00Z" };
    await io.savePendingNews(newer);
    await io.savePendingNews({ ...pending, attempts: 2 }, pending.at);
    await io.dropPendingNews(pending.id, pending.at);
    expect(await io.pendingNews()).toContainEqual(newer);
    await io.savePendingNews({ ...newer, attempts: 2 }, newer.at);
    expect(await io.pendingNews()).toContainEqual({ ...newer, attempts: 2 });
    await io.dropPendingNews(pending.id, newer.at);
    expect((await io.pendingNews()).map((p) => p.id)).not.toContain(pending.id);
  });
});
