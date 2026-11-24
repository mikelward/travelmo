
// Mailboxes connected over IMAP with an app password (SPEC "Connected IMAP
// mailboxes"). Pure and shared by the parser, the web app and (apps/android
// :core, Imap.kt) the Android app.

import { stableHash } from "./hash";

// How many IMAP mailboxes one account may connect.
export const maxImapMailboxes = 5;

// Implicit TLS, the only kind the parser connects with.
export const imapTlsPort = 993;

export type ImapProvider = {
  name: string;
  host: string;
  port: number;
  // Where the provider explains making an app password.
  appPasswordUrl?: string;
};

const icloud: ImapProvider = { name: "iCloud", host: "imap.mail.me.com", port: imapTlsPort, appPasswordUrl: "https://support.apple.com/en-us/102654" };
const yahoo: ImapProvider = {
  name: "Yahoo",
  host: "imap.mail.yahoo.com",
  port: imapTlsPort,
  appPasswordUrl: "https://help.yahoo.com/kb/SLN15241.html",
};
const infomaniak: ImapProvider = { name: "Infomaniak", host: "mail.infomaniak.com", port: imapTlsPort };

const knownDomains: Record<string, ImapProvider> = {
  "icloud.com": icloud,
  "me.com": icloud,
  "mac.com": icloud,
  "ymail.com": yahoo,
  "rocketmail.com": yahoo,
  "ik.me": infomaniak,
  "ikmail.com": infomaniak,
  "etik.com": infomaniak,
};

// Addresses with a connector of their own, which reads them better.
const gmailDomains = new Set(["gmail.com", "googlemail.com"]);
const fastmailDomains = new Set(["fastmail.com", "fastmail.fm", "fastmail.net", "fastmail.org", "fastmail.us", "fastmail.to", "fastmail.in", "fastmail.cn", "sent.com", "messagingengine.com"]);

export type ImapServerChoice =
  | { kind: "known"; provider: ImapProvider }
  // Use the Gmail or Fastmail section instead.
  | { kind: "gmail" }
  | { kind: "fastmail" }
  // The user names the server.
  | { kind: "other" };

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : address.slice(at + 1).trim().toLowerCase();
}

// Which server an address is read from, by its domain.
export function imapServerFor(address: string): ImapServerChoice {
  const domain = domainOf(address);
  if (gmailDomains.has(domain)) return { kind: "gmail" };
  if (fastmailDomains.has(domain)) return { kind: "fastmail" };
  const known = knownDomains[domain] ?? (/^yahoo\.[a-z.]+$/.test(domain) ? yahoo : undefined);
  return known ? { kind: "known", provider: known } : { kind: "other" };
}

// What Settings says instead of connecting an address another section
// reads; undefined when IMAP is the way.
export function imapRedirect(address: string): string | undefined {
  const choice = imapServerFor(address);
  if (choice.kind === "gmail") return "For a Gmail address, use Connect Gmail above.";
  if (choice.kind === "fastmail") return "For a Fastmail address, use the Fastmail section above.";
  return undefined;
}

// A server as typed, `host` or `host:port`; the port defaults to 993.
// Undefined when it does not read as one.
export function parseImapServer(input: string): { host: string; port: number } | undefined {
  const text = input.trim().toLowerCase().replace(/^imaps?:\/\//, "");
  const match = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)(:(\d{1,5}))?$/.exec(text);
  if (!match) return undefined;
  const port = match[6] ? Number(match[6]) : imapTlsPort;
  if (port < 1 || port > 65535) return undefined;
  return { host: match[1]!, port };
}

// The user's IMAP mailboxes, oldest connection first.
export function imapMailboxes<C extends { emailAddress: string; connectedAt?: string | undefined }>(user: { imaps?: Record<string, C> | undefined } | undefined): C[] {
  return Object.values(user?.imaps ?? {}).sort(
    (a, b) => (a.connectedAt ?? "").localeCompare(b.connectedAt ?? "") || a.emailAddress.toLowerCase().localeCompare(b.emailAddress.toLowerCase()),
  );
}

// Import record and source ids of IMAP emails: the mailbox's record key,
// the inbox's UIDVALIDITY and the message's UID, which together name one
// message for good (RFC 9051 §2.3.1.1) on one server.
export const imapRecordPrefix = "imap-";

// The record key names the address on its server: an address reconnected
// to another server is another inbox, whose UIDVALIDITY and UIDs may repeat
// the old one's, so its emails must not share their records.
export function imapRecordKey(address: string, host: string, port: number): string {
  return stableHash(`${address.trim().toLowerCase()}|${host.trim().toLowerCase()}:${port}`);
}

export function imapRecordId(key: string, uidValidity: string, uid: number): string {
  return `${imapRecordPrefix}${key}-${uidValidity}-${uid}`;
}

const recordPattern = /^imap-([0-9a-z]+)-(\d+)-(\d+)$/;

export function parseImapRecordId(id: string): { key: string; uidValidity: string; uid: number } | undefined {
  const match = recordPattern.exec(id);
  if (!match) return undefined;
  const uid = Number(match[3]);
  return Number.isSafeInteger(uid) && uid > 0 ? { key: match[1]!, uidValidity: match[2]!, uid } : undefined;
}
