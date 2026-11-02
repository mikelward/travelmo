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

export type EmailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  listUnsubscribe: boolean;
  text: string;
};

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

export async function fetchMessage(gmail: Gmail, id: string): Promise<EmailMessage> {
  const { data } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  return toEmailMessage(data);
}

export type MessagePage = { ids: string[]; nextPageToken?: string };

// Up to `max` message ids from `pageToken` on, and where to carry on from;
// no nextPageToken once the search is exhausted.
export async function searchMessagePage(gmail: Gmail, query: string, max: number, pageToken?: string): Promise<MessagePage> {
  const ids: string[] = [];
  let token = pageToken;
  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(100, max - ids.length),
      ...(token ? { pageToken: token } : {}),
    });
    for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
    token = data.nextPageToken ?? undefined;
  } while (token && ids.length < max);
  return { ids, ...(token ? { nextPageToken: token } : {}) };
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
