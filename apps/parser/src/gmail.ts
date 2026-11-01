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

export async function searchMessageIds(gmail: Gmail, query: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(100, max - ids.length),
      ...(pageToken ? { pageToken } : {}),
    });
    for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }
  return ids;
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
