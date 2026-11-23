import { paths, type FastmailState } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  OtherMailboxConnected,
  changeFastmailBackfill,
  fastmailUsers,
  loadFastmailState,
  removeFastmailConnection,
  saveFastmailConnection,
  updateFastmailLive,
} from "./fastmailConnection";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const iso = "2026-11-01T12:00:00.000Z";
let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++n}`;

const state = (emailAddress: string, over: Partial<FastmailState> = {}): FastmailState => ({
  token: "fmu1-token",
  accountId: "u1",
  emailAddress,
  connectedAt: iso,
  emailState: "10",
  ...over,
});

const progress = { scanned: 300, imported: 4, done: false, updatedAt: iso };

describe("Fastmail connections", () => {
  it("keeps the token server-side and shows the client only the address and progress", async () => {
    const uid = unique("u");
    await saveFastmailConnection(db, uid, state("traveler@fastmail.com"));
    const user = (await db.doc(paths.user(uid)).get()).data();
    expect(user?.fastmail).toEqual({ emailAddress: "traveler@fastmail.com", connectedAt: iso });
    expect((await loadFastmailState(db, uid))?.token).toBe("fmu1-token");
    expect(await fastmailUsers(db)).toContain(uid);
  });

  it("connecting the same mailbox again takes the new token and keeps its place", async () => {
    const uid = unique("u");
    await saveFastmailConnection(db, uid, state("traveler@fastmail.com"));
    await changeFastmailBackfill(db, uid, () => ({ next: progress, result: undefined }));
    await saveFastmailConnection(db, uid, state("traveler@fastmail.com", { token: "fmu1-new", emailState: "99", connectedAt: "2026-11-02T00:00:00.000Z" }));
    expect(await loadFastmailState(db, uid)).toMatchObject({ token: "fmu1-new", emailState: "10", connectedAt: iso, backfill: progress });
  });

  it("refuses a second mailbox until the first is disconnected", async () => {
    const uid = unique("u");
    await saveFastmailConnection(db, uid, state("one@fastmail.com"));
    await expect(saveFastmailConnection(db, uid, state("two@fastmail.com"))).rejects.toBeInstanceOf(OtherMailboxConnected);
    await removeFastmailConnection(db, uid);
    await saveFastmailConnection(db, uid, state("two@fastmail.com"));
    expect((await loadFastmailState(db, uid))?.emailAddress).toBe("two@fastmail.com");
  });

  it("records backfill progress where Settings reads it", async () => {
    const uid = unique("u");
    expect(await changeFastmailBackfill(db, uid, () => ({ next: progress, result: 1 }))).toBeUndefined();
    await saveFastmailConnection(db, uid, state("traveler@fastmail.com"));
    const changed = await changeFastmailBackfill(db, uid, (current) => ({ next: progress, result: current }));
    expect(changed?.result).toBeUndefined();
    expect((await db.doc(paths.user(uid)).get()).data()?.fastmail?.backfill).toEqual(progress);
  });

  it("moves the mailbox state on only for the mailbox still connected, under the same reset generation", async () => {
    const uid = unique("u");
    await saveFastmailConnection(db, uid, state("traveler@fastmail.com"));
    expect(await updateFastmailLive(db, uid, "other@fastmail.com", { emailState: "11" })).toBe(false);
    expect(await updateFastmailLive(db, uid, "traveler@fastmail.com", { emailState: "11" }, 3)).toBe(false);
    expect(await updateFastmailLive(db, uid, "traveler@fastmail.com", { emailState: "12" }, 0)).toBe(true);
    expect((await loadFastmailState(db, uid))?.emailState).toBe("12");
  });

  it("disconnecting removes the token and the connection, and leaves a deleted account deleted", async () => {
    const uid = unique("u");
    await saveFastmailConnection(db, uid, state("traveler@fastmail.com"));
    await removeFastmailConnection(db, uid);
    expect(await loadFastmailState(db, uid)).toBeUndefined();
    expect((await db.doc(paths.user(uid)).get()).data()?.fastmail).toBeUndefined();
    const gone = unique("u");
    await removeFastmailConnection(db, gone);
    expect((await db.doc(paths.user(gone)).get()).exists).toBe(false);
  });
});
