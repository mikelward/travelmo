import { GmailState, GoogleCalendarState, gmailIdPrefix, mailboxKey, maxGmailMailboxes, paths, stableHash, type BackfillProgress, type GmailConnection, type GoogleCalendarChoice, type GoogleCalendarConnection } from "@travelmo/core";
import { FieldPath, FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { refuseIfDeleted } from "./deleted";
import { errorKind } from "./log";
import { generationOf, mailboxesQuery } from "./store";

export const oauthStateTtlMs = 10 * 60 * 1000;

export class MailboxConflict extends Error {
  constructor(emailAddress: string) {
    super(`${emailAddress} is already connected to another account`);
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

// A user may connect several mailboxes (SPEC "Connecting Gmail"), each with
// its own token, watch, history cursor and reading: the token and state in
// `users/{uid}/private/gmail-<key>`, what the apps may see in the user
// document's `gmails`, by lowercased address. A mailbox connected before
// there could be several sits in `private/gmail` and the user document's
// `gmail` until `moveLegacyMailbox` moves it, which anything that loads
// mailboxes does first, as the parser does for everyone when it starts.
// The user document's `gmail` is left in place, frozen, for rules and apps
// from before, and goes when that mailbox is disconnected.

const lower = (address: string) => address.trim().toLowerCase();
const mailboxDoc = (db: Firestore, uid: string, address: string) => db.doc(paths.gmailMailbox(uid, mailboxKey(address)));
// The user document's entry for a mailbox: a field path, since an address
// has dots in it.
const publicEntry = (address: string, ...rest: string[]) => new FieldPath("gmails", lower(address), ...rest);

export class TooManyMailboxes extends Error {
  constructor() {
    super(`You can connect up to ${maxGmailMailboxes} Gmail accounts. Disconnect one first.`);
  }
}

// Writes fields of the user document's `gmails` by field path (an address
// has dots in it), each replaced whole: a deep merge would keep nested
// values the new one no longer has. Only on a user document that exists:
// one already deleted (account deletion) must not come back.
function updatePublic(t: Transaction, userRef: DocumentReference, user: DocumentSnapshot, fields: [FieldPath | string, unknown][]): void {
  if (!user.exists || fields.length === 0) return;
  const [[field, value], ...rest] = fields as [[FieldPath | string, unknown], ...[FieldPath | string, unknown][]];
  t.update(userRef, field, value, ...rest.flat());
}

// The rules and the parser's access checks count a connected mailbox as the
// account's from the private record linked addresses are kept in
// (`users/{uid}/private/emails`'s `mailboxes`), read in the same lookup as
// those; never from the user document's `gmails`, a copy for the apps that
// clients could write before the rules locked it.
function trustMailbox(db: Firestore, t: Transaction, uid: string, address: string): void {
  t.set(db.doc(paths.emailLinks(uid)), { mailboxes: FieldValue.arrayUnion(lower(address)) }, { merge: true });
}

function publicPart(state: GmailState): GmailConnection {
  const { refreshToken: _token, ...connection } = state;
  return connection;
}

// Moves a mailbox connected before there could be several to where every
// mailbox is kept now. Its emails keep the bare message ids they were
// recorded under, so it becomes the account's first for good (`gmailIds`).
// True when there was one to move.
export async function moveLegacyMailbox(db: Firestore, uid: string): Promise<boolean> {
  return db.runTransaction(async (t) => {
    const legacyRef = db.doc(paths.gmailState(uid));
    const userRef = db.doc(paths.user(uid));
    const idsRef = db.doc(paths.gmailIds(uid));
    const legacy = await t.get(legacyRef);
    if (!legacy.exists) return false;
    const state = GmailState.parse(legacy.data());
    const targetRef = mailboxDoc(db, uid, state.emailAddress);
    const [target, ids, user] = await Promise.all([t.get(targetRef), t.get(idsRef), t.get(userRef)]);
    const moved: GmailState = { ...state, idPrefix: "" };
    if (!target.exists) t.set(targetRef, moved);
    if (!ids.exists) t.set(idsRef, { first: lower(state.emailAddress) });
    trustMailbox(db, t, uid, state.emailAddress);
    t.delete(legacyRef);
    // The user document's `gmail` stays as it was, no longer updated, until
    // the mailbox is disconnected: rules and apps from before several
    // mailboxes read only it, and the rules deploy after the parser.
    if (!target.exists) updatePublic(t, userRef, user, [[publicEntry(state.emailAddress), publicPart(moved)]]);
    return true;
  });
}

// Moves every mailbox connected before there could be several, once the
// parser starts; any it misses moves when that user's mailboxes are next
// loaded.
export async function moveLegacyMailboxes(
  db: Firestore,
  log: (severity: "INFO" | "ERROR", event: string, fields: Record<string, unknown>) => void,
): Promise<{ moved: number; failed: number }> {
  const snap = await db.collection("users").where("gmail.connectedAt", ">", "").get();
  let moved = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    try {
      // Those moved already keep their `gmail` (see above): one read each.
      if ((await db.doc(paths.gmailState(doc.id)).get()).exists && (await moveLegacyMailbox(db, doc.id))) moved += 1;
    } catch (error) {
      // Left where it was, which every reader still reads; tried again on
      // the next start or when the user's mailboxes are next loaded.
      failed += 1;
      log("ERROR", "gmail_move_failed", { uid: doc.id, ...errorKind(error) });
    }
  }
  return { moved, failed };
}

async function moveIfLegacy(db: Firestore, uid: string): Promise<void> {
  if ((await db.doc(paths.gmailState(uid)).get()).exists) await moveLegacyMailbox(db, uid);
}

// Every mailbox the user connected, oldest first.
export async function loadMailboxes(db: Firestore, uid: string): Promise<GmailState[]> {
  await moveIfLegacy(db, uid);
  const snap = await mailboxesQuery(db, uid).get();
  return snap.docs.map((d) => GmailState.parse(d.data())).sort((a, b) => a.connectedAt.localeCompare(b.connectedAt) || a.emailAddress.localeCompare(b.emailAddress));
}

// One mailbox, by its address.
export async function loadMailbox(db: Firestore, uid: string, emailAddress: string): Promise<GmailState | undefined> {
  const read = async () => {
    const snap = await mailboxDoc(db, uid, emailAddress).get();
    const state = snap.exists ? GmailState.parse(snap.data()) : undefined;
    return state && lower(state.emailAddress) === lower(emailAddress) ? state : undefined;
  };
  const found = await read();
  if (found) return found;
  await moveIfLegacy(db, uid);
  return read();
}

// The mailbox a request or a queued batch names by key; without one (a
// client or a batch from before there could be several), the user's only
// mailbox, else their first.
export async function resolveMailbox(db: Firestore, uid: string, key?: string): Promise<GmailState | undefined> {
  const all = await loadMailboxes(db, uid);
  if (key !== undefined) return all.find((m) => mailboxKey(m.emailAddress) === key);
  return all.length === 1 ? all[0] : all.find((m) => !m.idPrefix);
}

// A mailbox routes notifications to exactly one user: a second user is
// refused rather than silently taking it over. A user may hold up to
// `maxGmailMailboxes`; connecting one again replaces its connection. The
// account's first mailbox ever keeps Gmail's bare message ids for its
// emails; every other gets ids that name it (gmailIdPrefix), so two
// mailboxes' ids never meet. Returns the connection as stored.
export async function saveConnection(db: Firestore, uid: string, state: GmailState): Promise<GmailState> {
  return db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    const accountRef = db.doc(paths.gmailAccount(state.emailAddress));
    const stateRef = mailboxDoc(db, uid, state.emailAddress);
    const idsRef = db.doc(paths.gmailIds(uid));
    // A connected mailbox's address counts as the user's (SPEC "Linked email
    // addresses"), so one another account linked is refused as one it
    // connected is.
    const linkedRef = db.doc(paths.linkedEmail(lower(state.emailAddress)));
    const userRef = db.doc(paths.user(uid));
    const [account, linked, ids, others, legacy, user] = await Promise.all([
      t.get(accountRef),
      t.get(linkedRef),
      t.get(idsRef),
      t.get(mailboxesQuery(db, uid)),
      t.get(db.doc(paths.gmailState(uid))),
      t.get(userRef),
    ]);
    for (const owner of [account.data()?.uid, linked.data()?.uid] as (string | undefined)[]) {
      if (owner !== undefined && owner !== uid) throw new MailboxConflict(state.emailAddress);
    }
    const connected = new Set(others.docs.map((d) => lower(String(d.get("emailAddress")))));
    if (legacy.exists) connected.add(lower(String(legacy.get("emailAddress"))));
    connected.delete(lower(state.emailAddress));
    if (connected.size >= maxGmailMailboxes) throw new TooManyMailboxes();
    const first = ids.get("first") as string | undefined;
    const idPrefix = first === undefined || first === lower(state.emailAddress) ? "" : gmailIdPrefix(state.emailAddress);
    if (first === undefined) t.set(idsRef, { first: lower(state.emailAddress) });
    trustMailbox(db, t, uid, state.emailAddress);
    const stored: GmailState = { ...state, idPrefix };
    t.set(stateRef, stored);
    // This mailbox's entry replaced whole; the others stay.
    if (user.exists) updatePublic(t, userRef, user, [[publicEntry(state.emailAddress), publicPart(stored)]]);
    else t.set(userRef, { gmails: { [lower(state.emailAddress)]: publicPart(stored) } });
    t.set(accountRef, { uid });
    return stored;
  });
}

// Background work only touches a connection that still exists for the same
// mailbox; a user who disconnected while Gmail was answering must not come
// back as connected, nor be left with a half-formed document.
// With `generation`, also only while the user's trips have not been reset
// since it was read (tripsReset.ts): a mailbox reading that began before
// "Delete all trips" must not write its old place back.
function updateLive(db: Firestore, uid: string, emailAddress: string, fields: Partial<GmailConnection>, generation?: number, trust = false): Promise<boolean> {
  return db.runTransaction(async (t) => {
    const stateRef = mailboxDoc(db, uid, emailAddress);
    const userRef = db.doc(paths.user(uid));
    const [snap, user] = await Promise.all([t.get(stateRef), t.get(userRef)]);
    if (generation !== undefined && generationOf(await t.get(db.doc(paths.importLock(uid)))) !== generation) return false;
    if (!snap.exists || lower(GmailState.parse(snap.data()).emailAddress) !== lower(emailAddress)) return false;
    t.update(stateRef, fields);
    updatePublic(t, userRef, user, Object.entries(fields).map(([key, value]) => [publicEntry(emailAddress, key), value]));
    if (trust) trustMailbox(db, t, uid, emailAddress);
    return true;
  });
}

export function updateWatch(db: Firestore, uid: string, emailAddress: string, watchExpiration: string): Promise<boolean> {
  // Also records the mailbox as the account's again, in case a write that
  // knew nothing of `mailboxes` (a parser from before them, still serving
  // while this one rolled out) replaced the record it is kept in.
  return updateLive(db, uid, emailAddress, { watchExpiration }, undefined, true);
}

// Changes how far the reading of one mailbox has got, as `change` decides
// from the stored progress and the trips' reset generation, read in the same
// transaction; undefined when that mailbox is not connected.
export function changeBackfill<R>(
  db: Firestore,
  uid: string,
  emailAddress: string,
  change: (current: BackfillProgress | undefined, generation: number) => { next?: BackfillProgress | undefined; result: R },
): Promise<{ state: GmailState; generation: number; result: R } | undefined> {
  return db.runTransaction(async (t) => {
    const stateRef = mailboxDoc(db, uid, emailAddress);
    const userRef = db.doc(paths.user(uid));
    const [snap, lock, user] = await Promise.all([t.get(stateRef), t.get(db.doc(paths.importLock(uid))), t.get(userRef)]);
    if (!snap.exists) return undefined;
    const state = GmailState.parse(snap.data());
    if (lower(state.emailAddress) !== lower(emailAddress)) return undefined;
    const generation = generationOf(lock);
    const { next, result } = change(state.backfill, generation);
    if (next) {
      t.update(stateRef, { backfill: next });
      updatePublic(t, userRef, user, [[publicEntry(emailAddress, "backfill"), next]]);
    }
    return { state, generation, result };
  });
}

export function updateHistoryId(db: Firestore, uid: string, emailAddress: string, historyId: string, generation?: number): Promise<boolean> {
  return updateLive(db, uid, emailAddress, { historyId }, generation);
}

// Removes one mailbox's connection, wherever it is kept, and its owner
// mapping if it is this user's. The account's first mailbox stays the one
// with bare ids (`gmailIds`), so connecting it again finds its emails.
export async function removeConnection(db: Firestore, uid: string, emailAddress: string): Promise<void> {
  await db.runTransaction(async (t) => {
    const accountRef = db.doc(paths.gmailAccount(emailAddress));
    const userRef = db.doc(paths.user(uid));
    const legacyRef = db.doc(paths.gmailState(uid));
    const linksRef = db.doc(paths.emailLinks(uid));
    const [account, user, legacy, links] = await Promise.all([t.get(accountRef), t.get(userRef), t.get(legacyRef), t.get(linksRef)]);
    const owner = account.data()?.uid as string | undefined;
    t.delete(mailboxDoc(db, uid, emailAddress));
    // Never recreated for a deleted account.
    if (links.exists) t.update(linksRef, { mailboxes: FieldValue.arrayRemove(lower(emailAddress)) });
    if (legacy.exists && lower(String(legacy.get("emailAddress"))) === lower(emailAddress)) t.delete(legacyRef);
    const old = user.get("gmail") as { emailAddress?: unknown } | undefined;
    const dropOld = typeof old?.emailAddress === "string" && lower(old.emailAddress) === lower(emailAddress);
    updatePublic(t, userRef, user, [[publicEntry(emailAddress), FieldValue.delete()], ...(dropOld ? ([["gmail", FieldValue.delete()]] as [string, unknown][]) : [])]);
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
