import { GmailState, paths, type GmailConnection } from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

export const oauthStateTtlMs = 10 * 60 * 1000;

export class MailboxConflict extends Error {
  constructor(emailAddress: string) {
    super(`${emailAddress} is already connected to another account`);
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

// A mailbox routes notifications to exactly one user; a second user trying
// to connect it is refused rather than silently taking it over.
export async function saveConnection(db: Firestore, uid: string, state: GmailState): Promise<void> {
  await db.runTransaction(async (t) => {
    const accountRef = db.doc(paths.gmailAccount(state.emailAddress));
    const owner = (await t.get(accountRef)).data()?.uid as string | undefined;
    if (owner !== undefined && owner !== uid) throw new MailboxConflict(state.emailAddress);
    t.set(db.doc(paths.gmailState(uid)), state);
    t.set(db.doc(paths.user(uid)), { gmail: publicPart(state) }, { merge: true });
    t.set(accountRef, { uid });
  });
}

export async function updateWatch(db: Firestore, uid: string, state: GmailState): Promise<void> {
  const batch = db.batch();
  batch.set(db.doc(paths.gmailState(uid)), state);
  batch.set(db.doc(paths.user(uid)), { gmail: publicPart(state) }, { merge: true });
  await batch.commit();
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
