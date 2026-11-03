import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { paths, type Segment, type Trip } from "@travelmo/core";
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { readFileSync } from "node:fs";

let env: RulesTestEnvironment;

const owner = { uid: "owner", email: "owner@example.com" };
const partner = { uid: "partner", email: "partner@example.com" };
const stranger = { uid: "stranger", email: "stranger@example.com" };

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
    await assertSucceeds(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { title: "Renamed", sender: "cove.example" }));
    await assertSucceeds(updateDoc(doc(as(partner), paths.segment(trip.id, segment.id)), { title: "Renamed by partner" }));
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
    await assertSucceeds(updateDoc(doc(as(partner), paths.segment(trip.id, "s5")), { title: "Edited by partner" }));
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s7")), { ...imported, id: "s7", source: "ics" }));
    const withSources = { ...imported, id: "s8", sources: [{ kind: "gmail", id: "m1", label: "Your booking", at: "2026-11-01T00:00:00Z" }] };
    await assertSucceeds(setDoc(doc(as(owner), paths.segment(trip.id, "s8")), withSources));
    await assertSucceeds(updateDoc(doc(as(partner), paths.segment(trip.id, "s8")), { title: "Edited, sources kept" }));
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

describe("users", () => {
  it("a user reads and edits their own profile but not the gmail connection", async () => {
    await assertSucceeds(getDoc(doc(as(owner), paths.user(owner.uid))));
    await assertFails(getDoc(doc(as(stranger), paths.user(owner.uid))));
    await assertSucceeds(setDoc(doc(as(owner), paths.user(owner.uid)), { displayName: "Owner" }, { merge: true }));
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { gmail: { emailAddress: "forged@example.com" } }, { merge: true }));
    await assertFails(setDoc(doc(as(stranger), paths.user(stranger.uid)), { gmail: { emailAddress: "forged@example.com" } }));
  });

  it("a user may not forge a Google Calendar connection or read its token", async () => {
    const forged = { emailAddress: "forged@example.com", connectedAt: "2026-11-01T00:00:00Z", calendars: [] };
    await assertFails(setDoc(doc(as(owner), paths.user(owner.uid)), { googleCalendar: forged }, { merge: true }));
    await assertFails(setDoc(doc(as(stranger), paths.user(stranger.uid)), { googleCalendar: forged }));
    await assertFails(getDoc(doc(as(owner), paths.googleCalendarState(owner.uid))));
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

  it("sender patterns are the user's; parsed messages read-only; private is sealed", async () => {
    await assertSucceeds(setDoc(doc(as(owner), paths.senderPatterns(owner.uid)), { allow: ["cove.example"], deny: [] }));
    await assertFails(setDoc(doc(as(stranger), paths.senderPatterns(owner.uid)), { allow: [], deny: [] }));
    await assertFails(setDoc(doc(as(owner), paths.parsedMessage(owner.uid, "m1")), { outcome: "imported" }));
    await assertSucceeds(getDoc(doc(as(owner), paths.parsedMessage(owner.uid, "m1"))));
    await assertFails(getDoc(doc(as(owner), paths.gmailState(owner.uid))));
  });
});

describe("server-only collections", () => {
  it("are unreadable and unwritable by clients", async () => {
    await assertFails(getDoc(doc(as(owner), paths.gmailAccount(owner.email))));
    await assertFails(setDoc(doc(as(owner), paths.oauthState("nonce")), { uid: owner.uid }));
    await assertFails(getDoc(doc(as(owner), paths.pendingConnection("token"))));
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
});
