import { ImapState, mailboxKey, maxImapMailboxes, paths, type BackfillProgress, type ImapConnection } from "@travelmo/core";
import { FieldPath, FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { refuseIfDeleted } from "./deleted";
import { credentialContext, credentialSealer, withOpenedCredential } from "./sealing";
import { generationOf, imapMailboxesQuery } from "./store";

// Mailboxes connected over IMAP (SPEC "Connected IMAP mailboxes"), up to
// maxImapMailboxes per user, as Gmail's are: each one's app password,
// server and state in `users/{uid}/private/imap-<key>` (server only), and
// what Settings shows in the user document's `imaps`, by lowercased
// address. The password is stored sealed (sealing.ts); every function here
// takes and returns it unsealed.

const lower = (address: string) => address.trim().toLowerCase();
const stateRef = (db: Firestore, uid: string, address: string) => db.doc(paths.imapMailbox(uid, mailboxKey(address)));
const publicEntry = (address: string, ...rest: string[]) => new FieldPath("imaps", lower(address), ...rest);

export class TooManyImapMailboxes extends Error {
  constructor() {
    super(`You can connect up to ${maxImapMailboxes} mailboxes this way. Disconnect one first.`);
  }
}

async function openState(uid: string, state: ImapState): Promise<ImapState> {
  return { ...state, password: await credentialSealer().open(state.password, credentialContext.imap(uid, state.emailAddress)) };
}

function publicPart(state: ImapState): ImapConnection {
  const { password: _password, host: _host, port: _port, mailboxState: _state, lastPolledAt: _polled, passwordId: _id, ...connection } = state;
  return connection;
}

// Writes fields of the user document's `imaps` by field path (an address
// has dots in it), only on a user document that exists: one already
// deleted (account deletion) must not come back.
function updatePublic(t: Transaction, userRef: DocumentReference, user: DocumentSnapshot, fields: [FieldPath, unknown][]): void {
  if (!user.exists || fields.length === 0) return;
  const [[field, value], ...rest] = fields as [[FieldPath, unknown], ...[FieldPath, unknown][]];
  t.update(userRef, field, value, ...rest.flat());
}

// Every IMAP mailbox the user connected, oldest first.
export async function loadImapMailboxes(db: Firestore, uid: string): Promise<ImapState[]> {
  const snap = await imapMailboxesQuery(db, uid).get();
  const all = await Promise.all(snap.docs.map((d) => openState(uid, ImapState.parse(d.data()))));
  return all.sort((a, b) => a.connectedAt.localeCompare(b.connectedAt) || lower(a.emailAddress).localeCompare(lower(b.emailAddress)));
}

// One mailbox, by its address or its key.
export async function loadImapMailbox(db: Firestore, uid: string, mailbox: { emailAddress: string } | { key: string }): Promise<ImapState | undefined> {
  const ref = "key" in mailbox ? db.doc(paths.imapMailbox(uid, mailbox.key)) : stateRef(db, uid, mailbox.emailAddress);
  const snap = await ref.get();
  if (!snap.exists) return undefined;
  const state = ImapState.parse(snap.data());
  if ("emailAddress" in mailbox && lower(state.emailAddress) !== lower(mailbox.emailAddress)) return undefined;
  return openState(uid, state);
}

// Connecting a mailbox already connected takes the new password and server
// and keeps its place, its reading and when it was first connected; a
// sixth is refused. Returns the connection as stored, its password as
// given.
export async function saveImapConnection(db: Firestore, uid: string, state: ImapState): Promise<ImapState> {
  // Sealed before the transaction, which may run more than once.
  const password = await credentialSealer().seal(state.password, credentialContext.imap(uid, state.emailAddress));
  return db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    const ref = stateRef(db, uid, state.emailAddress);
    const userRef = db.doc(paths.user(uid));
    const [current, others, user] = await Promise.all([t.get(ref), t.get(imapMailboxesQuery(db, uid)), t.get(userRef)]);
    const existing = current.exists ? ImapState.parse(current.data()) : undefined;
    if (!existing && others.size >= maxImapMailboxes) throw new TooManyImapMailboxes();
    const { loginFailedAt: _failed, ...given } = state;
    const fresh: ImapState = { ...given, passwordId: randomUUID() };
    const sameServer = existing && existing.host === state.host && existing.port === state.port;
    const next: ImapState = existing
      ? {
          ...fresh,
          connectedAt: existing.connectedAt,
          // Another server is another inbox: its UIDs say nothing of the old
          // one's, so the place and the reading start afresh there.
          ...(sameServer && existing.mailboxState ? { mailboxState: existing.mailboxState } : {}),
          ...(sameServer && existing.backfill ? { backfill: existing.backfill } : {}),
        }
      : fresh;
    t.set(ref, { ...next, password });
    if (user.exists) updatePublic(t, userRef, user, [[publicEntry(state.emailAddress), publicPart(next)]]);
    else t.set(userRef, { imaps: { [lower(state.emailAddress)]: publicPart(next) } });
    return next;
  });
}

type LiveFields = { mailboxState?: string; lastPolledAt?: string; loginFailedAt?: string | null };

// A mailbox as background work read it: the address on its server, and
// the password it was read with.
export type ImapMailboxRef = Pick<ImapState, "emailAddress" | "host" | "port" | "passwordId">;

// Background work only touches a connection that still exists for the same
// mailbox on the same server (not one reconnected to another server while
// it ran), and with `generation`, only while the user's trips have not been
// reset since it was read (see connections.ts's updateLive).
// `loginFailedAt: null` clears it.
export function updateImapLive(db: Firestore, uid: string, mailbox: ImapMailboxRef, fields: LiveFields, generation?: number): Promise<boolean> {
  const { emailAddress } = mailbox;
  return db.runTransaction(async (t) => {
    const ref = stateRef(db, uid, emailAddress);
    const userRef = db.doc(paths.user(uid));
    const [snap, user] = await Promise.all([t.get(ref), t.get(userRef)]);
    if (generation !== undefined && generationOf(await t.get(db.doc(paths.importLock(uid)))) !== generation) return false;
    if (!snap.exists) return false;
    const stored = ImapState.parse(snap.data());
    if (lower(stored.emailAddress) !== lower(emailAddress) || stored.host !== mailbox.host || stored.port !== mailbox.port) return false;
    // A new password saved meanwhile: what the old one found says nothing
    // of it (a refused old password must not mark the new one).
    if (stored.passwordId !== mailbox.passwordId) return false;
    t.update(ref, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? FieldValue.delete() : v])));
    if (fields.loginFailedAt !== undefined) {
      updatePublic(t, userRef, user, [[publicEntry(emailAddress, "loginFailedAt"), fields.loginFailedAt ?? FieldValue.delete()]]);
    }
    return true;
  });
}

// The server refused the password at `at`: background reads leave the
// mailbox alone for a while (imap.ts's imapLoginBackoffMs) and Settings says so.
export function markImapLoginFailed(db: Firestore, uid: string, mailbox: ImapMailboxRef, at: string): Promise<boolean> {
  return updateImapLive(db, uid, mailbox, { loginFailedAt: at });
}

// As connections.ts's changeBackfill, for one IMAP mailbox.
export async function changeImapBackfill<R>(
  db: Firestore,
  uid: string,
  emailAddress: string,
  change: (current: BackfillProgress | undefined, generation: number) => { next?: BackfillProgress | undefined; result: R },
): Promise<{ state: ImapState; generation: number; result: R } | undefined> {
  const ref = stateRef(db, uid, emailAddress);
  const changed = await withOpenedCredential(
    async () => {
      const snap = await ref.get();
      return snap.exists ? ImapState.parse(snap.data()) : undefined;
    },
    (state) => state.password,
    async (state) => (await openState(uid, state)).password,
    (unchanged) =>
      db.runTransaction(async (t) => {
        const userRef = db.doc(paths.user(uid));
        const [snap, lock, user] = await Promise.all([t.get(ref), t.get(db.doc(paths.importLock(uid))), t.get(userRef)]);
        if (!snap.exists) return undefined;
        const state = ImapState.parse(snap.data());
        if (lower(state.emailAddress) !== lower(emailAddress)) return undefined;
        if (!unchanged(state)) return "replaced" as const;
        const generation = generationOf(lock);
        const { next, result } = change(state.backfill, generation);
        if (next) {
          t.update(ref, { backfill: next });
          updatePublic(t, userRef, user, [[publicEntry(emailAddress, "backfill"), next]]);
        }
        return { state, rest: { generation, result } };
      }),
  );
  return changed && { ...changed.rest, state: { ...changed.state, password: changed.opened } };
}

// Forgets the mailbox: its password and state, and its entry in `imaps`.
export async function removeImapConnection(db: Firestore, uid: string, emailAddress: string): Promise<void> {
  await db.runTransaction(async (t) => {
    const userRef = db.doc(paths.user(uid));
    const user = await t.get(userRef);
    t.delete(stateRef(db, uid, emailAddress));
    updatePublic(t, userRef, user, [[publicEntry(emailAddress), FieldValue.delete()]]);
  });
}

// Every connected IMAP mailbox of every user, for the poll for new mail:
// the `private` documents with a password (an index covers it,
// firestore.indexes.json).
export async function imapMailboxesToPoll(db: Firestore): Promise<{ uid: string; emailAddress: string }[]> {
  const snap = await db.collectionGroup("private").where("password", ">", "").get();
  return snap.docs.flatMap((d) => {
    const user = d.ref.parent.parent;
    const emailAddress: unknown = d.get("emailAddress");
    if (!user || user.parent.id !== "users" || !d.id.startsWith("imap-") || typeof emailAddress !== "string") return [];
    return [{ uid: user.id, emailAddress }];
  });
}

