import { GmailState, paths, type BackfillProgress, type GmailConnection } from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

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

type OAuthState = { uid: string; createdAt: string };
export type PendingConnection = { uid: string; refreshToken: string; createdAt: string };

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

export async function createOAuthState(db: Firestore, nonce: string, uid: string, now: string): Promise<void> {
  await db.doc(paths.oauthState(nonce)).create({ uid, createdAt: now } satisfies OAuthState);
}

export function takeOAuthState(db: Firestore, nonce: string, now: number): Promise<OAuthState | undefined> {
  return take<OAuthState>(db, paths.oauthState(nonce), now);
}

export async function savePending(db: Firestore, token: string, pending: PendingConnection): Promise<void> {
  await db.doc(paths.pendingConnection(token)).create(pending);
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
function updateLive(db: Firestore, uid: string, emailAddress: string, fields: Partial<GmailConnection>): Promise<boolean> {
  return db.runTransaction(async (t) => {
    const stateRef = db.doc(paths.gmailState(uid));
    const snap = await t.get(stateRef);
    if (!snap.exists || GmailState.parse(snap.data()).emailAddress !== emailAddress) return false;
    t.update(stateRef, fields);
    t.set(db.doc(paths.user(uid)), { gmail: fields }, { merge: true });
    return true;
  });
}

export function updateWatch(db: Firestore, uid: string, emailAddress: string, watchExpiration: string): Promise<boolean> {
  return updateLive(db, uid, emailAddress, { watchExpiration });
}

export function updateBackfill(db: Firestore, uid: string, emailAddress: string, backfill: BackfillProgress): Promise<boolean> {
  return updateLive(db, uid, emailAddress, { backfill });
}

export function updateHistoryId(db: Firestore, uid: string, emailAddress: string, historyId: string): Promise<boolean> {
  return updateLive(db, uid, emailAddress, { historyId });
}

export async function removeConnection(db: Firestore, uid: string, emailAddress: string): Promise<void> {
  await db.runTransaction(async (t) => {
    const accountRef = db.doc(paths.gmailAccount(emailAddress));
    const owner = (await t.get(accountRef)).data()?.uid as string | undefined;
    t.delete(db.doc(paths.gmailState(uid)));
    t.set(db.doc(paths.user(uid)), { gmail: FieldValue.delete() }, { merge: true });
    if (owner === uid) t.delete(accountRef);
  });
}
