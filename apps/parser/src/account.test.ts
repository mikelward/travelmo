import { mailboxKey, paths, type Segment, type Trip } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { deleteAccount, type AccountDeps } from "./account";
import { hashToken, issueExport } from "./calendarExport";
import { createOAuthState, removeCalendarState, removeConnection, saveCalendarState, saveConnection, saveEventAliases, savePending } from "./connections";
import { AccountDeletedError } from "./deleted";
import { saveImapConnection } from "./imapConnection";
import { firestoreForwardStore } from "./inbound";
import { firestoreReminderIo } from "./reminders";
import { firestoreFeeds } from "./feeds";
import { firestoreRetryStore } from "./geocodeSweep";
import { acquireUploadLease } from "./leases";
import { saveImportedProfile } from "./travelProfile";
import { firestoreStore } from "./store";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const iso = "2026-11-01T12:00:00.000Z";
let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++n}`;

type Logged = { severity: string; event: string; fields: Record<string, unknown> };

function fakeDeps(overrides: Partial<AccountDeps> = {}) {
  const calls = { stopWatch: [] as string[], revoke: [] as string[], deleteAuthUser: [] as string[] };
  const logged: Logged[] = [];
  const deps: AccountDeps = {
    db,
    stopWatch: async (token) => void calls.stopWatch.push(token),
    revoke: async (token) => void calls.revoke.push(token),
    deleteAuthUser: async (uid) => void calls.deleteAuthUser.push(uid),
    now: () => iso,
    log: (severity, event, fields) => void logged.push({ severity, event, fields }),
    ...overrides,
  };
  return { deps, calls, logged };
}

async function seedTrip(ownerUid: string, sharedWith: string[] = [], segments = 2): Promise<string> {
  const id = unique("trip");
  const trip: Trip = { id, title: "Lisbon", start: "2026-12-01", end: "2026-12-03", ownerUid, sharedWith, createdAt: iso, updatedAt: iso };
  await db.doc(paths.trip(id)).set(trip);
  for (let i = 0; i < segments; i++) await seedSegment(id, `${id}-s${i}`, ownerUid);
  return id;
}

async function seedSegment(tripId: string, id: string, uid: string): Promise<void> {
  const segment: Segment = {
    id,
    tripId,
    type: "lodging",
    title: "Hotel",
    start: "2026-12-01T15:00:00+00:00",
    end: "2026-12-03T11:00:00+00:00",
    source: "manual",
    gmailMessageIds: [],
    sources: [{ kind: "gmail", id: "m1", label: "Your stay", uid, at: iso }],
    createdAt: iso,
    updatedAt: iso,
  };
  await db.doc(paths.segment(tripId, id)).set(segment);
}

// Everything a fully set-up user has: their profile and its subcollections,
// both Google connections (two Gmail mailboxes), a consent in flight, a forwarding address and a
// calendar link.
async function seedUser(uid: string, email: string) {
  const mailbox = `${unique("mailbox")}@example.com`;
  await db.doc(paths.user(uid)).set({ email });
  await saveConnection(db, uid, { refreshToken: `rt-gmail-${uid}`, emailAddress: mailbox, connectedAt: iso, historyId: "1", watchExpiration: iso });
  const second = `${unique("second")}@example.com`;
  await saveConnection(db, uid, { refreshToken: `rt-gmail2-${uid}`, emailAddress: second, connectedAt: iso, historyId: "1", watchExpiration: iso });
  await saveCalendarState(db, uid, {
    refreshToken: `rt-cal-${uid}`,
    emailAddress: mailbox,
    connectedAt: iso,
    calendars: [{ id: "travel", summary: "Travel", selected: true }],
  });
  const pending = unique("pending");
  await savePending(db, pending, { uid, refreshToken: `rt-pending-${uid}`, createdAt: iso });
  const nonce = unique("nonce");
  await createOAuthState(db, nonce, uid, iso);
  const forwardHash = hashToken(unique("fwd"));
  await db.doc(paths.forwardAddress(forwardHash)).set({ uid, createdAt: iso });
  await db.doc(paths.user(uid)).set({ forward: { address: "x@in.example.com", createdAt: iso } }, { merge: true });
  const exportHash = hashToken(unique("cal"));
  await db.doc(paths.calendarExportToken(exportHash)).set({ uid, createdAt: iso });
  await db.doc(paths.calendarExport(uid)).set({ token: "t", createdAt: iso });
  const retry = `${unique("t")}__s`;
  await db.doc(`geocodeRetries/${retry}`).set({ uid, tripId: "t", segmentId: "s", at: iso });
  // An address they linked, and one waiting for its confirmation link.
  const linked = `${unique("work")}@company.example`;
  await db.doc(paths.linkedEmail(linked)).set({ uid, linkedAt: iso });
  await db.doc(paths.user(uid)).set({ emails: [linked], pendingEmails: [{ email: "next@company.example", sentAt: iso, expiresAt: iso }] }, { merge: true });
  const owned = [
    paths.pushSubscription(uid, "browser"),
    paths.device(uid, "phone"),
    paths.senderPatterns(uid),
    paths.travelProfile(uid),
    paths.feed(uid, "feed"),
    paths.parsedMessage(uid, "m1"),
    paths.examples(uid),
    paths.forwardBudget(uid),
    paths.importLock(uid),
    paths.reminderLog(uid, "t"),
    paths.emailLinks(uid),
    // Their reminders before trips, what they ticked off on one and a one-off they added to it.
    paths.tripReminder(uid, "s0"),
    paths.tripChecklist(uid, "t"),
    paths.tripChecklistAddedSlot(uid, "t", "a0"),
  ];
  for (const path of owned) await db.doc(path).set({ at: iso });
  // Whether one of those reminders went to them.
  const sent = `${uid}__t__r1`;
  await db.doc(paths.checklistReminder(sent)).set({ id: sent, uid, tripId: "t", reminderId: "r1", ends: "2026-12-19", attempts: 0, done: true, at: iso });
  const lookups = [
    paths.checklistReminder(sent),
    paths.gmailAccount(mailbox),
    paths.gmailAccount(second),
    paths.pendingConnection(pending),
    paths.oauthState(nonce),
    paths.forwardAddress(forwardHash),
    paths.calendarExportToken(exportHash),
    `geocodeRetries/${retry}`,
    paths.linkedEmail(linked),
  ];
  // A mailbox connected over IMAP: its sealed password goes with the rest.
  await saveImapConnection(db, uid, { emailAddress: "me@icloud.com", password: `pw-${uid}`, host: "imap.mail.me.com", port: 993, connectedAt: iso });
  const mailboxes = [paths.gmailMailbox(uid, mailboxKey(mailbox)), paths.gmailMailbox(uid, mailboxKey(second)), paths.gmailIds(uid), paths.imapMailbox(uid, mailboxKey("me@icloud.com"))];
  return { mailbox, second, owned, lookups, mailboxes };
}

const exists = async (path: string) => (await db.doc(path).get()).exists;
const segmentCount = async (tripId: string) => (await db.collection(paths.segments(tripId)).get()).size;

describe("deleteAccount", () => {
  it("deletes the user's trips with their bookings, their documents and connections, then the sign-in", async () => {
    const uid = unique("u");
    const email = `${uid}@example.com`;
    const seeded = await seedUser(uid, email);
    const trips = [await seedTrip(uid), await seedTrip(uid, ["friend@example.com"])];
    const { deps, calls, logged } = fakeDeps();

    const result = await deleteAccount(uid, email, deps);

    for (const id of trips) {
      expect(await exists(paths.trip(id))).toBe(false);
      expect(await segmentCount(id)).toBe(0);
    }
    expect(await exists(paths.user(uid))).toBe(false);
    for (const path of [...seeded.owned, ...seeded.mailboxes, paths.gmailState(uid), paths.googleCalendarState(uid), paths.calendarExport(uid)]) {
      expect(await exists(path), path).toBe(false);
    }
    for (const path of seeded.lookups) expect(await exists(path), path).toBe(false);
    expect((await db.doc(paths.user(uid)).listCollections()).length).toBe(0);
    expect(calls.stopWatch.sort()).toEqual([`rt-gmail-${uid}`, `rt-gmail2-${uid}`]);
    expect(calls.revoke.sort()).toEqual([`rt-cal-${uid}`, `rt-gmail-${uid}`, `rt-gmail2-${uid}`, `rt-pending-${uid}`]);
    expect(calls.deleteAuthUser).toEqual([uid]);
    expect(result).toMatchObject({ revoked: 4, revokeFailures: 0, ownedTrips: 2 });
    expect(logged.map((l) => l.event)).toEqual(["account_delete_started", "account_deleted"]);
    // The logs name the account by its id only.
    expect(JSON.stringify(logged)).not.toContain(email);
    expect(JSON.stringify(logged)).not.toContain(seeded.mailbox);
    expect(JSON.stringify(logged)).not.toContain(seeded.second);
  });

  it("stops and removes a mailbox connected before there could be several", async () => {
    const uid = unique("u");
    const mailbox = `${unique("legacy")}@example.com`;
    await db.doc(paths.user(uid)).set({ email: `${uid}@example.com`, gmail: { emailAddress: mailbox, connectedAt: iso } });
    await db.doc(paths.gmailState(uid)).set({ refreshToken: `rt-old-${uid}`, emailAddress: mailbox, connectedAt: iso });
    await db.doc(paths.gmailAccount(mailbox)).set({ uid });
    const { deps, calls } = fakeDeps();

    await deleteAccount(uid, undefined, deps);

    expect(calls.stopWatch).toEqual([`rt-old-${uid}`]);
    expect(calls.revoke).toEqual([`rt-old-${uid}`]);
    for (const path of [paths.gmailState(uid), paths.gmailMailbox(uid, mailboxKey(mailbox)), paths.gmailAccount(mailbox), paths.user(uid)]) {
      expect(await exists(path), path).toBe(false);
    }
  });

  it("takes them off trips and profiles others shared with them, which stay with their bookings", async () => {
    const uid = unique("u");
    const email = `${uid}@example.com`;
    const owner = unique("owner");
    const shared = await seedTrip(owner, [email, "partner@example.com"]);
    // A booking the deleted user added to the other person's trip.
    await seedSegment(shared, `${shared}-theirs`, uid);
    const untouched = await seedTrip(owner, ["partner@example.com"]);
    await db.doc(paths.travelProfile(owner)).set({ ownerUid: owner, trustedEmails: [email, "partner@example.com"] });
    await db.doc(paths.access(email)).set({ email, status: "approved", uid, approvedBy: "admin", approvedAt: iso });
    // A check-in reminder that reached both of them on the shared trip.
    const reminder = paths.checkInReminder(`${shared}__${shared}-s0`);
    await db.doc(reminder).set({ id: `${shared}__${shared}-s0`, departs: iso, sent: [owner, uid], attempts: 0, done: true, at: iso });
    const { deps } = fakeDeps();

    const result = await deleteAccount(uid, email, deps);
    expect(await exists(paths.access(email))).toBe(false);
    expect((await db.doc(reminder).get()).data()?.sent).toEqual([owner]);

    expect((await db.doc(paths.trip(shared)).get()).data()?.sharedWith).toEqual(["partner@example.com"]);
    expect(await segmentCount(shared)).toBe(3);
    expect(await exists(paths.segment(shared, `${shared}-theirs`))).toBe(true);
    expect((await db.doc(paths.trip(untouched)).get()).data()?.sharedWith).toEqual(["partner@example.com"]);
    expect(await segmentCount(untouched)).toBe(2);
    expect((await db.doc(paths.travelProfile(owner)).get()).data()?.trustedEmails).toEqual(["partner@example.com"]);
    expect(result).toMatchObject({ sharedTrips: 1, trustedProfiles: 1, ownedTrips: 0 });
  });

  it("leaves shared trips alone without a verified email", async () => {
    const uid = unique("u");
    const email = `${uid}@example.com`;
    const shared = await seedTrip(unique("owner"), [email]);
    await deleteAccount(uid, undefined, fakeDeps().deps);
    expect((await db.doc(paths.trip(shared)).get()).data()?.sharedWith).toEqual([email]);
  });

  it("goes on when a token cannot be revoked", async () => {
    const uid = unique("u");
    await seedUser(uid, `${uid}@example.com`);
    const trip = await seedTrip(uid);
    const { deps, calls, logged } = fakeDeps({
      revoke: async () => {
        throw new Error("invalid_token");
      },
      stopWatch: async () => {
        throw new Error("unauthorized");
      },
    });

    const result = await deleteAccount(uid, undefined, deps);

    expect(await exists(paths.trip(trip))).toBe(false);
    expect(await exists(paths.user(uid))).toBe(false);
    expect(await exists(paths.gmailState(uid))).toBe(false);
    expect(calls.deleteAuthUser).toEqual([uid]);
    expect(result).toMatchObject({ revoked: 0, revokeFailures: 4 });
    expect(logged.filter((l) => l.event === "account_delete_revoke_failed")).toHaveLength(4);
    expect(logged.some((l) => l.event === "account_delete_stop_watch_failed" && l.severity === "WARNING")).toBe(true);
    expect(logged.at(-1)?.event).toBe("account_deleted");
  });

  it("finishes on a second call what an interrupted one left", async () => {
    const uid = unique("u");
    const email = `${uid}@example.com`;
    const seeded = await seedUser(uid, email);
    const trips = [await seedTrip(uid), await seedTrip(uid)];
    const shared = await seedTrip(unique("owner"), [email]);
    // The first run fails partway through deleting trips: the clock is read
    // once for the deletion marker and once per trip.
    let clock = 0;
    const first = fakeDeps({
      now: () => {
        if (++clock > 2) throw new Error("interrupted");
        return iso;
      },
    });
    await expect(deleteAccount(uid, email, first.deps)).rejects.toThrow("interrupted");
    expect(first.logged.at(-1)).toMatchObject({ severity: "ERROR", event: "account_delete_failed", fields: { uid, step: "owned_trips" } });
    expect(first.calls.deleteAuthUser).toEqual([]);
    const left = await Promise.all(trips.map((id) => exists(paths.trip(id))));
    expect(left.filter(Boolean)).toHaveLength(1);
    expect(await exists(paths.gmailState(uid))).toBe(false);

    const second = fakeDeps();
    await deleteAccount(uid, email, second.deps);

    for (const id of trips) expect(await exists(paths.trip(id))).toBe(false);
    expect((await db.doc(paths.trip(shared)).get()).data()?.sharedWith).toEqual([]);
    expect(await exists(paths.user(uid))).toBe(false);
    for (const path of [...seeded.owned, ...seeded.lookups]) expect(await exists(path), path).toBe(false);
    // The connections went in the first run: nothing is left to stop or revoke.
    expect(second.calls.stopWatch).toEqual([]);
    expect(second.calls.revoke).toEqual([]);
    expect(second.calls.deleteAuthUser).toEqual([uid]);
  });

  it("retries the sign-in's deletion when only that failed", async () => {
    const uid = unique("u");
    const trip = await seedTrip(uid);
    const first = fakeDeps({
      deleteAuthUser: async () => {
        throw new Error("auth unavailable");
      },
    });
    await expect(deleteAccount(uid, undefined, first.deps)).rejects.toThrow("auth unavailable");
    expect(first.logged.at(-1)?.fields).toMatchObject({ step: "auth" });
    expect(await exists(paths.trip(trip))).toBe(false);

    const second = fakeDeps();
    await deleteAccount(uid, undefined, second.deps);
    expect(second.calls.deleteAuthUser).toEqual([uid]);
  });

  it("refuses every import write once deletion has started, so nothing is recreated", async () => {
    const uid = unique("u");
    await seedTrip(uid);
    await deleteAccount(uid, undefined, fakeDeps().deps);

    // An import that was already under way when the account was deleted.
    const store = firestoreStore(db);
    expect(await store.claimMessage(uid, "m-late", iso)).toBe(false);
    await expect(store.withUserLock(uid, async (tx) => tx.createTrip({
      id: unique("trip"), title: "Late", start: "2026-12-01", end: "2026-12-02", ownerUid: uid, sharedWith: [], createdAt: iso, updatedAt: iso,
    }))).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(store.setParsed({ messageId: "m-late", uid, outcome: "failed", segmentIds: [], processedAt: iso })).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(store.saveExample(uid, "bookings", { subject: "Your stay", vector: [0.1] })).rejects.toBeInstanceOf(AccountDeletedError);

    expect((await db.collection(paths.trips()).where("ownerUid", "==", uid).get()).empty).toBe(true);
    expect(await exists(paths.parsedMessage(uid, "m-late"))).toBe(false);
    expect(await exists(paths.examples(uid))).toBe(false);
  });

  it("keeps a trip a retry can find when its bookings could not all be deleted", async () => {
    const uid = unique("u");
    const trip = await seedTrip(uid);
    const realDelete = db.recursiveDelete.bind(db);
    db.recursiveDelete = async () => {
      throw new Error("bookings unavailable");
    };
    try {
      await expect(deleteAccount(uid, undefined, fakeDeps().deps)).rejects.toThrow("bookings unavailable");
    } finally {
      db.recursiveDelete = realDelete;
    }
    expect(await exists(paths.trip(trip))).toBe(true);
    expect((await db.collection(paths.segments(trip)).get()).size).toBe(2);

    await deleteAccount(uid, undefined, fakeDeps().deps);
    expect(await exists(paths.trip(trip))).toBe(false);
    expect((await db.collection(paths.segments(trip)).get()).empty).toBe(true);
  });

  it("refuses a Google connection that completes after deletion started", async () => {
    const uid = unique("u");
    await deleteAccount(uid, undefined, fakeDeps().deps);

    const token = unique("pending");
    await expect(savePending(db, token, { uid, refreshToken: "rt-late", createdAt: iso })).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(
      saveConnection(db, uid, { refreshToken: "rt-late", emailAddress: `${unique("mailbox")}@example.com`, connectedAt: iso, historyId: "1", watchExpiration: iso }),
    ).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(
      saveCalendarState(db, uid, { refreshToken: "rt-late", emailAddress: "a@example.com", connectedAt: iso, calendars: [] }),
    ).rejects.toBeInstanceOf(AccountDeletedError);

    expect(await exists(paths.pendingConnection(token))).toBe(false);
    expect(await exists(paths.gmailState(uid))).toBe(false);
    expect(await exists(paths.googleCalendarState(uid))).toBe(false);
    expect(await exists(paths.user(uid))).toBe(false);
  });

  it("refuses a forwarding address or calendar link issued after deletion started", async () => {
    const uid = unique("u");
    await deleteAccount(uid, undefined, fakeDeps().deps);

    const forwardHash = hashToken(unique("fwd"));
    await expect(
      firestoreForwardStore(db, "in.example.com").issue(uid, { address: "late@in.example.com", createdAt: iso }, forwardHash, iso),
    ).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(issueExport(db, uid, iso)).rejects.toBeInstanceOf(AccountDeletedError);

    expect(await exists(paths.forwardAddress(forwardHash))).toBe(false);
    expect(await exists(paths.calendarExport(uid))).toBe(false);
    expect(await exists(paths.user(uid))).toBe(false);
  });

  it("refuses imports and background bookkeeping that finish after deletion started", async () => {
    const uid = unique("u");
    await deleteAccount(uid, undefined, fakeDeps().deps);

    await expect(saveEventAliases(db, uid, "travel", { e1: "uid-1" })).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(firestoreReminderIo(db, async () => undefined, async () => []).markSent(uid, "t1", ["line"], iso)).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(firestoreFeeds(db).save(uid, { id: "f1", url: "https://example.com/cal.ics", addedAt: iso })).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(acquireUploadLease(db, uid, "tripit", "h1", iso)).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(saveImportedProfile(db, uid, undefined, { travelers: [], loyalty: [], documents: [] }, iso)).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(firestoreRetryStore(db).put({ uid, tripId: "t1", segmentId: "s1", at: iso })).rejects.toBeInstanceOf(AccountDeletedError);
    expect(await exists(paths.geocodeRetry("t1", "s1"))).toBe(false);
    await expect(firestoreForwardStore(db, "in.example.com").reserve(uid, "2026-11-01", 50)).rejects.toBeInstanceOf(AccountDeletedError);
    const nonce = unique("nonce");
    await expect(createOAuthState(db, nonce, uid, iso)).rejects.toBeInstanceOf(AccountDeletedError);
    expect(await exists(paths.oauthState(nonce))).toBe(false);
    // A disconnect finishing late leaves the deleted user document deleted.
    await removeConnection(db, uid, `${unique("mailbox")}@example.com`);
    await removeCalendarState(db, uid);
    expect(await exists(paths.user(uid))).toBe(false);

    expect((await db.doc(paths.user(uid)).listCollections()).length).toBe(0);
  });
});

