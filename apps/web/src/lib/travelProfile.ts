"use client";

import { TravelProfile, paths } from "@travelmo/core";
import type { User } from "firebase/auth";
import { collectionGroup, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "./firebase";

// The signed-in user's own travel profile; null when there is none yet.
export function useTravelProfile(uid: string): TravelProfile | null | undefined {
  const [profile, setProfile] = useState<TravelProfile | null>();
  useEffect(() => {
    return onSnapshot(
      doc(firestore(), paths.travelProfile(uid)),
      (s) => {
        if (!s.exists()) return setProfile(null);
        const result = TravelProfile.safeParse(s.data());
        if (result.success) setProfile(result.data);
        else console.error(`Malformed travel profile ${s.ref.path}`, result.error);
      },
      (error) => console.error("Travel profile subscription failed", error),
    );
  }, [uid]);
  return profile;
}

// Profiles other people have shared with this user, by verified email.
export function useSharedProfiles(user: User): TravelProfile[] | undefined {
  const [profiles, setProfiles] = useState<TravelProfile[]>();
  const email = user.emailVerified ? user.email?.toLowerCase() : undefined;
  useEffect(() => {
    if (!email) return;
    return onSnapshot(
      query(collectionGroup(firestore(), "travelProfile"), where("trustedEmails", "array-contains", email)),
      (s) => {
        const out: TravelProfile[] = [];
        for (const d of s.docs) {
          const result = TravelProfile.safeParse(d.data());
          if (result.success) out.push(result.data);
          else console.error(`Skipping malformed travel profile ${d.ref.path}`, result.error);
        }
        setProfiles(out);
      },
      (error) => console.error("Shared profiles subscription failed", error),
    );
  }, [email]);
  // An unverified address is trusted by nobody.
  return email ? profiles : [];
}

export const maxTrusted = 20;

// One address per person, lowercased as the rules compare them; the owner
// themself is never on their own list.
export function normalizeTrusted(emails: readonly string[], ownEmail?: string | null): string[] {
  const own = ownEmail?.toLowerCase();
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@") && e !== own))];
}

// A merge, so it starts a profile before any import and, on one that exists,
// touches only the list (the rules refuse anything else).
export async function saveTrusted(user: User, exists: boolean, emails: readonly string[]): Promise<void> {
  const trustedEmails = normalizeTrusted(emails, user.email);
  if (trustedEmails.length > maxTrusted) throw new Error(`Share with at most ${maxTrusted} people.`);
  const owner = exists ? {} : { ownerUid: user.uid, ...(user.email ? { ownerEmail: user.email.toLowerCase() } : {}) };
  await setDoc(doc(firestore(), paths.travelProfile(user.uid)), { ...owner, trustedEmails, updatedAt: new Date().toISOString() }, { merge: true });
}
