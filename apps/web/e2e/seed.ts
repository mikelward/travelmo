import { paths, type CalendarFeed, type GmailConnection, type GoogleCalendarConnection, type TravelProfile, type Segment, type Trip } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// The Admin SDK finds the emulator through FIRESTORE_EMULATOR_HOST, which
// `firebase emulators:exec` exports.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);

export async function seedTrip(ownerUid: string, tripId: string, stayExtra: Partial<Segment> = {}): Promise<Trip> {
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
    sources: [
      { kind: "gmail", id: "m1", label: "Your stay at Cove", at: "2026-11-01T00:00:00Z" },
      { kind: "tripit", id: "tripit-example", label: "Liverpool weekend", at: "2026-11-02T00:00:00Z" },
    ],
    sender: "cove.example",
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    ...stayExtra,
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

// An invented past week in Lisbon: flights known only by their airport
// codes, and a stay that names its country and its spot.
export async function seedLisbonTrip(ownerUid: string, tripId: string): Promise<Trip> {
  const at = "2025-05-01T00:00:00Z";
  const trip: Trip = { id: tripId, title: "Lisbon", start: "2025-06-10", end: "2025-06-14", ownerUid, sharedWith: [], createdAt: at, updatedAt: at };
  const base = { tripId, source: "manual" as const, gmailMessageIds: [], createdAt: at, updatedAt: at };
  const segments: Segment[] = [
    {
      ...base,
      id: `${tripId}-out`,
      type: "flight",
      title: "XX 1 LHR to LIS",
      start: "2025-06-10T08:00:00+01:00",
      end: "2025-06-10T10:45:00+01:00",
      origin: { name: "Heathrow", code: "LHR" },
      destination: { name: "Lisbon", code: "LIS" },
    },
    {
      ...base,
      id: `${tripId}-stay`,
      type: "lodging",
      title: "Example Guesthouse",
      start: "2025-06-10T15:00:00+01:00",
      end: "2025-06-14T11:00:00+01:00",
      destination: { name: "Example Guesthouse", city: "Lisbon", country: "PT", lat: 38.71, lon: -9.14 },
    },
    {
      ...base,
      id: `${tripId}-back`,
      type: "flight",
      title: "XX 2 LIS to LHR",
      start: "2025-06-14T13:00:00+01:00",
      end: "2025-06-14T15:40:00+01:00",
      origin: { name: "Lisbon", code: "LIS" },
      destination: { name: "Heathrow", code: "LHR" },
    },
  ];
  await db.doc(paths.trip(tripId)).set(trip);
  for (const segment of segments) await db.doc(paths.segment(tripId, segment.id)).set(segment);
  return trip;
}

export async function seedCalendarExport(uid: string, token: string | undefined): Promise<void> {
  const ref = db.doc(paths.calendarExport(uid));
  if (token) await ref.set({ token, createdAt: "2026-11-01T00:00:00Z" });
  else await ref.delete();
}

export async function seedFeed(uid: string, feed: CalendarFeed): Promise<void> {
  await db.doc(paths.feed(uid, feed.id)).set(feed);
}

// The connection as the parser leaves it on the profile (no token here).
export async function seedGmail(uid: string, gmail: GmailConnection): Promise<void> {
  await db.doc(paths.user(uid)).set({ gmail }, { merge: true });
}

export async function seedGoogleCalendar(uid: string, googleCalendar: GoogleCalendarConnection): Promise<void> {
  await db.doc(paths.user(uid)).set({ googleCalendar }, { merge: true });
}

export async function seedTravelProfile(uid: string, profile: Omit<TravelProfile, "ownerUid">): Promise<void> {
  await db.doc(paths.travelProfile(uid)).set({ ownerUid: uid, ...profile });
}

// A change made elsewhere (another tab, a sharee) while a page is open.
export async function updateSegment(tripId: string, segmentId: string, data: Partial<Segment>): Promise<void> {
  await db.doc(paths.segment(tripId, segmentId)).update(data);
}

// A trip's bookings as stored, for what the page does not show.
export async function readSegments(tripId: string): Promise<Segment[]> {
  const snap = await db.collection(paths.segments(tripId)).orderBy("start").get();
  return snap.docs.map((d) => d.data() as Segment);
}

export async function clearData(): Promise<void> {
  await db.recursiveDelete(db.collection("trips"));
  await db.recursiveDelete(db.collection("users"));
}
