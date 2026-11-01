import type { User } from "firebase/auth";

export type BackfillResult = {
  candidates: number;
  skipped: number;
  filtered: number;
  not_booking: number;
  imported: number;
  failed: number;
};

function parserUrl(): string {
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
  disconnectGmail: (user: User) => post<void>(user, "/gmail/disconnect"),
  backfill: (user: User, max?: number) => post<BackfillResult>(user, "/gmail/backfill", max ? { max } : {}),
};
