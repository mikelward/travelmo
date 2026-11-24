"use client";

import { effectiveHomes, homeTimeline, maxHomeCorrections, paths, type HomeCorrection, type HomePeriod, type Segment } from "@travelmo/core";

export { correctionText, homeLine, parseCorrection } from "@travelmo/core";
import type { User } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { firestore } from "./firebase";
import { useAllSegments, useProfile, useTrips } from "./trips";

// Where home was over time, and how many trips could not be read to work it
// out: with any, the timeline may be missing what those trips would say.
export type Homes = { periods: HomePeriod[]; corrections: HomeCorrection[]; failed: number };

export function deriveHomes(byTrip: Record<string, Segment[]>, failed: readonly string[], corrections: readonly HomeCorrection[]): Homes {
  const inferred = homeTimeline(Object.values(byTrip).flat());
  return { periods: effectiveHomes(inferred, corrections), corrections: [...corrections], failed: failed.length };
}

// As the reports page says it for trips it could not read.
export function failedReadsText(failed: number): string {
  const trips = `${failed.toLocaleString("en-US")} ${failed === 1 ? "trip" : "trips"}`;
  return `${trips} couldn't be read, so ${failed === 1 ? "it isn't" : "they aren't"} counted. Reload to try again.`;
}

// Where home was over time for this user: worked out from their own trips'
// bookings, with their corrections over it. Undefined while loading.
export function useHomes(user: User): Homes | undefined {
  const trips = useTrips(user);
  const profile = useProfile(user.uid);
  const own = trips?.filter((t) => t.ownerUid === user.uid).map((t) => t.id);
  const all = useAllSegments(own);
  if (!all || !profile) return undefined;
  return deriveHomes(all.byTrip, all.failed, profile.homes ?? []);
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
