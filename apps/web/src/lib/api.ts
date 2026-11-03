import type { User } from "firebase/auth";
import type { CalendarExport } from "@travelmo/core";
import type { CalendarResult } from "./ics";
import type { TripItResult } from "./tripit";

export type BackfillResult = {
  candidates: number;
  progress: { scanned: number; imported: number; failed?: number; done: boolean; updatedAt: string };
  skipped: number;
  filtered: number;
  not_booking: number;
  imported: number;
  failed: number;
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
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  connectGmail: (user: User) => post<{ url: string }>(user, "/gmail/connect"),
  completeGmail: (user: User, state: string) => post<{ emailAddress: string }>(user, "/gmail/complete", { state }),
  disconnectGmail: (user: User) => post<void>(user, "/gmail/disconnect"),
  connectCalendar: (user: User) => post<{ url: string }>(user, "/calendar/connect"),
  completeCalendar: (user: User, state: string) =>
    post<{ emailAddress: string; calendars: number }>(user, "/calendar/complete", { state }),
  selectCalendars: (user: User, ids: string[]) => post<{ read: number; failed: number }>(user, "/calendar/select", { ids }),
  disconnectCalendar: (user: User) => post<void>(user, "/calendar/disconnect"),
  backfill: (user: User, restart = false) => post<BackfillResult>(user, "/gmail/backfill", restart ? { restart } : {}),
  reimport: (user: User, messageId: string) => post<{ outcome: string }>(user, "/gmail/reimport", { messageId }),
  importTripIt: (user: User, exported: unknown) => post<TripItResult>(user, "/import/tripit", { export: exported }),
  importIcs: (user: User, text: string) => post<CalendarResult>(user, "/import/ics", { text }),
  addFeed: (user: User, url: string, label?: string) =>
    post<CalendarResult & { id: string }>(user, "/feeds/add", { url, ...(label ? { label } : {}) }),
  removeFeed: (user: User, id: string) => post<void>(user, "/feeds/remove", { id }),
  issueCalendarExport: (user: User) => post<CalendarExport>(user, "/export/calendar"),
  stopCalendarExport: (user: User) => post<void>(user, "/export/calendar/stop"),
};
