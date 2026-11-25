"use client";

import {
  OneOffReminder,
  StandingReminder,
  TripChecklist,
  bySlot,
  isInternational,
  maxStandingReminders,
  maxTripReminders,
  oneOffSlotPrefix,
  paths,
  standingSlotPrefix,
  tripChecklist,
  checklistShown,
  withDone,
  type ChecklistEntry,
  type HomeCorrection,
  type PlaceLookup,
  type Segment,
  type Trip,
} from "@travelmo/core";
import { collection, deleteDoc, doc, onSnapshot, runTransaction, type QuerySnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { firestore } from "./firebase";

// The traveler's own reminders before a trip (SPEC "Before you go"): the
// standing ones in Settings, and on each trip what they ticked off and the
// one-offs they added. Each reminder is a document in a numbered slot, so
// the rules can bound how many there are.

export type Slotted<T> = T & { slot: string };

// The documents in slot order; one that does not parse is logged by its
// path and left out.
function slotted<T>(schema: z.ZodType<T>, snap: QuerySnapshot): Slotted<T>[] {
  return snap.docs
    .map((d) => ({ slot: d.id, path: d.ref.path, parsed: schema.safeParse(d.data()) }))
    .sort(bySlot)
    .flatMap(({ slot, path, parsed }) => {
      if (parsed.success) return [{ ...parsed.data, slot }];
      console.error(`Malformed reminder ${path}`, parsed.error);
      return [];
    });
}

function useSlotted<T>(path: string, schema: z.ZodType<T>, what: string): Slotted<T>[] | undefined {
  const [state, setState] = useState<{ path: string; list: Slotted<T>[] }>();
  useEffect(
    () =>
      onSnapshot(
        collection(firestore(), path),
        (s) => setState({ path, list: slotted(schema, s) }),
        (error) => console.error(`${what} subscription failed`, error),
      ),
    [path, schema, what],
  );
  return state?.path === path ? state.list : undefined;
}

export const useStandingReminders = (uid: string) => useSlotted(paths.tripReminders(uid), StandingReminder, "Reminders before trips");

// The viewer's own ticks and one-offs for a trip; undefined while loading.
export function useMyChecklist(uid: string, tripId: string): { done: string[]; added: Slotted<OneOffReminder>[] } | undefined {
  const added = useSlotted(paths.tripChecklistAdded(uid, tripId), OneOffReminder, "Trip reminders");
  const [state, setState] = useState<{ tripId: string; done: string[] }>();
  useEffect(
    () =>
      onSnapshot(
        doc(firestore(), paths.tripChecklist(uid, tripId)),
        (s) => {
          const parsed = TripChecklist.safeParse(s.data() ?? {});
          if (!parsed.success) console.error(`Malformed checklist ${s.ref.path}`, parsed.error);
          setState({ tripId, done: parsed.success ? parsed.data.done : [] });
        },
        (error) => console.error("Checklist subscription failed", error),
      ),
    [uid, tripId],
  );
  if (!added || state?.tripId !== tripId) return undefined;
  return { done: state.done, added };
}

// A new reminder's id: random, so a reminder that takes a freed slot is not
// ticked off where the one before it was.
export const newReminderId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 20);

// Writes a reminder to its slot, or to the first free one for a new one:
// each free slot is read in the transaction before it is taken, so two tabs
// adding at once take two slots.
async function saveSlotted(collectionPath: string, prefix: string, max: number, reminder: object, slot?: string): Promise<void> {
  const data = { ...reminder, createdAt: new Date().toISOString() };
  const db = firestore();
  await runTransaction(db, async (tx) => {
    if (slot) {
      tx.set(doc(db, collectionPath, slot), data);
      return;
    }
    for (let i = 0; i < max; i++) {
      const ref = doc(db, collectionPath, `${prefix}${i}`);
      if (!(await tx.get(ref)).exists()) {
        tx.set(ref, data);
        return;
      }
    }
    throw new Error(`At most ${max}.`);
  });
}

export const saveStandingReminder = (uid: string, reminder: StandingReminder, slot?: string) =>
  saveSlotted(paths.tripReminders(uid), standingSlotPrefix, maxStandingReminders, reminder, slot);

export const removeStandingReminder = (uid: string, slot: string) => deleteDoc(doc(firestore(), paths.tripReminder(uid, slot)));

export const addOneOff = (uid: string, tripId: string, reminder: OneOffReminder) =>
  saveSlotted(paths.tripChecklistAdded(uid, tripId), oneOffSlotPrefix, maxTripReminders, reminder);

export const removeOneOff = (uid: string, tripId: string, slot: string) => deleteDoc(doc(firestore(), paths.tripChecklistAddedSlot(uid, tripId, slot)));

// Ticks a reminder off for this trip, or not, on the list as stored now.
export async function setDone(uid: string, tripId: string, id: string, done: boolean): Promise<void> {
  const db = firestore();
  const ref = doc(db, paths.tripChecklist(uid, tripId));
  await runTransaction(db, async (tx) => {
    const parsed = TripChecklist.safeParse((await tx.get(ref)).data() ?? {});
    const before = parsed.success ? parsed.data.done : [];
    tx.set(ref, { done: withDone(before, id, done), updatedAt: new Date().toISOString() });
  });
}

// The trip's checklist for the viewer: their standing reminders when the
// trip goes abroad (from home on its first day, as ride suggestions work
// home out, with their corrections from Profile), and their one-offs. The
// airport table loads only when there are standing reminders to place.
// Undefined while loading, and once the trip has started (checklistShown).
export function useTripChecklist(
  uid: string,
  tripId: string,
  trip: Trip | null | undefined,
  segments: readonly Segment[] | undefined,
  corrections: readonly HomeCorrection[] | undefined,
  today: string,
): { entries: ChecklistEntry[]; added: Slotted<OneOffReminder>[] } | undefined {
  const standing = useStandingReminders(uid);
  const mine = useMyChecklist(uid, tripId);
  const wanted = !!trip && checklistShown(trip, today) && !!standing?.length && !!segments?.length;
  const [lookup, setLookup] = useState<{ place: PlaceLookup } | Error>();
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    import("@travelmo/core/airportPlaces")
      .then((m) => current && setLookup({ place: m.airportPlace }))
      .catch((error: Error) => {
        // Places named by airport code alone are then not placed.
        console.error("Loading the airport table failed", error);
        if (current) setLookup(error);
      });
    return () => {
      current = false;
    };
  }, [wanted]);
  return useMemo(() => {
    if (!trip || !standing || !mine || !segments || !corrections || !checklistShown(trip, today)) return undefined;
    if (wanted && !lookup) return undefined;
    const international = isInternational(trip, segments, corrections, lookup instanceof Error ? undefined : lookup?.place);
    return { entries: tripChecklist(trip, standing, mine, international), added: mine.added };
  }, [trip, standing, mine, segments, corrections, today, wanted, lookup]);
}
