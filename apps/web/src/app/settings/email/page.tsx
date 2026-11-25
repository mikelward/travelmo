"use client";

import type { User } from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Where a confirmation link lands (SPEC "Linked email addresses"): signed
// in, it asks the parser to link the address, which only the account that
// asked may do. It opens to an account not approved yet too, which links
// the address it was invited at from the invite-only page; confirming lets
// it in, and the app follows its user document, so no reload is needed.
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
  // Settings stays closed to an account not approved yet.
  const { access } = useAuth();
  return (
    <SignInGate whileWaiting>
      {(user) => (
        <>
          {access.state === "approved" && (
            <p className="mb-2">
              <Link href="/settings" className="underline">
                Settings
              </Link>
            </p>
          )}
          <h1 className="mb-6 text-2xl font-semibold">Email address</h1>
          <Suspense fallback={<p className="text-muted">Loading…</p>}>
            <Confirm user={user} />
          </Suspense>
        </>
      )}
    </SignInGate>
  );
}
