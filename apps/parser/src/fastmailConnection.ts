import { FastmailState, paths, type BackfillProgress, type FastmailConnection } from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { refuseIfDeleted } from "./deleted";
import { generationOf } from "./store";

// A Fastmail connection: the read-only API token and the mailbox's state in
// `users/{uid}/private/fastmail` (server only), and what Settings shows in
// the user document's `fastmail`.

export async function loadFastmailState(db: Firestore, uid: string): Promise<FastmailState | undefined> {
  const snap = await db.doc(paths.fastmailState(uid)).get();
  return snap.exists ? FastmailState.parse(snap.data()) : undefined;
}

function publicPart(state: FastmailState): FastmailConnection {
  const { token: _token, accountId: _account, emailState: _state, lastPolledAt: _polled, ...connection } = state;
  return connection;
}

export class OtherMailboxConnected extends Error {
  constructor(public readonly emailAddress: string) {
    super(`${emailAddress} is still connected; disconnect it first`);
  }
}

// A user holds one Fastmail mailbox: connecting another means disconnecting
// the first. Connecting the same one again replaces its token and keeps
// its place.
export async function saveFastmailConnection(db: Firestore, uid: string, state: FastmailState): Promise<FastmailState> {
  return db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    const stateRef = db.doc(paths.fastmailState(uid));
    const current = await t.get(stateRef);
    const existing = current.exists ? FastmailState.parse(current.data()) : undefined;
    if (existing && existing.emailAddress !== state.emailAddress) throw new OtherMailboxConnected(existing.emailAddress);
    const next: FastmailState = existing
      ? {
          ...state,
          connectedAt: existing.connectedAt,
          ...(existing.emailState ? { emailState: existing.emailState } : {}),
          ...(existing.backfill ? { backfill: existing.backfill } : {}),
        }
      : state;
    t.set(stateRef, next);
    t.set(db.doc(paths.user(uid)), { fastmail: publicPart(next) }, { merge: true });
    return next;
  });
}

// Background work only touches a connection that still exists for the same
// mailbox, and with `generation`, only while the user's trips have not been
// reset since it was read (see connections.ts's updateLive).
export function updateFastmailLive(
  db: Firestore,
  uid: string,
  emailAddress: string,
  fields: Partial<Pick<FastmailState, "emailState" | "lastPolledAt">>,
  generation?: number,
): Promise<boolean> {
  return db.runTransaction(async (t) => {
    const stateRef = db.doc(paths.fastmailState(uid));
    const snap = await t.get(stateRef);
    if (generation !== undefined && generationOf(await t.get(db.doc(paths.importLock(uid)))) !== generation) return false;
    if (!snap.exists || FastmailState.parse(snap.data()).emailAddress !== emailAddress) return false;
    t.update(stateRef, fields);
    return true;
  });
}

// As connections.ts's changeBackfill, for the Fastmail mailbox.
export function changeFastmailBackfill<R>(
  db: Firestore,
  uid: string,
  change: (current: BackfillProgress | undefined, generation: number) => { next?: BackfillProgress | undefined; result: R },
): Promise<{ state: FastmailState; generation: number; result: R } | undefined> {
  return db.runTransaction(async (t) => {
    const stateRef = db.doc(paths.fastmailState(uid));
    const [snap, lock] = await Promise.all([t.get(stateRef), t.get(db.doc(paths.importLock(uid)))]);
    if (!snap.exists) return undefined;
    const state = FastmailState.parse(snap.data());
    const generation = generationOf(lock);
    const { next, result } = change(state.backfill, generation);
    if (next) {
      t.update(stateRef, { backfill: next });
      t.set(db.doc(paths.user(uid)), { fastmail: { backfill: next } }, { mergeFields: ["fastmail.backfill"] });
    }
    return { state, generation, result };
  });
}

export async function removeFastmailConnection(db: Firestore, uid: string): Promise<void> {
  await db.runTransaction(async (t) => {
    const userRef = db.doc(paths.user(uid));
    // An update, not a merge: a user document already deleted (account
    // deletion) must not come back empty.
    const userExists = (await t.get(userRef)).exists;
    t.delete(db.doc(paths.fastmailState(uid)));
    if (userExists) t.update(userRef, { fastmail: FieldValue.delete() });
  });
}

// Every user with Fastmail connected, for the poll for new mail.
export async function fastmailUsers(db: Firestore): Promise<string[]> {
  const snap = await db.collection("users").where("fastmail.connectedAt", ">", "").get();
  return snap.docs.map((d) => d.id);
}
