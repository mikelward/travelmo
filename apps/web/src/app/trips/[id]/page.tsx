"use client";

import { allLoyalty, bookedDateRange, bookingHeading, headedRouteLine, flightCheckInState, displayBounds, effectiveHomes, homeTimeline, journeyGapHomes, journeyGaps, rideNeedKey, rideNeeds, displayTitles, formatDate, formatDateRange, gmailMailboxes, localDate, normalizeEmail, paths, programsFor, mixedTrip, duplicateFlights, duplicateFlightKey, namedTravelers, sharedWithAny, sourceGroups, watchedTrip, type Segment, type SenderCleanup, type Trip } from "@travelmo/core";
import type { User } from "firebase/auth";
import { arrayRemove, doc, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SegmentForm } from "@/components/SegmentForm";
import { RideSuggestion } from "@/components/RideSuggestion";
import { SegmentRow } from "@/components/SegmentRow";
import { Dialog } from "@/components/BookingMenu";
import { api } from "@/lib/api";
import { hideRideNeed, markOneWay } from "@/lib/rides";
import { SignInGate } from "@/components/SignInGate";
import { sourceKindLabels } from "@/lib/sourceLinks";
import { cancelSegment, cancelTrip, deleteSegment, deleteTrip, favoriteSegment, fitTripDates, mergeSegments, mergeTrips, moveSegment, moveSegmentToNewTrip, splitTrip, rateSegment, renameTrip, restoreSegment, restoreTrip, saveSegment, setRemovedTravelers, markOneTrip, markBothTaken } from "@/lib/edits";
import { shareTrip } from "@/lib/access";
import { firestore } from "@/lib/firebase";
import { useSaveForOffline } from "@/lib/offline";
import { effectiveDecision, learnSender, removeSenderBookings, senderBookings } from "@/lib/patterns";
import { DocumentWarnings } from "@/components/DocumentWarnings";
import { JourneyGapNotice } from "@/components/JourneyGapNotice";
import { MixedTripNotice } from "@/components/MixedTripNotice";
import { DuplicateFlightNotice } from "@/components/DuplicateFlightNotice";
import { EntryRequirements } from "@/components/EntryRequirements";
import { useEntryRequirements } from "@/lib/visas";
import { usePeopleDocuments, useTripWarnings } from "@/lib/documents";
import { usePeople } from "@/lib/people";
import { useTravelProfile } from "@/lib/travelProfile";
import { BeforeYouGo } from "@/components/Checklist";
import { useTripChecklist } from "@/lib/checklist";
import { useReportTrip } from "@/components/ReportBug";
import { useAddresses, useLocalToday, useNow, useProfile, useSegments, useSenderPatterns, useTrip, useTrips, useKeepTripFlags } from "@/lib/trips";
import { flightLinesFor, useFlightRefresh, useFlightStatuses } from "@/lib/flightStatus";
import { setCheckedIn, useCheckedIn, useCheckedInFromNotification } from "@/lib/checkedIn";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5  hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function byDay(segments: Segment[]): [string, Segment[]][] {
  const days = new Map<string, Segment[]>();
  for (const segment of segments) {
    const day = localDate(segment.start);
    days.set(day, [...(days.get(day) ?? []), segment]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// The trip's own ⋮ menu, as Android's top bar has it: Rename and Split…, for the owner.
type MenuItem = { label: string; onSelect: () => void };

function TripMenu({ items }: { items: readonly MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    wrapper.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div ref={wrapper} className="relative mt-1 shrink-0" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        aria-label="Trip actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full px-2 py-1 text-xl leading-none text-muted hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        ⋮
      </button>
      {open && (
        <div role="menu" aria-label="Trip actions" className="absolute right-0 top-9 z-10 min-w-40 rounded-lg border border-zinc-200 bg-background py-1 shadow-lg dark:border-zinc-800">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="block w-full px-4 py-2 text-left hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Title({ trip, canEdit, more = [] }: { trip: Trip; canEdit: boolean; more?: readonly MenuItem[] }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(trip.title);
  const [error, setError] = useState<string>();

  if (!editing) {
    return (
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{trip.title}</h1>
        {canEdit && (
          <TripMenu
            items={[
              {
                label: "Rename",
                onSelect: () => {
                  setTitle(trip.title);
                  setEditing(true);
                },
              },
              ...more,
            ]}
          />
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
        className="flex-1 rounded-lg border border-field bg-background px-3 py-2 text-2xl font-semibold"
      />
      <button type="submit" className={buttonClass}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className={buttonClass}>
        Cancel
      </button>
      {error && <span className="text-danger">{error}</span>}
    </form>
  );
}

// Offered only when the bookings span less than the trip, which happens after
// deletions because saving only ever widens the dates.
function FitDates({ trip, segments }: { trip: Trip; segments: Segment[] }) {
  const [error, setError] = useState<string>();
  // The trip's own dates cover every booking, cancelled ones too.
  const range = bookedDateRange(segments);
  if (!range || (range.start === trip.start && range.end === trip.end)) return null;
  return (
    <>
      {" · "}
      <button
        type="button"
        onClick={() => fitTripDates(firestore(), trip.id).catch((e: Error) => setError(e.message))}
        className="text-muted hover:underline"
      >
        Fit dates to bookings ({formatDateRange(range.start, range.end)})
      </button>
      {error && <span className="ml-2 text-danger">{error}</span>}
    </>
  );
}

function Sharing({ trip, user }: { trip: Trip; user: User }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const ref = doc(firestore(), paths.trip(trip.id));

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const address = normalizeEmail(email);
    if (!address) return setError("Enter an email address");
    setError(undefined);
    try {
      // Sharing also lets the address into Travelmo (SPEC "Access").
      await shareTrip(firestore(), trip.id, address, user.uid, new Date().toISOString());
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
      <h2 className="text-lg font-medium">Shared with</h2>
      <ul className="mt-2 space-y-1">
        {trip.sharedWith.length === 0 && <li className="text-muted">Only you</li>}
        {trip.sharedWith.map((address) => (
          <li key={address} className="flex items-center justify-between">
            <span>{address}</span>
            <button type="button" onClick={() => remove(address)} className="text-muted hover:underline">
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
          className="flex-1 rounded-lg border border-field bg-background px-3 py-2"
        />
        <button type="submit" className={buttonClass}>
          Share
        </button>
      </form>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}

// Split…: some of the trip's bookings into a new trip of their own, as when a
// forwarded itinerary of someone else's was filed into the user's own trip.
// Each email (sourceGroups) is a heading with its subject, sender and date,
// its bookings ticked under it; ticking the email ticks them all, and a
// booking two emails gave is ticked under both.
function SplitDialog({ trip, segments, uid, onClose }: { trip: Trip; segments: Segment[]; uid: string; onClose: () => void }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const groups = useMemo(() => sourceGroups(segments), [segments]);
  const byId = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);
  const toggle = (ids: readonly string[], on: boolean) =>
    setPicked((was) => {
      const next = new Set(was);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const split = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const ids = [...segments].sort((a, b) => a.start.localeCompare(b.start)).map((s) => s.id).filter((id) => picked.has(id));
      const id = await splitTrip(firestore(), trip.id, ids, uid);
      router.push(`/trips/${id}`);
    } catch (e) {
      console.error("Splitting a trip failed", e);
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const count = picked.size;
  return (
    <Dialog title="Split trip" onClose={onClose}>
      <p className="text-zinc-600 dark:text-zinc-400">Pick the bookings to move to a new trip.</p>
      <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="Emails">
        {groups.map((group) => {
          const ticked = group.segmentIds.filter((id) => picked.has(id)).length;
          const subject = group.source ? (group.source.label ?? sourceKindLabels[group.source.kind]) : "Added by hand";
          const from = group.source ? [group.sender ?? sourceKindLabels[group.source.kind], formatDate(localDate(group.source.sentAt ?? group.source.at))].join(" · ") : undefined;
          return (
            <li key={group.source ? `${group.source.kind}/${group.source.id}` : "by-hand"} className="py-2" data-testid="split-group">
              <label className="flex items-baseline gap-3 py-1">
                <TriCheckbox checked={ticked === group.segmentIds.length} mixed={ticked > 0 && ticked < group.segmentIds.length} onChange={(on) => toggle(group.segmentIds, on)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-medium">{subject}</span>
                  {from && <span className="block text-muted">{from}</span>}
                </span>
              </label>
              <ul className="pl-7" aria-label={subject}>
                {group.segmentIds.map((id) => {
                  const segment = byId.get(id)!;
                  // As its row on the trip page: its heading, then where it goes, so two flights of one airline are told apart.
                  const heading = bookingHeading(segment);
                  const route = headedRouteLine(segment, heading);
                  return (
                    <li key={id}>
                      <label className="flex items-baseline gap-3 py-1">
                        <input type="checkbox" checked={picked.has(id)} onChange={(e) => toggle([id], e.target.checked)} />
                        <span className="min-w-0 flex-1">
                          <span className="block">{heading.headline}</span>
                          {route && <span className="block text-muted">{route}</span>}
                          <span className="block text-muted">{formatDate(localDate(segment.start))}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-danger">{error}</p>}
      <div className="mt-3">
        <button type="button" disabled={busy || count === 0 || count === segments.length} onClick={split} className={buttonClass}>
          {busy ? "Moving…" : count === 1 ? "Move 1 booking to a new trip" : `Move ${count} bookings to a new trip`}
        </button>
      </div>
    </Dialog>
  );
}

// A checkbox that can be partly ticked, as an email's is when only some of its bookings are.
function TriCheckbox({ checked, mixed, onChange }: { checked: boolean; mixed: boolean; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return <input ref={ref} type="checkbox" checked={checked} aria-checked={mixed ? "mixed" : checked} onChange={(e) => onChange(e.target.checked)} />;
}

// Whom the trip is for: every name its bookings give, ticked unless the
// owner took it off. Unticking a wrongly named passenger, the user among
// them, makes it a trip they're only watching.
function TravelersDialog({ trip, segments, onClose }: { trip: Trip; segments: Segment[]; onClose: () => void }) {
  const names = useMemo(() => namedTravelers(segments, trip.removedTravelers), [segments, trip.removedTravelers]);
  // Unticked: only those the owner took off, as people write them; a name
  // on nothing but a cancelled booking is still on the trip.
  const [off, setOff] = useState<Set<string>>(() => new Set(namedTravelers([], trip.removedTravelers)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await setRemovedTravelers(firestore(), trip.id, [...off]);
      onClose();
    } catch (e) {
      console.error("Saving a trip's travelers failed", e);
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog title="Travelers" onClose={onClose}>
      <p className="text-zinc-600 dark:text-zinc-400">Untick anyone not on this trip. A trip you&apos;re not on is left out of your reports and reminders.</p>
      <ul className="mt-3" aria-label="Travelers">
        {names.map((name) => (
          <li key={name}>
            <label className="flex items-baseline gap-3 py-2">
              <input
                type="checkbox"
                checked={!off.has(name)}
                onChange={(e) =>
                  setOff((was) => {
                    const next = new Set(was);
                    if (e.target.checked) next.delete(name);
                    else next.add(name);
                    return next;
                  })
                }
              />
              <span>{name}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-danger">{error}</p>}
      <div className="mt-3">
        <button type="button" disabled={busy} onClick={save} className={buttonClass}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Dialog>
  );
}

function MergeInto({ trip, targets, titles }: { trip: Trip; targets: Trip[]; titles: Map<string, string> }) {
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
      <h2 className="text-lg font-medium">Merge into another trip</h2>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        Moves every booking here into the other trip and deletes this one. Who it is shared with stays as the other trip has it.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={target?.id ?? ""}
          onChange={(e) => setTarget(targets.find((t) => t.id === e.target.value))}
          aria-label="Trip to merge into"
          className="min-w-0 max-w-full rounded-lg border border-field bg-background px-3 py-2"
        >
          <option value="">Choose a trip…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({formatDateRange(t.start, t.end)})
            </option>
          ))}
        </select>
        <button type="button" disabled={!target || busy} onClick={merge} className={buttonClass}>
          {busy ? "Merging…" : `Merge into ${target ? (titles.get(target.id) ?? target.title) : "…"}`}
        </button>
      </div>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// "2 trips and 1 booking": what a sender cleanup deletes, trips whole.
function imported(plan: SenderCleanup): string {
  const parts = [plan.trips.length && count(plan.trips.length, "trip"), plan.segments.length && count(plan.segments.length, "booking")].filter(Boolean);
  return parts.join(" and ");
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
      <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
        <p>Deleting this trip was interrupted. Its bookings can no longer be changed.</p>
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Finish deleting"}
        </button>
        {error && <p className="mt-2 text-danger">{error}</p>}
      </section>
    );
  }
  return (
    <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="text-danger hover:underline">
          Delete this trip
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span>Delete “{trip.title}” and all its bookings? This cannot be undone.</span>
          <button type="button" disabled={busy} onClick={remove} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={buttonClass}>
            Keep
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}

// A cancelled trip says so under its dates, with Restore for the owner; one
// still on offers the owner "Mark trip cancelled" at the foot of the page.
function TripCancelled({ trip, canManage }: { trip: Trip; canManage: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = (action: (db: ReturnType<typeof firestore>, tripId: string) => Promise<void>, what: string) => {
    setBusy(true);
    setError(undefined);
    action(firestore(), trip.id)
      .catch((e: Error) => {
        console.error(`${what} failed`, e);
        setError(e.message);
      })
      .finally(() => setBusy(false));
  };
  if (trip.cancelledAt) {
    return (
      <section className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700" data-testid="trip-cancelled-banner">
        <span className="font-medium text-danger">Trip cancelled</span>
        {canManage && (
          <button type="button" disabled={busy} onClick={() => run(restoreTrip, "Restoring a trip")} className={buttonClass}>
            Restore
          </button>
        )}
        {error && <span className="text-danger">{error}</span>}
      </section>
    );
  }
  if (!canManage) return null;
  return (
    <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <button type="button" disabled={busy} onClick={() => run(cancelTrip, "Cancelling a trip")} className="hover:underline disabled:opacity-50">
        Mark trip cancelled
      </button>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}

type Editing = { kind: "add"; date?: string } | { kind: "edit"; segment: Segment } | undefined;

function TripDetail({ tripId, user }: { tripId: string; user: User }) {
  useSaveForOffline();
  const trip = useTrip(tripId, user.uid);
  const segments = useSegments(tripId, user.uid, trip?.updatedAt);
  // A bug report sent from here carries this trip's bookings.
  useReportTrip(trip, segments);
  const tripForFlags = useMemo(() => (trip ? [trip] : undefined), [trip]);
  const segmentsForFlags = useCallback(() => segments, [segments]);
  useKeepTripFlags(tripForFlags, segmentsForFlags);
  const today = useLocalToday();
  const upcomingOrCurrent = !trip || displayBounds(trip).end >= today;
  const now = useNow(60_000, upcomingOrCurrent);
  const flightStatuses = useFlightStatuses(segments, now);
  useFlightRefresh(user, tripId, segments, flightStatuses, now);
  const isOwner = trip?.ownerUid === user.uid;
  const patterns = useSenderPatterns(user.uid, isOwner);
  const allTrips = useTrips(user);
  const profile = useProfile(user.uid);
  const addresses = useAddresses(user);
  const people = usePeopleDocuments(user, upcomingOrCurrent);
  // Whom the user's bookings name, and so whether they're only watching this trip.
  const travelers = usePeople(user.uid);
  // Watching it, what is the user's own leaves it out: warnings, entry
  // requirements, rides, the checklist and check-in.
  const removedTravelers = trip?.removedTravelers;
  const onlyWatching = useMemo(() => !!segments && watchedTrip({ removedTravelers }, segments, travelers ?? []), [segments, travelers, removedTravelers]);
  // Bookings that look like two trips in one, unless the owner said it is one.
  const oneTrip = trip?.oneTrip === true;
  const bothTaken = trip?.bothTaken;
  // Flights that look booked twice, one of them likely not taken.
  const duplicates = useMemo(() => (segments && !trip?.cancelledAt ? duplicateFlights(segments, bothTaken) : []), [segments, bothTaken, trip?.cancelledAt]);
  const mixed = useMemo(() => (segments && !oneTrip ? mixedTrip(segments, removedTravelers) : undefined), [segments, oneTrip, removedTravelers]);
  // The viewer's own programs, for the number at check-in; a fellow
  // traveler's are theirs.
  const ownTravelProfile = useTravelProfile(user.uid);
  const loyalty = useMemo(() => (ownTravelProfile ? allLoyalty(ownTravelProfile, travelers) : []), [ownTravelProfile, travelers]);
  const tripList = useMemo(() => (trip && !onlyWatching ? [trip] : []), [trip, onlyWatching]);
  const segmentsOfTrip = useMemo(() => (segments ? { [tripId]: segments } : {}), [segments, tripId]);
  const warnings = useTripWarnings(people, tripList, segmentsOfTrip, today)[tripId] ?? [];
  const entries = useEntryRequirements(people, onlyWatching ? null : trip, segments, today);
  // Flights with no car or ride booked. Home is where this trip's round trip
  // starts, unless the viewer said otherwise on Profile: reading every trip
  // to work it out would cost a read of each on every visit.
  const needs = useMemo(() => {
    if (!segments || !profile || onlyWatching) return [];
    const periods = effectiveHomes(homeTimeline(segments), profile.homes ?? []);
    return rideNeeds(segments, { periods, hidden: profile.hiddenRideNeeds ?? [], now });
  }, [segments, profile, now, onlyWatching]);
  // The journeys the trip seems to be missing (no flight back, or none
  // between two far apart), the trip's ends left out once the viewer said
  // it goes one way. Home is only what they set on Profile, as a one-way
  // trip has no round trip to work it out from.
  const gaps = useMemo(() => {
    if (!segments || !profile || !trip || trip.cancelledAt || trip.deleting) return [];
    return journeyGaps(segments, journeyGapHomes(profile.homes ?? [], profile.homeAirports ?? []), (profile.oneWayTrips ?? []).includes(tripId));
  }, [segments, profile, trip, tripId]);
  // The viewer's own reminders before the trip, theirs alone, shared trip or not.
  const checklist = useTripChecklist(user.uid, tripId, trip, segments, profile ? (profile.homes ?? []) : undefined, today);
  const [editing, setEditing] = useState<Editing>();
  const [error, setError] = useState<string>();
  // The viewer's own "I've checked in" marks on this trip's flights.
  const checkedInIds = useMemo(() => (upcomingOrCurrent ? [tripId] : []), [upcomingOrCurrent, tripId]);
  const checkedIn = useCheckedIn(user.uid, checkedInIds)[tripId];
  const markCheckedIn = useCallback(
    (segmentId: string, on: boolean) =>
      setCheckedIn(user.uid, tripId, segmentId, on).catch((e: unknown) => {
        console.error("Saving a check-in mark failed", e);
        setError("Couldn't save your check-in. Try again.");
      }),
    [user.uid, tripId],
  );
  useCheckedInFromNotification(segments, markCheckedIn);
  // After "Never import this sender": what it already imported, offered for deletion.
  const [cleanup, setCleanup] = useState<{ domain: string; plan: SenderCleanup }>();
  const router = useRouter();
  const [splitting, setSplitting] = useState(false);
  const [editingTravelers, setEditingTravelers] = useState(false);
  const otherTrips = useMemo(
    () =>
      trip
        ? (allTrips ?? [])
            .filter((t) => t.id !== trip.id && !t.deleting)
            .sort((a, b) => a.start.localeCompare(b.start))
        : [],
    [allTrips, trip],
  );
  const allTitles = useMemo(() => displayTitles(allTrips ?? []), [allTrips]);
  const days = useMemo(() => (segments ? byDay(segments) : []), [segments]);
  const mailboxes = useMemo(() => gmailMailboxes(profile), [profile]);
  const clean = async () => {
    if (!cleanup) return;
    const { plan } = cleanup;
    setCleanup(undefined);
    try {
      if ((await removeSenderBookings(firestore(), plan)).includes(tripId)) router.replace("/");
    } catch (e) {
      console.error("Removing a sender's bookings failed", e);
      setError((e as Error).message);
      // Offered again to retry: the sender is denied now, so Never isn't.
      // What was already deleted is skipped or harmless the second time.
      setCleanup(cleanup);
    }
  };
  // The offer and its error stand outside the trip's own page: a cleanup
  // that deleted this trip and then failed is still there to retry.
  const cleanupOffer = cleanup && (
    <Dialog title="Delete what it imported?" onClose={() => setCleanup(undefined)}>
      <p className="">
        Mail from {cleanup.domain} won&rsquo;t be imported again. Delete {imported(cleanup.plan)} already imported from it?
      </p>
      <button type="button" onClick={() => void clean()} className="mt-3 rounded-lg border border-field px-3 py-2 text-danger hover:bg-zinc-100 dark:hover:bg-zinc-900">
        Delete
      </button>
    </Dialog>
  );
  if (trip === undefined) return <p className="text-muted">Loading…</p>;
  if (trip === null)
    return (
      <>
        <p className="text-muted">This trip does not exist or is not shared with you.</p>
        {error && <p className="mt-2 text-danger">{error}</p>}
        {cleanupOffer}
      </>
    );
  const isSharee = sharedWithAny(trip.sharedWith, addresses);
  // Sharees edit bookings; only the owner renames, shares or deletes the trip.
  const canEdit = (isOwner || isSharee) && !trip.deleting;
  const canManage = isOwner && !trip.deleting;

  const save = async (extracted: Parameters<typeof saveSegment>[2]) => {
    await saveSegment(firestore(), trip.id, extracted, editing?.kind === "edit" ? editing.segment : undefined);
    setEditing(undefined);
  };
  const remove = (segment: Segment) =>
    deleteSegment(firestore(), trip.id, segment.id).catch((e: Error) => setError(e.message));
  const merge = (segment: Segment, otherId: string) =>
    mergeSegments(firestore(), trip.id, segment.id, otherId).catch((e: Error) => {
      console.error("Merging bookings failed", e);
      setError(e.message);
    });
  const move = (segment: Segment, toTripId: string) =>
    moveSegment(firestore(), trip.id, segment.id, toTripId).catch((e: Error) => setError(e.message));
  const moveToNew = (segment: Segment) =>
    moveSegmentToNewTrip(firestore(), trip.id, segment.id, user.uid).catch((e: Error) => setError(e.message));
  // Sender rules are the viewer's own, so the offer stands for the owner only:
  // the import ran against their mailbox.
  const learn = (segment: Segment) =>
    isOwner && segment.sender && effectiveDecision(patterns, segment.sender) !== "allow"
      ? () => learnSender(firestore(), user.uid, segment.sender!, "allow").catch((e: Error) => setError(e.message))
      : undefined;
  const never = (segment: Segment) =>
    isOwner && segment.sender && effectiveDecision(patterns, segment.sender) !== "deny"
      ? async () => {
          const domain = segment.sender!;
          try {
            // Read first: if that fails, nothing is saved and Never stays on offer to try again.
            const plan = await senderBookings(firestore(), user.uid, domain);
            await learnSender(firestore(), user.uid, domain, "deny");
            if (plan.trips.length || plan.segments.length) setCleanup({ domain, plan });
          } catch (e) {
            console.error("Never importing a sender failed", e);
            setError((e as Error).message);
          }
        }
      : undefined;

  return (
    <>
      <Link href="/" className="text-muted hover:underline">
        ← All trips
      </Link>
      <Title
        trip={trip}
        canEdit={canManage}
        more={[
          ...(canManage && segments && segments.length > 1 ? [{ label: "Split…", onSelect: () => setSplitting(true) }] : []),
          ...(canManage && segments && namedTravelers(segments, trip.removedTravelers).length > 0 ? [{ label: "Travelers…", onSelect: () => setEditingTravelers(true) }] : []),
        ]}
      />
      {splitting && segments && <SplitDialog trip={trip} segments={segments} uid={user.uid} onClose={() => setSplitting(false)} />}
      {editingTravelers && segments && <TravelersDialog trip={trip} segments={segments} onClose={() => setEditingTravelers(false)} />}
      <p className="mt-1 text-zinc-600 dark:text-zinc-400" data-testid="trip-dates">
        {formatDateRange(displayBounds(trip).start, displayBounds(trip).end)}
        {canManage && segments && <FitDates trip={trip} segments={segments} />}
      </p>
      {isOwner && trip.deleting && <DangerZone trip={trip} />}
      {onlyWatching && (
        <p className="mt-1 text-muted" data-testid="trip-watching">
          Watching: you&apos;re not on this trip
        </p>
      )}
      {trip.cancelledAt && <TripCancelled trip={trip} canManage={canManage} />}
      {mixed && (
        <MixedTripNotice
          mixed={mixed}
          {...(canManage && segments && segments.length > 1 ? { onSplit: () => setSplitting(true) } : {})}
          {...(canManage && mixed.kind === "travelers" ? { onTravelers: () => setEditingTravelers(true) } : {})}
          {...(canManage
            ? {
                onOneTrip: () =>
                  markOneTrip(firestore(), trip.id).catch((e: Error) => {
                    console.error("Marking a trip as one trip failed", e);
                    setError(e.message);
                  }),
              }
            : {})}
        />
      )}
      {duplicates.map((pair) => (
        <DuplicateFlightNotice
          key={duplicateFlightKey(pair.first, pair.second)}
          pair={pair}
          {...(canEdit
            ? {
                onCancel: (segmentId: string) =>
                  cancelSegment(firestore(), trip.id, segmentId).catch((e: Error) => {
                    console.error("Marking a booking cancelled failed", e);
                    setError(e.message);
                  }),
              }
            : {})}
          {...(canManage
            ? {
                onBothTaken: () =>
                  markBothTaken(firestore(), trip.id, duplicateFlightKey(pair.first, pair.second)).catch((e: Error) => {
                    console.error("Saving that both flights were taken failed", e);
                    setError(e.message);
                  }),
              }
            : {})}
        />
      ))}
      <DocumentWarnings warnings={warnings} today={today} />
      {gaps.length > 0 && (
        <JourneyGapNotice
          gaps={gaps}
          onLook={(gap, next) => api.lookForJourney(user, gap, next)}
          {...(canEdit ? { onAdd: (date: string) => setEditing({ kind: "add", date }) } : {})}
          onOneWay={() =>
            markOneWay(user.uid, tripId).catch((e: Error) => {
              console.error("Marking a trip one way failed", e);
              setError(e.message);
            })
          }
        />
      )}
      {entries && <EntryRequirements entries={entries.entries} fetched={entries.fetched} />}
      {checklist && !trip.deleting && !onlyWatching && <BeforeYouGo uid={user.uid} tripId={trip.id} entries={checklist.entries} added={checklist.added} today={today} />}

      {canEdit && !editing && (
        <button type="button" onClick={() => setEditing({ kind: "add" })} className={`${buttonClass} mt-4`}>
          Add a booking
        </button>
      )}
      {editing?.kind === "add" && (
        <SegmentForm defaultDate={editing.date ?? trip.start} onSave={save} onCancel={() => setEditing(undefined)} />
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
      {cleanupOffer}

      {!segments && <p className="mt-8 text-muted">Loading…</p>}
      {segments && segments.length === 0 && <p className="mt-8 text-muted">No bookings in this trip yet.</p>}
      {segments &&
        days.map(([day, items]) => (
          <section key={day} className="mt-8">
            <h2 className="mb-3 text-lg font-medium">{formatDate(day)}</h2>
            {/* One card per day, a rule between its bookings. No overflow-hidden so a row's ⋮ menu isn't clipped. */}
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {items.map((segment) => {
                if (editing?.kind === "edit" && editing.segment.id === segment.id) {
                  return (
                    <li key={segment.id} className="px-4 py-3">
                      <SegmentForm
                        segment={segment}
                        defaultDate={trip.start}
                        onSave={save}
                        onCancel={() => setEditing(undefined)}
                      />
                    </li>
                  );
                }
                const onLearnSender = learn(segment);
                const onNeverSender = never(segment);
                const checkInState = checkedIn && !onlyWatching && flightCheckInState(segment, checkedIn, now);
                return (
                  <SegmentRow
                    key={segment.id}
                    segment={segment}
                    {...(canEdit
                      ? {
                          onEdit: () => setEditing({ kind: "edit", segment }),
                          onDelete: () => remove(segment),
                          moveTargets: otherTrips,
                          onMove: (toTripId: string) => move(segment, toTripId),
                          mergeTargets: segments.filter((other) => other.id !== segment.id && other.type === segment.type),
                          onMerge: (otherId: string) => merge(segment, otherId),
                          // Only the owner: a sharee's new trip would take the booking from the owner's sight.
                          ...(isOwner ? { onMoveToNew: () => void moveToNew(segment) } : {}),
                        }
                      : {})}
                    {...(onLearnSender ? { onLearnSender } : {})}
                    {...(onNeverSender ? { onNeverSender } : {})}
                    // Each email links for whoever imported it, from their mailbox.
                    emailLinks={{ uid: user.uid, mailboxes, ownsTrip: isOwner }}
                    programs={programsFor(segment.provider, loyalty)}
                    flightLines={flightLinesFor(segment, flightStatuses, now)}
                    {...(checkInState ? { checkIn: { state: checkInState, onChange: (on: boolean) => void markCheckedIn(segment.id, on) } } : {})}
                    {...(canEdit
                      ? {
                          onRate: (rating: number | null) => rateSegment(firestore(), trip.id, segment.id, rating).catch((e: Error) => setError(e.message)),
                          onFavorite: (favorite: boolean) => favoriteSegment(firestore(), trip.id, segment.id, favorite).catch((e: Error) => setError(e.message)),
                          onMarkCancelled: () =>
                            cancelSegment(firestore(), trip.id, segment.id).catch((e: Error) => {
                              console.error("Marking a booking cancelled failed", e);
                              setError(e.message);
                            }),
                          // One cancelled with its trip comes back with the trip.
                          ...(trip.cancelledAt && segment.userCancelled === "trip"
                            ? {}
                            : {
                                onRestore: () =>
                                  restoreSegment(firestore(), trip.id, segment.id).catch((e: Error) => {
                                    console.error("Restoring a cancelled booking failed", e);
                                    setError(e.message);
                                  }),
                              }),
                        }
                      : {})}
                  >
                    {needs
                      .filter((n) => n.segmentId === segment.id)
                      .map((n) => (
                        <RideSuggestion
                          key={rideNeedKey(n)}
                          kind={n.kind}
                          flight={segment}
                          companies={profile?.rideCompanies ?? []}
                          onHide={() =>
                            hideRideNeed(user.uid, rideNeedKey(n)).catch((e: Error) => {
                              console.error("Hiding a ride suggestion failed", e);
                              setError(e.message);
                            })
                          }
                        />
                      ))}
                  </SegmentRow>
                );
              })}
            </ul>
          </section>
        ))}

      {canManage && <Sharing trip={trip} user={user} />}
      {canManage && <MergeInto trip={trip} targets={otherTrips} titles={allTitles} />}
      {canManage && !trip.cancelledAt && <TripCancelled trip={trip} canManage={canManage} />}
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
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <TripRoute params={props.params} />
    </Suspense>
  );
}
