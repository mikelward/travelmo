"use client";

import type { User } from "firebase/auth";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";

export function SignInGate({ children }: { children: (user: User) => ReactNode }) {
  const { user, signIn } = useAuth();
  const [error, setError] = useState<string>();

  if (user === undefined) {
    return <p className="text-zinc-500">Loading…</p>;
  }
  if (user === null) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
        <h1 className="text-2xl font-semibold">Travelmo</h1>
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
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    );
  }
  return <>{children(user)}</>;
}
