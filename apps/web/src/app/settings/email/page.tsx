"use client";

import type { User } from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { api } from "@/lib/api";

// Where a confirmation link lands (SPEC "Linked email addresses"): signed
// in, it asks the parser to link the address, which only the account that
// asked may do.
function Confirm({ user }: { user: User }) {
  const token = useSearchParams().get("token");
  const [result, setResult] = useState<{ email: string } | { error: string }>();
  const asked = useRef(false);
  useEffect(() => {
    if (!token || asked.current) return;
    asked.current = true;
    api
      .confirmEmail(user, token)
      .then(setResult)
      .catch((e: Error) => {
        console.error("Confirming an email address failed", e);
        setResult({ error: e.message });
      });
  }, [token, user]);

  if (!token) return <p className="text-danger">This link is incomplete. Open the one in the email.</p>;
  if (!result) return <p className="text-muted">Confirming…</p>;
  if ("error" in result) return <p className="text-danger">{result.error}</p>;
  return <p>{result.email} is now yours on Travelmo.</p>;
}

export default function ConfirmEmailPage() {
  return (
    <SignInGate>
      {(user) => (
        <>
          <p className="mb-2 text-sm">
            <Link href="/settings" className="underline">
              Settings
            </Link>
          </p>
          <h1 className="mb-6 text-2xl font-semibold">Email address</h1>
          <Suspense fallback={<p className="text-muted">Loading…</p>}>
            <Confirm user={user} />
          </Suspense>
        </>
      )}
    </SignInGate>
  );
}
