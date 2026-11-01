"use client";

import { groupTrips, type Trip } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { SignInGate } from "@/components/SignInGate";
import { TripCard } from "@/components/TripCard";
import { useTrips } from "@/lib/trips";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function Section({ title, trips, uid }: { title: string; trips: Trip[]; uid: string }) {
  if (trips.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="grid gap-3">
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} shared={trip.ownerUid !== uid} />
        ))}
      </div>
    </section>
  );
}

function Trips({ user }: { user: User }) {
  const trips = useTrips(user);
  if (!trips) return <p className="text-zinc-500">Loading trips…</p>;
  if (trips.length === 0) {
    return (
      <div className="mt-16 text-center text-zinc-600 dark:text-zinc-400">
        <p>No trips yet.</p>
        <p className="mt-2">
          <Link href="/settings" className="underline">
            Connect Gmail
          </Link>{" "}
          to import your bookings.
        </p>
      </div>
    );
  }
  const groups = groupTrips(trips, today());
  return (
    <>
      <Section title="Now" trips={groups.current} uid={user.uid} />
      <Section title="Upcoming" trips={groups.upcoming} uid={user.uid} />
      <Section title="Past" trips={groups.past} uid={user.uid} />
    </>
  );
}

export default function HomePage() {
  return <SignInGate>{(user) => <Trips user={user} />}</SignInGate>;
}
