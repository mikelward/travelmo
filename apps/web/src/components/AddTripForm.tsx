"use client";

import { tripDraftProblem } from "@travelmo/core";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createTrip } from "@/lib/edits";
import { firestore } from "@/lib/firebase";

const field = "rounded-lg border border-field bg-background px-3 py-2";
const button = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

// Add a trip (SPEC "Adding a trip"): a name and its dates; saved, the new
// trip opens, to add bookings to.
export function AddTripForm({ uid, onCancel }: { uid: string; onCancel: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = tripDraftProblem(title, start || undefined, end || undefined);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    try {
      const id = await createTrip(firestore(), uid, title, start, end);
      router.push(`/trips/${id}`);
    } catch (e) {
      console.error("Adding a trip failed", e);
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} aria-label="Add a trip" className="mb-6 space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name" aria-label="Name" className={`${field} w-full`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          From
          <input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              // A day trip unless said otherwise.
              if (!end || end < e.target.value) setEnd(e.target.value);
            }}
            className={field}
          />
        </label>
        <label className="flex items-center gap-2">
          To
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={field} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className={button}>
          {busy ? "Adding…" : "Add"}
        </button>
        {/* Not while saving: the save would go on, and open its trip over a form opened after it. */}
        <button type="button" onClick={onCancel} disabled={busy} className={button}>
          Cancel
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </form>
  );
}
