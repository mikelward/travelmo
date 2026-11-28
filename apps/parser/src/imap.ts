import { imapRecordId, imapRecordPrefix, parseImapRecordId } from "@travelmo/core";
import { ImapFlow, type SearchObject } from "imapflow";
import { isIP } from "node:net";
import { backfillBatch, backfillSubjects, documentSubjects, statementDays, statementSubjects } from "./backfill";
import type { EmailMessage, MessagePage } from "./gmail";
import { offered, parseInbound } from "./inbound";
import { errorKind, log } from "./log";
import type { MailSource } from "./mailSource";
import type { ChangesResult } from "./newMailPoll";
import { travelDocumentDomains } from "./prefilter";
import { isPublicAddress, publicOnlyLookup } from "./safefetch";

// Any mailbox over IMAP (RFC 9051, RFC 3501) with an app password: iCloud,
// Yahoo, Infomaniak and the like, whose providers offer no OAuth for mail.
// Only the inbox is read, opened read-only (EXAMINE), and nothing here can
// write: the client type below has no command that changes a mailbox.
// Connections are implicit TLS only (port 993 usually); a server that
// offers only plaintext or STARTTLS is refused.

// What the import reads of a message at most: its text and the PDFs the
// model is shown (gmail.ts's limits) fit, as a forwarded message's do
// (inbound.ts); a message cut off here keeps its text but not its PDFs.
export const imapMaxBytes = 16 * 1024 * 1024;

// New mail one poll imports at most, oldest first; the rest waits for the
// next poll.
export const imapPollBatch = 200;

// The commands the import uses, which imapflow's ImapFlow has; tests stand
// in a fake. Opening the inbox goes through getMailboxLock with readOnly,
// which imapflow sends as EXAMINE.
export type ImapClient = {
  connect(): Promise<void>;
  getMailboxLock(path: string, options: { readOnly: true }): Promise<{ release(): void }>;
  readonly mailbox: false | { uidValidity: bigint; uidNext: number; readOnly?: boolean | undefined };
  search(query: SearchObject, options: { uid: true }): Promise<number[] | false | undefined>;
  fetchOne(uid: string, query: { uid: true; source: { maxLength: number } }, options: { uid: true }): Promise<{ uid: number; source?: Buffer | undefined } | false>;
  logout(): Promise<void>;
  close(): void;
};

export type ImapLogin = { host: string; port: number; user: string; password: string };

// The server refused the address and password (imapflow's
// AuthenticationFailure, or one with `authenticationFailed`).
export function isImapAuthFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { authenticationFailed?: unknown }).authenticationFailed === true;
}

// A server the parser will not connect to: on a private network, or not
// a host name at all.
export class ImapServerRefused extends Error {
  constructor() {
    super("That server is on a private network.");
    this.name = "ImapServerRefused";
  }
}

// A message no longer in the inbox, or one whose UID the inbox no longer
// honors (its UIDVALIDITY changed), as Gmail's 404.
export class ImapNotFound extends Error {
  readonly status = 404;
  constructor() {
    super("IMAP message not found");
    this.name = "ImapNotFound";
  }
}

// The backfill's cursor names an inbox UIDVALIDITY no longer current: its
// UIDs mean other messages now, so the reading starts over.
export class ImapCursorStale extends Error {
  constructor() {
    super("The inbox's UIDVALIDITY changed");
    this.name = "ImapCursorStale";
  }
}

function checkServer(host: string): void {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) ? !isPublicAddress(bare) : bare === "localhost" || bare.endsWith(".localhost") || bare.endsWith(".internal") || !bare.includes(".")) {
    throw new ImapServerRefused();
  }
}

// imapflow's client: implicit TLS whatever the port (no STARTTLS, no
// plaintext), certificates checked, only to public addresses (checked
// where the connection is made, as feeds are), no IDLE, nothing logged
// (its logs would carry addresses and subjects), and timeouts well inside
// a request. `onError` hears errors the connection raises between
// commands, which would otherwise crash the process.
export function imapFlowClient(login: ImapLogin, onError: (error: unknown) => void): ImapClient {
  checkServer(login.host);
  const client = new ImapFlow({
    host: login.host,
    port: login.port,
    secure: true,
    auth: { user: login.user, pass: login.password },
    tls: { lookup: publicOnlyLookup(), minVersion: "TLSv1.2", rejectUnauthorized: true },
    logger: false,
    disableAutoIdle: true,
    clientInfo: { name: "Travelmo" },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  client.on("error", onError);
  return client;
}

// The inbox, open read-only, and what its UIDs are relative to.
export type ImapInbox = {
  uidValidity: string;
  // The UID the next message will get: every message below it was there
  // when the inbox was opened.
  uidNext: number;
  client: ImapClient;
};

// A login the server refuses fails here (isImapAuthFailure), the
// connection dropped.
export async function openInbox(client: ImapClient): Promise<ImapInbox> {
  try {
    await client.connect();
    await client.getMailboxLock("INBOX", { readOnly: true });
    const box = client.mailbox;
    if (!box) throw new Error("The IMAP server opened no inbox");
    return { uidValidity: box.uidValidity.toString(), uidNext: box.uidNext, client };
  } catch (error) {
    client.close();
    throw error;
  }
}

// Ends the session politely, or drops it if the server does not answer.
export async function closeInbox(client: ImapClient): Promise<void> {
  try {
    await client.logout();
  } catch (error) {
    // The connection is gone either way; nothing was written, so nothing is lost.
    log("DEBUG", "imap_logout_failed", errorKind(error));
    client.close();
  }
}

const day = 24 * 60 * 60 * 1000;

// The backfill's search (backfill.ts) in IMAP SEARCH: any booking-like
// subject, or a statement-like one from the last 60 days. IMAP matches
// subjects as substrings, so this finds somewhat more than Gmail's word
// search; the pre-filter and the model decide. Statements are not narrowed
// to travel programs' senders, as one SEARCH cannot AND two ORs without
// repeating one per term; the pre-filter does it.
export function backfillSearch(now: Date): SearchObject {
  const since = new Date(now.getTime() - statementDays * day);
  return {
    or: [
      ...backfillSubjects.map((subject) => ({ subject })),
      ...documentSubjects.map((subject) => ({ subject })),
      ...travelDocumentDomains.map((from) => ({ from })),
      { since, or: statementSubjects.map((subject) => ({ subject })) },
    ],
  };
}

// Where a reading has got to: the inbox's UIDVALIDITY and the lowest UID
// read so far. Pages go down from there, newest first, so mail arriving
// meanwhile shifts nothing.
function parseCursor(cursor: string): { uidValidity: string; below: number } {
  const [uidValidity, below] = cursor.split(":");
  const n = Number(below);
  if (!uidValidity || !Number.isSafeInteger(n) || n < 1) throw new ImapCursorStale();
  return { uidValidity, below: n };
}

// One page of the search, newest (highest UID) first, below the cursor.
// The server answers the whole search at once; this keeps a batch's worth.
export async function searchPage(inbox: ImapInbox, key: string, query: SearchObject, cursor: string | undefined, limit = backfillBatch): Promise<MessagePage> {
  let range: SearchObject = {};
  if (cursor) {
    const { uidValidity, below } = parseCursor(cursor);
    if (uidValidity !== inbox.uidValidity) throw new ImapCursorStale();
    if (below <= 1) return { ids: [] };
    range = { uid: `1:${below - 1}` };
  }
  const found = (await inbox.client.search({ ...query, ...range }, { uid: true })) || [];
  // `1:n` may still answer a UID above n on some servers; kept out.
  const bound = cursor ? parseCursor(cursor).below : Infinity;
  const uids = [...new Set(found)].filter((uid) => uid < bound).sort((a, b) => b - a).slice(0, limit);
  const last = uids[uids.length - 1];
  return {
    ids: uids.map((uid) => imapRecordId(key, inbox.uidValidity, uid)),
    ...(uids.length === limit && last !== undefined && last > 1 ? { nextPageToken: `${inbox.uidValidity}:${last}` } : {}),
  };
}

// One message, downloaded whole up to imapMaxBytes and reduced as a
// forwarded one is (inbound.ts's parseInbound), its PDFs included.
export async function fetchMessage(inbox: ImapInbox, key: string, id: string): Promise<EmailMessage> {
  const parsed = parseImapRecordId(id);
  if (!parsed || parsed.key !== key) throw new Error("Not a record id of this IMAP mailbox");
  if (parsed.uidValidity !== inbox.uidValidity) throw new ImapNotFound();
  const found = await inbox.client.fetchOne(String(parsed.uid), { uid: true, source: { maxLength: imapMaxBytes } }, { uid: true });
  if (!found || found.uid !== parsed.uid || !found.source) throw new ImapNotFound();
  const mail = await parseInbound(found.source, found.source.length < imapMaxBytes);
  return { id, threadId: id, from: mail.from, subject: mail.subject, date: mail.date, listUnsubscribe: mail.listUnsubscribe, text: mail.text, ...offered(mail.attachments) };
}

// Where new mail is read from: the inbox's UIDVALIDITY and the last UID
// read, `<uidvalidity>:<uid>`.
export function currentMailboxState(inbox: ImapInbox): string {
  return `${inbox.uidValidity}:${Math.max(0, inbox.uidNext - 1)}`;
}

// Mail that reached the inbox after `since`, oldest first, as record ids,
// up to imapPollBatch, and the state to read on from; "expired" when the
// inbox's UIDVALIDITY changed, so the old UIDs say nothing.
export async function newSince(inbox: ImapInbox, key: string, since: string, limit = imapPollBatch): Promise<ChangesResult | "expired"> {
  const [uidValidity, last] = since.split(":");
  const lastUid = Number(last);
  if (uidValidity !== inbox.uidValidity || !Number.isSafeInteger(lastUid) || lastUid < 0) return "expired";
  if (inbox.uidNext - 1 <= lastUid) return { created: [], state: since };
  // `n:*` answers the newest message even when it is below n.
  const found = (await inbox.client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || [];
  const uids = [...new Set(found)].filter((uid) => uid > lastUid).sort((a, b) => a - b);
  const taken = uids.slice(0, limit);
  const upTo = uids.length > limit ? taken[taken.length - 1]! : Math.max(inbox.uidNext - 1, ...taken);
  return { created: taken.map((uid) => imapRecordId(key, inbox.uidValidity, uid)), state: `${inbox.uidValidity}:${upTo}` };
}

export const isImapNotFound = (error: unknown) => error instanceof ImapNotFound;

// How long after the server refused a password background reads leave the
// mailbox alone: providers lock out an account that keeps failing.
export const imapLoginBackoffMs = 60 * 60 * 1000;

export function inLoginBackoff(state: { loginFailedAt?: string | undefined }, nowMs: number): boolean {
  return state.loginFailedAt !== undefined && nowMs - Date.parse(state.loginFailedAt) < imapLoginBackoffMs;
}

// A background read of a mailbox whose password the server refused within
// imapLoginBackoffMs: not tried, so the provider sees no more failures.
export class ImapLoginPaused extends Error {
  constructor() {
    super("The server refused this mailbox's app password recently");
    this.name = "ImapLoginPaused";
  }
}

// Opens a stored mailbox's inbox. A refused password is reported
// (`loginFailed`, which records it), so background reads (`background`)
// leave the mailbox alone for imapLoginBackoffMs rather than have the
// provider lock the account; reads the user asks for always try.
export async function connectMailbox(options: {
  loginFailedAt?: string | undefined;
  background: boolean;
  nowMs: number;
  open: () => Promise<ImapInbox>;
  loginFailed: () => Promise<void>;
}): Promise<ImapInbox> {
  if (options.background && inLoginBackoff(options, options.nowMs)) throw new ImapLoginPaused();
  try {
    return await options.open();
  } catch (error) {
    if (isImapAuthFailure(error)) await options.loginFailed();
    throw error;
  }
}

export type ImapSource = MailSource & {
  // The open inbox, for the poll's own reads.
  inbox: () => Promise<ImapInbox>;
  // New mail since `since`, as ids this source fetches (newSince).
  newSince: (since: string) => Promise<ChangesResult | "expired">;
  close: () => Promise<void>;
};

// The mailbox (by key) as a MailSource. It connects once something is
// read, and keeps one connection until `close`, which its user calls.
export function imapSource(key: string, connect: () => Promise<ImapInbox>, now: () => Date = () => new Date()): ImapSource {
  let opened: Promise<ImapInbox> | undefined;
  const inbox = () => (opened ??= connect());
  return {
    provider: "imap",
    inbox,
    searchPage: async (cursor) => searchPage(await inbox(), key, backfillSearch(now()), cursor),
    fetch: async (id) => fetchMessage(await inbox(), key, id),
    newSince: async (since) => newSince(await inbox(), key, since),
    isStaleCursor: (error) => error instanceof ImapCursorStale,
    isNotFound: isImapNotFound,
    close: async () => {
      if (!opened) return;
      const pending = opened;
      opened = undefined;
      let open: ImapInbox;
      try {
        open = await pending;
      } catch (error) {
        // It never opened, and its failure went to whoever read it; there
        // is nothing to close.
        log("DEBUG", "imap_close_unopened", errorKind(error));
        return;
      }
      await closeInbox(open.client);
    },
  };
}

export { imapRecordPrefix };
