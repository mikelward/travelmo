"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, signOut } = useAuth();
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          Travelmo
        </Link>
        {user && (
          <div className="flex items-center gap-4 text-sm">
            <Link href="/profile" className="hover:underline">
              Profile
            </Link>
            <Link href="/settings" className="hover:underline">
              Settings
            </Link>
            <button type="button" onClick={() => signOut()} className="text-zinc-500 hover:underline">
              Sign out
            </button>
          </div>
        )}
      </nav>
    </header>
  );
}
