"use client";

import { formatDate, formatDateRange, localDate, paths, segmentDateRange, type Segment, type Trip } from "@travelmo/core";
import type { User } from "firebase/auth";
import { arrayRemove, arrayUnion, doc, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useState, type FormEvent } from "react";
import { SegmentForm } from "@/components/SegmentForm";
import { SegmentRow } from "@/components/SegmentRow";
import { SignInGate } from "@/components/SignInGate";
import { deleteSegment, deleteTrip, fitTripDates, mergeTrips, moveSegment, renameTrip, saveSegment } from "@/lib/edits";
import { firestore } from "@/lib/firebase";
import { effectiveDecision, learnSender } from "@/lib/patterns";
import { useSegments, useSenderPatterns, useTrip, useTrips } from "@/lib/trips";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function byDay(segments: Segment[]): [string, Segment[]][] {
  const days = new Map<string, Segment[]>();
  for (const segment of segments) {
    const day = localDate(segment.start);
    days.set(day, [...(days.get(day) ?? []), segment]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function Title({ trip, canEdit }: { trip: Trip; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(trip.title);
  const [error, setError] = useState<string>();

  if (!editing) {
    return (
      <div className="mt-2 flex items-baseline gap-3">
        <h1 className="text-3xl font-semibold">{trip.title}</h1>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setTitle(trip.title);
              setEditing(true);
            }}
            className="text-sm text-zinc-500 hover:underline"
          >
            Rename
          </button>
        )}
      </div>
    );
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError("Give the trip a name");
    try {
      await renameTrip(firestore(), trip.id, title);
      setEditing(false);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <form onSubmit={submit} className="mt-2 flex items-center gap-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-2xl font-semibold dark:border-zinc-700"
      />
      <button type="submit" className={buttonClass}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className={buttonClass}>
        Cancel
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}

// Offered only when the bookings span less than the trip, which happens after
// deletions because saving only ever widens the dates.
function FitDates({ trip, segments }: { trip: Trip; segments: Segment[] }) {
  const [error, setError] = useState<string>();
  const range = segmentDateRange(segments);
  if (!range || (range.start === trip.start && range.end === trip.end)) return null;
  return (
    <>
      {" · "}
      <button
        type="button"
        onClick={() => fitTripDates(firestore(), trip.id).catch((e: Error) => setError(e.message))}
        className="text-sm text-zinc-500 hover:underline"
      >
        Fit dates to bookings ({formatDateRange(range.start, range.end)})
      </button>
      {error && <span className="ml-2 text-sm text-red-600">{error}</span>}
    </>
  );
}

function Sharing({ trip }: { trip: Trip }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const ref = doc(firestore(), paths.trip(trip.id));

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address.includes("@")) return setError("Enter an email address");
    setError(undefined);
    try {
      await updateDoc(ref, { sharedWith: arrayUnion(address), updatedAt: new Date().toISOString() });
      setEmail("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = (address: string) =>
    updateDoc(ref, { sharedWith: arrayRemove(address), updatedAt: new Date().toISOString() }).catch((e: Error) =>
      setError(e.message),
    );

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Shared with</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {trip.sharedWith.length === 0 && <li className="text-zinc-500">Only you</li>}
        {trip.sharedWith.map((address) => (
          <li key={address} className="flex items-center justify-between">
            <span>{address}</span>
            <button type="button" onClick={() => remove(address)} className="text-zinc-500 hover:underline">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="partner@example.com"
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        />
        <button type="submit" className={buttonClass}>
          Share
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function MergeInto({ trip, targets }: { trip: Trip; targets: Trip[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<Trip>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (targets.length === 0) return null;
  const merge = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await mergeTrips(firestore(), trip.id, target.id);
      router.replace(`/trips/${target.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Merge into another trip</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Moves every booking here into the other trip and deletes this one. Who it is shared with stays as the other trip has it.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={target?.id ?? ""}
          onChange={(e) => setTarget(targets.find((t) => t.id === e.target.value))}
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        >
          <option value="">Choose a trip…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({formatDateRange(t.start, t.end)})
            </option>
          ))}
        </select>
        <button type="button" disabled={!target || busy} onClick={merge} className={buttonClass}>
          {busy ? "Merging…" : `Merge into ${target?.title ?? "…"}`}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function DangerZone({ trip }: { trip: Trip }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remove = async () => {
    setBusy(true);
    try {
      await deleteTrip(firestore(), trip.id);
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  if (trip.deleting) {
    return (
      <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950">
        <p>Deleting this trip was interrupted. Its bookings can no longer be changed.</p>
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Finish deleting"}
        </button>
        {error && <p className="mt-2 text-red-600">{error}</p>}
      </section>
    );
  }
  return (
    <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="text-sm text-red-600 hover:underline">
          Delete this trip
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Delete “{trip.title}” and all its bookings? This cannot be undone.</span>
          <button type="button" disabled={busy} onClick={remove} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={buttonClass}>
            Keep
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

type Editing = { kind: "add" } | { kind: "edit"; segment: Segment } | undefined;

function TripDetail({ tripId, user }: { tripId: string; user: User }) {
  const trip = useTrip(tripId);
  const segments = useSegments(tripId);
  const patterns = useSenderPatterns(user.uid);
  const allTrips = useTrips(user);
  const [editing, setEditing] = useState<Editing>();
  const [error, setError] = useState<string>();
  if (trip === undefined) return <p className="text-zinc-500">Loading…</p>;
  if (trip === null) return <p className="text-zinc-500">This trip does not exist or is not shared with you.</p>;
  const isOwner = trip.ownerUid === user.uid;
  const isSharee = !!user.email && user.emailVerified && trip.sharedWith.includes(user.email.toLowerCase());
  // Sharees edit bookings; only the owner renames, shares or deletes the trip.
  const canEdit = (isOwner || isSharee) && !trip.deleting;
  const canManage = isOwner && !trip.deleting;

  const save = async (extracted: Parameters<typeof saveSegment>[2]) => {
    await saveSegment(firestore(), trip.id, extracted, editing?.kind === "edit" ? editing.segment : undefined);
    setEditing(undefined);
  };
  const remove = (segment: Segment) =>
    deleteSegment(firestore(), trip.id, segment.id).catch((e: Error) => setError(e.message));
  // Other trips the viewer can edit, as destinations for a booking or for the
  // whole trip; the rules decide finally, so a sharee of only one side is told.
  const otherTrips = (allTrips ?? [])
    .filter((t) => t.id !== trip.id && !t.deleting)
    .sort((a, b) => a.start.localeCompare(b.start));
  const move = (segment: Segment, toTripId: string) =>
    moveSegment(firestore(), trip.id, segment.id, toTripId).catch((e: Error) => setError(e.message));
  // Sender rules are the viewer's own, so the offer stands for the owner only:
  // the import ran against their mailbox.
  const learn = (segment: Segment) =>
    isOwner && segment.sender && effectiveDecision(patterns, segment.sender) !== "allow"
      ? () => learnSender(firestore(), user.uid, segment.sender!, "allow").catch((e: Error) => setError(e.message))
      : undefined;

  return (
    <>
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← All trips
      </Link>
      <Title trip={trip} canEdit={canManage} />
      <p className="mt-1 text-zinc-600 dark:text-zinc-400" data-testid="trip-dates">
        {formatDateRange(trip.start, trip.end)}
        {canManage && segments && <FitDates trip={trip} segments={segments} />}
      </p>
      {isOwner && trip.deleting && <DangerZone trip={trip} />}

      {canEdit && !editing && (
        <button type="button" onClick={() => setEditing({ kind: "add" })} className={`${buttonClass} mt-4`}>
          Add a booking
        </button>
      )}
      {editing?.kind === "add" && (
        <SegmentForm defaultDate={trip.start} onSave={save} onCancel={() => setEditing(undefined)} />
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {!segments && <p className="mt-8 text-zinc-500">Loading…</p>}
      {segments && segments.length === 0 && <p className="mt-8 text-zinc-500">No bookings in this trip yet.</p>}
      {segments &&
        byDay(segments).map(([day, items]) => (
          <section key={day} className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">{formatDate(day)}</h2>
            <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-800">
              {items.map((segment) =>
                editing?.kind === "edit" && editing.segment.id === segment.id ? (
                  <li key={segment.id} className="py-3">
                    <SegmentForm
                      segment={segment}
                      defaultDate={trip.start}
                      onSave={save}
                      onCancel={() => setEditing(undefined)}
                    />
                  </li>
                ) : (
                  <SegmentRow
                    key={segment.id}
                    segment={segment}
                    {...(canEdit
                      ? {
                          onEdit: () => setEditing({ kind: "edit", segment }),
                          onDelete: () => remove(segment),
                          moveTargets: otherTrips,
                          onMove: (toTripId: string) => move(segment, toTripId),
                        }
                      : {})}
                    {...(learn(segment) ? { onLearnSender: learn(segment) } : {})}
                  />
                ),
              )}
            </ul>
          </section>
        ))}

      {canManage && <Sharing trip={trip} />}
      {canManage && <MergeInto trip={trip} targets={otherTrips} />}
      {canManage && <DangerZone trip={trip} />}
    </>
  );
}

function TripRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SignInGate>{(user) => <TripDetail tripId={id} user={user} />}</SignInGate>;
}

export default function TripPage(props: PageProps<"/trips/[id]">) {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <TripRoute params={props.params} />
    </Suspense>
  );
}
