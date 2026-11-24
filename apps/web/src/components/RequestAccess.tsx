"use client";

import { checkNewLink, linkRefusalText, type AccountAccess } from "@travelmo/core";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { DeleteAccountSection } from "@/components/DeleteAccount";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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
  const email = user.emailVerified && user.email ? user.email.toLowerCase() : undefined;

  // Nobody asks for access (Travelmo is invite-only). The parser lets in an
  // account from before approvals, or one someone already shared with; the
  // page follows the record it writes.
  const waiting = status === "none" || status === "requested";
  useEffect(() => {
    if (email && waiting) api.checkAccess(user).catch((e: Error) => console.error("Checking access failed", e));
  }, [user, email, waiting]);

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
      <Logo size={72} className="mx-auto mb-4" />
      <h1 className="text-xl font-medium">Travelmo is invite-only</h1>
      {!email && <p className="mt-2 text-muted">Sign in with an account whose email address Google has verified.</p>}
      {email && waiting && (
        <p className="mt-2 text-muted">You&apos;re signed in as {email}. Ask someone who uses Travelmo to share a trip with you.</p>
      )}
      {email && status === "declined" && <p className="mt-2 text-muted">Your request for {email} wasn&apos;t approved.</p>}
      {email && waiting && <InvitedElsewhere user={user} signIn={email} />}
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

// Someone invited at another address links it (SPEC "Linked email
// addresses"): the parser mails a link only to an address that lets the
// account in, and confirming it opens the app.
function InvitedElsewhere({ user, signIn }: { user: User; signIn: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(undefined);
    setError(undefined);
    const check = checkNewLink(email, signIn, undefined, new Date().toISOString());
    if ("refusal" in check) return setError(linkRefusalText[check.refusal]);
    setBusy(true);
    try {
      await api.addEmail(user, check.email);
      setEmail("");
      setNotice(`We sent a link to ${check.email}. Open it here to confirm.`);
    } catch (err) {
      // Logged without the address or the message, which may name it.
      console.error("Sending a link to an invited address failed", { error: (err as Error).name });
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void send(e)} className="mt-8 text-left">
      <h2 className="font-medium">Invited at another address?</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email address"
          className="min-w-0 flex-1 rounded-lg border border-field bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          aria-label="Add email address"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Send link
        </button>
      </div>
      {notice && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{notice}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </form>
  );
}
