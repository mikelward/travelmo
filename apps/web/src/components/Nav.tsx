"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, signOut } = useAuth();
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      {/* Wraps on a phone, where the links do not fit beside the wordmark. */}
      <nav className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          Travelmo
        </Link>
        {user && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/calendar" className="hover:underline">
              Calendar
            </Link>
            <Link href="/reports" className="hover:underline">
              Reports
            </Link>
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
