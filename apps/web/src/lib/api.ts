import type { User } from "firebase/auth";
import { backfillStartPath, backfillStopPath, deleteAllTripsPath, gmailConnectPath, gmailDisconnectPath, linkRefusalText, refusalOf, regroupPath, type AccountAccess, type CalendarExport, type ForwardAddress, type RegroupResult } from "@travelmo/core";
import type { CalendarResult } from "./ics";
import type { TripItResult } from "./tripit";

export type BackfillStarted = {
  progress: { scanned: number; imported: number; failed?: number; done: boolean; running?: boolean; updatedAt: string };
};

export function parserUrl(): string {
  const url = process.env.NEXT_PUBLIC_PARSER_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_PARSER_URL");
  return url.replace(/\/$/, "");
}

async function post<T>(user: User, path: string, body: unknown = {}): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${parserUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    // A refusal to link an address is put in words.
    const refusal = refusalOf(text);
    throw new Error(refusal ? linkRefusalText[refusal] : `${path} failed: ${response.status} ${text}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  connectGmail: (user: User) => post<{ url: string }>(user, gmailConnectPath),
  completeGmail: (user: User, state: string) => post<{ emailAddress: string }>(user, "/gmail/complete", { state }),
  // Each of several mailboxes by its address.
  disconnectGmail: (user: User, emailAddress: string) => post<void>(user, gmailDisconnectPath, { emailAddress }),
  connectCalendar: (user: User) => post<{ url: string }>(user, "/calendar/connect"),
  completeCalendar: (user: User, state: string) =>
    post<{ emailAddress: string; calendars: number }>(user, "/calendar/complete", { state }),
  selectCalendars: (user: User, ids: string[]) => post<{ read: number; failed: number }>(user, "/calendar/select", { ids }),
  disconnectCalendar: (user: User) => post<void>(user, "/calendar/disconnect"),
  startBackfill: (user: User, emailAddress: string, restart = false) =>
    post<BackfillStarted>(user, backfillStartPath, restart ? { emailAddress, restart } : { emailAddress }),
  stopBackfill: (user: User, emailAddress: string) => post<void>(user, backfillStopPath, { emailAddress }),
  reimport: (user: User, messageId: string) => post<{ outcome: string }>(user, "/gmail/reimport", { messageId }),
  importTripIt: (user: User, exported: unknown) => post<TripItResult>(user, "/import/tripit", { export: exported }),
  importIcs: (user: User, text: string) => post<CalendarResult>(user, "/import/ics", { text }),
  addFeed: (user: User, url: string, label?: string) =>
    post<CalendarResult & { id: string }>(user, "/feeds/add", { url, ...(label ? { label } : {}) }),
  removeFeed: (user: User, id: string) => post<void>(user, "/feeds/remove", { id }),
  issueCalendarExport: (user: User) => post<CalendarExport>(user, "/export/calendar"),
  stopCalendarExport: (user: User) => post<void>(user, "/export/calendar/stop"),
  issueForward: (user: User) => post<ForwardAddress>(user, "/forward/issue"),
  stopForward: (user: User) => post<void>(user, "/forward/stop"),
  deleteAccount: (user: User) => post<void>(user, "/account/delete"),
  checkAccess: (user: User) => post<{ status: AccountAccess }>(user, "/access/check"),
  addEmail: (user: User, email: string) => post<{ email: string }>(user, "/emails/add", { email }),
  confirmEmail: (user: User, token: string) => post<{ email: string }>(user, "/emails/confirm", { token }),
  removeEmail: (user: User, email: string) => post<void>(user, "/emails/remove", { email }),
  regroupTrips: (user: User) => post<RegroupResult>(user, regroupPath),
  deleteAllTrips: (user: User) => post<{ trips: number }>(user, deleteAllTripsPath),
  refreshFlights: (user: User, tripId: string) => post<{ enabled: boolean; checked?: number }>(user, "/flights/refresh", { tripId }),
};
