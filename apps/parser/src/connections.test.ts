import { paths, type GmailState } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  MailboxConflict,
  OtherMailboxConnected,
  createOAuthState,
  oauthStateTtlMs,
  removeConnection,
  saveConnection,
  savePending,
  takeOAuthState,
  takePending,
  updateHistoryId,
  updateWatch,
} from "./connections";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const now = Date.parse("2026-11-01T12:00:00Z");
const iso = new Date(now).toISOString();
let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++n}`;

const state = (emailAddress: string): GmailState => ({
  refreshToken: "rt",
  emailAddress,
  connectedAt: iso,
  historyId: "1",
  watchExpiration: iso,
});

const accountOwner = async (emailAddress: string) => (await db.doc(paths.gmailAccount(emailAddress)).get()).data()?.uid;

describe("oauth state and pending connections", () => {
  it("redeems a nonce exactly once", async () => {
    const nonce = unique("nonce");
    await createOAuthState(db, nonce, "u1", iso);
    expect(await takeOAuthState(db, nonce, now)).toMatchObject({ uid: "u1" });
    expect(await takeOAuthState(db, nonce, now)).toBeUndefined();
  });

  it("refuses an expired nonce and still consumes it", async () => {
    const nonce = unique("nonce");
    await createOAuthState(db, nonce, "u1", iso);
    expect(await takeOAuthState(db, nonce, now + oauthStateTtlMs + 1)).toBeUndefined();
    expect((await db.doc(paths.oauthState(nonce)).get()).exists).toBe(false);
  });

  it("hands a pending connection to exactly one completion", async () => {
    const token = unique("token");
    await savePending(db, token, { uid: "u1", refreshToken: "rt", createdAt: iso });
    const results = await Promise.all([takePending(db, token, now), takePending(db, token, now)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("mailbox ownership", () => {
  it("refuses a second user connecting the same mailbox and keeps the first mapping", async () => {
    const email = unique("shared") + "@example.com";
    const [a, b] = [unique("a"), unique("b")];
    await saveConnection(db, a, state(email));
    await expect(saveConnection(db, b, state(email))).rejects.toBeInstanceOf(MailboxConflict);
    expect(await accountOwner(email)).toBe(a);
    expect((await db.doc(paths.gmailState(b)).get()).exists).toBe(false);
  });

  it("lets the owner reconnect the same mailbox", async () => {
    const email = unique("same") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    await saveConnection(db, a, { ...state(email), historyId: "2" });
    expect(await accountOwner(email)).toBe(a);
  });

  it("only removes the mapping when the disconnecting user owns it", async () => {
    const email = unique("owned") + "@example.com";
    const [a, b] = [unique("a"), unique("b")];
    await saveConnection(db, a, state(email));
    await db.doc(paths.gmailState(b)).set(state(email));
    await removeConnection(db, b, email);
    expect(await accountOwner(email)).toBe(a);
    expect((await db.doc(paths.gmailState(b)).get()).exists).toBe(false);
    await removeConnection(db, a, email);
    expect(await accountOwner(email)).toBeUndefined();
  });

  it("refuses a user's second mailbox while the first is connected", async () => {
    const [first, second] = [unique("first") + "@example.com", unique("second") + "@example.com"];
    const a = unique("a");
    await saveConnection(db, a, state(first));
    await expect(saveConnection(db, a, state(second))).rejects.toBeInstanceOf(OtherMailboxConnected);
    expect(await accountOwner(first)).toBe(a);
    expect(await accountOwner(second)).toBeUndefined();
    expect((await db.doc(paths.gmailState(a)).get()).data()?.emailAddress).toBe(first);
    await removeConnection(db, a, first);
    await saveConnection(db, a, state(second));
    expect(await accountOwner(second)).toBe(a);
  });

  it("renewing a watch moves only the expiry of a live connection", async () => {
    const email = unique("watch") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    expect(await updateWatch(db, a, email, "2026-11-08T00:00:00.000Z")).toBe(true);
    const stored = (await db.doc(paths.gmailState(a)).get()).data();
    expect(stored).toMatchObject({ emailAddress: email, refreshToken: "rt", watchExpiration: "2026-11-08T00:00:00.000Z" });
    expect((await db.doc(paths.user(a)).get()).data()?.gmail?.watchExpiration).toBe("2026-11-08T00:00:00.000Z");
    expect(await accountOwner(email)).toBe(a);
  });

  it("advancing the history cursor follows the same rule", async () => {
    const email = unique("cursor") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    expect(await updateHistoryId(db, a, email, "42")).toBe(true);
    expect((await db.doc(paths.gmailState(a)).get()).data()).toMatchObject({ refreshToken: "rt", historyId: "42" });
    await removeConnection(db, a, email);
    expect(await updateHistoryId(db, a, email, "43")).toBe(false);
    expect((await db.doc(paths.gmailState(a)).get()).exists).toBe(false);
  });

  it("renewing after a disconnect recreates nothing", async () => {
    const email = unique("gone") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    await removeConnection(db, a, email);
    expect(await updateWatch(db, a, email, "2026-11-08T00:00:00.000Z")).toBe(false);
    expect((await db.doc(paths.gmailState(a)).get()).exists).toBe(false);
    expect((await db.doc(paths.user(a)).get()).data()?.gmail).toBeUndefined();
    expect(await accountOwner(email)).toBeUndefined();
  });
});
