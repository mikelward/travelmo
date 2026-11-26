import type { User } from "firebase/auth";
import { accountDeletePath, bugReportFailure, bugReportPath, type BugReport, backfillStartPath, backfillStopPath, calendarConnectPath, calendarDisconnectPath, calendarExportIssuePath, calendarSelectPath, calendarExportStopPath, startOverPath, fastmailBackfillStartPath, fastmailBackfillStopPath, fastmailConnectPath, fastmailDisconnectPath, feedAddPath, imapBackfillStartPath, imapBackfillStopPath, imapConnectPath, imapDisconnectPath, feedRemovePath, forwardIssuePath, forwardStopPath, gmailConnectPath, gmailDisconnectPath, isDeletionUnfinished, linkRefusalText, refusalOf, refreshPath, refreshStopPath, regroupPath, lookPath, type AccountAccess, type JourneyGap, type LookResult, type CalendarExport, type ForwardAddress, type RegroupResult } from "@travelmo/core";
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

// The account the parser last said had a deletion stop part way: the app
// shows FinishDeletion in place of any page for it (SPEC "Deleting an
// account").
let unfinishedUid: string | undefined;
const unfinishedListeners = new Set<() => void>();

export function deletionUnfinishedFor(): string | undefined {
  return unfinishedUid;
}

export function onDeletionUnfinished(listener: () => void): () => void {
  unfinishedListeners.add(listener);
  return () => void unfinishedListeners.delete(listener);
}

function markDeletionUnfinished(uid: string): void {
  unfinishedUid = uid;
  for (const listener of unfinishedListeners) listener();
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
    const text = await response.text();
    if (isDeletionUnfinished(response.status, text)) markDeletionUnfinished(user.uid);
    throw new Error(failureMessage(path, response.status, text, plain));
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// Sends a bug report; a failure says why in the user's words, from the
// status alone (SPEC "Bug reports").
async function sendBugReport(user: User, report: BugReport): Promise<void> {
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${parserUrl()}${bugReportPath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  } catch (error) {
    console.error("Sending the bug report failed: the parser could not be reached", error);
    throw new Error(bugReportFailure(null));
  }
  if (!response.ok) {
    console.error(`Sending the bug report failed: ${response.status}`);
    throw new Error(bugReportFailure(response.status));
  }
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
  // `report`: what was read and what the model said, to copy (debugReport.ts).
  reimport: (user: User, messageId: string) => post<{ outcome: string; report?: string }>(user, "/gmail/reimport", { messageId }),
  // "Look for it" on a journey a trip seems to be missing: emails read, and
  // `next` to keep looking from (findJourney.ts).
  lookForJourney: (user: User, gap: JourneyGap, next?: number) =>
    post<LookResult>(user, lookPath, {
      from: gap.from,
      to: gap.to,
      date: gap.date,
      ...(gap.until ? { until: gap.until } : {}),
      ...(gap.fromCode ? { fromCode: gap.fromCode } : {}),
      ...(gap.toCode ? { toCode: gap.toCode } : {}),
      ...(next !== undefined ? { next } : {}),
    }),
  importTripIt: (user: User, exported: unknown) => post<TripItResult>(user, "/import/tripit", { export: exported }),
  importIcs: (user: User, text: string) => post<CalendarResult>(user, "/import/ics", { text }),
  addFeed: (user: User, url: string, label?: string) =>
    post<CalendarResult & { id: string }>(user, feedAddPath, { url, ...(label ? { label } : {}) }),
  removeFeed: (user: User, id: string) => post<void>(user, feedRemovePath, { id }),
  issueCalendarExport: (user: User) => post<CalendarExport>(user, calendarExportIssuePath),
  stopCalendarExport: (user: User) => post<void>(user, calendarExportStopPath),
  issueForward: (user: User) => post<ForwardAddress>(user, forwardIssuePath),
  stopForward: (user: User) => post<void>(user, forwardStopPath),
  deleteAccount: (user: User) => post<void>(user, accountDeletePath),
  checkAccess: (user: User) => post<{ status: AccountAccess }>(user, "/access/check"),
  addEmail: (user: User, email: string) => post<{ email: string }>(user, "/emails/add", { email }),
  confirmEmail: (user: User, token: string) => post<{ email: string }>(user, "/emails/confirm", { token }),
  removeEmail: (user: User, email: string) => post<void>(user, "/emails/remove", { email }),
  regroupTrips: (user: User) => post<RegroupResult>(user, regroupPath),
  // "Delete everything and start over" (SPEC "Starting over").
  startOver: (user: User) => post<{ trips: number; mailboxes: number }>(user, startOverPath),
  // "Refresh from email" (`restart` from the first email again), run on the
  // server; its progress shows on the profile.
  // `retryFailed`: only the emails the last refresh couldn't read.
  // `everything`: "Refresh everything from email", every email from the start.
  refreshFromEmail: (user: User, restart = false, retryFailed = false, everything = false) =>
    post<BackfillStarted>(user, refreshPath, everything ? { everything } : restart ? { restart } : retryFailed ? { retryFailed } : {}, true),
  stopRefresh: (user: User) => post<void>(user, refreshStopPath),
  sendBugReport,
  refreshFlights: (user: User, tripId: string) => post<{ enabled: boolean; checked?: number }>(user, "/flights/refresh", { tripId }),
};
