"use client";

import {
  displayTitles,
  filtering as filtersOn,
  flagsUnknown,
  groupTrips,
  hiddenFromList,
  tripTravelers,
  watchedTrip,
  watching,
  journeyGapHomes,
  journeyGaps,
  journeyGapText,
  isEmptyQuery,
  listWarnings,
  nextUpFlightKeys,
  noListFilters,
  parseTripQuery,
  tripMatches,
  type FlightStatus,
  type ListFilters,
  type Segment,
  type Trip,
} from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { TripCard } from "@/components/TripCard";
import { AddTripForm } from "@/components/AddTripForm";
import { TripListToolbar } from "@/components/TripListToolbar";
import {
  usePeopleDocuments,
  useTripWarnings,
  warningText,
} from "@/lib/documents";
import { usePeople } from "@/lib/people";
import { setCheckedIn, useCheckedIn } from "@/lib/checkedIn";
import { useFlightStatusesOf } from "@/lib/flightStatus";
import { useSaveForOffline } from "@/lib/offline";
import {
  useAllSegments,
  useKeepTripFlags,
  useLocalToday,
  useNow,
  useProfile,
  useSegmentsOf,
  useSegmentsOnce,
  useTripsState,
} from "@/lib/trips";

// Trips worth a listener each: everything under way, for the "next up"
// lines, and the few coming next, so their document warnings know where
// they go.
const upcomingWithDetails = 3;

// The list's filters, kept in this browser (SPEC "Filtering the trip list").
const listFiltersKey = "travelmo.listFilters";

function useListFilters(): [ListFilters, (next: ListFilters) => void] {
  const [filters, setFilters] = useState<ListFilters>(noListFilters);
  // Read after the first render, so the page the server sent matches.
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(listFiltersKey) ?? "null",
      );
      if (stored && typeof stored === "object") {
        const { hideCancelled, hideLocal, hideWatching } = stored as Record<
          string,
          unknown
        >;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only there after hydration
        setFilters({
          hideCancelled: hideCancelled === true,
          hideLocal: hideLocal === true,
          hideWatching: hideWatching === true,
        });
      }
    } catch (e) {
      // Storage may be blocked (a private window): everything shows.
      console.debug(
        "Reading the trip list's filters failed; showing every trip",
        e,
      );
    }
  }, []);
  const update = (next: ListFilters) => {
    setFilters(next);
    try {
      localStorage.setItem(listFiltersKey, JSON.stringify(next));
    } catch (e) {
      // They still apply for this visit.
      console.debug(
        "Saving the trip list's filters failed; they last this visit",
        e,
      );
    }
  };
  return [filters, update];
}

function Section({
  title,
  trips,
  titles,
  uid,
  segmentsByTrip,
  now,
  flightStatuses,
  checkedIn,
  onCheckedIn,
  showNext,
  missingOf,
  watchingOf,
}: {
  title: string;
  trips: Trip[];
  titles: Map<string, string>;
  uid: string;
  segmentsByTrip: Record<string, Segment[]>;
  now: string;
  // The live status of the cards' next flights, by key.
  flightStatuses: Record<string, FlightStatus>;
  // The flights the viewer marked "I've checked in", by trip.
  checkedIn: Record<string, ReadonlySet<string>>;
  onCheckedIn: (tripId: string, segmentId: string) => void;
  // Whether the cards say what comes next: only a trip under way does. A
  // card whose bookings are loaded says they were all cancelled either way.
  showNext: boolean;
  // What a trip whose bookings are loaded seems to be missing (journeyGaps).
  missingOf: (trip: Trip) => string | undefined;
  // Whether the viewer is only watching a trip (watching).
  watchingOf: (trip: Trip) => boolean;
}) {
  if (trips.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-3 text-lg font-medium">{title}</h2>
      {/* One card per section, a rule between its trips. */}
      <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {trips.map((trip) => {
          const missing = missingOf(trip);
          return (
            <TripCard
              key={trip.id}
              trip={trip}
              title={titles.get(trip.id) ?? trip.title}
              shared={trip.ownerUid !== uid}
              {...(segmentsByTrip[trip.id]
                ? { segments: segmentsByTrip[trip.id] }
                : {})}
              {...(showNext
                ? {
                    now,
                    flightStatuses,
                    onCheckedIn: (segmentId: string) =>
                      onCheckedIn(trip.id, segmentId),
                  }
                : {})}
              {...(checkedIn[trip.id] ? { checkedIn: checkedIn[trip.id] } : {})}
              {...(missing ? { missing } : {})}
              watching={watchingOf(trip)}
            />
          );
        })}
      </div>
    </section>
  );
}

function Trips({ user }: { user: User }) {
  useSaveForOffline();
  const tripsState = useTripsState(user);
  const trips = tripsState?.trips;
  const today = useLocalToday();
  const [search, setSearch] = useState("");
  // Once searched, kept for the visit, so clearing the box and searching
  // again reads nothing more.
  const [searched, setSearched] = useState(false);
  const query = useMemo(() => parseTripQuery(search), [search]);
  const searching = !isEmptyQuery(query);
  const [filters, setFilters] = useListFilters();
  const [addingTrip, setAddingTrip] = useState(false);
  const filtering = filtersOn(filters);
  // Whom the user's bookings name, and so which trips they're only watching.
  const travelers = usePeople(user.uid);
  // Every trip's bookings, read once a search starts (SPEC "Searching trips").
  // Once the server answers for the trip list, bookings read from the cache alone are read again.
  const all = useAllSegments(trips && searched ? trips : undefined, user.uid, Boolean(tripsState?.confirmed));
  // The bookings of trips that don't yet say what the filters and their
  // picture need (flagsUnknown), each read once per version of the trip,
  // whenever it turns up so (a later snapshot, an edit), and its flags kept,
  // so each is read once and never again.
  const unknownTrips = useMemo(() => (trips ? trips.filter(flagsUnknown) : undefined), [trips]);
  const unknown = useSegmentsOnce(unknownTrips, user.uid);
  const bookingsOf = (id: string) => all?.byTrip[id] ?? unknown[id];
  useKeepTripFlags(trips, bookingsOf, true);
  const titles = useMemo(() => displayTitles(trips ?? []), [trips]);
  const kept = useMemo(
    () => trips?.filter((t) => !hiddenFromList(t, all?.byTrip[t.id] ?? unknown[t.id], filters, travelers ?? [])),
    [trips, all, unknown, filters, travelers],
  );
  const watchingOf = (trip: Trip) => {
    const read = bookingsOf(trip.id);
    return watching(
      trip.travelers ?? (read ? tripTravelers(read) : undefined),
      travelers ?? [],
    );
  };
  const shown = useMemo(
    () =>
      kept && searching
        ? kept.filter((t) =>
            tripMatches(
              query,
              t,
              titles.get(t.id) ?? t.title,
              all?.byTrip[t.id] ?? [],
            ),
          )
        : kept,
    [kept, searching, query, titles, all],
  );
  // Listeners follow every trip, searched or not; the sections show what a search found.
  const everything = useMemo(() => (trips ? groupTrips(trips, today) : undefined), [trips, today]);
  const groups = useMemo(
    () => (shown === trips ? everything : shown ? groupTrips(shown, today) : undefined),
    [shown, trips, everything, today],
  );
  const detailed = useMemo(
    () =>
      everything
        ? [
            ...everything.current,
            ...everything.upcoming.slice(0, upcomingWithDetails),
          ].map((t) => t.id)
        : [],
    [everything],
  );
  const segmentsByTrip = useSegmentsOf(detailed);
  const hasCurrent = (everything?.current.length ?? 0) > 0;
  const now = useNow(60_000, hasCurrent);
  const currentTrips = everything?.current;
  // A card under way reads the live status of its next flight, one listener each.
  const flightKeys = useMemo(
    () =>
      (currentTrips ?? []).flatMap((trip) => {
        const segments = segmentsByTrip[trip.id];
        return segments ? nextUpFlightKeys(segments, now) : [];
      }),
    [currentTrips, segmentsByTrip, now],
  );
  const flightStatuses = useFlightStatusesOf(flightKeys);
  // The viewer's own "I've checked in" marks on the trips under way.
  const currentIds = useMemo(() => (currentTrips ?? []).map((trip) => trip.id), [currentTrips]);
  const checkedIn = useCheckedIn(user.uid, currentIds);
  const [error, setError] = useState<string>();
  const onCheckedIn = (tripId: string, segmentId: string) => {
    setError(undefined);
    setCheckedIn(user.uid, tripId, segmentId, true).catch((e: unknown) => {
      console.error("Marking a flight checked in failed", e);
      setError("Couldn't save your check-in. Try again.");
    });
  };
  const people = usePeopleDocuments(user);
  const profile = useProfile(user.uid);
  // The user's own trips whose bookings are loaded: one they're only watching warns of no one's documents.
  const ownTrips = useMemo(
    () => (trips ?? []).filter((t) => segmentsByTrip[t.id] && !watchedTrip(t, segmentsByTrip[t.id], travelers ?? [])),
    [trips, segmentsByTrip, travelers],
  );
  const warnings = useTripWarnings(people, ownTrips, segmentsByTrip, today);
  const gapHomes = useMemo(
    () => (profile ? journeyGapHomes(profile.homes ?? [], profile.homeAirports ?? []) : []),
    [profile],
  );
  const oneWaySet = useMemo(() => new Set(profile?.oneWayTrips ?? []), [profile]);
  const listed = useMemo(() => (trips ? listWarnings(warnings, trips) : []), [warnings, trips]);

  if (!trips || !groups) return <p className="text-muted">Loading trips…</p>;
  // The bar and Add a trip's form, first on the page whether or not there
  // are trips yet: the first trip added fills the list before its write is
  // confirmed, and the form must stay as it is through that.
  const head = (
    <>
      <TripListToolbar
        query={search}
        onQuery={(next) => {
          setSearch(next);
          if (next.trim()) setSearched(true);
        }}
        filters={filters}
        onFilters={setFilters}
        onAddTrip={() => setAddingTrip(true)}
      />
      {addingTrip && (
        <AddTripForm uid={user.uid} onCancel={() => setAddingTrip(false)} />
      )}
    </>
  );
  if (trips.length === 0) {
    return (
      <>
        {head}
        <div className="mt-16 text-center text-zinc-600 dark:text-zinc-400">
          <p>No trips yet.</p>
          <p className="mt-2">
            <Link href="/settings" className="underline">
              Connect your email
            </Link>{" "}
            to import your bookings, or{" "}
            <button
              type="button"
              onClick={() => setAddingTrip(true)}
              className="underline"
            >
              add a trip
            </button>
            .
          </p>
        </div>
      </>
    );
  }
  // A journey a trip seems to be missing, for the cards whose bookings are
  // read (those under way and the next few), as the trip's page says it.
  const missingOf = (trip: Trip) => {
    const segments = segmentsByTrip[trip.id];
    if (!segments || !profile || trip.deleting) return undefined;
    const [gap] = journeyGaps(segments, gapHomes, oneWaySet.has(trip.id));
    return gap ? journeyGapText(gap) : undefined;
  };
  const sectionProps = {
    uid: user.uid,
    titles,
    segmentsByTrip,
    now,
    flightStatuses,
    checkedIn,
    onCheckedIn,
    missingOf,
    watchingOf,
  };
  // Document warnings once, at the top, each for the earliest trip it bears
  // on and linking to it, rather than repeated on every card.
  return (
    <>
      {head}
      {listed.length > 0 && (
        <ul
          className="mb-8 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
          aria-label="Document warnings"
        >
          {listed.map(({ trip, warning }, i) => (
            <li
              key={i}
              className={
                warning.warning.when === "before"
                  ? "text-red-700 dark:text-red-400"
                  : "text-amber-800 dark:text-amber-300"
              }
            >
              <Link href={`/trips/${trip.id}`} className="hover:underline">
                {warningText(
                  warning,
                  today,
                  sectionProps.titles.get(trip.id) ?? trip.title,
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mb-4 text-danger">{error}</p>}
      {/* Until the server has answered for every trip's bookings: the cache's may be only some of them. */}
      {searching && (!all || all.unconfirmed.length > 0) && (
        <p className="mb-4 text-muted">Searching bookings…</p>
      )}
      {searching && all && all.failed.length > 0 && (
        <p className="mb-4 text-danger">
          Some trips&apos; bookings couldn&apos;t be read, so they&apos;re
          searched by title and dates only.
        </p>
      )}
      {searching && all && all.unconfirmed.length === 0 && shown?.length === 0 && (
        <p className="text-muted">No trips match.</p>
      )}
      {!searching && filtering && all && shown?.length === 0 && (
        <p className="text-muted">Every trip is hidden.</p>
      )}
      <Section title="Now" trips={groups.current} showNext {...sectionProps} />
      <Section
        title="Upcoming"
        trips={groups.upcoming}
        showNext={false}
        {...sectionProps}
      />
      <Section
        title="Past"
        trips={groups.past}
        showNext={false}
        {...sectionProps}
      />
    </>
  );
}

export default function HomePage() {
  return <SignInGate>{(user) => <Trips user={user} />}</SignInGate>;
}
