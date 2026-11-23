import { paths, type CalendarFeed, type GmailConnection, type GoogleCalendarConnection, type ParsedMessage, type TravelProfile, type Segment, type Trip, type UserProfile } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";

// The Admin SDK finds the emulator through FIRESTORE_EMULATOR_HOST, which
// `firebase emulators:exec` exports.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);

export async function seedTrip(
  ownerUid: string,
  tripId: string,
  stayExtra: Partial<Segment> = {},
  tripExtra: Partial<Trip> = {},
): Promise<Trip> {
  const trip: Trip = {
    id: tripId,
    title: "Liverpool",
    start: "2026-12-12",
    end: "2026-12-14",
    ownerUid,
    sharedWith: [],
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...tripExtra,
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
export async function seedFlight(tripId: string, extra: Partial<Segment> = {}): Promise<Segment> {
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
    ...extra,
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
// A change to the user's profile made elsewhere (another tab or device).
export async function updateUser(uid: string, data: Partial<UserProfile>): Promise<void> {
  await db.doc(paths.user(uid)).set(data, { merge: true });
}

// A connected mailbox as the parser leaves it: on the profile, one of
// several by its lowercased address, replaced whole; and in the private
// record the rules trust, which counts it as the account's.
export async function seedGmail(uid: string, gmail: GmailConnection): Promise<void> {
  const ref = db.doc(paths.user(uid));
  if (!(await ref.get()).exists) await ref.set({});
  await ref.update(new FieldPath("gmails", gmail.emailAddress.toLowerCase()), { idPrefix: "", ...gmail });
  await db.doc(paths.emailLinks(uid)).set({ mailboxes: FieldValue.arrayUnion(gmail.emailAddress.toLowerCase()) }, { merge: true });
}

// One connected before there could be several, as the parser left it then.
export async function seedLegacyGmail(uid: string, gmail: GmailConnection): Promise<void> {
  await db.doc(paths.user(uid)).set({ gmail }, { merge: true });
}

// Addresses the parser confirmed for the account (SPEC "Linked email
// addresses"): its private record, which the rules trust, then the
// profile's copy, which the app shows and queries with.
export async function seedLinkedEmails(uid: string, emails: string[]): Promise<void> {
  await db.doc(paths.emailLinks(uid)).set({ pending: [], confirmed: emails }, { merge: true });
  await db.doc(paths.user(uid)).set({ emails }, { merge: true });
}

export async function seedGoogleCalendar(uid: string, googleCalendar: GoogleCalendarConnection): Promise<void> {
  await db.doc(paths.user(uid)).set({ googleCalendar }, { merge: true });
}

// What the parser records for an email or import it has handled.
export async function seedParsedMessage(record: ParsedMessage): Promise<void> {
  await db.doc(paths.parsedMessage(record.uid, record.messageId)).set(record);
}

export async function seedTravelProfile(uid: string, profile: Omit<TravelProfile, "ownerUid">): Promise<void> {
  await db.doc(paths.travelProfile(uid)).set({ ownerUid: uid, ...profile });
}

export async function readTravelProfile(uid: string): Promise<TravelProfile | undefined> {
  const snap = await db.doc(paths.travelProfile(uid)).get();
  return snap.exists ? (snap.data() as TravelProfile) : undefined;
}

// The user's own document, for settings the page writes.
export async function readUser(uid: string): Promise<UserProfile | undefined> {
  const snap = await db.doc(paths.user(uid)).get();
  return snap.exists ? (snap.data() as UserProfile) : undefined;
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
  await db.recursiveDelete(db.collection(paths.accessRecords()));
  await db.recursiveDelete(db.collection("config"));
}

// Lets an address use the app, as an admin's approval does (SPEC "Access").
export async function approve(email: string): Promise<void> {
  await db.doc(paths.access(email)).set({ email, status: "approved", approvedBy: "e2e", approvedAt: "2026-11-01T00:00:00Z" });
}

export async function setAdmins(admins: string[]): Promise<void> {
  await db.doc(paths.accessConfig()).set({ admins });
}

// The user's reminders before trips, by slot, as stored.
export async function seedTripReminder(uid: string, slot: string, reminder: Record<string, unknown>): Promise<void> {
  await db.doc(paths.tripReminder(uid, slot)).set({ createdAt: "2026-11-01T00:00:00Z", ...reminder });
}

// A stored reminder's words and when, without its made-up id and time.
const shown = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== "id" && key !== "createdAt"));

export async function readTripReminders(uid: string): Promise<Record<string, Record<string, unknown>>> {
  const snap = await db.collection(paths.tripReminders(uid)).get();
  return Object.fromEntries(snap.docs.map((d) => [d.id, shown(d.data())]));
}

// What the user ticked off on a trip and the one-offs they added to it.
// What another device ticked off on a trip.
export async function seedTripTicks(uid: string, tripId: string, done: string[]): Promise<void> {
  await db.doc(paths.tripChecklist(uid, tripId)).set({ done }, { merge: true });
}

export async function readTripChecklist(uid: string, tripId: string): Promise<{ done: unknown; added: Record<string, unknown>[] }> {
  const [snap, added] = await Promise.all([db.doc(paths.tripChecklist(uid, tripId)).get(), db.collection(paths.tripChecklistAdded(uid, tripId)).get()]);
  return {
    done: snap.get("done"),
    added: added.docs.map((d) => ({ slot: d.id, ...shown(d.data()) })),
  };
}

export async function readPushSubscriptions(uid: string): Promise<PushSubscription[]> {
  return (await db.collection(paths.pushSubscriptions(uid)).get()).docs.map((d) => d.data() as PushSubscription);
}
