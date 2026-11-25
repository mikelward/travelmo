import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { maxFoundLoyalty, paths, type Segment, type Trip } from "@travelmo/core";
import { arrayUnion, collection, collectionGroup, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { readFileSync } from "node:fs";

let env: RulesTestEnvironment;

const owner = { uid: "owner", email: "owner@example.com" };
const partner = { uid: "partner", email: "partner@example.com" };
const stranger = { uid: "stranger", email: "stranger@example.com" };
// Signed up after approvals began: no user document.
const newcomer = { uid: "newcomer", email: "newcomer@example.com" };
// Listed in config/access, with no user document either.
const admin = { uid: "admin", email: "admin@example.com" };

const trip: Trip = {
  id: "t1",
  title: "Liverpool",
  start: "2026-12-12",
  end: "2026-12-14",
  ownerUid: owner.uid,
  sharedWith: [partner.email],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const segment: Segment = {
  id: "s1",
  tripId: "t1",
  type: "lodging",
  title: "Cove Liverpool",
  start: "2026-12-12T15:00:00+00:00",
  end: "2026-12-14T11:00:00+00:00",
  source: "gmail",
  gmailMessageIds: ["m1"],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

function as(user: { uid: string; email: string }, verified = true) {
  return env.authenticatedContext(user.uid, { email: user.email, email_verified: verified }).firestore();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-travelmo",
    firestore: { rules: readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8") },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, paths.trip(trip.id)), trip);
    await setDoc(doc(db, paths.segment(trip.id, segment.id)), segment);
    await setDoc(doc(db, paths.gmailState(owner.uid)), { refreshToken: "secret", emailAddress: owner.email, connectedAt: trip.createdAt });
    await setDoc(doc(db, paths.user(owner.uid)), { email: owner.email, gmail: { emailAddress: owner.email, connectedAt: trip.createdAt } });
    // Accounts from before approvals, which every one of them has.
    await setDoc(doc(db, paths.user(partner.uid)), { email: partner.email });
    await setDoc(doc(db, paths.user(stranger.uid)), { email: stranger.email });
    await setDoc(doc(db, paths.accessConfig()), { admins: [admin.email] });
  });
});

describe("trips", () => {
  it("owner and sharee can read, stranger cannot", async () => {
    await assertSucceeds(getDoc(doc(as(owner), paths.trip(trip.id))));
    await assertSucceeds(getDoc(doc(as(partner), paths.trip(trip.id))));
    await assertFails(getDoc(doc(as(stranger), paths.trip(trip.id))));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), paths.trip(trip.id))));
  });

  it("lets a signed-in user see that a trip is missing, but not an anonymous one", async () => {
    const snap = await assertSucceeds(getDoc(doc(as(stranger), paths.trip("nope"))));
    expect(snap.exists()).toBe(false);
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), paths.trip("nope"))));
  });

  it("sharing requires a verified email", async () => {
    await assertFails(getDoc(doc(as(partner, false), paths.trip(trip.id))));
  });

  it("matches shared emails case-insensitively on the token side", async () => {
    const db = env.authenticatedContext(partner.uid, { email: "Partner@Example.com", email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(db, paths.trip(trip.id))));
  });

  it("owner and sharee list queries succeed", async () => {
    const trips = (db: ReturnType<typeof as>) => collection(db, paths.trips());
    await assertSucceeds(getDocs(query(trips(as(owner)), where("ownerUid", "==", owner.uid))));
    await assertSucceeds(getDocs(query(trips(as(partner)), where("sharedWith", "array-contains", partner.email))));
    await assertFails(getDocs(query(trips(as(stranger)), where("ownerUid", "==", owner.uid))));
    await assertFails(getDocs(trips(as(owner))));
  });

  it("owner can share and update; sharee and stranger cannot change anything but the dates", async () => {
    await assertSucceeds(updateDoc(doc(as(owner), paths.trip(trip.id)), { sharedWith: [partner.email, "x@example.com"], updatedAt: "2026-11-02T00:00:00Z" }));
    await assertFails(updateDoc(doc(as(partner), paths.trip(trip.id)), { title: "Mine now" }));
    await assertFails(updateDoc(doc(as(partner), paths.trip(trip.id)), { sharedWith: [partner.email, stranger.email] }));
    await assertFails(updateDoc(doc(as(partner), paths.trip(trip.id)), { deleting: true }));
    await assertFails(updateDoc(doc(as(stranger), paths.trip(trip.id)), { title: "Mine now" }));
  });

  it("a sharee may widen the trip's dates but not narrow them", async () => {
    const ref = doc(as(partner), paths.trip(trip.id));
    await assertSucceeds(updateDoc(ref, { start: "2026-12-11", end: "2026-12-15", updatedAt: "2026-11-02T00:00:00Z" }));
    await assertFails(updateDoc(ref, { start: "2026-12-13", updatedAt: "2026-11-02T00:00:00Z" }));
    await assertFails(updateDoc(ref, { end: "2026-12-14", updatedAt: "2026-11-02T00:00:00Z" }));
    await assertSucceeds(updateDoc(ref, { updatedAt: "2026-11-03T00:00:00Z" }));
  });

  it("keeps the dates a trip is shown with within its own, both or neither, for the owner and a sharee alike", async () => {
    const owned = doc(as(owner), paths.trip(trip.id));
    await assertSucceeds(updateDoc(owned, { liveStart: trip.start, liveEnd: trip.start }));
    await assertFails(updateDoc(owned, { liveStart: "2026-12-01", liveEnd: trip.start }));
    await assertFails(updateDoc(owned, { liveEnd: trip.end, liveStart: deleteField() }));
    await assertFails(updateDoc(owned, { liveStart: "soon", liveEnd: "later" }));
    const shared = doc(as(partner), paths.trip(trip.id));
    // Moved in, as marking a booking at the trip's end cancelled does.
    await assertSucceeds(updateDoc(shared, { liveStart: trip.end, liveEnd: trip.end }));
    await assertSucceeds(updateDoc(shared, { liveStart: trip.start, liveEnd: trip.end }));
    await assertSucceeds(updateDoc(shared, { liveStart: deleteField(), liveEnd: deleteField() }));
    await assertFails(updateDoc(shared, { liveStart: "2026-12-01", liveEnd: trip.start }));
    await assertFails(updateDoc(shared, { liveStart: trip.start, liveEnd: deleteField() }));
  });

  it("lets the owner and a sharee keep the list's flags, as true or false", async () => {
    await assertSucceeds(updateDoc(doc(as(owner), paths.trip(trip.id)), { allCancelled: false, localOnly: true }));
    await assertSucceeds(updateDoc(doc(as(partner), paths.trip(trip.id)), { allCancelled: true, localOnly: false }));
    await assertFails(updateDoc(doc(as(owner), paths.trip(trip.id)), { allCancelled: "yes" }));
    await assertFails(updateDoc(doc(as(partner), paths.trip(trip.id)), { localOnly: 1 }));
    await assertFails(updateDoc(doc(as(stranger), paths.trip(trip.id)), { allCancelled: true }));
    // And whom its bookings are for, a list of at most a hundred.
    await assertSucceeds(updateDoc(doc(as(owner), paths.trip(trip.id)), { travelers: ["Sam Example"] }));
    await assertSucceeds(updateDoc(doc(as(partner), paths.trip(trip.id)), { travelers: [] }));
    await assertFails(updateDoc(doc(as(partner), paths.trip(trip.id)), { travelers: "Sam Example" }));
    await assertFails(updateDoc(doc(as(owner), paths.trip(trip.id)), { travelers: Array.from({ length: 101 }, (_, i) => `Person${i} Example`) }));
  });

  it("lets only the owner mark a trip cancelled, with a time", async () => {
    await assertFails(updateDoc(doc(as(partner), paths.trip(trip.id)), { cancelledAt: "2026-11-24T10:00:00Z" }));
    await assertFails(updateDoc(doc(as(owner), paths.trip(trip.id)), { cancelledAt: "yesterday" }));
    await assertSucceeds(updateDoc(doc(as(owner), paths.trip(trip.id)), { cancelledAt: "2026-11-24T10:00:00Z" }));
    await assertFails(updateDoc(doc(as(partner), paths.trip(trip.id)), { cancelledAt: deleteField() }));
    await assertSucceeds(updateDoc(doc(as(owner), paths.trip(trip.id)), { cancelledAt: deleteField() }));
  });

  it("owner cannot hand the trip to someone else or write bad dates", async () => {
    await assertFails(updateDoc(doc(as(owner), paths.trip(trip.id)), { ownerUid: stranger.uid }));
    await assertFails(updateDoc(doc(as(owner), paths.trip(trip.id)), { start: "2027-01-01" }));
    await assertFails(updateDoc(doc(as(owner), paths.trip(trip.id)), { extra: true }));
  });

  it("a user can create their own trip with a matching id and not someone else's", async () => {
    const mine: Trip = { ...trip, id: "t2", ownerUid: stranger.uid, sharedWith: [] };
    await assertSucceeds(setDoc(doc(as(stranger), paths.trip("t2")), mine));
    await assertFails(setDoc(doc(as(stranger), paths.trip("t3")), { ...mine, id: "t2" }));
    await assertFails(setDoc(doc(as(stranger), paths.trip("t4")), { ...mine, id: "t4", ownerUid: owner.uid }));
  });

  it("only the owner can delete", async () => {
    await assertFails(deleteDoc(doc(as(partner), paths.trip(trip.id))));
    await assertSucceeds(deleteDoc(doc(as(owner), paths.trip(trip.id))));
  });
});

describe("segments", () => {
  it("follow the parent trip's access, for sharees too", async () => {
    await assertSucceeds(getDoc(doc(as(owner), paths.segment(trip.id, segment.id))));
    await assertSucceeds(getDocs(collection(as(partner), paths.segments(trip.id))));
    await assertFails(getDocs(collection(as(stranger), paths.segments(trip.id))));
    await assertSucceeds(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { title: "Renamed", sender: "cove.example", editedAt: "2026-11-24T00:00:00Z" }));
    await assertSucceeds(updateDoc(doc(as(partner), paths.segment(trip.id, segment.id)), { title: "Renamed by partner", editedAt: "2026-11-24T00:01:00Z" }));
    await assertFails(updateDoc(doc(as(stranger), paths.segment(trip.id, segment.id)), { title: "Renamed" }));
  });

  it("owner and sharee can add a well-formed manual segment and delete one; a stranger cannot", async () => {
    const manual: Segment = { ...segment, id: "s2", source: "manual", gmailMessageIds: [], end: undefined } as Segment;
    delete (manual as { end?: string }).end;
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s2")), manual));
    await assertSucceeds(setDoc(doc(as(partner), paths.segment(trip.id, "s3")), { ...manual, id: "s3" }));
    await assertFails(setDoc(doc(as(stranger), paths.segment(trip.id, "s4")), { ...manual, id: "s4" }));
    await assertSucceeds(deleteDoc(doc(as(owner), paths.segment(trip.id, "s2"))));
    await assertSucceeds(deleteDoc(doc(as(partner), paths.segment(trip.id, "s3"))));
    await assertFails(deleteDoc(doc(as(stranger), paths.segment(trip.id, segment.id))));
  });

  it("lets owner and sharee edit a booking imported from TripIt or a calendar, but not invent a source", async () => {
    const imported = { ...segment, id: "s5", source: "tripit", gmailMessageIds: [] };
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s5")), imported));
    await assertSucceeds(updateDoc(doc(as(partner), paths.segment(trip.id, "s5")), { title: "Edited by partner", editedAt: "2026-11-24T00:00:00Z" }));
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s7")), { ...imported, id: "s7", source: "ics" }));
    // A forwarded email's booking is the owner's to edit, rate and move too.
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s10")), { ...imported, id: "s10", source: "forward" }));
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s10")), { ...imported, id: "s10", source: "forward", rating: 4 }));
    // So is one read from a connected Fastmail mailbox.
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s11")), { ...imported, id: "s11", source: "fastmail" }));
    // And one read from a mailbox connected over IMAP.
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s12")), { ...imported, id: "s12", source: "imap" }));
    const withSources = { ...imported, id: "s8", sources: [{ kind: "gmail", id: "m1", label: "Your booking", at: "2026-11-01T00:00:00Z" }] };
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s8")), withSources));
    await assertSucceeds(updateDoc(doc(as(partner), paths.segment(trip.id, "s8")), { title: "Edited, sources kept", editedAt: "2026-11-24T00:00:00Z" }));
    await assertFails(setDoc(doc(as(owner), paths.segment(trip.id, "s9")), { ...withSources, id: "s9", sources: "m1" }));
    await assertFails(setDoc(doc(as(owner), paths.segment(trip.id, "s6")), { ...imported, id: "s6", source: "carrier-pigeon" }));
  });

  it("refuses new segments on a trip being deleted, but still lets the owner remove them", async () => {
    await assertSucceeds(updateDoc(doc(as(owner), paths.trip(trip.id)), { deleting: true, updatedAt: "2026-11-02T00:00:00Z" }));
    const manual = { ...segment, id: "s9", source: "manual" };
    await assertFails(setDoc(doc(as(owner), paths.segment(trip.id, "s9")), manual));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { title: "Late edit" }));
    await assertSucceeds(deleteDoc(doc(as(owner), paths.segment(trip.id, segment.id))));
    await assertSucceeds(deleteDoc(doc(as(owner), paths.trip(trip.id))));
  });

  it("keeps a booking's cancellation well formed, and lets an editor take it back", async () => {
    const cancelled = { cancelledAt: "2026-11-05T09:00:00Z", cancelledBy: "m2", cancelledSentAt: "2026-11-04T08:00:00Z" };
    await assertSucceeds(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), cancelled));
    await assertSucceeds(
      updateDoc(doc(as(partner), paths.segment(trip.id, segment.id)), { cancelledAt: deleteField(), cancelledBy: deleteField(), restoredFrom: arrayUnion("m2") }),
    );
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { restoredFrom: "m2" }));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { cancelledSentAt: "last week" }));
    await assertSucceeds(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { restoredAt: "2026-11-06T10:00:00Z" }));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { restoredAt: "yesterday" }));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { cancelledAt: "yesterday" }));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { cancelledBy: "" }));
    await assertFails(updateDoc(doc(as(stranger), paths.segment(trip.id, segment.id)), cancelled));
  });

  it("lets an editor mark a booking cancelled by hand, and take it back", async () => {
    const ref = (who: typeof owner) => doc(as(who), paths.segment(trip.id, segment.id));
    await assertFails(updateDoc(ref(partner), { userCancelled: "booking" }));
    await assertFails(updateDoc(ref(partner), { cancelledAt: "2026-11-24T10:00:00Z", userCancelled: "maybe" }));
    await assertSucceeds(updateDoc(ref(partner), { cancelledAt: "2026-11-24T10:00:00Z", userCancelled: "booking" }));
    await assertFails(updateDoc(ref(stranger), { cancelledAt: deleteField(), userCancelled: deleteField() }));
    await assertSucceeds(updateDoc(ref(partner), { cancelledAt: deleteField(), userCancelled: deleteField() }));
    await assertSucceeds(updateDoc(ref(owner), { cancelledAt: "2026-11-24T10:00:00Z", userCancelled: "trip" }));
  });

  it("lets an editor rate a booking one to five stars and mark it a favorite, and nothing else", async () => {
    await assertSucceeds(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { rating: 4, favorite: true }));
    await assertSucceeds(updateDoc(doc(as(partner), paths.segment(trip.id, segment.id)), { rating: 1, favorite: false }));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { rating: 6 }));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { rating: 0 }));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { rating: 3.5 }));
    await assertFails(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { favorite: "yes" }));
    await assertFails(updateDoc(doc(as(stranger), paths.segment(trip.id, segment.id)), { rating: 5 }));
  });

  it("refuses a change to a booking's details that does not record when it was edited", async () => {
    const at = doc(as(owner), paths.segment(trip.id, segment.id));
    await assertFails(updateDoc(at, { title: "Quietly renamed" }));
    await assertFails(updateDoc(at, { start: "2026-12-12T16:00:00+00:00", updatedAt: "2026-11-24T00:00:00Z" }));
    await assertFails(updateDoc(at, { title: "Renamed", editedAt: "yesterday" }));
    await assertSucceeds(updateDoc(at, { start: "2026-12-12T16:00:00+00:00", editedAt: "2026-11-24T00:02:00Z", updatedAt: "2026-11-24T00:02:00Z" }));
    // A rating, a favorite mark or a restore is no edit of its details.
    await assertSucceeds(updateDoc(at, { rating: 3, favorite: true, updatedAt: "2026-11-24T00:03:00Z" }));
    await assertSucceeds(updateDoc(at, { restoredAt: "2026-11-24T00:04:00Z" }));
  });

  it("rejects malformed segments", async () => {
    const at = (id: string) => doc(as(owner), paths.segment(trip.id, id));
    await assertFails(setDoc(at("bad1"), { ...segment, id: "bad1", type: "spaceship" }));
    await assertFails(setDoc(at("bad2"), { ...segment, id: "other" }));
    await assertFails(setDoc(at("bad3"), { ...segment, id: "bad3", tripId: "t9" }));
    await assertFails(setDoc(at("bad4"), { ...segment, id: "bad4", start: "tomorrow" }));
    await assertFails(setDoc(at("bad5"), { ...segment, id: "bad5", extra: 1 }));
    await assertFails(setDoc(at("bad6"), { ...segment, id: "bad6", title: "" }));
  });
});

describe("people", () => {
  const sam = { id: "p1", name: "Sam Example", aliases: ["S Example"], bookings: 3, direct: 2, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.person(owner.uid, sam.id)), sam);
    });
  });

  it("are the owner's alone to read", async () => {
    await assertSucceeds(getDoc(doc(as(owner), paths.person(owner.uid, sam.id))));
    await assertFails(getDoc(doc(as(partner), paths.person(owner.uid, sam.id))));
  });

  it("let the owner rename one and say it is them, and nothing else", async () => {
    const ref = doc(as(owner), paths.person(owner.uid, sam.id));
    await assertSucceeds(updateDoc(ref, { name: "Samuel Example", me: true, updatedAt: "2026-11-02T00:00:00Z" }));
    await assertFails(updateDoc(ref, { bookings: 99 }));
    await assertFails(updateDoc(ref, { name: "" }));
    await assertFails(updateDoc(ref, { me: "yes" }));
    await assertFails(setDoc(doc(as(owner), paths.person(owner.uid, "p2")), { ...sam, id: "p2" }));
    await assertFails(updateDoc(doc(as(partner), paths.person(owner.uid, sam.id)), { me: true }));
  });
});

describe("users", () => {
  it("a user reads and edits their own profile but not the gmail connection", async () => {
    await assertSucceeds(getDoc(doc(as(owner), paths.user(owner.uid))));
    await assertFails(getDoc(doc(as(stranger), paths.user(owner.uid))));
    await assertSucceeds(setDoc(doc(as(owner), paths.user(owner.uid)), { displayName: "Owner" }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { gmail: { emailAddress: "forged@example.com" } }, { merge: true }));
    await assertFails(setDoc(doc(as(stranger), paths.user(stranger.uid)), { gmail: { emailAddress: "forged@example.com" } }));
    // Nor any of several mailboxes.
    const forged = { "forged@example.com": { emailAddress: "forged@example.com", connectedAt: "2026-11-01T00:00:00Z" } };
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { gmails: forged }, { merge: true }));
    await assertFails(setDoc(doc(as(stranger), paths.user(stranger.uid)), { gmails: forged }));
    // Nor a refresh's progress: the parser runs those.
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { refresh: { scanned: 1, imported: 0, done: true, updatedAt: "2026-11-24T00:00:00Z" } }, { merge: true }));
    // Nor a forwarding address: the parser issues those.
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { forward: { address: "abcdefghijklmnopqrst@travelmo.app", createdAt: "2026-11-08T00:00:00Z" } }, { merge: true }));
  });

  it("a user keeps their own corrections to where home was, and nobody else sees them", async () => {
    const homes = [{ city: "London", country: "GB", from: "2021-03-12" }];
    await assertSucceeds(setDoc(doc(as(owner), paths.user(owner.uid)), { homes }, { merge: true }));
    await assertSucceeds(updateDoc(doc(as(owner), paths.user(owner.uid)), { homes: [] }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { homes: "London" }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { homes: Array.from({ length: 51 }, () => homes[0]) }, { merge: true }));
    const homeAirports = [{ city: "Mountain View", country: "US", airports: ["SFO", "SJC"] }];
    await assertSucceeds(setDoc(doc(as(owner), paths.user(owner.uid)), { homeAirports }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { homeAirports: "SFO" }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { homeAirports: Array.from({ length: 51 }, () => homeAirports[0]) }, { merge: true }));
    await assertFails(setDoc(doc(as(partner), paths.user(owner.uid)), { homes }, { merge: true }));
    await assertFails(getDoc(doc(as(partner), paths.user(owner.uid))));
  });

  it("a user keeps their own ride companies and hidden ride suggestions, and nobody else sees them", async () => {
    const rideCompanies = [{ name: "Example Cars", url: "https://cars.example.com/", near: "home" }];
    await assertSucceeds(setDoc(doc(as(owner), paths.user(owner.uid)), { rideCompanies, hiddenRideNeeds: ["s1/car"] }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { rideCompanies: "Example Cars" }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { rideCompanies: Array.from({ length: 21 }, () => rideCompanies[0]) }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { hiddenRideNeeds: Array.from({ length: 201 }, (_, i) => `s${i}/car`) }, { merge: true }));
    await assertFails(setDoc(doc(as(partner), paths.user(owner.uid)), { rideCompanies }, { merge: true }));
  });

  it("nobody reads or writes the sender counts but the server", async () => {
    await assertFails(getDoc(doc(as(owner), paths.senderStats("cove.example"))));
    await assertFails(setDoc(doc(as(owner), paths.senderStats("cove.example")), { read: 1 }));
  });

  it("a user keeps the trips they said go one way, at most two hundred, and nobody else writes them", async () => {
    await assertSucceeds(setDoc(doc(as(owner), paths.user(owner.uid)), { oneWayTrips: ["t1"] }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { oneWayTrips: "t1" }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { oneWayTrips: Array.from({ length: 201 }, (_, i) => `t${i}`) }, { merge: true }));
    await assertFails(setDoc(doc(as(partner), paths.user(owner.uid)), { oneWayTrips: ["t1"] }, { merge: true }));
  });

  it("a user keeps their own reminders before international trips, at most twenty, each checked, and nobody else sees them", async () => {
    const at = "2026-11-07T00:00:00Z";
    const visa = { id: "r1", text: "Apply for a visa", amount: 30, unit: "days", createdAt: at };
    const ref = (slot: string, user = owner) => doc(as(user), paths.tripReminder(owner.uid, slot));
    await assertSucceeds(setDoc(ref("s0"), visa));
    await assertSucceeds(setDoc(ref("s19"), { ...visa, id: "r2", text: "Request prescriptions", amount: 2, unit: "weeks" }));
    await assertSucceeds(setDoc(ref("s1"), { ...visa, amount: 12, unit: "months" }));
    await assertSucceeds(getDoc(ref("s0")));
    await assertSucceeds(getDocs(collection(as(owner), paths.tripReminders(owner.uid))));
    // Twenty slots, no more.
    await assertFails(setDoc(ref("s20"), visa));
    await assertFails(setDoc(ref("r1"), visa));
    await assertFails(setDoc(ref("s2"), { ...visa, text: "" }));
    await assertFails(setDoc(ref("s2"), { ...visa, text: "x".repeat(201) }));
    await assertFails(setDoc(ref("s2"), { ...visa, amount: 13, unit: "months" }));
    await assertFails(setDoc(ref("s2"), { ...visa, amount: 366 }));
    await assertFails(setDoc(ref("s2"), { ...visa, amount: 1.5 }));
    await assertFails(setDoc(ref("s2"), { ...visa, amount: -1 }));
    await assertFails(setDoc(ref("s2"), { ...visa, unit: "years" }));
    await assertFails(setDoc(ref("s2"), { ...visa, id: "a/b" }));
    await assertFails(setDoc(ref("s2"), { ...visa, id: 7 }));
    await assertFails(setDoc(ref("s2"), { ...visa, extra: 1 }));
    const { amount: _a, unit: _u, ...bare } = visa;
    await assertFails(setDoc(ref("s2"), bare));
    // A date is for a one-off on one trip only.
    await assertFails(setDoc(ref("s2"), { ...bare, date: "2026-12-01" }));
    await assertFails(getDoc(ref("s0", partner)));
    await assertFails(setDoc(ref("s3", partner), visa));
    await assertSucceeds(deleteDoc(ref("s0")));
  });

  it("a user ticks off and adds reminders to a trip for themselves alone, shared trip or not", async () => {
    const at = "2026-11-07T00:00:00Z";
    const ref = (user: { uid: string; email: string }, uid = owner.uid) => doc(as(user), paths.tripChecklist(uid, trip.id));
    await assertSucceeds(setDoc(ref(owner), { done: ["r1"], updatedAt: at }));
    await assertSucceeds(getDoc(ref(owner)));
    // The trip's sharee keeps their own, under their own account.
    await assertSucceeds(setDoc(ref(partner, partner.uid), { done: ["r1"], updatedAt: at }));
    await assertFails(getDoc(ref(partner)));
    await assertFails(setDoc(ref(partner), { done: [], updatedAt: at }));
    await assertFails(setDoc(ref(owner), { done: Array.from({ length: 41 }, (_, i) => `r${i}`), updatedAt: at }));
    await assertFails(setDoc(ref(owner), { done: "r1", updatedAt: at }));
    await assertFails(setDoc(ref(owner), { done: [], updatedAt: at, extra: 1 }));
    await assertFails(setDoc(ref(owner), { done: [] }));

    const added = (slot: string, user = owner) => doc(as(user), paths.tripChecklistAddedSlot(owner.uid, trip.id, slot));
    const adapter = { id: "x1", text: "Pack the adapter", date: "2026-12-10", createdAt: at };
    await assertSucceeds(setDoc(added("a0"), adapter));
    await assertSucceeds(setDoc(added("a9"), { id: "x2", text: "Print tickets", amount: 3, unit: "days", createdAt: at }));
    await assertSucceeds(getDocs(collection(as(owner), paths.tripChecklistAdded(owner.uid, trip.id))));
    // Ten slots, no more.
    await assertFails(setDoc(added("a10"), adapter));
    await assertFails(setDoc(added("a1"), { ...adapter, date: "soon" }));
    await assertFails(setDoc(added("a1"), { ...adapter, amount: 3, unit: "days" }));
    await assertFails(setDoc(added("a1"), { id: "x3", text: "Pack", createdAt: at }));
    await assertFails(getDoc(added("a0", partner)));
    await assertFails(setDoc(added("a1", partner), adapter));
    await assertSucceeds(deleteDoc(added("a0")));
    await assertSucceeds(deleteDoc(ref(owner)));
  });

  it("a user marks the flights they checked in for themselves alone, shared trip or not", async () => {
    const at = "2026-11-07T00:00:00Z";
    const ref = (user: { uid: string; email: string }, uid = owner.uid) => doc(as(user), paths.checkedIn(uid, trip.id));
    await assertSucceeds(setDoc(ref(owner), { segmentIds: ["f1"], updatedAt: at }));
    await assertSucceeds(getDoc(ref(owner)));
    // The trip's sharee keeps their own mark, under their own account, and
    // neither reads nor writes the owner's.
    await assertSucceeds(setDoc(ref(partner, partner.uid), { segmentIds: ["f1"], updatedAt: at }));
    await assertFails(getDoc(ref(partner)));
    await assertFails(setDoc(ref(partner), { segmentIds: [], updatedAt: at }));
    await assertFails(setDoc(ref(owner), { segmentIds: Array.from({ length: 101 }, (_, i) => `f${i}`), updatedAt: at }));
    await assertFails(setDoc(ref(owner), { segmentIds: "f1", updatedAt: at }));
    await assertFails(setDoc(ref(owner), { segmentIds: [], updatedAt: at, extra: 1 }));
    await assertFails(setDoc(ref(owner), { segmentIds: [] }));
    await assertSucceeds(deleteDoc(ref(owner)));
  });

  it("nobody reads or writes whether a reminder before a trip was sent", async () => {
    const id = `${owner.uid}__${trip.id}__r1`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.checklistReminder(id)), { id, uid: owner.uid, done: true });
    });
    await assertFails(getDoc(doc(as(owner), paths.checklistReminder(id))));
    await assertFails(getDocs(collection(as(owner), paths.checklistReminders())));
    await assertFails(setDoc(doc(as(owner), paths.checklistReminder(id)), { id, done: false }));
    await assertFails(deleteDoc(doc(as(owner), paths.checklistReminder(id))));
  });

  it("a user may turn reminders on, but not read or write what was mailed", async () => {
    await assertSucceeds(setDoc(doc(as(owner), paths.user(owner.uid)), { reminders: { email: true } }, { merge: true }));
    await assertFails(getDoc(doc(as(owner), paths.reminderLog(owner.uid, "t1"))));
    await assertFails(setDoc(doc(as(owner), paths.reminderLog(owner.uid, "t1")), { sent: [], at: "2026-11-07T00:00:00Z" }));
  });

  it("a user keeps their own browsers' push subscriptions, whole, and nobody else's", async () => {
    const subscription = { endpoint: "https://push.example/s/1", keys: { p256dh: "p", auth: "a" }, createdAt: "2026-11-07T00:00:00Z" };
    const ref = doc(as(owner), paths.pushSubscription(owner.uid, "s1"));
    await assertSucceeds(setDoc(ref, subscription));
    await assertSucceeds(getDoc(ref));
    await assertFails(setDoc(doc(as(owner), paths.pushSubscription(owner.uid, "s2")), { ...subscription, endpoint: "http://push.example/s/2" }));
    await assertFails(setDoc(doc(as(owner), paths.pushSubscription(owner.uid, "s3")), { ...subscription, keys: { p256dh: "p" } }));
    await assertFails(setDoc(doc(as(owner), paths.pushSubscription(owner.uid, "s4")), { ...subscription, extra: 1 }));
    await assertFails(getDoc(doc(as(partner), paths.pushSubscription(owner.uid, "s1"))));
    await assertFails(setDoc(doc(as(partner), paths.pushSubscription(owner.uid, "s5")), subscription));
    await assertSucceeds(deleteDoc(ref));
  });

  it("a user keeps their own phones' device registrations, whole, and nobody else's", async () => {
    const device = { token: "fcm-token-1", platform: "android", createdAt: "2026-11-07T00:00:00Z" };
    const ref = doc(as(owner), paths.device(owner.uid, "d1"));
    await assertSucceeds(setDoc(ref, device));
    await assertSucceeds(getDoc(ref));
    await assertFails(setDoc(doc(as(owner), paths.device(owner.uid, "d2")), { ...device, token: "" }));
    await assertFails(setDoc(doc(as(owner), paths.device(owner.uid, "d3")), { ...device, platform: "ios" }));
    await assertFails(setDoc(doc(as(owner), paths.device(owner.uid, "d4")), { ...device, extra: 1 }));
    await assertFails(getDoc(doc(as(partner), paths.device(owner.uid, "d1"))));
    await assertFails(setDoc(doc(as(partner), paths.device(owner.uid, "d5")), device));
    await assertSucceeds(deleteDoc(ref));
  });

  it("a user may not forge a Google Calendar connection or read its token", async () => {
    const forged = { emailAddress: "forged@example.com", connectedAt: "2026-11-01T00:00:00Z", calendars: [] };
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { googleCalendar: forged }, { merge: true }));
    await assertFails(setDoc(doc(as(stranger), paths.user(stranger.uid)), { googleCalendar: forged }));
    await assertFails(getDoc(doc(as(owner), paths.googleCalendarState(owner.uid))));
  });

  it("a user may not forge a Fastmail connection or read its token", async () => {
    const forged = { emailAddress: "forged@fastmail.com", connectedAt: "2026-11-01T00:00:00Z" };
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { fastmail: forged }, { merge: true }));
    await assertFails(setDoc(doc(as(stranger), paths.user(stranger.uid)), { fastmail: forged }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.fastmailState(owner.uid)), { ...forged, token: "fmu1-secret", accountId: "u1" });
    });
    await assertFails(getDoc(doc(as(owner), paths.fastmailState(owner.uid))));
  });

  it("a user may not forge an IMAP connection or read its password", async () => {
    const forged = { emailAddress: "forged@icloud.com", connectedAt: "2026-11-01T00:00:00Z" };
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { imaps: { "forged@icloud.com": forged } }, { merge: true }));
    await assertFails(setDoc(doc(as(stranger), paths.user(stranger.uid)), { imaps: { "forged@icloud.com": forged } }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.imapMailbox(owner.uid, "k1")), { ...forged, password: "kms1:secret", host: "imap.mail.me.com", port: 993 });
    });
    await assertFails(getDoc(doc(as(owner), paths.imapMailbox(owner.uid, "k1"))));
  });

  it("calendar feeds are readable by their owner only and written by the parser alone", async () => {
    const feed = { id: "f1", url: "https://www.example.com/feed/secret.ics", addedAt: "2026-11-01T00:00:00Z" };
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.feed(owner.uid, "f1")), feed);
    });
    await assertSucceeds(getDoc(doc(as(owner), paths.feed(owner.uid, "f1"))));
    await assertFails(getDoc(doc(as(stranger), paths.feed(owner.uid, "f1"))));
    await assertFails(getDoc(doc(as(partner), paths.feed(owner.uid, "f1"))));
    await assertFails(setDoc(doc(as(owner), paths.feed(owner.uid, "f2")), { ...feed, id: "f2", url: "https://169.254.169.254/" }));
  });

  it("the calendar export link is readable by its owner only, and its lookup by nobody", async () => {
    const record = { token: "t".repeat(32), createdAt: "2026-11-01T00:00:00Z" };
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.calendarExport(owner.uid)), record);
      await setDoc(doc(ctx.firestore(), paths.calendarExportToken("h1")), { uid: owner.uid });
    });
    await assertSucceeds(getDoc(doc(as(owner), paths.calendarExport(owner.uid))));
    await assertFails(getDoc(doc(as(partner), paths.calendarExport(owner.uid))));
    await assertFails(setDoc(doc(as(owner), paths.calendarExport(owner.uid)), { ...record, token: "x".repeat(32) }));
    await assertFails(getDoc(doc(as(owner), paths.calendarExportToken("h1"))));
    await assertFails(setDoc(doc(as(owner), paths.calendarExportToken("h2")), { uid: owner.uid }));
  });

  it("sender patterns are the user's; parsed messages read-only; private is sealed", async () => {
    await assertSucceeds(setDoc(doc(as(owner), paths.senderPatterns(owner.uid)), { allow: ["cove.example"], deny: [] }));
    await assertFails(setDoc(doc(as(stranger), paths.senderPatterns(owner.uid)), { allow: [], deny: [] }));
    await assertFails(setDoc(doc(as(owner), paths.parsedMessage(owner.uid, "m1")), { outcome: "imported" }));
    await assertSucceeds(getDoc(doc(as(owner), paths.parsedMessage(owner.uid, "m1"))));
    await assertFails(getDoc(doc(as(owner), paths.gmailState(owner.uid))));
    await assertFails(getDoc(doc(as(owner), paths.gmailMailbox(owner.uid, "k1"))));
    await assertFails(setDoc(doc(as(owner), paths.gmailMailbox(owner.uid, "k1")), { emailAddress: "forged@example.com", refreshToken: "x" }));
    await assertFails(getDoc(doc(as(owner), paths.gmailIds(owner.uid))));
    await assertFails(setDoc(doc(as(owner), paths.emailLinks(owner.uid)), { mailboxes: ["forged@example.com"] }, { merge: true }));
  });
});

describe("server-only collections", () => {
  it("are unreadable and unwritable by clients", async () => {
    await assertFails(getDoc(doc(as(owner), paths.gmailAccount(owner.email))));
    await assertFails(getDoc(doc(as(owner), paths.forwardAddress("h1"))));
    await assertFails(setDoc(doc(as(owner), paths.forwardAddress("h2")), { uid: owner.uid }));
    await assertFails(getDoc(doc(as(owner), paths.forwardBudget(owner.uid))));
    await assertFails(setDoc(doc(as(owner), paths.oauthState("nonce")), { uid: owner.uid }));
    await assertFails(getDoc(doc(as(owner), paths.pendingConnection("token"))));
    await assertFails(getDoc(doc(as(owner), paths.geocode("abc"))));
    await assertFails(setDoc(doc(as(owner), paths.geocode("abc")), { query: "x", status: "ok", country: "FR", at: "2026-11-07T00:00:00Z" }));
    await assertFails(setDoc(doc(as(owner), paths.geocodeBudget("2026-11-07")), { calls: 0 }));
    await assertFails(getDoc(doc(as(owner), paths.geocodeRetry("t1", "s1"))));
    await assertFails(setDoc(doc(as(owner), paths.geocodeRetry("t1", "s1")), { uid: owner.uid, tripId: "t1", segmentId: "s1", at: "2026-11-07T00:00:00Z" }));
    await assertFails(getDoc(doc(as(owner), paths.geocodeBackfill())));
    await assertFails(setDoc(doc(as(owner), paths.geocodeBackfill()), { cursor: "done" }));
    await assertFails(getDoc(doc(as(owner), paths.deletedAccount(owner.uid))));
    await assertFails(setDoc(doc(as(owner), paths.deletedAccount(owner.uid)), { uid: owner.uid }));
  });

  it("keep bug reports and their daily count from every client, the reporter's own included", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.bugReport("r1")), { id: "r1", uid: owner.uid, at: "2026-11-24T10:00:00Z", app: "web", text: "Hi", logChars: 0, hasScreenshot: false });
      await setDoc(doc(ctx.firestore(), paths.bugReportBudget(owner.uid)), { day: "2026-11-24", count: 1 });
    });
    await assertFails(getDoc(doc(as(owner), paths.bugReport("r1"))));
    await assertFails(getDocs(collection(as(owner), paths.bugReports())));
    await assertFails(setDoc(doc(as(owner), paths.bugReport("r2")), { id: "r2", uid: owner.uid }));
    await assertFails(updateDoc(doc(as(owner), paths.bugReport("r1")), { text: "Changed" }));
    await assertFails(deleteDoc(doc(as(owner), paths.bugReport("r1"))));
    await assertFails(getDoc(doc(as(owner), paths.bugReportBudget(owner.uid))));
    await assertFails(setDoc(doc(as(owner), paths.bugReportBudget(owner.uid)), { day: "2026-11-24", count: 0 }));
  });
});

describe("flight status", () => {
  const key = "XX100_2026-12-13_SYD";
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.flightStatus(key)), { ident: "XX100", date: "2026-12-13", found: true, departureGate: "8", checkedAt: "2026-12-12T21:00:00Z" });
    });
  });

  it("is readable by any signed-in client that names the flight", async () => {
    await assertSucceeds(getDoc(doc(as(stranger), paths.flightStatus(key))));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), paths.flightStatus(key))));
  });

  it("is never listed or written by a client, nor is its budget read", async () => {
    await assertFails(getDocs(collection(as(owner), "flightStatus")));
    await assertFails(setDoc(doc(as(owner), paths.flightStatus(key)), { ident: "XX100", date: "2026-12-13", found: true, checkedAt: "2026-12-12T21:00:00Z" }));
    await assertFails(updateDoc(doc(as(owner), paths.flightStatus(key)), { departureGate: "9" }));
    await assertFails(deleteDoc(doc(as(owner), paths.flightStatus(key))));
    await assertFails(getDoc(doc(as(owner), paths.flightStatusBudget("2026-12-12"))));
    await assertFails(setDoc(doc(as(owner), paths.flightStatusBudget("2026-12-12")), { calls: 0 }));
    await assertFails(getDoc(doc(as(owner), paths.flightStatusClaim(key))));
    await assertFails(getDoc(doc(as(owner), paths.flightStatusNewsEntry(`${key}__${owner.uid}`))));
    await assertFails(setDoc(doc(as(owner), paths.flightStatusClaim(key)), { until: "2026-12-12T21:00:30Z" }));
  });

  it("keeps who was reminded of check-in from every client", async () => {
    const id = "trip1__flight1";
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.checkInReminder(id)), { id, sent: [owner.uid], done: true });
    });
    await assertFails(getDoc(doc(as(owner), paths.checkInReminder(id))));
    await assertFails(getDocs(collection(as(owner), paths.checkInReminders())));
    await assertFails(setDoc(doc(as(owner), paths.checkInReminder(id)), { id, sent: [], done: false }));
    await assertFails(deleteDoc(doc(as(owner), paths.checkInReminder(id))));
  });
});

describe("a deleted account", () => {
  // Its sign-in token is still good for up to an hour after deletion.
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.deletedAccount(owner.uid)), { uid: owner.uid, at: "2026-11-22T00:00:00Z" });
    });
  });

  it("can create or change nothing, while everyone else carries on", async () => {
    await assertFails(setDoc(doc(as(owner), paths.trip("t2")), { ...trip, id: "t2" }));
    await assertFails(updateDoc(doc(as(owner), paths.trip(trip.id)), { title: "Renamed", updatedAt: "2026-11-23T00:00:00Z" }));
    await assertFails(setDoc(doc(as(owner), paths.segment(trip.id, "s2")), { ...segment, id: "s2" }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { email: owner.email }));
    await assertFails(setDoc(doc(as(owner), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, ownerEmail: owner.email, trustedEmails: [] }));
    await assertFails(setDoc(doc(as(owner), paths.tripReminder(owner.uid, "s0")), { id: "r1", text: "Apply for a visa", amount: 30, unit: "days", createdAt: "2026-11-23T00:00:00Z" }));
    await assertFails(setDoc(doc(as(owner), paths.tripChecklist(owner.uid, trip.id)), { done: ["r1"], updatedAt: "2026-11-23T00:00:00Z" }));
    await assertFails(setDoc(doc(as(owner), paths.checkedIn(owner.uid, trip.id)), { segmentIds: ["f1"], updatedAt: "2026-11-23T00:00:00Z" }));
    // The partner the trip is shared with is not deleted and still edits it.
    await assertSucceeds(setDoc(doc(as(partner), paths.segment(trip.id, "s3")), { ...segment, id: "s3" }));
  });

  it("can still delete, which only removes data", async () => {
    await assertSucceeds(deleteDoc(doc(as(owner), paths.segment(trip.id, segment.id))));
  });
});

describe("travel profiles", () => {
  const passport = { title: "Passport", fields: [{ label: "Number", value: "X1234567" }] };
  const seed = async (trustedEmails: string[]) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, ownerEmail: owner.email, trustedEmails, documents: [passport] });
    });
  };
  const collectionGroupOf = (db: ReturnType<typeof as>, email: string) =>
    query(collectionGroup(db, "travelProfile"), where("trustedEmails", "array-contains", email));

  it("is readable by its owner and the people they trust, by verified email, and nobody else", async () => {
    await seed([partner.email]);
    await assertSucceeds(getDoc(doc(as(owner), paths.travelProfile(owner.uid))));
    await assertSucceeds(getDoc(doc(as(partner), paths.travelProfile(owner.uid))));
    await assertFails(getDoc(doc(as(partner, false), paths.travelProfile(owner.uid))));
    await assertFails(getDoc(doc(as(stranger), paths.travelProfile(owner.uid))));
    await assertSucceeds(getDocs(collectionGroupOf(as(partner), partner.email)));
    await assertFails(getDocs(collectionGroupOf(as(stranger), partner.email)));
    // An address signed in with capitals still finds what was shared with it.
    const mixed = { uid: partner.uid, email: "Partner@Example.com" };
    await assertSucceeds(getDocs(collectionGroupOf(as(mixed), partner.email)));
    await assertSucceeds(getDoc(doc(as(mixed), paths.travelProfile(owner.uid))));
  });

  it("lets the owner choose who to trust, and nobody write the imported details", async () => {
    // Before any import, the owner can already start a profile to share.
    await assertSucceeds(setDoc(doc(as(owner), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, ownerEmail: owner.email, trustedEmails: [partner.email] }));
    await assertFails(setDoc(doc(as(owner), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, trustedEmails: [], documents: [passport] }));
    await seed([]);
    await assertSucceeds(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { trustedEmails: [partner.email], updatedAt: "2026-11-03T00:00:00Z" }));
    await assertFails(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { documents: [] }));
    await assertFails(updateDoc(doc(as(partner), paths.travelProfile(owner.uid)), { trustedEmails: [stranger.email] }));
    await assertFails(setDoc(doc(as(stranger), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, trustedEmails: [stranger.email] }));
    await assertFails(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { trustedEmails: Array.from({ length: 21 }, (_, i) => `p${i}@example.com`) }));
  });

  it("lets the owner remove loyalty numbers found in emails, and nobody else touch them", async () => {
    const found = { program: "Example Air Club", number: "EA123", messageId: "m1", at: "2026-11-01T00:00:00Z" };
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, trustedEmails: [partner.email], foundLoyalty: [found, { ...found, number: "EA456" }] });
    });
    await assertSucceeds(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { foundLoyalty: [found], updatedAt: "2026-11-03T00:00:00Z" }));
    await assertFails(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { foundLoyalty: "EA123" }));
    // More than the fifty once kept, up to the bound (maxFoundLoyalty).
    await assertSucceeds(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { foundLoyalty: Array.from({ length: 51 }, () => found) }));
    await assertFails(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { foundLoyalty: Array.from({ length: maxFoundLoyalty + 1 }, () => found) }));
    await assertFails(updateDoc(doc(as(partner), paths.travelProfile(owner.uid)), { foundLoyalty: [] }));
    // A profile an import started, with no sharing list yet.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, loyalty: [], foundLoyalty: [found] });
    });
    await assertSucceeds(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { foundLoyalty: [], updatedAt: "2026-11-03T00:00:00Z" }));
    await assertFails(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { trustedEmails: "everyone" }));
  });

  it("lets the owner alone say whose each membership is", async () => {
    const said = { program: "Example Air Club", number: "EA123", person: "Alex Sample" };
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, trustedEmails: [partner.email], loyalty: [] });
    });
    await assertSucceeds(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { loyaltyPeople: [said], updatedAt: "2026-11-03T00:00:00Z" }));
    await assertFails(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { loyaltyPeople: "Alex Sample" }));
    await assertFails(updateDoc(doc(as(owner), paths.travelProfile(owner.uid)), { loyaltyPeople: Array.from({ length: 101 }, () => said) }));
    await assertFails(updateDoc(doc(as(partner), paths.travelProfile(owner.uid)), { loyaltyPeople: [] }));
  });
});

describe("linked email addresses", () => {
  // Signs in with one address and has confirmed another.
  const worker = { uid: "worker", email: "worker@example.com" };
  const work = "worker@work.example";
  const mailbox = "worker.mail@example.net";
  // Two more connected since there could be several.
  const travel = "worker.travel@example.org";
  const family = "worker.family@example.org";
  const shared = (id: string, sharedWith: string[]): Trip => ({ ...trip, id, sharedWith });
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, paths.user(worker.uid)), {
        email: worker.email,
        emails: [work],
        pendingEmails: [{ email: "pending@work.example", sentAt: "2026-11-23T00:00:00Z", expiresAt: "2026-11-24T00:00:00Z" }],
        gmail: { emailAddress: "Worker.Mail@example.net", connectedAt: "2026-11-01T00:00:00Z" },
      });
      await setDoc(doc(db, paths.trip("work")), shared("work", [work]));
      await setDoc(doc(db, paths.segment("work", segment.id)), { ...segment, tripId: "work" });
      await setDoc(doc(db, paths.trip("mailbox")), shared("mailbox", [mailbox]));
      await setDoc(doc(db, paths.trip("travel")), shared("travel", [travel]));
      await setDoc(doc(db, paths.trip("family")), shared("family", [family]));
      await setDoc(doc(db, paths.trip("pending")), shared("pending", ["pending@work.example"]));
      await setDoc(doc(db, paths.trip("signin")), shared("signin", [worker.email]));
      await setDoc(doc(db, paths.linkedEmail(work)), { uid: worker.uid, linkedAt: "2026-11-23T00:00:00Z" });
      await setDoc(doc(db, paths.emailLinks(worker.uid)), { pending: [], confirmed: [work], mailboxes: [travel, family] });
    });
  });

  it("trusts only the parser's own list, not one a client wrote on its profile before the rules locked it", async () => {
    const planter = { uid: "planter", email: "planter@example.com" };
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.user(planter.uid)), { email: planter.email, emails: [work, admin.email] });
      await setDoc(doc(ctx.firestore(), paths.accessConfig()), { admins: [admin.email] });
    });
    await assertFails(getDoc(doc(as(planter), paths.trip("work"))));
    await assertFails(getDoc(doc(as(planter), paths.accessConfig())));
    // Nor mailboxes written there.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.user(planter.uid)), { gmails: { [travel]: { emailAddress: travel, connectedAt: "2026-11-01T00:00:00Z" } } }, { merge: true });
    });
    await assertFails(getDoc(doc(as(planter), paths.trip("travel"))));
  });

  it("lets every connected Gmail mailbox open what was shared with it, until it is disconnected", async () => {
    await assertSucceeds(getDoc(doc(as(worker), paths.trip("travel"))));
    await assertSucceeds(getDoc(doc(as(worker), paths.trip("family"))));
    const mine = [worker.email, work, mailbox, travel, family];
    const snap = await assertSucceeds(getDocs(query(collection(as(worker), paths.trips()), where("sharedWith", "array-contains-any", mine))));
    expect(snap.docs.map((d) => d.id).sort()).toEqual(["family", "mailbox", "signin", "travel", "work"]);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.emailLinks(worker.uid)), { pending: [], confirmed: [work], mailboxes: [travel] });
    });
    await assertSucceeds(getDoc(doc(as(worker), paths.trip("travel"))));
    await assertFails(getDoc(doc(as(worker), paths.trip("family"))));
  });

  it("lets a confirmed address or the connected Gmail open what was shared with it", async () => {
    await assertSucceeds(getDoc(doc(as(worker), paths.trip("work"))));
    await assertSucceeds(getDoc(doc(as(worker), paths.trip("mailbox"))));
    await assertSucceeds(getDoc(doc(as(worker), paths.trip("signin"))));
    await assertSucceeds(getDocs(collection(as(worker), paths.segments("work"))));
    await assertSucceeds(setDoc(doc(as(worker), paths.segment("work", "s2")), { ...segment, id: "s2", tripId: "work" }));
    // A sharee's widening of the dates, as for the sign-in address.
    await assertSucceeds(updateDoc(doc(as(worker), paths.trip("work")), { start: "2026-12-11", updatedAt: "2026-11-24T00:00:00Z" }));
    await assertFails(updateDoc(doc(as(worker), paths.trip("work")), { title: "Mine now" }));
  });

  it("lists the trips shared with any of the account's addresses in one query", async () => {
    const mine = [worker.email, work, mailbox];
    const snap = await assertSucceeds(getDocs(query(collection(as(worker), paths.trips()), where("sharedWith", "array-contains-any", mine))));
    expect(snap.docs.map((d) => d.id).sort()).toEqual(["mailbox", "signin", "work"]);
    // Not with an address that is someone else's.
    await assertFails(getDocs(query(collection(as(worker), paths.trips()), where("sharedWith", "array-contains-any", [...mine, partner.email]))));
  });

  it("does not count an address still waiting for confirmation, or another account's", async () => {
    await assertFails(getDoc(doc(as(worker), paths.trip("pending"))));
    await assertFails(getDoc(doc(as(stranger), paths.trip("work"))));
    await assertFails(getDocs(query(collection(as(stranger), paths.trips()), where("sharedWith", "array-contains-any", [stranger.email, work]))));
  });

  it("lets a trusted linked address read a travel profile and list it", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.travelProfile(owner.uid)), { ownerUid: owner.uid, ownerEmail: owner.email, trustedEmails: [work] });
    });
    await assertSucceeds(getDoc(doc(as(worker), paths.travelProfile(owner.uid))));
    await assertSucceeds(getDocs(query(collectionGroup(as(worker), "travelProfile"), where("trustedEmails", "array-contains-any", [worker.email, work]))));
    await assertFails(getDoc(doc(as(stranger), paths.travelProfile(owner.uid))));
  });

  it("makes an account an admin when a linked address is listed", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), paths.accessConfig()), { admins: [work] });
    });
    await assertSucceeds(getDoc(doc(as(worker), paths.accessConfig())));
    await assertSucceeds(getDocs(collection(as(worker), paths.accessRecords())));
    await assertFails(getDoc(doc(as(owner), paths.accessConfig())));
  });

  it("lets no client write the list, the pending links or the claims", async () => {
    const own = doc(as(worker), paths.user(worker.uid));
    await assertSucceeds(getDoc(own));
    await assertFails(updateDoc(own, { emails: [work, partner.email] }));
    await assertFails(updateDoc(own, { pendingEmails: [] }));
    await assertFails(setDoc(doc(as(stranger), paths.user(stranger.uid)), { emails: [partner.email] }, { merge: true }));
    await assertFails(setDoc(doc(as(newcomer), paths.user(newcomer.uid)), { emails: [partner.email] }));
    await assertFails(getDoc(doc(as(worker), paths.linkedEmail(work))));
    await assertFails(setDoc(doc(as(stranger), paths.linkedEmail(partner.email)), { uid: stranger.uid }));
    await assertFails(deleteDoc(doc(as(worker), paths.linkedEmail(work))));
    await assertFails(getDoc(doc(as(worker), paths.emailLinks(worker.uid))));
    await assertFails(setDoc(doc(as(worker), paths.emailLinks(worker.uid)), { pending: [] }));
  });
});

describe("access", () => {
  const at = "2026-11-23T00:00:00Z";
  const request = { email: newcomer.email, status: "approved", uid: newcomer.uid, approvedBy: newcomer.uid, approvedAt: at };
  const record = (email: string) => paths.access(email);
  const seedRecord = async (email: string, data: Record<string, unknown>) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), record(email)), { email, ...data });
    });
  };
  const shareWithNewcomer = async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), paths.trip(trip.id)), { sharedWith: [partner.email, newcomer.email] });
    });
  };

  it("lets accounts from before approvals carry on, with no record", async () => {
    await assertSucceeds(getDoc(doc(as(partner), paths.trip(trip.id))));
    await assertSucceeds(setDoc(doc(as(partner), paths.segment(trip.id, "s2")), { ...segment, id: "s2" }));
    await assertSucceeds(setDoc(doc(as(stranger), paths.user(stranger.uid)), { displayName: "Stranger" }, { merge: true }));
  });

  it("keeps a new account out of everything until it is approved", async () => {
    await shareWithNewcomer();
    const db = as(newcomer);
    await assertFails(getDoc(doc(db, paths.trip(trip.id))));
    await assertFails(getDocs(query(collection(db, paths.trips()), where("sharedWith", "array-contains", newcomer.email))));
    await assertFails(getDoc(doc(db, paths.trip("nope"))));
    await assertFails(getDocs(collection(db, paths.segments(trip.id))));
    await assertFails(setDoc(doc(db, paths.trip("t2")), { ...trip, id: "t2", ownerUid: newcomer.uid, sharedWith: [] }));
    await assertFails(setDoc(doc(db, paths.user(newcomer.uid)), { email: newcomer.email }));
    await assertFails(setDoc(doc(db, paths.device(newcomer.uid, "d1")), { token: "t", platform: "android", createdAt: at }));
    await assertFails(getDocs(query(collectionGroup(db, "travelProfile"), where("trustedEmails", "array-contains", newcomer.email))));
    // Its own user document reads as missing, which is how the app tells it apart.
    const own = await assertSucceeds(getDoc(doc(db, paths.user(newcomer.uid))));
    expect(own.exists()).toBe(false);
  });

  it("lets nobody write their own access record: Travelmo is invite-only", async () => {
    const db = as(newcomer);
    await assertFails(setDoc(doc(db, record(newcomer.email)), request));
    await assertFails(setDoc(doc(db, record(newcomer.email)), { email: newcomer.email, uid: newcomer.uid }));
    // Nobody but admins reads anyone else's record or lists them.
    await assertFails(getDoc(doc(as(owner), record(newcomer.email))));
    await assertFails(getDocs(collection(as(owner), paths.accessRecords())));
    await assertFails(setDoc(doc(db, paths.user(newcomer.uid)), { email: newcomer.email }));
  });

  it("lets an admin approve an address, after which the account may use the app", async () => {
    await shareWithNewcomer();
    await seedRecord(newcomer.email, { uid: newcomer.uid });
    await assertSucceeds(getDocs(collection(as(admin), paths.accessRecords())));
    await assertFails(updateDoc(doc(as(admin), record(newcomer.email)), { status: "approved", approvedBy: owner.uid, approvedAt: at }));
    await assertSucceeds(updateDoc(doc(as(admin), record(newcomer.email)), { status: "approved", approvedBy: admin.uid, approvedAt: at }));
    await assertSucceeds(getDoc(doc(as(newcomer), paths.trip(trip.id))));
    await assertSucceeds(setDoc(doc(as(newcomer), paths.user(newcomer.uid)), { email: newcomer.email }));
  });

  it("lets an admin decline an address and invite another", async () => {
    await seedRecord(newcomer.email, { uid: newcomer.uid });
    await assertSucceeds(updateDoc(doc(as(admin), record(newcomer.email)), { status: "declined", declinedBy: admin.uid, declinedAt: at }));
    await assertFails(setDoc(doc(as(newcomer), paths.user(newcomer.uid)), { email: newcomer.email }));
    const invited = "invited@example.com";
    await assertFails(setDoc(doc(as(admin), record(invited)), { email: invited, status: "approved", approvedBy: admin.uid, approvedAt: at, uid: "someone" }));
    await assertSucceeds(setDoc(doc(as(admin), record(invited)), { email: invited, status: "approved", approvedBy: admin.uid, approvedAt: at }));
    await assertSucceeds(getDoc(doc(as({ uid: "invited", email: invited }), paths.trip("nope"))));
  });

  it("lets an admin revoke an account from before approvals, but never an admin", async () => {
    await assertSucceeds(setDoc(doc(as(admin), record(partner.email)), { email: partner.email, status: "declined", declinedBy: admin.uid, declinedAt: at }));
    await assertFails(getDoc(doc(as(partner), paths.trip(trip.id))));
    await assertFails(setDoc(doc(as(partner), paths.user(partner.uid)), { displayName: "Partner" }, { merge: true }));
    await assertFails(setDoc(doc(as(admin), record(admin.email)), { email: admin.email, status: "declined", declinedBy: admin.uid, declinedAt: at }));
    // Approving again lets them back in.
    await assertSucceeds(updateDoc(doc(as(admin), record(partner.email)), { status: "approved", approvedBy: admin.uid, approvedAt: at }));
    await assertSucceeds(getDoc(doc(as(partner), paths.trip(trip.id))));
  });

  it("lets nobody but an admin decide", async () => {
    await seedRecord(newcomer.email, { uid: newcomer.uid });
    await assertFails(updateDoc(doc(as(owner), record(newcomer.email)), { status: "approved", approvedBy: owner.uid, approvedAt: at }));
    await assertFails(setDoc(doc(as(owner), record(stranger.email)), { email: stranger.email, status: "declined", declinedBy: owner.uid, declinedAt: at }));
    await assertFails(deleteDoc(doc(as(admin), record(newcomer.email))));
  });

  it("lets an approved user invite an address by sharing a trip with it", async () => {
    const db = as(owner);
    const batch = writeBatch(db);
    batch.update(doc(db, paths.trip(trip.id)), { sharedWith: arrayUnion(newcomer.email), updatedAt: at });
    batch.set(doc(db, record(newcomer.email)), { email: newcomer.email, invitedBy: owner.uid, invitedAt: at }, { merge: true });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(as(newcomer), paths.trip(trip.id))));
    await assertSucceeds(setDoc(doc(as(newcomer), paths.user(newcomer.uid)), { email: newcomer.email }));
  });

  it("lets an invite approve an address, but not undo an admin's decline", async () => {
    await seedRecord(newcomer.email, { uid: newcomer.uid });
    const invite = { email: newcomer.email, invitedBy: partner.uid, invitedAt: at };
    await assertSucceeds(setDoc(doc(as(partner), record(newcomer.email)), invite, { merge: true }));
    await assertSucceeds(setDoc(doc(as(newcomer), paths.user(newcomer.uid)), { email: newcomer.email }));

    await seedRecord(stranger.email, { status: "declined", declinedBy: admin.uid, declinedAt: at });
    await assertSucceeds(setDoc(doc(as(partner), record(stranger.email)), { ...invite, email: stranger.email }, { merge: true }));
    await assertFails(getDoc(doc(as(stranger), paths.trip("nope"))));
  });

  it("lets nobody invite in someone else's name, nor an account still waiting", async () => {
    await assertFails(setDoc(doc(as(owner), record(newcomer.email)), { email: newcomer.email, invitedBy: partner.uid, invitedAt: at }, { merge: true }));
    await assertFails(
      setDoc(doc(as(owner), record(newcomer.email)), { email: newcomer.email, invitedBy: owner.uid, invitedAt: at, status: "approved" }, { merge: true }),
    );
    const other = "other@example.com";
    await assertFails(setDoc(doc(as(newcomer), record(other)), { email: other, invitedBy: newcomer.uid, invitedAt: at }, { merge: true }));
  });

  it("lets an account from before approvals record itself, and no one else approve themselves", async () => {
    const self = { email: partner.email, status: "approved", uid: partner.uid, approvedBy: partner.uid, approvedAt: at };
    await assertSucceeds(setDoc(doc(as(partner), record(partner.email)), self));
    await assertFails(
      setDoc(doc(as(newcomer), record(newcomer.email)), { ...self, email: newcomer.email, uid: newcomer.uid, approvedBy: newcomer.uid }),
    );
  });

  it("lets admins alone read the admins' list, and nobody write it", async () => {
    await assertSucceeds(getDoc(doc(as(admin), paths.accessConfig())));
    await assertFails(getDoc(doc(as(owner), paths.accessConfig())));
    await assertFails(getDoc(doc(as(newcomer), paths.accessConfig())));
    await assertFails(setDoc(doc(as(admin), paths.accessConfig()), { admins: [admin.email, owner.email] }));
    await assertFails(setDoc(doc(as(owner), paths.accessConfig()), { admins: [owner.email] }));
    await assertFails(setDoc(doc(as(owner), "config/other"), { x: 1 }));
    // The parser's own markers, such as how far stored loyalty numbers were revised.
    await assertFails(getDoc(doc(as(owner), paths.foundLoyaltyRevision())));
    await assertFails(setDoc(doc(as(owner), paths.foundLoyaltyRevision()), { revision: 99 }));
  });

  it("lets an admin with no user document use the app", async () => {
    await assertSucceeds(setDoc(doc(as(admin), paths.user(admin.uid)), { email: admin.email }));
  });
});
