import { backfillBatch, backfillSubjects, statementDays, statementSubjects } from "./backfill";
import type { EmailMessage, MessagePage } from "./gmail";
import type { MailSource } from "./mailSource";
import type { ChangesResult } from "./newMailPoll";
import { travelLoyaltyDomains } from "./prefilter";
import { bodyText } from "./text";

// Fastmail over JMAP (RFC 8620, RFC 8621), with an API token the user made
// read-only in Fastmail's settings. The token is sent only to Fastmail's
// session URL and the API URL that session names on Fastmail's own host.

export const fastmailSessionUrl = "https://api.fastmail.com/jmap/session";
const mailCapability = "urn:ietf:params:jmap:mail";
const using = ["urn:ietf:params:jmap:core", mailCapability];

// What the import reads of an email body at most: more than any booking.
const maxBodyBytes = 256 * 1024;

// Our record ids for Fastmail messages, kept apart from Gmail's and the
// other sources' in the user's import records.
export const fastmailRecordPrefix = "fm-";
export const fastmailRecordId = (emailId: string) => `${fastmailRecordPrefix}${emailId}`;
export const fastmailEmailId = (recordId: string): string => {
  if (!recordId.startsWith(fastmailRecordPrefix)) throw new Error("Not a Fastmail record id");
  return recordId.slice(fastmailRecordPrefix.length);
};

// An HTTP failure, shaped as googleapis errors are (status, response
// headers), so the rate-limit and not-found checks read both alike.
export class JmapHttpError extends Error {
  readonly status: number;
  readonly response: { status: number; headers: Headers };
  constructor(status: number, headers: Headers, what: string) {
    super(`Fastmail ${what}: HTTP ${status}`);
    this.name = "JmapHttpError";
    this.status = status;
    this.response = { status, headers };
  }
}

// A method-level error (RFC 8620 §3.6.2): `type` says which.
export class JmapMethodError extends Error {
  constructor(readonly type: string, method: string) {
    super(`Fastmail ${method}: ${type}`);
    this.name = "JmapMethodError";
  }
}

// A message the mailbox no longer has, as Gmail's 404.
export class JmapNotFound extends Error {
  readonly status = 404;
  constructor(id: string) {
    super(`Fastmail email ${id} not found`);
    this.name = "JmapNotFound";
  }
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type JmapSession = { apiUrl: string; accountId: string; username: string; readOnly: boolean; maxObjectsInGet?: number };

// How many ids one /get takes when the server does not say (RFC 8620 asks
// servers for at least 500).
export const defaultMaxObjectsInGet = 500;

// The token's session: where to call, the mail account, its address and
// whether the token can change anything.
export async function jmapSession(token: string, fetchFn: FetchFn = fetch): Promise<JmapSession> {
  const res = await fetchFn(fastmailSessionUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new JmapHttpError(res.status, res.headers, "session");
  const body = (await res.json()) as {
    apiUrl?: unknown;
    username?: unknown;
    primaryAccounts?: Record<string, unknown>;
    accounts?: Record<string, { isReadOnly?: unknown }>;
    capabilities?: Record<string, { maxObjectsInGet?: unknown } | undefined>;
  };
  const accountId = body.primaryAccounts?.[mailCapability];
  if (typeof accountId !== "string") throw new JmapMethodError("noMailAccount", "session");
  if (typeof body.apiUrl !== "string" || !onFastmail(body.apiUrl)) throw new JmapMethodError("unexpectedApiUrl", "session");
  const advertised = body.capabilities?.["urn:ietf:params:jmap:core"]?.maxObjectsInGet;
  const maxGet = typeof advertised === "number" && Number.isInteger(advertised) && advertised > 0 ? advertised : undefined;
  return {
    apiUrl: body.apiUrl,
    accountId,
    username: typeof body.username === "string" ? body.username : "",
    readOnly: body.accounts?.[accountId]?.isReadOnly === true,
    ...(maxGet ? { maxObjectsInGet: maxGet } : {}),
  };
}

function onFastmail(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "fastmail.com" || hostname.endsWith(".fastmail.com"));
  } catch {
    // Not a URL at all: refused like any other host.
    return false;
  }
}

type Invocation = [string, Record<string, unknown>, string];

export type Jmap = {
  call: (calls: Invocation[]) => Promise<Record<string, unknown>[]>;
  accountId: string;
  // The most ids one /get may name.
  maxObjectsInGet: number;
};

export function jmapClient(token: string, session: Pick<JmapSession, "apiUrl" | "accountId" | "maxObjectsInGet">, fetchFn: FetchFn = fetch): Jmap {
  return {
    accountId: session.accountId,
    maxObjectsInGet: session.maxObjectsInGet ?? defaultMaxObjectsInGet,
    call: async (calls) => {
      const res = await fetchFn(session.apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ using, methodCalls: calls }),
      });
      const what = calls.map((c) => c[0]).join(",");
      if (!res.ok) throw new JmapHttpError(res.status, res.headers, what);
      const body = (await res.json()) as { methodResponses?: Invocation[] };
      const responses = body.methodResponses ?? [];
      return calls.map(([method, , tag]) => {
        const found = responses.find((r) => r[2] === tag);
        if (!found) throw new JmapMethodError("missingResponse", method);
        if (found[0] === "error") throw new JmapMethodError(String(found[1].type ?? "unknown"), method);
        return found[1];
      });
    },
  };
}

// Mailboxes by role: the inbox new mail is read from, and trash and junk,
// which the backfill leaves out as Gmail's search does.
export async function mailboxRoles(jmap: Jmap): Promise<{ inbox: string[]; excluded: string[] }> {
  const [got] = await jmap.call([["Mailbox/get", { accountId: jmap.accountId, ids: null, properties: ["role"] }, "0"]]);
  const list = (got!.list ?? []) as { id: string; role?: string | null }[];
  return {
    inbox: list.filter((m) => m.role === "inbox").map((m) => m.id),
    excluded: list.filter((m) => m.role === "trash" || m.role === "junk").map((m) => m.id),
  };
}

// The backfill's search (backfill.ts) as a JMAP filter: booking-like
// subjects anywhere but trash and junk, and travel programs' recent
// statements.
export function backfillFilter(excludedMailboxes: readonly string[], now: Date): Record<string, unknown> {
  const anySubject = (terms: readonly string[]) => ({ operator: "OR", conditions: terms.map((subject) => ({ subject })) });
  const since = new Date(now.getTime() - statementDays * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const statements = {
    operator: "AND",
    conditions: [
      anySubject(statementSubjects),
      { after: since },
      { operator: "OR", conditions: travelLoyaltyDomains.map((from) => ({ from })) },
    ],
  };
  const booking = { operator: "OR", conditions: [...anySubject(backfillSubjects).conditions, statements] };
  return excludedMailboxes.length === 0
    ? booking
    : // In none of them: `inMailboxOtherThan` would keep an email in the
      // trash that kept another label too (RFC 8621 §4.4.1).
      { operator: "AND", conditions: [{ operator: "NOT", conditions: excludedMailboxes.map((inMailbox) => ({ inMailbox })) }, booking] };
}

// One page of the search, newest first, after the email the last page
// ended on: anchored on it rather than counted, so mail arriving meanwhile
// shifts nothing. An anchor that has gone (deleted since) fails with
// anchorNotFound, and the reading starts over.
export async function searchPage(jmap: Jmap, filter: Record<string, unknown>, cursor: string | undefined, limit = backfillBatch): Promise<MessagePage> {
  const [result] = await jmap.call([
    [
      "Email/query",
      {
        accountId: jmap.accountId,
        filter,
        sort: [{ property: "receivedAt", isAscending: false }],
        ...(cursor ? { anchor: cursor, anchorOffset: 1 } : { position: 0 }),
        limit,
        collapseThreads: false,
      },
      "0",
    ],
  ]);
  const ids = (result!.ids ?? []) as string[];
  const last = ids[ids.length - 1];
  return { ids, ...(ids.length === limit && last ? { nextPageToken: last } : {}) };
}

type JmapEmail = {
  id: string;
  threadId?: string;
  from?: { name?: string | null; email?: string | null }[] | null;
  subject?: string | null;
  sentAt?: string | null;
  receivedAt?: string | null;
  "header:List-Unsubscribe:asText"?: string | null;
  textBody?: { partId?: string }[];
  htmlBody?: { partId?: string }[];
  bodyValues?: Record<string, { value?: string }>;
};

function sender(from: JmapEmail["from"]): string {
  const first = from?.[0];
  if (!first?.email) return first?.name ?? "";
  return first.name ? `${first.name} <${first.email}>` : first.email;
}

function partsText(parts: JmapEmail["textBody"], values: JmapEmail["bodyValues"]): string {
  return (parts ?? []).map((p) => (p.partId ? (values?.[p.partId]?.value ?? "") : "")).join("\n");
}

// One email, reduced as Gmail's and forwarded ones are: plain text when it
// is the whole message, else the HTML flattened. Attachments are not read.
export async function fetchEmail(jmap: Jmap, emailId: string): Promise<EmailMessage> {
  const [result] = await jmap.call([
    [
      "Email/get",
      {
        accountId: jmap.accountId,
        ids: [emailId],
        properties: ["id", "threadId", "from", "subject", "sentAt", "receivedAt", "header:List-Unsubscribe:asText", "textBody", "htmlBody", "bodyValues"],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
        maxBodyValueBytes: maxBodyBytes,
      },
      "0",
    ],
  ]);
  const email = ((result!.list ?? []) as JmapEmail[])[0];
  if (!email) throw new JmapNotFound(emailId);
  const id = fastmailRecordId(email.id);
  return {
    id,
    threadId: email.threadId ? fastmailRecordId(email.threadId) : id,
    from: sender(email.from),
    subject: email.subject ?? "",
    date: email.sentAt ?? email.receivedAt ?? "",
    listUnsubscribe: Boolean(email["header:List-Unsubscribe:asText"]),
    text: bodyText(partsText(email.textBody, email.bodyValues), partsText(email.htmlBody, email.bodyValues)),
  };
}


// Emails created since `sinceState` that are in the inbox, as Gmail's watch
// covers only the inbox; "expired" when the server can no longer say.
export async function inboxCreatedSince(jmap: Jmap, sinceState: string, inbox: readonly string[]): Promise<ChangesResult | "expired"> {
  const created: string[] = [];
  let state = sinceState;
  for (;;) {
    let changes: Record<string, unknown>;
    try {
      [changes] = (await jmap.call([["Email/changes", { accountId: jmap.accountId, sinceState: state, maxChanges: 500 }, "0"]])) as [
        Record<string, unknown>,
      ];
    } catch (error) {
      if (error instanceof JmapMethodError && error.type === "cannotCalculateChanges") return "expired";
      throw error;
    }
    created.push(...((changes.created ?? []) as string[]));
    state = String(changes.newState);
    if (changes.hasMoreChanges !== true) break;
  }
  // Looked up in batches the server takes: a long outage can leave more
  // new mail than one /get may name.
  const inInbox: string[] = [];
  for (let at = 0; at < created.length; at += jmap.maxObjectsInGet) {
    const ids = created.slice(at, at + jmap.maxObjectsInGet);
    const [got] = await jmap.call([["Email/get", { accountId: jmap.accountId, ids, properties: ["mailboxIds"] }, "0"]]);
    for (const e of (got!.list ?? []) as { id: string; mailboxIds?: Record<string, boolean> }[]) {
      if (inbox.some((m) => e.mailboxIds?.[m])) inInbox.push(e.id);
    }
  }
  return { created: inInbox, state };
}

// Where the mailbox is now, for reading new mail from.
export async function currentEmailState(jmap: Jmap): Promise<string> {
  const [got] = await jmap.call([["Email/get", { accountId: jmap.accountId, ids: [], properties: ["id"] }, "0"]]);
  return String(got!.state);
}

export const isJmapNotFound = (error: unknown) => error instanceof JmapNotFound;

// The mailbox as a MailSource. It reaches Fastmail only once something is
// read (`connect` makes the client), so the backfill's bookkeeping, and
// stopping it with a token Fastmail no longer takes, needs no session.
export function fastmailSource(connect: () => Promise<Jmap>, now: () => Date = () => new Date()): MailSource {
  let client: Promise<Jmap> | undefined;
  let filter: Promise<Record<string, unknown>> | undefined;
  const jmap = () => (client ??= connect());
  return {
    provider: "fastmail",
    // Ids leave as record ids; the cursor stays Fastmail's own.
    searchPage: async (cursor) => {
      const api = await jmap();
      filter ??= mailboxRoles(api).then((roles) => backfillFilter(roles.excluded, now()));
      const page = await searchPage(api, await filter, cursor);
      return { ...page, ids: page.ids.map(fastmailRecordId) };
    },
    fetch: async (id) => fetchEmail(await jmap(), fastmailEmailId(id)),
    isStaleCursor: (error) => error instanceof JmapMethodError && error.type === "anchorNotFound",
    isNotFound: isJmapNotFound,
  };
}
