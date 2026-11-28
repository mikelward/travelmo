"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";

export function Nav() {
  const { user, access } = useAuth();
  const approved = access.state === "approved";
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      {/* Wraps on a phone, where the links do not fit beside the wordmark. */}
      <nav className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3">
        <Link href="/" className="font-wordmark flex items-center gap-2 text-lg font-medium">
          <Logo size={28} />
          Travelmo
        </Link>
        {user && approved && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/" className="hover:underline">
              Trips
            </Link>
            <Link href="/calendar" className="hover:underline">
              Calendar
            </Link>
            <Link href="/reports" className="hover:underline">
              Reports
            </Link>
            <Link href="/wallet" className="hover:underline">
              Wallet
            </Link>
            <Link href="/settings" className="hover:underline">
              Settings
            </Link>
            {access.state === "approved" && access.admin && (
              <Link href="/access" className="hover:underline">
                Access
              </Link>
            )}
          </div>
        )}
      </nav>
    </header>
  );
}
