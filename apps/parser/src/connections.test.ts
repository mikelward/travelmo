import { gmailIdPrefix, mailboxKey, maxGmailMailboxes, paths, type GmailState, type GoogleCalendarState } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  MailboxConflict,
  TooManyMailboxes,
  loadMailbox,
  loadMailboxes,
  moveLegacyMailbox,
  moveLegacyMailboxes,
  resolveMailbox,
  calendarUsers,
  createOAuthState,
  loadCalendarState,
  loadEventAliases,
  removeCalendarState,
  revocable,
  saveCalendarState,
  saveEventAliases,
  updateCalendars,
  oauthStateTtlMs,
  removeConnection,
  saveConnection,
  savePending,
  takeOAuthState,
  takePending,
  changeBackfill,
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
  const stored = async (uid: string, email: string) => (await db.doc(paths.gmailMailbox(uid, mailboxKey(email))).get()).data();
  const shown = async (uid: string) => (await db.doc(paths.user(uid)).get()).data()?.gmails as Record<string, Record<string, unknown>> | undefined;

  it("refuses a second user connecting the same mailbox and keeps the first mapping", async () => {
    const email = unique("shared") + "@example.com";
    const [a, b] = [unique("a"), unique("b")];
    await saveConnection(db, a, state(email));
    await expect(saveConnection(db, b, state(email))).rejects.toBeInstanceOf(MailboxConflict);
    expect(await accountOwner(email)).toBe(a);
    expect(await loadMailboxes(db, b)).toEqual([]);
  });

  it("lets the owner reconnect the same mailbox", async () => {
    const email = unique("same") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    await saveConnection(db, a, { ...state(email), historyId: "2" });
    expect(await accountOwner(email)).toBe(a);
    expect((await loadMailboxes(db, a)).map((m) => m.historyId)).toEqual(["2"]);
  });

  it("only removes the mapping when the disconnecting user owns it", async () => {
    const email = unique("owned") + "@example.com";
    const [a, b] = [unique("a"), unique("b")];
    await saveConnection(db, a, state(email));
    await db.doc(paths.gmailMailbox(b, mailboxKey(email))).set(state(email));
    await removeConnection(db, b, email);
    expect(await accountOwner(email)).toBe(a);
    expect(await stored(b, email)).toBeUndefined();
    await removeConnection(db, a, email);
    expect(await accountOwner(email)).toBeUndefined();
  });

  it("keeps several mailboxes of one user apart, each with its own token and owner mapping", async () => {
    const [first, second] = [unique("a-First") + "@example.com", unique("b-second") + "@example.com"];
    const a = unique("a");
    expect((await saveConnection(db, a, state(first))).idPrefix).toBe("");
    expect((await saveConnection(db, a, { ...state(second), refreshToken: "rt2" })).idPrefix).toBe(gmailIdPrefix(second));
    expect(await accountOwner(first)).toBe(a);
    expect(await accountOwner(second)).toBe(a);
    expect((await loadMailboxes(db, a)).map((m) => [m.emailAddress, m.refreshToken])).toEqual([
      [first, "rt"],
      [second, "rt2"],
    ]);
    expect((await loadMailbox(db, a, second.toUpperCase()))?.refreshToken).toBe("rt2");
    // Both count as the account's, by the record the rules trust.
    expect((await db.doc(paths.emailLinks(a)).get()).get("mailboxes")).toEqual([first.toLowerCase(), second]);
    // The apps see both, by lowercased address, and never a token.
    const profile = await shown(a);
    expect(Object.keys(profile ?? {}).sort()).toEqual([first.toLowerCase(), second].sort());
    expect(profile?.[second]).toMatchObject({ emailAddress: second, idPrefix: gmailIdPrefix(second) });
    expect(JSON.stringify(profile)).not.toContain("rt2");
    // Disconnecting one leaves the other.
    await removeConnection(db, a, second);
    expect((await loadMailboxes(db, a)).map((m) => m.emailAddress)).toEqual([first]);
    expect(Object.keys((await shown(a)) ?? {})).toEqual([first.toLowerCase()]);
    expect((await db.doc(paths.emailLinks(a)).get()).get("mailboxes")).toEqual([first.toLowerCase()]);
    expect(await accountOwner(second)).toBeUndefined();
  });

  it("keeps bare message ids for the account's first mailbox, even after it is connected again", async () => {
    const [first, second] = [unique("first") + "@example.com", unique("second") + "@example.com"];
    const a = unique("a");
    await saveConnection(db, a, state(first));
    await removeConnection(db, a, first);
    expect((await saveConnection(db, a, state(second))).idPrefix).toBe(gmailIdPrefix(second));
    expect((await saveConnection(db, a, state(first))).idPrefix).toBe("");
  });

  it(`refuses more than ${maxGmailMailboxes} mailboxes, but not connecting one of them again`, async () => {
    const a = unique("a");
    const emails = Array.from({ length: maxGmailMailboxes }, (_, i) => unique(`m${i}`) + "@example.com");
    for (const email of emails) await saveConnection(db, a, state(email));
    const extra = unique("extra") + "@example.com";
    await expect(saveConnection(db, a, state(extra))).rejects.toBeInstanceOf(TooManyMailboxes);
    expect(await accountOwner(extra)).toBeUndefined();
    await saveConnection(db, a, { ...state(emails[2]!), historyId: "9" });
    expect(await loadMailboxes(db, a)).toHaveLength(maxGmailMailboxes);
  });

  it("moves a mailbox connected before there could be several, keeping its bare ids", async () => {
    const email = unique("Legacy") + "@example.com";
    const a = unique("a");
    const legacy = { ...state(email), backfill: { scanned: 3, imported: 1, done: true, updatedAt: iso } };
    await db.doc(paths.gmailState(a)).set(legacy);
    await db.doc(paths.user(a)).set({ email: "me@example.com", gmail: { emailAddress: email, connectedAt: iso, backfill: legacy.backfill } });
    await db.doc(paths.gmailAccount(email)).set({ uid: a });
    // Any load moves it.
    expect(await loadMailbox(db, a, email)).toEqual({ ...legacy, idPrefix: "" });
    expect((await db.doc(paths.gmailState(a)).get()).exists).toBe(false);
    const user = (await db.doc(paths.user(a)).get()).data();
    // Left for rules and apps from before several mailboxes.
    expect(user?.gmail).toEqual({ emailAddress: email, connectedAt: iso, backfill: legacy.backfill });
    expect(user?.gmails?.[email.toLowerCase()]).toEqual({ emailAddress: email, connectedAt: iso, historyId: "1", watchExpiration: iso, backfill: legacy.backfill, idPrefix: "" });
    expect((await db.doc(paths.emailLinks(a)).get()).get("mailboxes")).toEqual([email.toLowerCase()]);
    expect(await moveLegacyMailbox(db, a)).toBe(false);
    // A second mailbox now gets ids of its own.
    const other = unique("other") + "@example.com";
    expect((await saveConnection(db, a, state(other))).idPrefix).toBe(gmailIdPrefix(other));
    // Disconnecting it drops what is left of it.
    await removeConnection(db, a, email);
    const after = (await db.doc(paths.user(a)).get()).data();
    expect(after?.gmail).toBeUndefined();
    expect(Object.keys(after?.gmails ?? {})).toEqual([other]);
  });

  it("moves every such mailbox when the parser starts, and never recreates a deleted user", async () => {
    const [a, gone] = [unique("a"), unique("gone")];
    const email = unique("old") + "@example.com";
    await db.doc(paths.gmailState(a)).set(state(email));
    await db.doc(paths.user(a)).set({ gmail: { emailAddress: email, connectedAt: iso } });
    await db.doc(paths.gmailState(gone)).set(state(unique("gone") + "@example.com"));
    const logged: unknown[] = [];
    // Other tests' users share the emulator, so only this one's is checked.
    const result = await moveLegacyMailboxes(db, (...line) => logged.push(line));
    expect(result.moved).toBeGreaterThanOrEqual(1);
    expect(await stored(a, email)).toMatchObject({ emailAddress: email, idPrefix: "" });
    // No user document: only a load finds it, and moves it without one.
    expect(await moveLegacyMailbox(db, gone)).toBe(true);
    expect((await db.doc(paths.user(gone)).get()).exists).toBe(false);
    // A failure names the account by its id only.
    expect(JSON.stringify(logged)).not.toContain("@example.com");
  });

  it("resolves the mailbox a request names by key, or the only or first one", async () => {
    const [first, second] = [unique("first") + "@example.com", unique("second") + "@example.com"];
    const a = unique("a");
    await saveConnection(db, a, state(first));
    expect((await resolveMailbox(db, a))?.emailAddress).toBe(first);
    await saveConnection(db, a, { ...state(second), connectedAt: "2026-11-02T00:00:00.000Z" });
    expect((await resolveMailbox(db, a, mailboxKey(second)))?.emailAddress).toBe(second);
    expect((await resolveMailbox(db, a))?.emailAddress).toBe(first);
    expect(await resolveMailbox(db, a, "nope")).toBeUndefined();
  });

  it("renewing a watch moves only the expiry of a live connection", async () => {
    const email = unique("watch") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    // A write from before `mailboxes` replaced the record they are kept in.
    await db.doc(paths.emailLinks(a)).set({ pending: [], confirmed: [] });
    expect(await updateWatch(db, a, email, "2026-11-08T00:00:00.000Z")).toBe(true);
    expect(await stored(a, email)).toMatchObject({ emailAddress: email, refreshToken: "rt", watchExpiration: "2026-11-08T00:00:00.000Z" });
    expect((await db.doc(paths.emailLinks(a)).get()).get("mailboxes")).toEqual([email]);
    expect((await shown(a))?.[email]?.watchExpiration).toBe("2026-11-08T00:00:00.000Z");
    expect(await accountOwner(email)).toBe(a);
  });

  it("advancing the history cursor follows the same rule", async () => {
    const email = unique("cursor") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    expect(await updateHistoryId(db, a, email, "42")).toBe(true);
    expect(await stored(a, email)).toMatchObject({ refreshToken: "rt", historyId: "42" });
    await removeConnection(db, a, email);
    expect(await updateHistoryId(db, a, email, "43")).toBe(false);
    expect(await stored(a, email)).toBeUndefined();
  });

  it("records backfill progress on a live connection only, visible to its user", async () => {
    const email = unique("backfill") + "@example.com";
    const other = unique("other") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    await saveConnection(db, a, state(other));
    const progress = { cursor: "p1", after: "m9", scanned: 300, imported: 4, done: false, updatedAt: "2026-11-02T00:00:00Z" };
    expect((await changeBackfill(db, a, email, () => ({ next: progress, result: "saved" })))?.result).toBe("saved");
    expect((await shown(a))?.[email]?.backfill).toEqual(progress);
    // Each mailbox reads on its own.
    expect((await shown(a))?.[other]?.backfill).toBeUndefined();
    // The user's copy is replaced whole, so a field the new progress lacks goes.
    const { after: _after, ...finished } = { ...progress, scanned: 400 };
    await changeBackfill(db, a, email, (current) => ({ next: current && finished, result: undefined }));
    expect((await shown(a))?.[email]?.backfill).toEqual(finished);
    expect((await shown(a))?.[email]?.emailAddress).toBe(email);
    await removeConnection(db, a, email);
    expect(await changeBackfill(db, a, email, () => ({ next: { ...progress, scanned: 600 }, result: "saved" }))).toBeUndefined();
    expect(await stored(a, email)).toBeUndefined();
  });

  it("renewing after a disconnect recreates nothing", async () => {
    const email = unique("gone") + "@example.com";
    const a = unique("a");
    await saveConnection(db, a, state(email));
    await removeConnection(db, a, email);
    expect(await updateWatch(db, a, email, "2026-11-08T00:00:00.000Z")).toBe(false);
    expect(await stored(a, email)).toBeUndefined();
    expect((await shown(a))?.[email]).toBeUndefined();
    expect(await accountOwner(email)).toBeUndefined();
  });
});

describe("Google Calendar connection", () => {
  const calendarState = (emailAddress: string): GoogleCalendarState => ({
    refreshToken: "rt-cal",
    emailAddress,
    connectedAt: iso,
    calendars: [{ id: "a", summary: "Travel", selected: false }],
  });

  it("keeps the token server-side and the calendars on the profile", async () => {
    const uid = unique("cal");
    await saveCalendarState(db, uid, calendarState("me@example.com"));
    expect((await loadCalendarState(db, uid))?.refreshToken).toBe("rt-cal");
    const profile = (await db.doc(paths.user(uid)).get()).data()?.googleCalendar;
    expect(profile).toEqual({ emailAddress: "me@example.com", connectedAt: iso, calendars: [{ id: "a", summary: "Travel", selected: false }] });
    expect(await calendarUsers(db)).toContain(uid);
  });

  it("changes the calendar list only while the same account is connected", async () => {
    const uid = unique("cal");
    await saveCalendarState(db, uid, calendarState("me@example.com"));
    const chosen = await updateCalendars(db, uid, "me@example.com", (current) => current.map((c) => ({ ...c, selected: true })));
    expect(chosen?.[0]?.selected).toBe(true);
    expect((await db.doc(paths.user(uid)).get()).data()?.googleCalendar?.calendars?.[0]?.selected).toBe(true);
    expect(await updateCalendars(db, uid, "other@example.com", () => [])).toBeUndefined();
    await saveEventAliases(db, uid, "a", { e1: "uid@example.com" });
    expect(await loadEventAliases(db, uid, "a")).toEqual({ e1: "uid@example.com" });
    await removeCalendarState(db, uid, ["a"]);
    expect(await loadEventAliases(db, uid, "a")).toEqual({});
    expect(await updateCalendars(db, uid, "me@example.com", () => [])).toBeUndefined();
    expect((await db.doc(paths.googleCalendarState(uid)).get()).exists).toBe(false);
    expect((await db.doc(paths.user(uid)).get()).data()?.googleCalendar).toBeUndefined();
    expect(await calendarUsers(db)).not.toContain(uid);
  });

  it("records what a consent was for", async () => {
    const nonce = unique("nonce");
    await createOAuthState(db, nonce, "u1", iso, "calendar");
    expect((await takeOAuthState(db, nonce, now))?.purpose).toBe("calendar");
  });
});

describe("revocable", () => {
  const gmail = { refreshToken: "rt-gmail", emailAddress: "me@example.com" };
  const calendar = { refreshToken: "rt-cal", emailAddress: "me@example.com" };

  it("keeps a grant another connection of the same Google account rests on", () => {
    expect(revocable("rt-cal", "me@example.com", [gmail, calendar])).toBe(false);
    expect(revocable("rt-gmail", "me@example.com", [gmail, calendar])).toBe(false);
  });

  it("revokes when nothing else uses that account, or the account is unknown and nothing else is connected", () => {
    expect(revocable("rt-cal", "me@example.com", [undefined, calendar])).toBe(true);
    expect(revocable("rt-cal", "me@example.com", [{ refreshToken: "rt-gmail", emailAddress: "other@example.com" }, calendar])).toBe(true);
    expect(revocable("rt-new", undefined, [undefined, undefined])).toBe(true);
    expect(revocable("rt-new", undefined, [gmail, undefined])).toBe(false);
  });
});
