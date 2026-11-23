import { normalizeEmail } from "./access";
import type { PendingEmail } from "./schema";

// Linked email addresses (SPEC "Linked email addresses"): a user signs in
// with one Google account but may own other addresses; each one confirmed
// counts as them wherever Travelmo knows people by email (sharing, trusted
// travel profiles, access). This module holds what is pure about it, the
// same for the web app, the parser and (apps/android :core, Emails.kt) the
// Android app.

// How many addresses an account may link besides its sign-in, pending ones
// included. With the sign-in and a connected Gmail that stays well under
// Firestore's limit of 30 values in one `array-contains-any` query.
export const maxLinkedEmails = 10;
export const maxQueryEmails = 30;
// How long a confirmation link works, and how many confirmation emails an
// account may send a day.
export const confirmationTtlMs = 24 * 60 * 60 * 1000;
export const dailyConfirmationLimit = 5;

// What `users/{uid}` says about the account's addresses: `emails`, those it
// confirmed (server-written), and the Gmail mailbox it connected, which
// counts as confirmed while it stays connected: the consent proved it.
export type AddressHolder = {
  emails?: readonly string[] | undefined;
  gmail?: { emailAddress: string } | undefined;
};

const unique = (emails: Iterable<string | undefined>): string[] => [...new Set([...emails].filter((e): e is string => !!e))];

// The addresses the account confirmed besides its sign-in, lowercased:
// those it linked, then its connected Gmail.
export function linkedEmails(user: AddressHolder | undefined): string[] {
  return unique([...(user?.emails ?? []).map((e) => normalizeEmail(e)), normalizeEmail(user?.gmail?.emailAddress)]);
}

// Every address that is the account's: its verified sign-in first.
export function myAddresses(signIn: string | null | undefined, user: AddressHolder | undefined): string[] {
  return unique([normalizeEmail(signIn), ...linkedEmails(user)]);
}

// The addresses a client asks about in one `array-contains-any` query; the
// link limit keeps the list within it, so nothing is dropped in practice.
export const queryAddresses = (addresses: readonly string[]): string[] => addresses.slice(0, maxQueryEmails);

export function isMine(email: string | null | undefined, addresses: readonly string[]): boolean {
  const normalized = normalizeEmail(email);
  return !!normalized && addresses.includes(normalized);
}

// Whether a trip's `sharedWith` or a profile's `trustedEmails` names the
// account by any of its addresses.
export function sharedWithAny(list: readonly string[], addresses: readonly string[]): boolean {
  return list.some((email) => isMine(email, addresses));
}

export type EmailRowKind = "signIn" | "gmail" | "confirmed" | "pending";
export type EmailRow = { email: string; kind: EmailRowKind };

const live = (pending: readonly PendingEmail[] | undefined, now: string): PendingEmail[] =>
  (pending ?? []).filter((p) => p.expiresAt > now);

// Settings' "Email addresses": the sign-in, those confirmed, the connected
// Gmail (unless confirmed too), then those waiting for confirmation that
// have not expired. Confirmed and pending ones can be removed.
export function emailRows(
  signIn: string | null | undefined,
  user: (AddressHolder & { pendingEmails?: readonly PendingEmail[] | undefined }) | undefined,
  now: string,
): EmailRow[] {
  const rows: EmailRow[] = [];
  const seen = new Set<string>();
  const add = (email: string | undefined, kind: EmailRowKind) => {
    if (!email || seen.has(email)) return;
    seen.add(email);
    rows.push({ email, kind });
  };
  add(normalizeEmail(signIn), "signIn");
  for (const email of user?.emails ?? []) add(normalizeEmail(email), "confirmed");
  add(normalizeEmail(user?.gmail?.emailAddress), "gmail");
  for (const p of live(user?.pendingEmails, now)) add(normalizeEmail(p.email), "pending");
  return rows;
}

export const isRemovable = (row: EmailRow): boolean => row.kind === "confirmed" || row.kind === "pending";

// Why an address cannot be linked. The first three a client can tell
// before asking; the parser tells the rest.
export type LinkRefusal = "invalid" | "yours" | "full" | "limit" | "taken" | "expired";

export const linkRefusalText: Record<LinkRefusal, string> = {
  invalid: "Enter one email address.",
  yours: "That address is already yours.",
  full: `You can add up to ${maxLinkedEmails} addresses.`,
  limit: "Too many confirmation emails today. Try again tomorrow.",
  taken: "That address belongs to another Travelmo account.",
  expired: "This link has expired or is for another account. Add the address again.",
};

// The address to link, normalized, or why not: one already the account's
// (sign-in, confirmed or Gmail) is refused; asking again for a pending one
// sends a fresh link.
export function checkNewLink(
  raw: string,
  signIn: string | null | undefined,
  user: (AddressHolder & { pendingEmails?: readonly PendingEmail[] | undefined }) | undefined,
  now: string,
): { email: string } | { refusal: LinkRefusal } {
  const email = normalizeEmail(raw);
  if (!email) return { refusal: "invalid" };
  if (myAddresses(signIn, user).includes(email)) return { refusal: "yours" };
  const pending = live(user?.pendingEmails, now).filter((p) => p.email !== email);
  if ((user?.emails?.length ?? 0) + pending.length >= maxLinkedEmails) return { refusal: "full" };
  return { email };
}

// The parser answers a refusal as `{"refusal":"taken"}`; anything else is
// not one.
export function refusalOf(body: string): LinkRefusal | undefined {
  const refusal = /"refusal"\s*:\s*"([a-z]+)"/.exec(body)?.[1];
  return refusal && Object.hasOwn(linkRefusalText, refusal) ? (refusal as LinkRefusal) : undefined;
}

// The page a confirmation link opens, which asks the parser to confirm.
export const confirmationUrl = (origin: string, token: string): string =>
  `${origin}/settings/email?token=${encodeURIComponent(token)}`;

export function confirmationMessage(email: string, url: string): { subject: string; text: string } {
  return {
    subject: "Confirm your email address for Travelmo",
    text:
      `Open this link to add ${email} to your Travelmo account:\n\n${url}\n\n` +
      "It works for 24 hours, signed in to the account that asked. If that wasn't you, ignore this email.\n",
  };
}

// The parser's own record (`users/{uid}/private/emails`), which no client
// has ever been able to write: the confirmed addresses (`confirmed`, what
// the rules and access checks trust), each pending link with the hash of
// its token, never the token, and the confirmation emails sent on `day`.
// `users/{uid}.emails` is a copy for the apps to show and query with; the
// rules before linked addresses let a client write it, so it is never
// trusted.
export type PendingLink = PendingEmail & { tokenHash: string };
export type EmailLinks = { pending: PendingLink[]; confirmed?: string[]; day?: string; sent?: number };

const day = (now: string) => now.slice(0, 10);

export const canSendLink = (links: EmailLinks, now: string, limit = dailyConfirmationLimit): boolean =>
  links.day !== day(now) || (links.sent ?? 0) < limit;

// After sending a link: expired ones dropped, one link per address (the
// newest), and the day's count raised.
export function withSentLink(links: EmailLinks, email: string, tokenHash: string, now: string): EmailLinks {
  const expiresAt = new Date(Date.parse(now) + confirmationTtlMs).toISOString();
  const pending = links.pending.filter((p) => p.expiresAt > now && p.email !== email);
  const sent = links.day === day(now) ? (links.sent ?? 0) + 1 : 1;
  return { ...links, pending: [...pending, { email, tokenHash, sentAt: now, expiresAt }], day: day(now), sent };
}

export const pendingLink = (links: EmailLinks, tokenHash: string, now: string): PendingLink | undefined =>
  links.pending.find((p) => p.tokenHash === tokenHash && p.expiresAt > now);

export const withoutLink = (links: EmailLinks, email: string, now: string): EmailLinks => ({
  ...links,
  pending: links.pending.filter((p) => p.email !== email && p.expiresAt > now),
});

// Withdraws one link by its token, leaving a newer link for the same
// address that a later request sent.
export const withoutToken = (links: EmailLinks, tokenHash: string, now: string): EmailLinks => ({
  ...links,
  pending: links.pending.filter((p) => p.tokenHash !== tokenHash && p.expiresAt > now),
});

// What Settings shows of the pending links (`users/{uid}.pendingEmails`).
export const shownPending = (links: EmailLinks): PendingEmail[] =>
  links.pending.map(({ email, sentAt, expiresAt }) => ({ email, sentAt, expiresAt }));
