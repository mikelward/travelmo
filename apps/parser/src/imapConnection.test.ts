import { mailboxKey, paths, type ImapState } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  TooManyImapMailboxes,
  changeImapBackfill,
  imapMailboxesToPoll,
  loadImapMailbox,
  loadImapMailboxes,
  markImapLoginFailed,
  removeImapConnection,
  saveImapConnection,
  updateImapLive,
} from "./imapConnection";
import { AccountDeletedError } from "./deleted";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const iso = "2026-11-01T12:00:00.000Z";
let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++n}`;

// A mailbox on the server state() connects it to.
// A mailbox as saved, as background work reads it (its password's id included).
const ref = async (uid: string, emailAddress: string) => {
  const stored = await loadImapMailbox(db, uid, { emailAddress });
  if (!stored) throw new Error(`${emailAddress} is not connected`);
  return { emailAddress, host: stored.host, port: stored.port, passwordId: stored.passwordId };
};

const state = (emailAddress: string, over: Partial<ImapState> = {}): ImapState => ({
  password: "app-password",
  emailAddress,
  connectedAt: iso,
  host: "imap.mail.me.com",
  port: 993,
  mailboxState: "1700000000:10",
  ...over,
});

const progress = { scanned: 300, imported: 4, done: false, updatedAt: iso };

describe("IMAP connections", () => {
  it("keep the password and server server-side and show the client only the address and progress", async () => {
    const uid = unique("u");
    await saveImapConnection(db, uid, state("Traveler@icloud.com"));
    const user = (await db.doc(paths.user(uid)).get()).data();
    expect(user?.imaps).toEqual({ "traveler@icloud.com": { emailAddress: "Traveler@icloud.com", connectedAt: iso } });
    expect(await loadImapMailbox(db, uid, { emailAddress: "traveler@icloud.com" })).toMatchObject({ password: "app-password", host: "imap.mail.me.com", port: 993 });
    expect(await imapMailboxesToPoll(db)).toContainEqual({ uid, emailAddress: "Traveler@icloud.com" });
  });

  it("are several per user, up to five", async () => {
    const uid = unique("u");
    for (let i = 1; i <= 5; i++) await saveImapConnection(db, uid, state(`me${i}@example.org`, { connectedAt: `2026-11-0${i}T00:00:00.000Z` }));
    await expect(saveImapConnection(db, uid, state("me6@example.org"))).rejects.toBeInstanceOf(TooManyImapMailboxes);
    expect((await loadImapMailboxes(db, uid)).map((m) => m.emailAddress)).toEqual(["me1@example.org", "me2@example.org", "me3@example.org", "me4@example.org", "me5@example.org"]);
    // Connecting one of them again is not a sixth.
    await saveImapConnection(db, uid, state("me3@example.org", { password: "new" }));
  });

  it("connecting the same mailbox again takes the new password and keeps its place", async () => {
    const uid = unique("u");
    await saveImapConnection(db, uid, state("me@icloud.com"));
    await changeImapBackfill(db, uid, "me@icloud.com", () => ({ next: progress, result: undefined }));
    await markImapLoginFailed(db, uid, await ref(uid, "me@icloud.com"), iso);
    await saveImapConnection(db, uid, state("me@icloud.com", { password: "new", mailboxState: "1700000000:99", connectedAt: "2026-11-02T00:00:00.000Z" }));
    const again = await loadImapMailbox(db, uid, { emailAddress: "me@icloud.com" });
    expect(again).toMatchObject({ password: "new", mailboxState: "1700000000:10", connectedAt: iso, backfill: progress });
    expect(again?.loginFailedAt).toBeUndefined();
    expect((await db.doc(paths.user(uid)).get()).get("imaps")["me@icloud.com"].loginFailedAt).toBeUndefined();
  });

  it("starts from the new server's place when the server changes", async () => {
    const uid = unique("u");
    await saveImapConnection(db, uid, state("me@example.org", { host: "imap.old.example" }));
    const old = await ref(uid, "me@example.org");
    await changeImapBackfill(db, uid, "me@example.org", () => ({ next: { scanned: 300, imported: 2, done: false, updatedAt: iso, cursor: "7:9000" }, result: undefined }));
    await saveImapConnection(db, uid, state("me@example.org", { host: "imap.new.example", mailboxState: "5:1" }));
    const moved = await loadImapMailbox(db, uid, { emailAddress: "me@example.org" });
    expect(moved?.mailboxState).toBe("5:1");
    // The old server's reading says nothing of the new inbox.
    expect(moved?.backfill).toBeUndefined();
    // Nor may a poll of the old server, still running, write its place.
    expect(await updateImapLive(db, uid, old, { mailboxState: "7:9000" })).toBe(false);
    expect(await updateImapLive(db, uid, await ref(uid, "me@example.org"), { mailboxState: "5:2" })).toBe(true);
  });

  it("do not take a refused login of an old password as the new one's", async () => {
    const uid = unique("u");
    await saveImapConnection(db, uid, state("me@icloud.com", { password: "old" }));
    const withOld = await ref(uid, "me@icloud.com");
    await saveImapConnection(db, uid, state("me@icloud.com", { password: "new" }));
    // A poll that began with the old password is refused after the new one was saved.
    expect(await markImapLoginFailed(db, uid, withOld, iso)).toBe(false);
    expect((await loadImapMailbox(db, uid, { emailAddress: "me@icloud.com" }))?.loginFailedAt).toBeUndefined();
    expect(await markImapLoginFailed(db, uid, await ref(uid, "me@icloud.com"), iso)).toBe(true);
  });

  it("record a refused password where Settings shows it, and clear it once a login works", async () => {
    const uid = unique("u");
    await saveImapConnection(db, uid, state("me@yahoo.com"));
    expect(await markImapLoginFailed(db, uid, await ref(uid, "me@yahoo.com"), iso)).toBe(true);
    expect((await loadImapMailbox(db, uid, { emailAddress: "me@yahoo.com" }))?.loginFailedAt).toBe(iso);
    expect((await db.doc(paths.user(uid)).get()).get("imaps")["me@yahoo.com"].loginFailedAt).toBe(iso);
    expect(await updateImapLive(db, uid, await ref(uid, "me@yahoo.com"), { mailboxState: "1700000000:11", loginFailedAt: null })).toBe(true);
    const cleared = await loadImapMailbox(db, uid, { emailAddress: "me@yahoo.com" });
    expect(cleared?.loginFailedAt).toBeUndefined();
    expect(cleared?.mailboxState).toBe("1700000000:11");
    expect((await db.doc(paths.user(uid)).get()).get("imaps")["me@yahoo.com"].loginFailedAt).toBeUndefined();
  });

  it("move their place only while the trips were not reset meanwhile, and only while connected", async () => {
    const uid = unique("u");
    await saveImapConnection(db, uid, state("me@example.org"));
    const mailbox = await ref(uid, "me@example.org");
    await db.doc(paths.importLock(uid)).set({ generation: 2 });
    expect(await updateImapLive(db, uid, await ref(uid, "me@example.org"), { mailboxState: "1700000000:20" }, 1)).toBe(false);
    expect(await updateImapLive(db, uid, await ref(uid, "me@example.org"), { mailboxState: "1700000000:20" }, 2)).toBe(true);
    await removeImapConnection(db, uid, "me@example.org");
    expect(await updateImapLive(db, uid, mailbox, { mailboxState: "1700000000:30" })).toBe(false);
    expect(await markImapLoginFailed(db, uid, mailbox, iso)).toBe(false);
    expect((await db.doc(paths.imapMailbox(uid, mailboxKey("me@example.org"))).get()).exists).toBe(false);
  });

  it("are forgotten whole on disconnect, the others kept", async () => {
    const uid = unique("u");
    await saveImapConnection(db, uid, state("one@example.org"));
    await saveImapConnection(db, uid, state("two@example.org"));
    await removeImapConnection(db, uid, "One@example.org");
    expect(Object.keys((await db.doc(paths.user(uid)).get()).get("imaps"))).toEqual(["two@example.org"]);
    expect((await loadImapMailboxes(db, uid)).map((m) => m.emailAddress)).toEqual(["two@example.org"]);
    expect(await imapMailboxesToPoll(db)).not.toContainEqual({ uid, emailAddress: "one@example.org" });
  });

  it("do not bring back a deleted user document, nor connect a deleted account", async () => {
    const uid = unique("u");
    await saveImapConnection(db, uid, state("me@example.org"));
    await db.doc(paths.user(uid)).delete();
    await removeImapConnection(db, uid, "me@example.org");
    expect((await db.doc(paths.user(uid)).get()).exists).toBe(false);
    await db.doc(paths.deletedAccount(uid)).set({ uid, at: iso });
    await expect(saveImapConnection(db, uid, state("me@example.org"))).rejects.toBeInstanceOf(AccountDeletedError);
  });
});
