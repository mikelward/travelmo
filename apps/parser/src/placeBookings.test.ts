import type { Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import type { TripTx } from "./importer";
import { placeBookings } from "./placeBookings";
import { memoryStore } from "./testStore";

// Invented bookings: trains between two unambiguous cities.
const at = "2026-11-01T12:00:00Z";
const trip = (id: string): Trip => ({ id, title: id, start: "2026-05-23", end: "2026-05-25", ownerUid: "u1", sharedWith: [], createdAt: at, updatedAt: at });
const train = (tripId: string, id: string): Segment => ({
  id,
  tripId,
  type: "train",
  title: "London to Liverpool",
  start: "2026-05-23T12:07:00+01:00",
  origin: { name: "London Euston", city: "London" },
  destination: { name: "Liverpool Lime Street", city: "Liverpool" },
  source: "gmail",
  gmailMessageIds: [id],
  createdAt: at,
  updatedAt: at,
});

const reads = new Set<keyof TripTx>(["listTrips", "getTrip", "listSegments", "getSegment", "listParsedIds", "connectedMailboxes", "listPendingCancellations", "listPeople"]);

describe("placeBookings", () => {
  it("reads every booking before writing any, as a Firestore transaction requires, over passes", async () => {
    const store = memoryStore();
    for (const id of ["a", "b", "c"]) {
      store.trips.set(id, trip(id));
      store.segments.set(`${id}-0`, train(id, `${id}-0`));
    }
    const lock = store.withUserLock.bind(store);
    store.withUserLock = (uid, fn) =>
      lock(uid, (tx) => {
        let wrote = false;
        const strict = new Proxy(tx, {
          get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              if (reads.has(key as keyof TripTx) && wrote) throw new Error(`read ${String(key)} after a write`);
              if (!reads.has(key as keyof TripTx)) wrote = true;
              return value.apply(target, args);
            };
          },
        });
        return fn(strict);
      });
    // Room for two trips a pass: three trips take two passes.
    expect(await placeBookings("u1", { store, now: () => "2026-11-24T09:00:00Z", log: () => {} }, 4)).toBe(3);
    for (const id of ["a", "b", "c"]) expect(store.segments.get(`${id}-0`)).toMatchObject({ origin: { country: "GB" }, destination: { country: "GB" }, updatedAt: at });
  });
});
