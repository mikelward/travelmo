"use client";

import type { User } from "firebase/auth";
import { useState, type ReactNode } from "react";
import { AccountDeleted, useAccountDeletion } from "@/components/DeleteAccount";
import { Logo } from "@/components/Logo";
import { RequestAccess } from "@/components/RequestAccess";
import { useAuth } from "@/lib/auth";

// `whileWaiting` opens the page to an account not approved yet that has not
// been declined: the page confirming a linked address, which is how such an
// account links the address it was invited at (SPEC "Linked email
// addresses"). Every other page shows the invite-only screen instead.
export function SignInGate({ children, whileWaiting = false }: { children: (user: User) => ReactNode; whileWaiting?: boolean }) {
  const { user, access, signIn } = useAuth();
  const [error, setError] = useState<string>();
  // An account without access deletes itself from the request screen, which
  // signing out afterwards would otherwise replace with the sign-in prompt.
  const { deleted, onDeleted } = useAccountDeletion();

  if (deleted) return <AccountDeleted />;
  if (user === undefined) {
    return <p className="text-muted">Loading…</p>;
  }
  if (user === null) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
        <Logo size={72} className="mx-auto mb-4" />
        <h1 className="font-wordmark text-2xl font-medium">Travelmo</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Your trips in one place, imported from your inbox.
        </p>
        <button
          type="button"
          onClick={() => signIn().catch((e: Error) => setError(e.message))}
          className="mt-6 w-full rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Sign in with Google
        </button>
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </div>
    );
  }
  if (access.state === "loading") return <p className="text-muted">Loading…</p>;
  const waiting = access.state === "none" || access.state === "requested";
  if (access.state !== "approved" && !(whileWaiting && waiting)) {
    return <RequestAccess user={user} status={access.state} onDeleted={onDeleted} />;
  }
  return <>{children(user)}</>;
}
