import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { paths, type Segment, type Trip } from "@travelmo/core";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
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

  it("owner can share and update; sharee and stranger cannot", async () => {
    await assertSucceeds(updateDoc(doc(as(owner), paths.trip(trip.id)), { sharedWith: [partner.email, "x@example.com"], updatedAt: "2026-11-02T00:00:00Z" }));
    await assertFails(updateDoc(doc(as(partner), paths.trip(trip.id)), { title: "Mine now" }));
    await assertFails(updateDoc(doc(as(stranger), paths.trip(trip.id)), { title: "Mine now" }));
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
  it("follow the parent trip's access", async () => {
    await assertSucceeds(getDoc(doc(as(owner), paths.segment(trip.id, segment.id))));
    await assertSucceeds(getDocs(collection(as(partner), paths.segments(trip.id))));
    await assertFails(getDocs(collection(as(stranger), paths.segments(trip.id))));
    await assertSucceeds(updateDoc(doc(as(owner), paths.segment(trip.id, segment.id)), { title: "Renamed" }));
    await assertFails(updateDoc(doc(as(partner), paths.segment(trip.id, segment.id)), { title: "Renamed" }));
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
  });
});
