"use client";

import { effectiveHomesWithAirports, maxHomeCorrections, paths, watchedTrip, type ChosenHomeAirports, type HomeCorrection, type HomePeriod, type PersonDoc, type Segment, type Trip, type UserProfile } from "@travelmo/core";

export { airportCodes, correctionText, homeLine, homeTownKey, parseAirportCodes, parseCorrection } from "@travelmo/core";
import type { User } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useMemo } from "react";
import { firestore } from "./firebase";
import { usePeople } from "./people";
import type { AllSegments } from "./segmentCache";
import { useAllSegments, useProfile, useTripsState } from "./trips";

// Where home was over time, and how many trips could not be read to work it
// out: with any, the timeline may be missing what those trips would say.
// Each period carries its airports: those chosen for it, else those its
// round trips leave from (withHomeAirports).
export type Homes = { periods: HomePeriod[]; corrections: HomeCorrection[]; chosen: ChosenHomeAirports[]; failed: number };

export function deriveHomes(
  byTrip: Record<string, Segment[]>,
  failed: readonly string[],
  corrections: readonly HomeCorrection[],
  chosen: readonly ChosenHomeAirports[] = [],
): Homes {
  const segments = Object.values(byTrip).flat();
  const periods = effectiveHomesWithAirports(segments, corrections, chosen);
  return { periods, corrections: [...corrections], chosen: [...chosen], failed: failed.length };
}

// The bookings home is worked out from: those of trips the user owns and
// isn't only watching (watchedTrip), by trip.
export function ownTripSegments(
  trips: readonly Trip[],
  byTrip: Readonly<Record<string, Segment[]>>,
  uid: string,
  people: readonly PersonDoc[],
): Record<string, Segment[]> {
  return Object.fromEntries(trips.flatMap((t) => (t.ownerUid === uid && byTrip[t.id] && !watchedTrip(t, byTrip[t.id], people) ? [[t.id, byTrip[t.id]!]] : [])));
}

// As the Profile says it for trips it could not read, which hold home over time back.
export function failedReadsText(failed: number): string {
  const trips = `${failed.toLocaleString("en-US")} ${failed === 1 ? "trip" : "trips"}`;
  return `${trips} couldn't be read, so home can't be worked out yet. Reload to try again.`;
}

// Where home was over time for this user: worked out from their own trips'
// bookings, those they're only watching aside, with their corrections over
// it. Undefined while loading, which lasts until the server has answered for
// every trip and its bookings: the cache's part of them could move home.
export function useHomes(user: User): Homes | undefined {
  const tripsState = useTripsState(user);
  const trips = tripsState?.confirmed ? tripsState.trips : undefined;
  const profile = useProfile(user.uid);
  const people = usePeople(user.uid);
  const own = useMemo(() => trips?.filter((t) => t.ownerUid === user.uid), [trips, user.uid]);
  const all = useAllSegments(own, user.uid, Boolean(tripsState?.confirmed));
  return useMemo(() => (trips && all && profile && people ? homesFrom(trips, all, user.uid, people, profile) : undefined), [trips, all, profile, people, user.uid]);
}

// Home over time from every trip's bookings, as read: none while some came from
// the cache alone, and none worked out while a trip couldn't be read (rather than
// one from the others), only its corrections, still to change, and how many failed.
export function homesFrom(
  trips: readonly Trip[],
  all: AllSegments,
  uid: string,
  people: readonly PersonDoc[],
  profile: Pick<UserProfile, "homes" | "homeAirports">,
): Homes | undefined {
  if (all.unconfirmed.length > 0) return undefined;
  if (all.failed.length > 0) return { periods: [], corrections: [...(profile.homes ?? [])], chosen: [...(profile.homeAirports ?? [])], failed: all.failed.length };
  return deriveHomes(ownTripSegments(trips, all.byTrip, uid, people), all.failed, profile.homes ?? [], profile.homeAirports ?? []);
}

// Runs a change to the corrections, logging a failure by what it was doing
// (no corrections or user data) before passing it on to be shown.
export async function logged<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    console.error(`Home corrections: ${operation} failed`, error);
    throw error;
  }
}

export async function saveCorrections(uid: string, corrections: readonly HomeCorrection[]): Promise<void> {
  if (corrections.length > maxHomeCorrections) throw new Error(`At most ${maxHomeCorrections}.`);
  await setDoc(doc(firestore(), paths.user(uid)), { homes: corrections }, { merge: true });
}

// The airports chosen for each home, one entry per home town.
export async function saveHomeAirports(uid: string, chosen: readonly ChosenHomeAirports[]): Promise<void> {
  if (chosen.length > maxHomeCorrections) throw new Error(`At most ${maxHomeCorrections} homes.`);
  await setDoc(doc(firestore(), paths.user(uid)), { homeAirports: chosen }, { merge: true });
}
