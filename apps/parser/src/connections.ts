import { GmailState, GoogleCalendarState, paths, stableHash, type BackfillProgress, type GmailConnection, type GoogleCalendarChoice, type GoogleCalendarConnection } from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { refuseIfDeleted } from "./deleted";
import { generationOf } from "./store";

export const oauthStateTtlMs = 10 * 60 * 1000;

export class MailboxConflict extends Error {
  constructor(emailAddress: string) {
    super(`${emailAddress} is already connected to another account`);
  }
}

export class OtherMailboxConnected extends Error {
  constructor(public readonly emailAddress: string) {
    super(`${emailAddress} is still connected; disconnect it first`);
  }
}

// What a Google consent was for: each grants its own scope and token, so
// connecting or disconnecting one leaves the other alone. Absent means Gmail
// (records from before Calendar existed).
export type OAuthPurpose = "gmail" | "calendar";
type OAuthState = { uid: string; createdAt: string; purpose?: OAuthPurpose };
export type PendingConnection = { uid: string; refreshToken: string; createdAt: string; purpose?: OAuthPurpose };

function fresh(createdAt: string, now: number): boolean {
  return now - Date.parse(createdAt) <= oauthStateTtlMs;
}

// Reads and deletes in one transaction so a nonce or completion token can be
// redeemed exactly once.
async function take<T extends { createdAt: string }>(db: Firestore, path: string, now: number): Promise<T | undefined> {
  return db.runTransaction(async (t) => {
    const ref = db.doc(path);
    const snap = await t.get(ref);
    if (!snap.exists) return undefined;
    t.delete(ref);
    const data = snap.data() as T;
    return fresh(data.createdAt, now) ? data : undefined;
  });
}

export async function createOAuthState(db: Firestore, nonce: string, uid: string, now: string, purpose: OAuthPurpose = "gmail"): Promise<void> {
  await db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    t.create(db.doc(paths.oauthState(nonce)), { uid, createdAt: now, purpose } satisfies OAuthState);
  });
}

export function takeOAuthState(db: Firestore, nonce: string, now: number): Promise<OAuthState | undefined> {
  return take<OAuthState>(db, paths.oauthState(nonce), now);
}

// Refuses a deleted account (deleted.ts), so a consent Google answered
// after deletion began is not parked with its token.
export async function savePending(db: Firestore, token: string, pending: PendingConnection): Promise<void> {
  await db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, pending.uid);
    t.create(db.doc(paths.pendingConnection(token)), pending);
  });
}

export function takePending(db: Firestore, token: string, now: number): Promise<PendingConnection | undefined> {
  return take<PendingConnection>(db, paths.pendingConnection(token), now);
}

export async function mailboxOwner(db: Firestore, emailAddress: string): Promise<string | undefined> {
  return (await db.doc(paths.gmailAccount(emailAddress)).get()).data()?.uid as string | undefined;
}

export async function loadState(db: Firestore, uid: string): Promise<GmailState | undefined> {
  const snap = await db.doc(paths.gmailState(uid)).get();
  return snap.exists ? GmailState.parse(snap.data()) : undefined;
}

function publicPart(state: GmailState): GmailConnection {
  const { refreshToken: _token, ...connection } = state;
  return connection;
}

// A mailbox routes notifications to exactly one user, and a user holds one
// mailbox: a second user is refused rather than silently taking it over, and
// a user with another mailbox still connected must disconnect it first (the
// caller does that before retrying, so a concurrent completion cannot leave
// the old mapping behind).
export async function saveConnection(db: Firestore, uid: string, state: GmailState): Promise<void> {
  await db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    const accountRef = db.doc(paths.gmailAccount(state.emailAddress));
    const stateRef = db.doc(paths.gmailState(uid));
    const [account, current] = await Promise.all([t.get(accountRef), t.get(stateRef)]);
    const owner = account.data()?.uid as string | undefined;
    if (owner !== undefined && owner !== uid) throw new MailboxConflict(state.emailAddress);
    const existing = current.exists ? GmailState.parse(current.data()) : undefined;
    if (existing && existing.emailAddress !== state.emailAddress) throw new OtherMailboxConnected(existing.emailAddress);
    t.set(stateRef, state);
    t.set(db.doc(paths.user(uid)), { gmail: publicPart(state) }, { merge: true });
    t.set(accountRef, { uid });
  });
}

// Background work only touches a connection that still exists for the same
// mailbox; a user who disconnected while Gmail was answering must not come
// back as connected, nor be left with a half-formed document.
// With `generation`, also only while the user's trips have not been reset
// since it was read (tripsReset.ts): a mailbox reading that began before
// "Delete all trips" must not write its old place back.
function updateLive(db: Firestore, uid: string, emailAddress: string, fields: Partial<GmailConnection>, generation?: number): Promise<boolean> {
  return db.runTransaction(async (t) => {
    const stateRef = db.doc(paths.gmailState(uid));
    const snap = await t.get(stateRef);
    if (generation !== undefined && generationOf(await t.get(db.doc(paths.importLock(uid)))) !== generation) return false;
    if (!snap.exists || GmailState.parse(snap.data()).emailAddress !== emailAddress) return false;
    t.update(stateRef, fields);
    t.set(db.doc(paths.user(uid)), { gmail: fields }, { merge: true });
    return true;
  });
}

export function updateWatch(db: Firestore, uid: string, emailAddress: string, watchExpiration: string): Promise<boolean> {
  return updateLive(db, uid, emailAddress, { watchExpiration });
}

export function updateBackfill(db: Firestore, uid: string, emailAddress: string, backfill: BackfillProgress, generation?: number): Promise<boolean> {
  return updateLive(db, uid, emailAddress, { backfill }, generation);
}

export function updateHistoryId(db: Firestore, uid: string, emailAddress: string, historyId: string, generation?: number): Promise<boolean> {
  return updateLive(db, uid, emailAddress, { historyId }, generation);
}

export async function removeConnection(db: Firestore, uid: string, emailAddress: string): Promise<void> {
  await db.runTransaction(async (t) => {
    const accountRef = db.doc(paths.gmailAccount(emailAddress));
    const userRef = db.doc(paths.user(uid));
    const owner = (await t.get(accountRef)).data()?.uid as string | undefined;
    // An update, not a merge: a user document already deleted (account
    // deletion) must not come back empty.
    const userExists = (await t.get(userRef)).exists;
    t.delete(db.doc(paths.gmailState(uid)));
    if (userExists) t.update(userRef, { gmail: FieldValue.delete() });
    if (owner === uid) t.delete(accountRef);
  });
}

// Google Calendar: one connection per user, its token apart from Gmail's.

export async function loadCalendarState(db: Firestore, uid: string): Promise<GoogleCalendarState | undefined> {
  const snap = await db.doc(paths.googleCalendarState(uid)).get();
  return snap.exists ? GoogleCalendarState.parse(snap.data()) : undefined;
}

function publicCalendar(state: GoogleCalendarState): GoogleCalendarConnection {
  const { refreshToken: _token, ...connection } = state;
  return connection;
}

export async function saveCalendarState(db: Firestore, uid: string, state: GoogleCalendarState): Promise<void> {
  await db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    t.set(db.doc(paths.googleCalendarState(uid)), state);
    t.set(db.doc(paths.user(uid)), { googleCalendar: publicCalendar(state) }, { merge: true });
  });
}

// Changes the calendar list of a connection that is still there for the
// same account, as `change` decides from the current list: a user who
// disconnected while Google was answering stays disconnected, and a choice
// made meanwhile is not overwritten with a stale one.
export function updateCalendars(
  db: Firestore,
  uid: string,
  emailAddress: string,
  change: (current: GoogleCalendarChoice[]) => GoogleCalendarChoice[],
): Promise<GoogleCalendarChoice[] | undefined> {
  return db.runTransaction(async (t) => {
    const stateRef = db.doc(paths.googleCalendarState(uid));
    const snap = await t.get(stateRef);
    if (!snap.exists) return undefined;
    const state = GoogleCalendarState.parse(snap.data());
    if (state.emailAddress !== emailAddress) return undefined;
    const calendars = change(state.calendars);
    t.update(stateRef, { calendars });
    t.set(db.doc(paths.user(uid)), { googleCalendar: { calendars } }, { merge: true });
    return calendars;
  });
}

export async function removeCalendarState(db: Firestore, uid: string, calendarIds: readonly string[] = []): Promise<void> {
  await db.runTransaction(async (t) => {
    const userRef = db.doc(paths.user(uid));
    const userExists = (await t.get(userRef)).exists;
    t.delete(db.doc(paths.googleCalendarState(uid)));
    for (const id of calendarIds) t.delete(db.doc(paths.googleCalendarAliases(uid, stableHash(id))));
    if (userExists) t.update(userRef, { googleCalendar: FieldValue.delete() });
  });
}

export async function loadEventAliases(db: Firestore, uid: string, calendarId: string): Promise<Record<string, string>> {
  const snap = await db.doc(paths.googleCalendarAliases(uid, stableHash(calendarId))).get();
  return ((snap.data() as { aliases?: Record<string, string> } | undefined)?.aliases) ?? {};
}

export async function saveEventAliases(db: Firestore, uid: string, calendarId: string, aliases: Record<string, string>): Promise<void> {
  await db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    t.set(db.doc(paths.googleCalendarAliases(uid, stableHash(calendarId))), { aliases });
  });
}

// Every user with Google Calendar connected, for the daily poll.
export async function calendarUsers(db: Firestore): Promise<string[]> {
  const snap = await db.collection("users").where("googleCalendar.connectedAt", ">", "").get();
  return snap.docs.map((d) => d.id);
}

// Google revokes a user's whole grant to this app, every scope and token,
// when any one token is revoked. So a token is revoked only when no other
// connection of the user still relies on the same Google account (by its
// address; with none known, on any account): disconnecting Calendar must
// not silently stop Gmail. The token is dropped either way.
export function revocable(
  token: string,
  emailAddress: string | undefined,
  connections: readonly ({ refreshToken: string; emailAddress: string } | undefined)[],
): boolean {
  const others = connections.filter((c): c is { refreshToken: string; emailAddress: string } => !!c && c.refreshToken !== token);
  return emailAddress === undefined ? others.length === 0 : !others.some((c) => c.emailAddress === emailAddress);
}
