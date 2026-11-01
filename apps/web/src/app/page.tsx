"use client";

import { groupTrips, type Segment, type Trip } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { SignInGate } from "@/components/SignInGate";
import { TripCard } from "@/components/TripCard";
import { useSaveForOffline } from "@/lib/offline";
import { useNow, useSegmentsOf, useTrips } from "@/lib/trips";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Trips whose "next up" line is worth a listener each: everything under way
// and the few coming next.
const upcomingWithDetails = 3;

function Section({
  title,
  trips,
  uid,
  segmentsByTrip,
  now,
}: {
  title: string;
  trips: Trip[];
  uid: string;
  segmentsByTrip: Record<string, Segment[]>;
  now: string;
}) {
  if (trips.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="grid gap-3">
        {trips.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            shared={trip.ownerUid !== uid}
            {...(segmentsByTrip[trip.id] ? { segments: segmentsByTrip[trip.id], now } : {})}
          />
        ))}
      </div>
    </section>
  );
}

function Trips({ user }: { user: User }) {
  useSaveForOffline();
  const trips = useTrips(user);
  const groups = trips ? groupTrips(trips, today()) : undefined;
  const detailed = groups ? [...groups.current, ...groups.upcoming.slice(0, upcomingWithDetails)].map((t) => t.id) : [];
  const segmentsByTrip = useSegmentsOf(detailed);
  const now = useNow();

  if (!trips || !groups) return <p className="text-zinc-500">Loading trips…</p>;
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
  const sectionProps = { uid: user.uid, segmentsByTrip, now };
  return (
    <>
      <Section title="Now" trips={groups.current} {...sectionProps} />
      <Section title="Upcoming" trips={groups.upcoming} {...sectionProps} />
      <Section title="Past" trips={groups.past} {...sectionProps} />
    </>
  );
}

export default function HomePage() {
  return <SignInGate>{(user) => <Trips user={user} />}</SignInGate>;
}
