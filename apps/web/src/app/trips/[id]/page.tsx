"use client";

import { formatDate, formatDateRange, localDate, paths, type Segment, type Trip } from "@travelmo/core";
import type { User } from "firebase/auth";
import { arrayRemove, arrayUnion, doc, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { Suspense, use, useState, type FormEvent } from "react";
import { SegmentRow } from "@/components/SegmentRow";
import { SignInGate } from "@/components/SignInGate";
import { firestore } from "@/lib/firebase";
import { useSegments, useTrip } from "@/lib/trips";

function byDay(segments: Segment[]): [string, Segment[]][] {
  const days = new Map<string, Segment[]>();
  for (const segment of segments) {
    const day = localDate(segment.start);
    days.set(day, [...(days.get(day) ?? []), segment]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
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
        <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
          Share
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function TripDetail({ tripId, user }: { tripId: string; user: User }) {
  const trip = useTrip(tripId);
  const segments = useSegments(tripId);
  if (trip === undefined) return <p className="text-zinc-500">Loading…</p>;
  if (trip === null) return <p className="text-zinc-500">This trip does not exist or is not shared with you.</p>;

  return (
    <>
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← All trips
      </Link>
      <h1 className="mt-2 text-3xl font-semibold">{trip.title}</h1>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">{formatDateRange(trip.start, trip.end)}</p>

      {!segments && <p className="mt-8 text-zinc-500">Loading…</p>}
      {segments && segments.length === 0 && <p className="mt-8 text-zinc-500">No bookings in this trip yet.</p>}
      {segments &&
        byDay(segments).map(([day, items]) => (
          <section key={day} className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">{formatDate(day)}</h2>
            <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-800">
              {items.map((segment) => (
                <SegmentRow key={segment.id} segment={segment} />
              ))}
            </ul>
          </section>
        ))}

      {trip.ownerUid === user.uid && <Sharing trip={trip} />}
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
