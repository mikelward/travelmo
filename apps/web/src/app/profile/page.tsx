"use client";

import type { ProfileEntry, TravelProfile } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { useSaveForOffline } from "@/lib/offline";
import { maxTrusted, saveTrusted, useSharedProfiles, useTravelProfile } from "@/lib/travelProfile";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

// Each entry folds away; documents start folded, so a passport number is
// not on screen until asked for.
function Entries({ title, entries, open }: { title: string; entries: ProfileEntry[]; open: boolean }) {
  if (!entries.length) return null;
  return (
    <section className="mt-6">
      <h3 className="font-medium">{title}</h3>
      <ul className="mt-2 space-y-2">
        {entries.map((entry, i) => (
          <li key={`${entry.title}-${i}`}>
            <details open={open} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <summary className="cursor-pointer text-sm font-medium">{entry.title}</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {entry.fields.map((field, j) => (
                  <div key={`${field.label}-${j}`} className="contents">
                    <dt className="text-zinc-600 dark:text-zinc-400">{field.label}</dt>
                    <dd className="break-words">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfileSections({ profile }: { profile: TravelProfile }) {
  return (
    <>
      <Entries title="Documents" entries={profile.documents} open={false} />
      <Entries title="Loyalty programs" entries={profile.loyalty} open />
      <Entries title="Travelers" entries={profile.travelers} open={false} />
    </>
  );
}

const hasDetails = (p: TravelProfile) => p.documents.length + p.loyalty.length + p.travelers.length > 0;

function SharingSection({ user, profile }: { user: User; profile: TravelProfile | null }) {
  const trusted = profile?.trustedEmails ?? [];
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (next: string[]) => {
    setBusy(true);
    setError(undefined);
    try {
      await saveTrusted(user, profile !== null, next);
      setEmail("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Shared with</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        People you trust, such as a partner, can see everything on this page, documents included, when signed in with
        that email address. They can&apos;t change it.
      </p>
      {trusted.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {trusted.map((t) => (
            <li key={t} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="break-all">{t}</span>
              <button type="button" disabled={busy} className={buttonClass} onClick={() => save(trusted.filter((x) => x !== t))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save([...trusted, email]);
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email address to share with"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        />
        <button type="submit" disabled={busy || !email.trim() || trusted.length >= maxTrusted} className={buttonClass}>
          Share
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function SharedWithYou({ user }: { user: User }) {
  const shared = useSharedProfiles(user)?.filter((p) => p.ownerUid !== user.uid);
  if (!shared?.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Shared with you</h2>
      {shared.map((p) => (
        <div key={p.ownerUid} className="mt-4">
          <p className="text-sm font-medium">From {p.ownerEmail ?? "someone who trusts you"}</p>
          {hasDetails(p) ? <ProfileSections profile={p} /> : <p className="mt-2 text-sm text-zinc-500">Nothing in it yet.</p>}
        </div>
      ))}
    </section>
  );
}

function ProfilePage({ user }: { user: User }) {
  const profile = useTravelProfile(user.uid);
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">Travel profile</h1>
      {profile === undefined && <p className="text-zinc-500">Loading…</p>}
      {profile !== undefined && (!profile || !hasDetails(profile)) && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nothing imported yet. Upload a TripIt export in <Link href="/settings" className="underline">Settings</Link> to
          bring in your documents, loyalty programs and fellow travelers.
        </p>
      )}
      {profile && hasDetails(profile) && <ProfileSections profile={profile} />}
      {profile !== undefined && <SharingSection user={user} profile={profile} />}
      <SharedWithYou user={user} />
    </>
  );
}

export default function Page() {
  useSaveForOffline();
  return <SignInGate>{(user) => <ProfilePage user={user} />}</SignInGate>;
}
