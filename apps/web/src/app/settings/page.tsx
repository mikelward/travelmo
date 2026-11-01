"use client";

import { paths, type SenderPatterns } from "@travelmo/core";
import type { User } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { api, type BackfillResult } from "@/lib/api";
import { firestore } from "@/lib/firebase";
import { useProfile, useSenderPatterns } from "@/lib/trips";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function GmailSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BackfillResult>();
  const status = useSearchParams().get("gmail");
  const [notice] = useState(() => (status === "connected" ? "Gmail connected. Import your past bookings below." : undefined));
  const [error, setError] = useState<string | undefined>(() => {
    if (status === "denied") return "Gmail access was not granted.";
    if (status === "error") return "Connecting Gmail failed. Try again.";
    return undefined;
  });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const gmail = profile?.gmail;
  return (
    <section>
      <h2 className="text-lg font-medium">Gmail</h2>
      {profile === undefined && <p className="mt-2 text-zinc-500">Loading…</p>}
      {profile && !gmail && (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Travelmo reads booking confirmations from your inbox and turns them into trips. It asks for read-only
            access and only sends emails that look like bookings to the extraction model.
          </p>
          <button
            type="button"
            disabled={busy}
            className={`${buttonClass} mt-3`}
            onClick={() =>
              run(async () => {
                const { url } = await api.connectGmail(user);
                window.location.assign(url);
              })
            }
          >
            Connect Gmail
          </button>
        </>
      )}
      {gmail && (
        <>
          <p className="mt-2 text-sm">
            Connected as <span className="font-medium">{gmail.emailAddress}</span>. New bookings import automatically.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => run(async () => setResult(await api.backfill(user)))}
            >
              {busy ? "Importing…" : "Import past bookings"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => run(() => api.disconnectGmail(user))}
            >
              Disconnect
            </button>
          </div>
          {result && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Looked at {result.candidates} emails: {result.imported} imported, {result.not_booking} not bookings,{" "}
              {result.filtered} filtered out, {result.skipped} already seen, {result.failed} failed.
            </p>
          )}
        </>
      )}
      {notice && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{notice}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function PatternsSection({ user }: { user: User }) {
  const saved = useSenderPatterns(user.uid);
  const [draft, setDraft] = useState<SenderPatterns>();
  const [status, setStatus] = useState<string>();
  const patterns = draft ?? saved;

  const save = async () => {
    if (!patterns) return;
    const clean = (list: string[]) => [...new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean))];
    const next = { allow: clean(patterns.allow), deny: clean(patterns.deny) };
    try {
      await setDoc(doc(firestore(), paths.senderPatterns(user.uid)), next);
      setDraft(undefined);
      setStatus("Saved");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const field = (key: keyof SenderPatterns, label: string, hint: string) => (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <span className="ml-2 text-zinc-500">{hint}</span>
      <textarea
        rows={3}
        value={(patterns?.[key] ?? []).join("\n")}
        onChange={(e) => setDraft({ allow: [], deny: [], ...patterns, [key]: e.target.value.split("\n") })}
        className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-zinc-700"
      />
    </label>
  );

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Sender rules</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        One domain per line. Always-import senders skip the subject check; never-import senders are dropped before
        anything is read.
      </p>
      <div className="mt-3 space-y-3">
        {field("allow", "Always import", "e.g. cove.example")}
        {field("deny", "Never import", "e.g. newsletters.example")}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={!draft} className={buttonClass} onClick={save}>
          Save
        </button>
        {status && <span className="text-sm text-zinc-500">{status}</span>}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <SignInGate>
      {(user) => (
        <>
          <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
          <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
            <GmailSection user={user} />
          </Suspense>
          <PatternsSection user={user} />
        </>
      )}
    </SignInGate>
  );
}
