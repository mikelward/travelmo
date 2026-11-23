import { normalizeEmail } from "./access";
import { stableHash } from "./hash";
import type { GmailConnection } from "./schema";
import { gmailMessageUrl } from "./sources";

// Several Gmail mailboxes per account (SPEC "Connecting Gmail"). Pure and
// shared by the parser, the web app and (apps/android :core, Gmail.kt) the
// Android app.

// How many mailboxes one account may connect.
export const maxGmailMailboxes = 5;

// What names a mailbox where its address should not appear: its token
// document (`users/{uid}/private/gmail-<key>`), a queued batch of its
// reading, the logs, and its emails' source ids.
export function mailboxKey(address: string): string {
  return stableHash(address.trim().toLowerCase());
}

// Gmail message ids are unique within a mailbox only, so the emails of
// every mailbox but the account's first are recorded under ids that carry
// the mailbox's key. The first keeps the bare message ids it always had.
// Gmail's ids are hexadecimal, so no bare id starts like this.
export function gmailIdPrefix(address: string): string {
  return `gmail-${mailboxKey(address)}-`;
}

const prefixed = /^gmail-([0-9a-z]+)-(.+)$/;

// The mailbox (by key; none for the first) and Gmail's own id of an email
// source or import record.
export function parseGmailSourceId(sourceId: string): { key?: string; messageId: string } {
  const match = prefixed.exec(sourceId);
  return match ? { key: match[1]!, messageId: match[2]! } : { messageId: sourceId };
}

// The user's connected mailboxes, oldest connection first.
export function gmailMailboxes<C extends { emailAddress: string; connectedAt?: string | undefined }>(
  user: { gmail?: C | undefined; gmails?: Record<string, C> | undefined } | undefined,
): C[] {
  const out = Object.values(user?.gmails ?? {});
  const legacy = user?.gmail;
  if (legacy && !out.some((m) => normalizeEmail(m.emailAddress) === normalizeEmail(legacy.emailAddress))) out.push(legacy);
  return out.sort((a, b) => (a.connectedAt ?? "").localeCompare(b.connectedAt ?? "") || a.emailAddress.localeCompare(b.emailAddress));
}

// The connected mailbox an email source or import record came from, if it
// is still connected: by the key its id carries, else the first mailbox
// (one without a prefix, as one connected before there could be several).
export function sourceMailbox<C extends Pick<GmailConnection, "emailAddress" | "idPrefix">>(sourceId: string, mailboxes: readonly C[]): C | undefined {
  const { key } = parseGmailSourceId(sourceId);
  if (key === undefined) return mailboxes.find((m) => !m.idPrefix);
  return mailboxes.find((m) => m.idPrefix === `gmail-${key}-`);
}

// Opens an imported email in the mailbox it came from; once that is
// disconnected, in whichever account the browser has open first.
export function gmailSourceLink<C extends Pick<GmailConnection, "emailAddress" | "idPrefix">>(sourceId: string, mailboxes: readonly C[]): string {
  return gmailMessageUrl(parseGmailSourceId(sourceId).messageId, sourceMailbox(sourceId, mailboxes)?.emailAddress);
}
