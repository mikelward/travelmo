"use client";

import { displayTitles, groupTrips, listWarnings, nextUpFlightKeys, type FlightStatus, type Segment, type Trip } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { SignInGate } from "@/components/SignInGate";
import { TripCard } from "@/components/TripCard";
import { localToday } from "@/lib/dates";
import { usePeopleDocuments, useTripWarnings, warningText } from "@/lib/documents";
import { useFlightStatusesOf } from "@/lib/flightStatus";
import { useSaveForOffline } from "@/lib/offline";
import { useNow, useSegmentsOf, useTrips } from "@/lib/trips";

// Trips worth a listener each: everything under way, for the "next up"
// lines, and the few coming next, so their document warnings know where
// they go.
const upcomingWithDetails = 3;

function Section({
  title,
  trips,
  titles,
  uid,
  segmentsByTrip,
  now,
  flightStatuses,
  showNext,
}: {
  title: string;
  trips: Trip[];
  titles: Map<string, string>;
  uid: string;
  segmentsByTrip: Record<string, Segment[]>;
  now: string;
  // The live status of the cards' next flights, by key.
  flightStatuses: Record<string, FlightStatus>;
  // Whether the cards say what comes next: only a trip under way does. A
  // card whose bookings are loaded says they were all cancelled either way.
  showNext: boolean;
}) {
  if (trips.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">{title}</h2>
      <div className="grid gap-3">
        {trips.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            title={titles.get(trip.id) ?? trip.title}
            shared={trip.ownerUid !== uid}
            {...(segmentsByTrip[trip.id] ? { segments: segmentsByTrip[trip.id] } : {})}
            {...(showNext ? { now, flightStatuses } : {})}
          />
        ))}
      </div>
    </section>
  );
}

function Trips({ user }: { user: User }) {
  useSaveForOffline();
  const trips = useTrips(user);
  const today = localToday();
  const groups = trips ? groupTrips(trips, today) : undefined;
  const detailed = groups ? [...groups.current, ...groups.upcoming.slice(0, upcomingWithDetails)].map((t) => t.id) : [];
  const segmentsByTrip = useSegmentsOf(detailed);
  const now = useNow();
  // A card under way reads the live status of its next flight, one listener each.
  const flightStatuses = useFlightStatusesOf(
    (groups?.current ?? []).flatMap((trip) => {
      const segments = segmentsByTrip[trip.id];
      return segments ? nextUpFlightKeys(segments, now) : [];
    }),
  );
  const people = usePeopleDocuments(user);
  const warnings = useTripWarnings(people, trips ?? [], segmentsByTrip, today);

  if (!trips || !groups) return <p className="text-muted">Loading trips…</p>;
  if (trips.length === 0) {
    return (
      <div className="mt-16 text-center text-zinc-600 dark:text-zinc-400">
        <p>No trips yet.</p>
        <p className="mt-2">
          <Link href="/settings" className="underline">
            Connect your email
          </Link>{" "}
          to import your bookings.
        </p>
      </div>
    );
  }
  const sectionProps = { uid: user.uid, titles: displayTitles(trips), segmentsByTrip, now, flightStatuses };
  // Document warnings once, at the top, each for the earliest trip it bears
  // on and linking to it, rather than repeated on every card.
  const listed = listWarnings(warnings, trips);
  return (
    <>
      {listed.length > 0 && (
        <ul
          className="mb-8 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950"
          aria-label="Document warnings"
        >
          {listed.map(({ trip, warning }, i) => (
            <li key={i} className={warning.warning.when === "before" ? "text-red-700 dark:text-red-400" : "text-amber-800 dark:text-amber-300"}>
              <Link href={`/trips/${trip.id}`} className="hover:underline">
                {warningText(warning, today, sectionProps.titles.get(trip.id) ?? trip.title)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Section title="Now" trips={groups.current} showNext {...sectionProps} />
      <Section title="Upcoming" trips={groups.upcoming} showNext={false} {...sectionProps} />
      <Section title="Past" trips={groups.past} showNext={false} {...sectionProps} />
    </>
  );
}

export default function HomePage() {
  return <SignInGate>{(user) => <Trips user={user} />}</SignInGate>;
}
