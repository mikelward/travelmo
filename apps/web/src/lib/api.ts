import type { User } from "firebase/auth";
import { backfillStartPath, backfillStopPath, calendarConnectPath, calendarDisconnectPath, calendarExportIssuePath, calendarSelectPath, calendarExportStopPath, deleteAllTripsPath, fastmailBackfillStartPath, fastmailBackfillStopPath, fastmailConnectPath, fastmailDisconnectPath, feedAddPath, imapBackfillStartPath, imapBackfillStopPath, imapConnectPath, imapDisconnectPath, feedRemovePath, forwardIssuePath, forwardStopPath, gmailConnectPath, gmailDisconnectPath, linkRefusalText, refusalOf, refreshPath, refreshStopPath, regroupPath, type AccountAccess, type CalendarExport, type ForwardAddress, type RegroupResult } from "@travelmo/core";
import type { CalendarResult } from "./ics";
import type { TripItResult } from "./tripit";

export type BackfillStarted = {
  progress: { scanned: number; imported: number; failed?: number; done: boolean; running?: boolean; updatedAt: string };
};

// Statuses whose body the parser words for the user: a request it won't
// take (a token Fastmail refused, say), or one that clashes with the
// account's state (another mailbox connected, a reading still running).
const userFacing = new Set([400, 409, 410]);

// What a failed call says: a refusal to link an address in words, the
// parser's own message where it words one for the user, else the details.
export function failureMessage(path: string, status: number, text: string, plain = false): string {
  const refusal = refusalOf(text);
  if (refusal) return linkRefusalText[refusal];
  if (plain && userFacing.has(status) && text.trim()) return text.trim();
  return `${path} failed: ${status} ${text}`;
}

export function parserUrl(): string {
  const url = process.env.NEXT_PUBLIC_PARSER_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_PARSER_URL");
  return url.replace(/\/$/, "");
}

// `plain`: the parser's message for a refused request is shown as it is.
async function post<T>(user: User, path: string, body: unknown = {}, plain = false): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${parserUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(failureMessage(path, response.status, await response.text(), plain));
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  connectGmail: (user: User) => post<{ url: string }>(user, gmailConnectPath),
  completeGmail: (user: User, state: string) => post<{ emailAddress: string }>(user, "/gmail/complete", { state }),
  // Each of several mailboxes by its address.
  disconnectGmail: (user: User, emailAddress: string) => post<void>(user, gmailDisconnectPath, { emailAddress }),
  connectCalendar: (user: User) => post<{ url: string }>(user, calendarConnectPath),
  completeCalendar: (user: User, state: string) =>
    post<{ emailAddress: string; calendars: number }>(user, "/calendar/complete", { state }),
  selectCalendars: (user: User, ids: string[]) => post<{ read: number; failed: number }>(user, calendarSelectPath, { ids }),
  disconnectCalendar: (user: User) => post<void>(user, calendarDisconnectPath),
  // A Gmail mailbox's reading, by its address.
  startBackfill: (user: User, emailAddress: string, restart = false) =>
    post<BackfillStarted>(user, backfillStartPath, restart ? { emailAddress, restart } : { emailAddress }, true),
  stopBackfill: (user: User, emailAddress: string) => post<void>(user, backfillStopPath, { emailAddress }),
  connectFastmail: (user: User, token: string) => post<{ emailAddress: string }>(user, fastmailConnectPath, { token }, true),
  disconnectFastmail: (user: User) => post<void>(user, fastmailDisconnectPath),
  startFastmailBackfill: (user: User, restart = false) =>
    post<BackfillStarted>(user, fastmailBackfillStartPath, restart ? { restart } : {}, true),
  stopFastmailBackfill: (user: User) => post<void>(user, fastmailBackfillStopPath),
  // `server` only for an address whose provider Travelmo does not know.
  connectImap: (user: User, emailAddress: string, password: string, server?: string) =>
    post<{ emailAddress: string }>(user, imapConnectPath, { emailAddress, password, ...(server ? { server } : {}) }, true),
  disconnectImap: (user: User, emailAddress: string) => post<void>(user, imapDisconnectPath, { emailAddress }, true),
  startImapBackfill: (user: User, emailAddress: string, restart = false) =>
    post<BackfillStarted>(user, imapBackfillStartPath, restart ? { emailAddress, restart } : { emailAddress }, true),
  stopImapBackfill: (user: User, emailAddress: string) => post<void>(user, imapBackfillStopPath, { emailAddress }),
  reimport: (user: User, messageId: string) => post<{ outcome: string }>(user, "/gmail/reimport", { messageId }),
  importTripIt: (user: User, exported: unknown) => post<TripItResult>(user, "/import/tripit", { export: exported }),
  importIcs: (user: User, text: string) => post<CalendarResult>(user, "/import/ics", { text }),
  addFeed: (user: User, url: string, label?: string) =>
    post<CalendarResult & { id: string }>(user, feedAddPath, { url, ...(label ? { label } : {}) }),
  removeFeed: (user: User, id: string) => post<void>(user, feedRemovePath, { id }),
  issueCalendarExport: (user: User) => post<CalendarExport>(user, calendarExportIssuePath),
  stopCalendarExport: (user: User) => post<void>(user, calendarExportStopPath),
  issueForward: (user: User) => post<ForwardAddress>(user, forwardIssuePath),
  stopForward: (user: User) => post<void>(user, forwardStopPath),
  deleteAccount: (user: User) => post<void>(user, "/account/delete"),
  checkAccess: (user: User) => post<{ status: AccountAccess }>(user, "/access/check"),
  addEmail: (user: User, email: string) => post<{ email: string }>(user, "/emails/add", { email }),
  confirmEmail: (user: User, token: string) => post<{ email: string }>(user, "/emails/confirm", { token }),
  removeEmail: (user: User, email: string) => post<void>(user, "/emails/remove", { email }),
  regroupTrips: (user: User) => post<RegroupResult>(user, regroupPath),
  deleteAllTrips: (user: User) => post<{ trips: number }>(user, deleteAllTripsPath),
  // "Refresh from email" (`restart` from the first email again), run on the
  // server; its progress shows on the profile.
  refreshFromEmail: (user: User, restart = false) => post<BackfillStarted>(user, refreshPath, restart ? { restart } : {}, true),
  stopRefresh: (user: User) => post<void>(user, refreshStopPath),
  refreshFlights: (user: User, tripId: string) => post<{ enabled: boolean; checked?: number }>(user, "/flights/refresh", { tripId }),
};
