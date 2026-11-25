"use client";

import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { api, deletionUnfinishedFor, onDeletionUnfinished } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { forgetFirestoreCache } from "@/lib/firebase";

// After a deletion: signs out and clears this browser's copy of the account.
// The caller shows <AccountDeleted /> once `deleted` is set, in place of a
// page that signing out would otherwise replace with the sign-in prompt.
export function useAccountDeletion(): { deleted: boolean; onDeleted: () => void } {
  const { signOut } = useAuth();
  const [deleted, setDeleted] = useState(false);
  const onDeleted = async () => {
    setDeleted(true);
    try {
      await signOut();
    } catch (error) {
      console.error("Signing out after deleting the account failed", error);
    }
    try {
      await forgetFirestoreCache();
    } catch (error) {
      console.error("Clearing this browser's copy of the deleted account failed", error);
    }
  };
  return { deleted, onDeleted: () => void onDeleted() };
}

export function AccountDeleted() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Account deleted</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Your account and everything in it are gone.</p>
    </>
  );
}

// Whether the parser said this account's deletion stopped part way.
export function useDeletionUnfinished(user: User | null | undefined): boolean {
  const [uid, setUid] = useState(deletionUnfinishedFor);
  useEffect(() => onDeletionUnfinished(() => setUid(deletionUnfinishedFor())), []);
  return !!user && uid === user.uid;
}

// In place of every page once deleting the account stopped part way: what
// is left is deleted by asking again (SPEC "Deleting an account").
export function FinishDeletion({ user, onDeleted }: { user: User; onDeleted: () => void }) {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const finish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteAccount(user);
    } catch (e) {
      console.error("Finishing the account's deletion failed", e);
      setError(`Couldn't delete your account: ${(e as Error).message}. Try again.`);
      setBusy(false);
      return;
    }
    onDeleted();
  };
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
      <h1 className="text-2xl font-semibold">Deleting your account didn&apos;t finish</h1>
      <p className="mt-2 text-muted">Some of it may still be stored.</p>
      <button type="button" disabled={busy} onClick={finish} className="mt-6 w-full rounded-lg bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-50">
        {busy ? "Deleting…" : "Finish deleting"}
      </button>
      {error && <p className="mt-4 text-danger">{error}</p>}
      <button type="button" onClick={() => void signOut()} className="mt-6 text-muted hover:underline">
        Sign out
      </button>
    </div>
  );
}

export function DeleteAccountSection({ user, onDeleted }: { user: User; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteAccount(user);
    } catch (e) {
      console.error("Deleting the account failed", e);
      setError(`Couldn't delete your account: ${(e as Error).message}. Try again.`);
      setBusy(false);
      return;
    }
    onDeleted();
  };
  return (
    <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-lg font-medium">Delete account</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        This deletes your trips, bookings, travel profile and connections, and people you shared trips with lose them.
      </p>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="mt-3 text-danger hover:underline">
          Delete account
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span>Delete your account and everything in it? This cannot be undone.</span>
          <button type="button" disabled={busy} onClick={remove} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Keep
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}
