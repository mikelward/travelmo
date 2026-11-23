import {
  AccessConfig,
  AccessRecord,
  canSendLink,
  checkNewLink,
  confirmationMessage,
  confirmationUrl,
  letsIn,
  maxLinkedEmails,
  myAddresses,
  normalizeEmail,
  paths,
  pendingLink,
  shownPending,
  withSentLink,
  withoutLink,
  withoutToken,
  type AddressHolder,
  type EmailLinks,
  type LinkRefusal,
  type PendingEmail,
  type PendingLink,
} from "@travelmo/core";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { hashToken, newToken } from "./calendarExport";
import { refuseIfDeleted } from "./deleted";
import type { Mailer } from "./mail";

// Linked email addresses (SPEC "Linked email addresses"), on the server:
// asking to link one sends a confirmation link; opening it, signed in to
// the account that asked, links it. `linkedEmails/{email}` names the one
// account an address is linked to; `users/{uid}/private/emails` holds the
// confirmed list, which the rules and access checks read, the hashes of the
// links sent and the day's count; `users/{uid}.emails` is a copy for the
// apps, never trusted (a client could write it before these rules).
//
// An account not approved yet may link too, but only an address that lets
// it in (SPEC "Access"): one an admin approved, someone invited, or an
// admin's. Until it confirms one, nothing creates its user document, whose
// existence would approve it; confirming writes it, which lets it in.

type Severity = "INFO" | "WARNING" | "ERROR";
export type EmailsLog = (severity: Severity, event: string, fields: Record<string, unknown>) => void;

function mailboxOf(value: unknown): { emailAddress: string } | undefined {
  const { emailAddress } = (value ?? {}) as { emailAddress?: unknown };
  return typeof emailAddress === "string" ? { emailAddress } : undefined;
}

// What `users/{uid}` says about the account's addresses, read leniently:
// a malformed field counts as absent.
export function addressHolderOf(data: Record<string, unknown> | undefined): AddressHolder & { pendingEmails?: PendingEmail[] } {
  if (!data) return {};
  const emails = Array.isArray(data.emails) ? data.emails.filter((e): e is string => typeof e === "string") : undefined;
  const gmail = mailboxOf(data.gmail);
  const pending = Array.isArray(data.pendingEmails)
    ? data.pendingEmails.filter(
        (p): p is PendingEmail =>
          !!p && typeof p === "object" && typeof p.email === "string" && typeof p.sentAt === "string" && typeof p.expiresAt === "string",
      )
    : undefined;
  return {
    ...(emails ? { emails } : {}),
    ...(gmail ? { gmail } : {}),
    ...(pending ? { pendingEmails: pending } : {}),
  };
}

// What the account's addresses are, from what the parser itself wrote: the
// confirmed list and the connected Gmail mailboxes in its private record
// (out of clients' reach), with the pending links the profile shows. Of the user document, only `gmail` counts, a mailbox
// connected before there could be several, which clients could never
// write; never `gmails`, which they could before the rules locked it.
export function trustedHolder(user: Record<string, unknown> | undefined, links: EmailLinks): AddressHolder & { pendingEmails?: PendingEmail[] } {
  const { gmail, pendingEmails } = addressHolderOf(user);
  const gmails = Object.fromEntries((links.mailboxes ?? []).map((address) => [address, { emailAddress: address }]));
  return { emails: links.confirmed ?? [], ...(gmail ? { gmail } : {}), gmails, ...(pendingEmails ? { pendingEmails } : {}) };
}

// The account's confirmed addresses besides its sign-in, as trusted.
export async function trustedLinked(db: Firestore, uid: string): Promise<{ user: Record<string, unknown> | undefined; holder: AddressHolder }> {
  const [user, links] = await Promise.all([db.doc(paths.user(uid)).get(), db.doc(paths.emailLinks(uid)).get()]);
  return { user: user.data(), holder: trustedHolder(user.data(), readLinks(links.data())) };
}

// Every address that is the account's: its verified sign-in, those it
// linked and its connected Gmail mailboxes.
export async function addressesOf(db: Firestore, uid: string, verifiedEmail: (uid: string) => Promise<string | undefined>): Promise<string[]> {
  const [email, { holder }] = await Promise.all([verifiedEmail(uid), trustedLinked(db, uid)]);
  return myAddresses(email, holder);
}

// The account an address belongs to besides as a sign-in: the one that
// linked it, else the one whose connected Gmail it is.
export async function linkedOwner(db: Firestore, email: string): Promise<string | undefined> {
  const address = normalizeEmail(email);
  if (!address) return undefined;
  const claim = (await db.doc(paths.linkedEmail(address)).get()).get("uid");
  if (typeof claim === "string") return claim;
  const mailbox = (await db.doc(paths.gmailAccount(address)).get()).get("uid");
  return typeof mailbox === "string" ? mailbox : undefined;
}

// Whose account an address is, for the people a trip is shared with: the
// account that signs in with it (Google verified), else the one that linked
// it or connected it as its Gmail. `signInOwner` asks Auth.
export function uidForAddress(
  db: Firestore,
  signInOwner: (email: string) => Promise<string | undefined>,
): (email: string) => Promise<string | undefined> {
  return async (email) => (await signInOwner(email)) ?? (await linkedOwner(db, email));
}

export class LinkRefused extends Error {
  constructor(public readonly refusal: LinkRefusal) {
    super(`link refused: ${refusal}`);
    this.name = "LinkRefused";
  }
}

export type EmailDeps = {
  db: Firestore;
  mail: Mailer | undefined;
  origin: string;
  now: () => string;
  log: EmailsLog;
  // The account that signs in with an address, if any (Auth).
  signInOwner: (email: string) => Promise<string | undefined>;
};

export function readLinks(data: Record<string, unknown> | undefined): EmailLinks {
  const pending = Array.isArray(data?.pending)
    ? (data.pending as unknown[]).filter(
        (p): p is PendingLink =>
          !!p &&
          typeof p === "object" &&
          ["email", "tokenHash", "sentAt", "expiresAt"].every((k) => typeof (p as Record<string, unknown>)[k] === "string"),
      )
    : [];
  const confirmed = Array.isArray(data?.confirmed) ? (data.confirmed as unknown[]).filter((e): e is string => typeof e === "string") : [];
  const mailboxes = Array.isArray(data?.mailboxes) ? (data.mailboxes as unknown[]).filter((e): e is string => typeof e === "string") : undefined;
  return {
    pending,
    confirmed,
    ...(mailboxes ? { mailboxes } : {}),
    ...(typeof data?.day === "string" ? { day: data.day } : {}),
    ...(typeof data?.sent === "number" ? { sent: data.sent } : {}),
  };
}

// Writes the parser's record and what the apps show of it together: the
// profile's copy of the confirmed list is set whole from the record, which
// also wipes any list a client wrote there before the rules locked it. The
// user document is updated while it exists, and created only when `create`
// says the account may have one: its existence approves the account.
function writeLinks(db: Firestore, t: Transaction, uid: string, links: EmailLinks, userExists: boolean, create: boolean) {
  t.set(db.doc(paths.emailLinks(uid)), links);
  const fields = { pendingEmails: shownPending(links), emails: links.confirmed ?? [] };
  if (userExists) t.update(db.doc(paths.user(uid)), fields);
  else if (create) t.set(db.doc(paths.user(uid)), fields);
}

// Whether confirming `email` would let an account not approved yet in, from
// its access record and `config/access` (core `letsIn`). A malformed one
// lets no one in.
function letsInFrom(email: string, record: DocumentSnapshot, config: DocumentSnapshot, log: EmailsLog): boolean {
  const parsedRecord = record.exists ? AccessRecord.safeParse(record.data()) : undefined;
  const parsedConfig = config.exists ? AccessConfig.safeParse(config.data()) : undefined;
  if (parsedRecord?.success === false || parsedConfig?.success === false) log("WARNING", "email_link_access_malformed", {});
  return letsIn(email, parsedRecord?.data, parsedConfig?.data);
}

// Refuses an address another account signs in with, linked or connected
// as its Gmail.
async function refuseOthers(deps: EmailDeps, uid: string, email: string): Promise<void> {
  const [signIn, owner] = await Promise.all([deps.signInOwner(email), linkedOwner(deps.db, email)]);
  if ((signIn && signIn !== uid) || (owner && owner !== uid)) throw new LinkRefused("taken");
}

// Sends a confirmation link for `raw` to that address, at most a few a day.
// `approved` is whether the account may use the app already (server.ts asks
// gateLinking). One that may not is refused an address that would not let
// it in, before anything says whether another account has it, so it cannot
// have us mail anyone or tell it who signed up.
export async function requestLink(
  deps: EmailDeps,
  uid: string,
  signIn: string | undefined,
  raw: string,
  approved = true,
): Promise<{ email: string }> {
  const { db, log } = deps;
  if (!deps.mail) throw new Error("Email is not set up on this server");
  const now = deps.now();
  const userRef = db.doc(paths.user(uid));
  const first = checkNewLink(raw, signIn, (await trustedLinked(db, uid)).holder, now);
  if ("refusal" in first) throw new LinkRefused(first.refusal);
  const { email } = first;
  if (!approved) {
    const [record, config] = await Promise.all([db.doc(paths.access(email)).get(), db.doc(paths.accessConfig()).get()]);
    if (!letsInFrom(email, record, config, log)) throw new LinkRefused("notInvited");
  }
  await refuseOthers(deps, uid, email);

  const token = newToken();
  const tokenHash = hashToken(token);
  await db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    const [user, links] = await Promise.all([t.get(userRef), t.get(db.doc(paths.emailLinks(uid)))]);
    // Checked again inside, against what another request changed meanwhile.
    const current = readLinks(links.data());
    const check = checkNewLink(raw, signIn, trustedHolder(user.data(), current), now);
    if ("refusal" in check) throw new LinkRefused(check.refusal);
    if (!canSendLink(current, now)) throw new LinkRefused("limit");
    writeLinks(db, t, uid, withSentLink(current, email, tokenHash, now), user.exists, approved);
  });

  const message = confirmationMessage(email, confirmationUrl(deps.origin, token));
  try {
    await deps.mail({ to: email, subject: message.subject, text: message.text });
  } catch (error) {
    // The link went nowhere, so it is withdrawn; the day's count stands.
    // The error's name and code: a mail server's message may name the address.
    log("ERROR", "email_link_send_failed", { uid, error: (error as Error).name, code: (error as { code?: unknown }).code });
    await withdraw(db, uid, (links) => withoutToken(links, tokenHash, now));
    throw error;
  }
  log("INFO", "email_link_sent", { uid });
  return { email };
}

// Takes a link back. Never creates the user document: with none there is
// no copy to correct, and creating one could approve the account.
async function withdraw(db: Firestore, uid: string, change: (links: EmailLinks) => EmailLinks): Promise<void> {
  await db.runTransaction(async (t) => {
    const userRef = db.doc(paths.user(uid));
    const [user, links] = await Promise.all([t.get(userRef), t.get(db.doc(paths.emailLinks(uid)))]);
    if (!links.exists) return;
    writeLinks(db, t, uid, change(readLinks(links.data())), user.exists, false);
  });
}

// Links the address a confirmation link was sent to, for the account that
// asked: its claim made in the same transaction as the list changes, so an
// address is never linked to two accounts. For an account not approved yet
// (`approved`, as requestLink), the address must still let it in (an admin
// may have declined it meanwhile); confirming then writes the user
// document, which lets the account in.
export async function confirmLink(deps: EmailDeps, uid: string, token: string, approved = true): Promise<{ email: string }> {
  const { db, log } = deps;
  const now = deps.now();
  const tokenHash = hashToken(token);
  const linksRef = db.doc(paths.emailLinks(uid));
  // A link is looked for among the caller's own: one another account asked
  // for, or one expired, reads the same.
  const found = pendingLink(readLinks((await linksRef.get()).data()), tokenHash, now);
  if (!found) {
    log("INFO", "email_link_unknown", { uid });
    throw new LinkRefused("expired");
  }
  const { email } = found;
  try {
    await refuseOthers(deps, uid, email);
  } catch (error) {
    if (error instanceof LinkRefused) await withdraw(db, uid, (links) => withoutLink(links, email, now));
    throw error;
  }
  const outcome = await db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    const userRef = db.doc(paths.user(uid));
    const claimRef = db.doc(paths.linkedEmail(email));
    const mailboxRef = db.doc(paths.gmailAccount(email));
    const [user, links, claim, mailbox, invite] = await Promise.all([
      t.get(userRef),
      t.get(linksRef),
      t.get(claimRef),
      t.get(mailboxRef),
      approved ? undefined : Promise.all([t.get(db.doc(paths.access(email))), t.get(db.doc(paths.accessConfig()))]),
    ]);
    const current = readLinks(links.data());
    if (!pendingLink(current, tokenHash, now)) return "expired" as const;
    const rest = withoutLink(current, email, now);
    if (invite && !letsInFrom(email, invite[0], invite[1], log)) {
      // No longer invited: the link is withdrawn, as it can no longer let
      // the account in.
      writeLinks(db, t, uid, rest, user.exists, false);
      return "notInvited" as const;
    }
    const owner = claim.get("uid") ?? mailbox.get("uid");
    if (typeof owner === "string" && owner !== uid) {
      // Taken meanwhile: the link is withdrawn, as it can never work.
      writeLinks(db, t, uid, rest, user.exists, false);
      return "taken" as const;
    }
    const emails = current.confirmed ?? [];
    if (!emails.includes(email) && emails.length >= maxLinkedEmails) return "full" as const;
    t.set(claimRef, { uid, linkedAt: now });
    // Created if missing: an approved account may have one, and one not
    // approved yet is let in by the address it just confirmed.
    writeLinks(db, t, uid, { ...rest, confirmed: [...emails.filter((e) => e !== email), email] }, user.exists, true);
    return "linked" as const;
  });
  if (outcome !== "linked") {
    log("INFO", "email_link_refused", { uid, reason: outcome });
    throw new LinkRefused(outcome);
  }
  log("INFO", "email_linked", { uid });
  return { email };
}

// Unlinks a confirmed address or withdraws a pending one. The connected
// Gmail and the sign-in are not linked this way and stay.
export async function removeLink(deps: Pick<EmailDeps, "db" | "now" | "log">, uid: string, raw: string): Promise<void> {
  const { db } = deps;
  const email = normalizeEmail(raw);
  if (!email) throw new LinkRefused("invalid");
  const now = deps.now();
  await db.runTransaction(async (t) => {
    const userRef = db.doc(paths.user(uid));
    const claimRef = db.doc(paths.linkedEmail(email));
    const [user, links, claim] = await Promise.all([t.get(userRef), t.get(db.doc(paths.emailLinks(uid))), t.get(claimRef)]);
    if (claim.get("uid") === uid) t.delete(claimRef);
    if (!user.exists) return;
    const rest = withoutLink(readLinks(links.data()), email, now);
    writeLinks(db, t, uid, { ...rest, confirmed: (rest.confirmed ?? []).filter((e) => e !== email) }, true, false);
  });
  deps.log("INFO", "email_unlinked", { uid });
}
