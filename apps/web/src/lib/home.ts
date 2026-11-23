"use client";

import {
  HomeCorrection,
  countryCode,
  describeHomes,
  effectiveHomes,
  formatDate,
  homeTimeline,
  isCountryCode,
  maxHomeCorrections,
  paths,
  type HomePeriod,
  type Segment,
} from "@travelmo/core";
import type { User } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { firestore } from "./firebase";
import { useAllSegments, useProfile, useTrips } from "./trips";

// The Profile's home line: "Home: London since Mar 2021 · Boston 2018–2021",
// or nothing when no trip says where home is and nobody said.
export function homeLine(periods: readonly HomePeriod[]): string | undefined {
  const text = describeHomes(periods);
  return text ? `Home: ${text}` : undefined;
}

// One correction as the Profile lists it: "London, GB from 12 Mar 2021".
export function correctionText(c: HomeCorrection): string {
  const where = c.country ? `${c.city}, ${c.country}` : c.city;
  return `${where} from ${formatDate(c.from, "en-GB", { weekday: undefined, year: "numeric" })}`;
}

// A correction from the form's fields, or why it cannot be one.
export function parseCorrection(city: string, country: string, from: string): HomeCorrection | string {
  // A name or a common short form ("UK") is saved as its ISO code.
  const code = country.trim() ? countryCode(country) : "";
  if (!city.trim()) return "Enter a city.";
  if (code && !isCountryCode(code)) return "Use a two-letter country code, such as GB.";
  const parsed = HomeCorrection.safeParse({ city: city.trim(), ...(code ? { country: code } : {}), from });
  if (parsed.success) return parsed.data;
  return "Enter a date.";
}

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
