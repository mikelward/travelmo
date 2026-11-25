"use client";

import { checkNewLink, emailRows, isRemovable, linkRefusalText, type EmailRowKind } from "@travelmo/core";
import type { User } from "firebase/auth";
import { useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/trips";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2  hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

const notes: Record<EmailRowKind, string | undefined> = {
  signIn: "Sign-in",
  gmail: "Gmail",
  confirmed: undefined,
  pending: "Not confirmed yet",
};

// Settings' "Email addresses" (SPEC "Linked email addresses"): the sign-in,
// the addresses confirmed, the connected Gmail, those waiting for their
// link, and Add, which mails a confirmation link.
export function EmailAddressesSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const signIn = user.emailVerified ? user.email : undefined;
  const now = new Date().toISOString();
  const rows = emailRows(signIn, profile, now);

  const run = async (operation: "add" | "remove", action: () => Promise<string | undefined>) => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      setNotice(await action());
    } catch (err) {
      // Logged without the address or the message, which may name it.
      console.error("Changing linked email addresses failed", { operation, error: (err as Error).name });
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const check = checkNewLink(email, signIn, profile, now);
    if ("refusal" in check) return setError(linkRefusalText[check.refusal]);
    void run("add", async () => {
      await api.addEmail(user, check.email);
      setEmail("");
      return `We sent a link to ${check.email}. Open it to confirm.`;
    });
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Email addresses</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">Trips and profiles shared with any of these come to you.</p>
      <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
        {rows.map((row) => (
          <li key={row.email} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="break-all">{row.email}</p>
              {notes[row.kind] && <p className="text-zinc-600 dark:text-zinc-400">{notes[row.kind]}</p>}
            </div>
            {isRemovable(row) && (
              <button type="button" disabled={busy} className={buttonClass} onClick={() => void run("remove", async () => void (await api.removeEmail(user, row.email)))}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 flex flex-wrap gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email address"
          className="min-w-0 flex-1 rounded-lg border border-field bg-background px-3 py-2"
        />
        {/* Named in full: Settings has other Add buttons. */}
        <button type="submit" disabled={busy || !email.trim()} aria-label="Add email address" className={buttonClass}>
          Add
        </button>
      </form>
      {notice && <p className="mt-3 text-green-700 dark:text-green-500">{notice}</p>}
      {error && <p className="mt-3 text-danger">{error}</p>}
    </section>
  );
}
