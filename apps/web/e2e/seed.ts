import { paths, type Segment, type Trip } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// The Admin SDK finds the emulator through FIRESTORE_EMULATOR_HOST, which
// `firebase emulators:exec` exports.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);

export async function seedTrip(ownerUid: string, tripId: string): Promise<Trip> {
  const trip: Trip = {
    id: tripId,
    title: "Liverpool",
    start: "2026-12-12",
    end: "2026-12-14",
    ownerUid,
    sharedWith: [],
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
  const stay: Segment = {
    id: `${tripId}-stay`,
    tripId,
    type: "lodging",
    title: "Cove Liverpool",
    start: "2026-12-12T15:00:00+00:00",
    end: "2026-12-14T11:00:00+00:00",
    destination: { name: "Cove Liverpool", city: "Liverpool", country: "GB" },
    source: "gmail",
    gmailMessageIds: ["m1"],
    sender: "cove.example",
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
  await db.doc(paths.trip(tripId)).set(trip);
  await db.doc(paths.segment(tripId, stay.id)).set(stay);
  return trip;
}

export async function clearData(): Promise<void> {
  await db.recursiveDelete(db.collection("trips"));
  await db.recursiveDelete(db.collection("users"));
}
