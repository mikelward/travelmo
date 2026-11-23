import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { paths, type Trip } from "@travelmo/core";
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decideAccess, recordSelf, requestAccess, shareTrip } from "./access";
import { saveTrusted } from "./travelProfile";

// The Access workflows as the browser runs them, against the emulator with
// the real rules loaded (SPEC "Access").
let env: RulesTestEnvironment;
const owner = { uid: "owner", email: "owner@example.com" };
const newcomer = { uid: "newcomer", email: "newcomer@example.com" };
const admin = { uid: "admin", email: "admin@example.com" };
const now = "2026-11-23T00:00:00Z";

const trip: Trip = {
  id: "t1",
  title: "Liverpool",
  start: "2026-12-12",
  end: "2026-12-14",
  ownerUid: owner.uid,
  sharedWith: [],
  createdAt: now,
  updatedAt: now,
};

const as = (user: { uid: string; email: string }) =>
  env.authenticatedContext(user.uid, { email: user.email, email_verified: true }).firestore() as unknown as Firestore;
const seed = (fn: (db: Firestore) => Promise<void>) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore() as unknown as Firestore));
const recordOf = async (email: string) => (await seedRead(paths.access(email)))?.data();
const seedRead = async (path: string) => {
  let snapshot: Awaited<ReturnType<typeof getDoc>> | undefined;
  await seed(async (db) => {
    snapshot = await getDoc(doc(db, path));
  });
  return snapshot;
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-travelmo",
    firestore: { rules: readFileSync(new URL("../../../../firestore.rules", import.meta.url), "utf8") },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, paths.trip(trip.id)), trip);
    await setDoc(doc(db, paths.user(owner.uid)), { email: owner.email });
    await setDoc(doc(db, paths.accessConfig()), { admins: [admin.email] });
  });
});

describe("requestAccess", () => {
  it("asks for the signed-in address, and the admin's approval lets the account in", async () => {
    await requestAccess(as(newcomer), newcomer.email, newcomer.uid, now);
    expect(await recordOf(newcomer.email)).toEqual({ email: newcomer.email, status: "requested", uid: newcomer.uid, requestedAt: now });
    await assertFails(setDoc(doc(as(newcomer), paths.user(newcomer.uid)), { email: newcomer.email }));
    await decideAccess(as(admin), newcomer.email, "approved", admin.uid, now);
    expect(await recordOf(newcomer.email)).toMatchObject({ status: "approved", approvedBy: admin.uid, requestedAt: now });
    await setDoc(doc(as(newcomer), paths.user(newcomer.uid)), { email: newcomer.email });
  });
});

describe("decideAccess", () => {
  it("invites an address that never asked, and revokes an account from before approvals", async () => {
    await decideAccess(as(admin), "invited@example.com", "approved", admin.uid, now);
    expect(await recordOf("invited@example.com")).toEqual({ email: "invited@example.com", status: "approved", approvedBy: admin.uid, approvedAt: now });
    await decideAccess(as(admin), owner.email, "declined", admin.uid, now);
    await assertFails(getDoc(doc(as(owner), paths.trip(trip.id))));
  });

  it("is refused to anyone but an admin", async () => {
    await assertFails(decideAccess(as(owner), "invited@example.com", "approved", owner.uid, now));
  });
});

describe("shareTrip", () => {
  it("shares the trip and invites the address in one write", async () => {
    await shareTrip(as(owner), trip.id, newcomer.email, owner.uid, now);
    expect(await recordOf(newcomer.email)).toEqual({ email: newcomer.email, invitedBy: owner.uid, invitedAt: now });
    const shared = await getDoc(doc(as(newcomer), paths.trip(trip.id)));
    expect(shared.data()?.sharedWith).toEqual([newcomer.email]);
  });

  it("still shares with an address an admin declined, which stays out", async () => {
    await seed((db) => setDoc(doc(db, paths.access(newcomer.email)), { email: newcomer.email, status: "declined", declinedBy: admin.uid, declinedAt: now }));
    await shareTrip(as(owner), trip.id, newcomer.email, owner.uid, now);
    await assertFails(getDoc(doc(as(newcomer), paths.trip(trip.id))));
  });
});

describe("saveTrusted", () => {
  it("invites each address newly trusted with the travel profile", async () => {
    const user = { uid: owner.uid, email: owner.email } as User;
    await saveTrusted(user, false, [newcomer.email], [], as(owner));
    expect(await recordOf(newcomer.email)).toMatchObject({ invitedBy: owner.uid });
    await getDoc(doc(as(newcomer), paths.travelProfile(owner.uid)));
  });
});

describe("recordSelf", () => {
  it("records an account from before approvals, and no one else", async () => {
    await recordSelf(as(owner), owner.email, owner.uid, now);
    expect(await recordOf(owner.email)).toMatchObject({ status: "approved", approvedBy: owner.uid });
    await assertFails(recordSelf(as(newcomer), newcomer.email, newcomer.uid, now));
  });
});
