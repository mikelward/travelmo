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

// An imported flight whose stored offset is not the one its airport's zone
// would give: an edit must keep it.
export async function seedFlight(tripId: string): Promise<Segment> {
  const flight: Segment = {
    id: `${tripId}-flight`,
    tripId,
    type: "flight",
    title: "XX 100 MAN to DXB",
    start: "2026-12-13T09:00:00+05:00",
    end: "2026-12-13T19:00:00+04:00",
    origin: { name: "Manchester", code: "MAN", country: "GB" },
    destination: { name: "Dubai", code: "DXB", country: "AE" },
    source: "gmail",
    gmailMessageIds: ["m2"],
    sender: "airline.example",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
  await db.doc(paths.segment(tripId, flight.id)).set(flight);
  return flight;
}

export async function clearData(): Promise<void> {
  await db.recursiveDelete(db.collection("trips"));
  await db.recursiveDelete(db.collection("users"));
}
