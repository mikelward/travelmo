"use client";

import { allLoyalty, bookedDateRange, flightCheckInState, displayBounds, effectiveHomes, homeTimeline, rideNeedKey, rideNeeds, displayTitles, formatDate, formatDateRange, gmailMailboxes, localDate, normalizeEmail, paths, programsFor, sharedWithAny, type Segment, type SenderCleanup, type Trip } from "@travelmo/core";
import type { User } from "firebase/auth";
import { arrayRemove, doc, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, Suspense, use, useCallback, useMemo, useState, type FormEvent } from "react";
import { SegmentForm } from "@/components/SegmentForm";
import { RideSuggestion } from "@/components/RideSuggestion";
import { SegmentRow } from "@/components/SegmentRow";
import { Dialog } from "@/components/BookingMenu";
import { hideRideNeed } from "@/lib/rides";
import { SignInGate } from "@/components/SignInGate";
import { cancelSegment, cancelTrip, deleteSegment, deleteTrip, favoriteSegment, fitTripDates, mergeTrips, moveSegment, moveSegmentToNewTrip, rateSegment, renameTrip, restoreSegment, restoreTrip, saveSegment } from "@/lib/edits";
import { shareTrip } from "@/lib/access";
import { firestore } from "@/lib/firebase";
import { useSaveForOffline } from "@/lib/offline";
import { effectiveDecision, learnSender, removeSenderBookings, senderBookings } from "@/lib/patterns";
import { DocumentWarnings } from "@/components/DocumentWarnings";
import { EntryRequirements } from "@/components/EntryRequirements";
import { useEntryRequirements } from "@/lib/visas";
import { localToday } from "@/lib/dates";
import { usePeopleDocuments, useTripWarnings } from "@/lib/documents";
import { useTravelProfile } from "@/lib/travelProfile";
import { BeforeYouGo } from "@/components/Checklist";
import { useTripChecklist } from "@/lib/checklist";
import { useReportTrip } from "@/components/ReportBug";
import { useAddresses, useNow, useProfile, useSegments, useSenderPatterns, useTrip, useTrips, useKeepTripFlags } from "@/lib/trips";
import { flightLinesFor, useFlightRefresh, useFlightStatuses } from "@/lib/flightStatus";
import { setCheckedIn, useCheckedIn, useCheckedInFromNotification } from "@/lib/checkedIn";

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
            className="text-sm text-muted hover:underline"
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
        className="flex-1 rounded-lg border border-field bg-background px-3 py-2 text-2xl font-semibold"
      />
      <button type="submit" className={buttonClass}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className={buttonClass}>
        Cancel
      </button>
      {error && <span className="text-sm text-danger">{error}</span>}
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
        className="text-sm text-muted hover:underline"
      >
        Fit dates to bookings ({formatDateRange(range.start, range.end)})
      </button>
      {error && <span className="ml-2 text-sm text-danger">{error}</span>}
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
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Shared with</h2>
      <ul className="mt-2 space-y-1 text-sm">
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
          className="flex-1 rounded-lg border border-field bg-background px-3 py-2 text-sm"
        />
        <button type="submit" className={buttonClass}>
          Share
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
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
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Merge into another trip</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Moves every booking here into the other trip and deletes this one. Who it is shared with stays as the other trip has it.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={target?.id ?? ""}
          onChange={(e) => setTarget(targets.find((t) => t.id === e.target.value))}
          aria-label="Trip to merge into"
          className="min-w-0 max-w-full rounded-lg border border-field bg-background px-3 py-2 text-sm"
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
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
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
        {error && <p className="mt-2 text-danger">{error}</p>}
      </section>
    );
  }
  return (
    <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="text-sm text-danger hover:underline">
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
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
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
      <section className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700" data-testid="trip-cancelled-banner">
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
    <section className="mt-10 border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
      <button type="button" disabled={busy} onClick={() => run(cancelTrip, "Cancelling a trip")} className="hover:underline disabled:opacity-50">
        Mark trip cancelled
      </button>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}

type Editing = { kind: "add" } | { kind: "edit"; segment: Segment } | undefined;

function TripDetail({ tripId, user }: { tripId: string; user: User }) {
  useSaveForOffline();
  const trip = useTrip(tripId);
  const segments = useSegments(tripId);
  // A bug report sent from here carries this trip's bookings.
  useReportTrip(trip, segments);
  useKeepTripFlags(trip ? [trip] : undefined, () => segments);
  const now = useNow();
  const flightStatuses = useFlightStatuses(segments, now);
  useFlightRefresh(user, tripId, segments, flightStatuses, now);
  const patterns = useSenderPatterns(user.uid);
  const allTrips = useTrips(user);
  const profile = useProfile(user.uid);
  const addresses = useAddresses(user);
  const people = usePeopleDocuments(user);
  // The viewer's own programs, for the number at check-in; a fellow
  // traveler's are theirs.
  const ownTravelProfile = useTravelProfile(user.uid);
  const loyalty = useMemo(() => (ownTravelProfile ? allLoyalty(ownTravelProfile) : []), [ownTravelProfile]);
  const today = localToday();
  const tripList = useMemo(() => (trip ? [trip] : []), [trip]);
  const segmentsOfTrip = useMemo(() => (segments ? { [tripId]: segments } : {}), [segments, tripId]);
  const warnings = useTripWarnings(people, tripList, segmentsOfTrip, today)[tripId] ?? [];
  const entries = useEntryRequirements(people, trip, segments, today);
  // Flights with no car or ride booked. Home is where this trip's round trip
  // starts, unless the viewer said otherwise on Profile: reading every trip
  // to work it out would cost a read of each on every visit.
  const needs = useMemo(() => {
    if (!segments || !profile) return [];
    const periods = effectiveHomes(homeTimeline(segments), profile.homes ?? []);
    return rideNeeds(segments, { periods, hidden: profile.hiddenRideNeeds ?? [], now });
  }, [segments, profile, now]);
  // The viewer's own reminders before the trip, theirs alone, shared trip or not.
  const checklist = useTripChecklist(user.uid, tripId, trip, segments, profile ? (profile.homes ?? []) : undefined, today);
  const [editing, setEditing] = useState<Editing>();
  const [error, setError] = useState<string>();
  // The viewer's own "I've checked in" marks on this trip's flights.
  const checkedIn = useCheckedIn(user.uid, [tripId])[tripId];
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
      <p className="text-sm">
        Mail from {cleanup.domain} won&rsquo;t be imported again. Delete {imported(cleanup.plan)} already imported from it?
      </p>
      <button type="button" onClick={() => void clean()} className="mt-3 rounded-lg border border-field px-3 py-2 text-sm text-danger hover:bg-zinc-100 dark:hover:bg-zinc-900">
        Delete
      </button>
    </Dialog>
  );
  if (trip === undefined) return <p className="text-muted">Loading…</p>;
  if (trip === null)
    return (
      <>
        <p className="text-muted">This trip does not exist or is not shared with you.</p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {cleanupOffer}
      </>
    );
  const isOwner = trip.ownerUid === user.uid;
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
  // Other trips the viewer can edit, as destinations for a booking or for the
  // whole trip; the rules decide finally, so a sharee of only one side is told.
  const otherTrips = (allTrips ?? [])
    .filter((t) => t.id !== trip.id && !t.deleting)
    .sort((a, b) => a.start.localeCompare(b.start));
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
      <Link href="/" className="text-sm text-muted hover:underline">
        ← All trips
      </Link>
      <Title trip={trip} canEdit={canManage} />
      <p className="mt-1 text-zinc-600 dark:text-zinc-400" data-testid="trip-dates">
        {formatDateRange(displayBounds(trip).start, displayBounds(trip).end)}
        {canManage && segments && <FitDates trip={trip} segments={segments} />}
      </p>
      {isOwner && trip.deleting && <DangerZone trip={trip} />}
      {trip.cancelledAt && <TripCancelled trip={trip} canManage={canManage} />}
      <DocumentWarnings warnings={warnings} today={today} />
      {entries && <EntryRequirements entries={entries.entries} fetched={entries.fetched} />}
      {checklist && !trip.deleting && <BeforeYouGo uid={user.uid} tripId={trip.id} entries={checklist.entries} added={checklist.added} today={today} />}

      {canEdit && !editing && (
        <button type="button" onClick={() => setEditing({ kind: "add" })} className={`${buttonClass} mt-4`}>
          Add a booking
        </button>
      )}
      {editing?.kind === "add" && (
        <SegmentForm defaultDate={trip.start} onSave={save} onCancel={() => setEditing(undefined)} />
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {cleanupOffer}

      {!segments && <p className="mt-8 text-muted">Loading…</p>}
      {segments && segments.length === 0 && <p className="mt-8 text-muted">No bookings in this trip yet.</p>}
      {segments &&
        byDay(segments).map(([day, items]) => (
          <section key={day} className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{formatDate(day)}</h2>
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
                  <Fragment key={segment.id}>
                    <SegmentRow
                      segment={segment}
                      {...(canEdit
                        ? {
                            onEdit: () => setEditing({ kind: "edit", segment }),
                            onDelete: () => remove(segment),
                            moveTargets: otherTrips,
                            onMove: (toTripId: string) => move(segment, toTripId),
                            // Only the owner: a sharee's new trip would take the booking from the owner's sight.
                            ...(isOwner ? { onMoveToNew: () => void moveToNew(segment) } : {}),
                          }
                        : {})}
                      {...(learn(segment) ? { onLearnSender: learn(segment) } : {})}
                      {...(never(segment) ? { onNeverSender: never(segment) } : {})}
                      // Each email links for whoever imported it, from their mailbox.
                      emailLinks={{ uid: user.uid, mailboxes: gmailMailboxes(profile), ownsTrip: isOwner }}
                      programs={programsFor(segment.provider, loyalty)}
                      flightLines={flightLinesFor(segment, flightStatuses, now)}
                      {...(() => {
                        const state = checkedIn && flightCheckInState(segment, checkedIn, now);
                        return state ? { checkIn: { state, onChange: (on: boolean) => void markCheckedIn(segment.id, on) } } : {};
                      })()}
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
                    />
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
                  </Fragment>
                ),
              )}
            </ul>
          </section>
        ))}

      {canManage && <Sharing trip={trip} user={user} />}
      {canManage && <MergeInto trip={trip} targets={otherTrips} titles={displayTitles(allTrips ?? [])} />}
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
