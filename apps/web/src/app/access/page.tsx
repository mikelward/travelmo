"use client";

import { accessLists, canRevoke, formatDate, normalizeEmail, type AccessConfig } from "@travelmo/core";
import type { User } from "firebase/auth";
import { useState, type FormEvent } from "react";
import { SignInGate } from "@/components/SignInGate";
import { decideAccess, useAccessRecords } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { firestore } from "@/lib/firebase";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

// Admins approve requests, invite addresses and revoke access (SPEC "Access").
function AccessAdmin({ user, config }: { user: User; config: AccessConfig }) {
  const records = useAccessRecords();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const me = user.email?.toLowerCase();

  const decide = async (address: string, decision: "approved" | "declined") => {
    setBusy(address);
    setError(undefined);
    try {
      await decideAccess(firestore(), address, decision, user.uid, new Date().toISOString());
      return true;
    } catch (e) {
      console.error("Saving an access decision failed", e);
      setError(`Couldn't save that for ${address}. Try again.`);
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const address = normalizeEmail(email);
    if (!address) return setError("Enter an email address");
    if (await decide(address, "approved")) setEmail("");
  };

  if (!records) return <p className="text-muted">Loading…</p>;
  const { pending, approved } = accessLists(records);
  return (
    <>
      <form onSubmit={invite} className="flex flex-wrap gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email address to invite"
          className="min-w-0 flex-1 rounded-lg border border-field bg-background px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy !== undefined} className={buttonClass}>
          Invite
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Requests</h2>
        {pending.length === 0 && <p className="mt-2 text-sm text-muted">No requests.</p>}
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {pending.map((r) => (
            <li key={r.email} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span className="break-all">
                {r.email}
                {r.requestedAt && <span className="text-muted"> · {formatDate(r.requestedAt.slice(0, 10))}</span>}
              </span>
              <span className="flex gap-2">
                <button type="button" disabled={busy === r.email} className={buttonClass} onClick={() => void decide(r.email, "approved")}>
                  Approve
                </button>
                <button type="button" disabled={busy === r.email} className={buttonClass} onClick={() => void decide(r.email, "declined")}>
                  Decline
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Approved</h2>
        <p className="mt-2 text-sm text-muted">Everyone with an account from before approvals is in too, listed once they next sign in.</p>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {approved.map((r) => (
            <li key={r.email} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="break-all">{r.email}</span>
              {canRevoke(r.email, me, config) && (
                <button type="button" disabled={busy === r.email} className={buttonClass} onClick={() => void decide(r.email, "declined")}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function AccessPage({ user }: { user: User }) {
  const { access } = useAuth();
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Access</h1>
      {access.state === "approved" && access.admin ? (
        <AccessAdmin user={user} config={{ admins: access.admins }} />
      ) : (
        <p className="text-muted">Only admins can see this page.</p>
      )}
    </>
  );
}

export default function Page() {
  return <SignInGate>{(user) => <AccessPage user={user} />}</SignInGate>;
}
