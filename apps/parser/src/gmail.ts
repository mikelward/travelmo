import { google, type gmail_v1 } from "googleapis";
import { emailText } from "./text";

export type Gmail = gmail_v1.Gmail;

export const gmailScopes = ["https://www.googleapis.com/auth/gmail.readonly"];

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
};

export function oauthClient(config: OAuthConfig) {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUrl);
}

export function gmailFor(config: OAuthConfig, refreshToken: string): Gmail {
  const auth = oauthClient(config);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

// A document attached to an email, as the model reads it: never parsed
// here, only passed on (extract.ts).
export type Attachment = { name: string; mimeType: "application/pdf"; data: string };

export type EmailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  listUnsubscribe: boolean;
  text: string;
  // Its PDF attachments, fetched only when asked for: once an email has
  // passed the filters and is about to be read (importer.ts).
  attachments?: () => Promise<Attachment[]>;
};

// What attached PDFs the model is shown: tickets and confirmations are a
// few hundred kilobytes, and Gemini takes at most 20 MB a request, which
// these keep well within once base64 adds a third.
export const maxAttachments = 3;
export const maxAttachmentBytes = 5 * 1024 * 1024;
export const maxAttachmentsBytes = 10 * 1024 * 1024;

type AttachedPart = { filename?: string | null; mimeType?: string | null; body?: { attachmentId?: string | null; data?: string | null; size?: number | null } | null; parts?: AttachedPart[] | null };

// The PDFs among a message's parts, within the limits above, in order.
export function pdfParts(payload: AttachedPart | undefined): { name: string; attachmentId?: string; data?: string; size: number }[] {
  const found: { name: string; attachmentId?: string; data?: string; size: number }[] = [];
  const walk = (part: AttachedPart) => {
    const name = part.filename ?? "";
    const pdf = part.mimeType === "application/pdf" || (part.mimeType === "application/octet-stream" && /\.pdf$/i.test(name));
    const size = part.body?.size ?? 0;
    if (pdf && size > 0 && size <= maxAttachmentBytes && (part.body?.attachmentId || part.body?.data)) {
      found.push({ name, size, ...(part.body?.attachmentId ? { attachmentId: part.body.attachmentId } : {}), ...(part.body?.data ? { data: part.body.data } : {}) });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  if (payload) walk(payload);
  const kept: typeof found = [];
  let total = 0;
  for (const part of found) {
    if (kept.length >= maxAttachments || total + part.size > maxAttachmentsBytes) break;
    kept.push(part);
    total += part.size;
  }
  return kept;
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | undefined {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

export function toEmailMessage(message: gmail_v1.Schema$Message): EmailMessage {
  if (!message.id || !message.threadId) throw new Error("Gmail message without id");
  const headers = message.payload?.headers ?? undefined;
  const internal = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined;
  return {
    id: message.id,
    threadId: message.threadId,
    from: header(headers, "From") ?? "",
    subject: header(headers, "Subject") ?? "",
    date: header(headers, "Date") ?? internal ?? "",
    listUnsubscribe: header(headers, "List-Unsubscribe") !== undefined,
    text: message.payload ? emailText(message.payload) : "",
  };
}

// Fetches a mailbox's emails under the ids their import records and
// sources carry: Gmail's own, behind the mailbox's prefix (none for the
// account's first; packages/core's gmailIdPrefix), so the same id in two
// mailboxes is two emails.
export function recordedAs(idPrefix: string | undefined, fetch: (id: string) => Promise<EmailMessage>) {
  return async (id: string): Promise<EmailMessage> => {
    const message = await fetch(id);
    return { ...message, id: `${idPrefix ?? ""}${message.id}` };
  };
}

// What Gmail charges against a user's per-minute quota ("Total Query Cost",
// 6,000 units a minute per user) for the calls made in bulk: a full message
// costs 60 units, a search 5 whatever the page size.
export const gmailUnits = { getFull: 60, list: 5 } as const;

// googleapis on its own retries a 429 three times within two seconds: each
// retry is charged again, and none waits long enough for a per-minute quota
// to free up. Calls that may hit it wait instead (`withRateLimitRetry`).
const noQuickRetryOn429 = {
  retryConfig: {
    statusCodesToRetry: [
      [100, 199],
      [408, 408],
      [500, 599],
    ],
  },
};

export async function fetchMessage(gmail: Gmail, id: string): Promise<EmailMessage> {
  const { data } = await gmail.users.messages.get({ userId: "me", id, format: "full" }, noQuickRetryOn429);
  const message = toEmailMessage(data);
  const parts = pdfParts(data.payload ?? undefined);
  if (parts.length === 0) return message;
  return {
    ...message,
    attachments: async () =>
      Promise.all(
        parts.map(async (part) => {
          const body = part.data ?? (await gmail.users.messages.attachments.get({ userId: "me", messageId: id, id: part.attachmentId! }, noQuickRetryOn429)).data.data;
          if (!body) throw new Error("Gmail returned an attachment without data");
          // Gmail's base64url, as the model takes standard base64.
          return { name: part.name, mimeType: "application/pdf" as const, data: Buffer.from(body, "base64url").toString("base64") };
        }),
      ),
  };
}

export type MessagePage = { ids: string[]; nextPageToken?: string };

// Gmail returns at most this many ids per search call.
export const maxSearchPage = 500;

// Up to `max` (at most 500) message ids from `pageToken` on, and where to
// carry on from; no nextPageToken once the search is exhausted. One search
// call, however many ids.
export async function searchMessagePage(gmail: Gmail, query: string, max: number, pageToken?: string): Promise<MessagePage> {
  const { data } = await gmail.users.messages.list(
    { userId: "me", q: query, maxResults: Math.min(maxSearchPage, max), ...(pageToken ? { pageToken } : {}) },
    noQuickRetryOn429,
  );
  const ids = (data.messages ?? []).flatMap((m) => (m.id ? [m.id] : []));
  return { ids, ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}) };
}

// Gmail answers 400 for a page token it no longer accepts.
export function isBadRequest(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return status === 400 || code === 400 || code === "400";
}

export type HistoryResult = { messageIds: string[]; historyId: string };

// Gmail returns 404 for a history id that has aged out; the caller then falls
// back to a search. Everything else propagates.
export async function listAddedSince(gmail: Gmail, startHistoryId: string): Promise<HistoryResult | "expired"> {
  const messageIds = new Set<string>();
  let historyId = startHistoryId;
  let pageToken: string | undefined;
  try {
    do {
      const { data } = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        ...(pageToken ? { pageToken } : {}),
      });
      for (const h of data.history ?? []) {
        for (const added of h.messagesAdded ?? []) if (added.message?.id) messageIds.add(added.message.id);
      }
      if (data.historyId) historyId = data.historyId;
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (error) {
    if (isNotFound(error)) return "expired";
    throw error;
  }
  return { messageIds: [...messageIds], historyId };
}

export async function currentHistoryId(gmail: Gmail): Promise<{ historyId: string; emailAddress: string }> {
  const { data } = await gmail.users.getProfile({ userId: "me" });
  if (!data.historyId || !data.emailAddress) throw new Error("Gmail profile missing historyId or emailAddress");
  return { historyId: data.historyId, emailAddress: data.emailAddress };
}

export async function watch(gmail: Gmail, topicName: string): Promise<{ historyId: string; expiration: string }> {
  const { data } = await gmail.users.watch({
    userId: "me",
    requestBody: { topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" },
  });
  if (!data.historyId || !data.expiration) throw new Error("Gmail watch returned no historyId/expiration");
  return { historyId: data.historyId, expiration: new Date(Number(data.expiration)).toISOString() };
}

export async function stopWatch(gmail: Gmail): Promise<void> {
  await gmail.users.stop({ userId: "me" });
}

// googleapis surfaces HTTP status as `status` (number) and `code` (number or string).
export function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return status === 404 || code === 404 || code === "404";
}

// Gmail's answer when a user's per-minute quota or rate is used up: 429, or
// 403 with reason rateLimitExceeded or userRateLimitExceeded, or one naming
// an exceeded quota. Undefined for any other error; otherwise how long Gmail
// asked to wait (Retry-After), or 0 when it did not say.
export function rateLimitWaitMs(error: unknown, nowMs = Date.now()): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    response?: { status?: unknown; headers?: unknown; data?: { error?: { errors?: { reason?: unknown }[] } } };
  };
  const status = Number(e.status ?? e.response?.status ?? e.code);
  const reasons = (e.response?.data?.error?.errors ?? []).map((r) => r.reason);
  const quota = typeof e.message === "string" && e.message.includes("Quota exceeded");
  const limited =
    status === 429 || (status === 403 && (quota || reasons.includes("rateLimitExceeded") || reasons.includes("userRateLimitExceeded")));
  if (!limited) return undefined;
  return retryAfterMs(e.response?.headers, nowMs) ?? 0;
}

function retryAfterMs(headers: unknown, nowMs: number): number | undefined {
  if (typeof headers !== "object" || headers === null) return undefined;
  const value =
    typeof (headers as { get?: unknown }).get === "function"
      ? (headers as { get: (name: string) => string | null }).get("retry-after")
      : (headers as Record<string, unknown>)["retry-after"];
  if (typeof value !== "string" || !value.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

// Gmail still refused for rate once there was no time left to wait.
export class GmailRateLimited extends Error {
  constructor(readonly limit: unknown) {
    super(`Gmail rate limit: ${limit instanceof Error ? limit.message : String(limit)}`);
    this.name = "GmailRateLimited";
  }
}

export type RetryIo = {
  // How long the caller may still wait: rather than wait past it, the call
  // gives up with GmailRateLimited.
  timeLeftMs: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields: Record<string, unknown>) => void;
};

// The first wait after a rate limit when Gmail names none, doubled each
// time up to a minute, by when a per-minute quota has freed up.
export const rateLimitBackoffMs = { first: 2000, max: 60_000 };

// Calls `fn`, waiting out Gmail's rate limits with exponential backoff, or
// as long as Gmail asks if longer, while `timeLeftMs` allows.
export async function withRateLimitRetry<T>(fn: () => Promise<T>, io: RetryIo): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const asked = rateLimitWaitMs(error);
      if (asked === undefined) throw error;
      const wait = Math.max(asked, Math.min(rateLimitBackoffMs.max, rateLimitBackoffMs.first * 2 ** attempt));
      if (io.timeLeftMs() < wait) throw new GmailRateLimited(error);
      io.log("gmail_rate_limited", { attempt: attempt + 1, waitMs: wait });
      await io.sleep(wait);
    }
  }
}

// Spaces calls out so that together they spend at most `unitsPerMinute` of
// the user's quota: each waits until the units of those before it have been
// spread over a minute.
export function gmailPacer(unitsPerMinute: number, io: { nowMs: () => number; sleep: (ms: number) => Promise<void> }) {
  let free = 0;
  return async (units: number): Promise<void> => {
    const now = io.nowMs();
    const start = Math.max(free, now);
    free = start + (units * 60_000) / unitsPerMinute;
    if (start > now) await io.sleep(start - now);
  };
}
