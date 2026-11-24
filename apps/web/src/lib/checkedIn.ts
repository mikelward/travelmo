"use client";

import { CheckedIn, paths, withCheckedIn, type Segment } from "@travelmo/core";
import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { checkedInParam } from "@/sw/checkedIn";
import { firestore } from "./firebase";

// "I've checked in" (SPEC "Check-in reminders"): the flights the viewer
// marked on each trip, theirs alone, one document per trip.

// The bookings the viewer marked on each of these trips, by trip: one
// listener each, so callers keep the set small. A trip still loading has
// no entry.
export function useCheckedIn(uid: string, tripIds: readonly string[]): Record<string, ReadonlySet<string>> {
  const [byTrip, setByTrip] = useState<Record<string, ReadonlySet<string>>>({});
  const key = [...new Set(tripIds)].sort().join("\n");
  useEffect(() => {
    const ids = key ? key.split("\n") : [];
    const unsubscribes = ids.map((tripId) =>
      onSnapshot(
        doc(firestore(), paths.checkedIn(uid, tripId)),
        (s) => {
          const parsed = CheckedIn.safeParse(s.data() ?? {});
          if (!parsed.success) console.error(`Malformed check-in marks ${s.ref.path}`, parsed.error);
          setByTrip((current) => ({ ...current, [tripId]: new Set(parsed.success ? parsed.data.segmentIds : []) }));
        },
        (error) => console.error(`Check-in marks subscription failed for ${tripId}`, error),
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [uid, key]);
  return useMemo(() => {
    const ids = key ? key.split("\n") : [];
    return Object.fromEntries(ids.flatMap((id) => (byTrip[id] ? [[id, byTrip[id]]] : [])));
  }, [byTrip, key]);
}

// Marks a flight checked in for the viewer, or not, on the list as stored
// now: read in the transaction before it is written.
export async function setCheckedIn(uid: string, tripId: string, segmentId: string, checkedIn: boolean): Promise<void> {
  const db = firestore();
  const ref = doc(db, paths.checkedIn(uid, tripId));
  await runTransaction(db, async (tx) => {
    const parsed = CheckedIn.safeParse((await tx.get(ref)).data() ?? {});
    const before = parsed.success ? parsed.data.segmentIds : [];
    tx.set(ref, { segmentIds: withCheckedIn(before, segmentId, checkedIn), updatedAt: new Date().toISOString() });
  });
}

// Saves the mark the trip page was opened with by a check-in reminder's
// "I've checked in" (sw/checkedIn.ts): the service worker has no sign-in,
// so the page, signed in as the viewer, saves it, once its bookings have
// loaded and only for one of its flights, then takes the query off the
// address so a reload does not mark it again.
export function useCheckedInFromNotification(segments: readonly Segment[] | undefined, mark: (segmentId: string, on: boolean) => unknown): void {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asked = params.get(checkedInParam);
  const done = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!asked || !segments || done.current === asked) return;
    done.current = asked;
    if (segments.some((s) => s.id === asked && s.type === "flight")) void mark(asked, true);
    else console.warn("A check-in mark was asked for a booking that is not a flight on this trip");
    router.replace(pathname);
  }, [asked, segments, mark, router, pathname]);
}
