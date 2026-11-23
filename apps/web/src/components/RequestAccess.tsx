"use client";

import type { AccountAccess } from "@travelmo/core";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { DeleteAccountSection } from "@/components/DeleteAccount";
import { Logo } from "@/components/Logo";
import { requestAccess } from "@/lib/access";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { firestore } from "@/lib/firebase";

// What a signed-in account sees until it is approved (SPEC "Access").
export function RequestAccess({
  user,
  status,
  onDeleted,
}: {
  user: User;
  status: Exclude<AccountAccess, "approved">;
  onDeleted: () => void;
}) {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const email = user.emailVerified && user.email ? user.email.toLowerCase() : undefined;

  // The parser lets in an account from before approvals, or one someone
  // already shared with, and tells the admins of a request they have not
  // heard of; the page follows the record it writes.
  const waiting = status === "none" || status === "requested";
  useEffect(() => {
    if (email && waiting) api.checkAccess(user).catch((e: Error) => console.error("Checking access failed", e));
  }, [user, email, waiting]);

  const ask = async () => {
    if (!email) return;
    setBusy(true);
    setError(undefined);
    try {
      await requestAccess(firestore(), email, user.uid, new Date().toISOString());
      await api.checkAccess(user);
    } catch (e) {
      console.error("Requesting access failed", e);
      setError("Couldn't send your request. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
      <Logo size={72} className="mx-auto mb-4" />
      <h1 className="text-xl font-medium">Travelmo is invite-only</h1>
      {!email && <p className="mt-2 text-muted">Sign in with an account whose email address Google has verified.</p>}
      {email && status === "none" && (
        <>
          <p className="mt-2 text-muted">
            You&apos;re signed in as {email}. Ask for access, or ask someone who uses Travelmo to share a trip with you.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void ask()}
            className="mt-6 w-full rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Request access
          </button>
        </>
      )}
      {email && status === "requested" && <p className="mt-2 text-muted">Request sent. Travelmo opens here once it&apos;s approved.</p>}
      {email && status === "declined" && <p className="mt-2 text-muted">Your request for {email} wasn&apos;t approved.</p>}
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      <button type="button" onClick={() => void signOut()} className="mt-6 text-sm text-muted hover:underline">
        Sign out
      </button>
      {/* Settings, where accounts are otherwise deleted, needs access. */}
      <div className="text-left">
        <DeleteAccountSection user={user} onDeleted={onDeleted} />
      </div>
    </div>
  );
}
