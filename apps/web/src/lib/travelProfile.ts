"use client";

import { LoyaltyPerson, ProfileEntry, TravelProfile, accessInvite, normalizeEmail, paths, queryAddresses, sameMembership, withLoyaltyPerson, type FoundLoyalty } from "@travelmo/core";
import type { User } from "firebase/auth";
import { collectionGroup, doc, onSnapshot, query, runTransaction, where, writeBatch, type Firestore } from "firebase/firestore";
import { firestore } from "./firebase";
import { useLiveSubscription } from "./liveCache";
import { useAddresses } from "./trips";

// The signed-in user's own travel profile; null when there is none yet.
export function useTravelProfile(uid: string, enabled = true): TravelProfile | null | undefined {
  return useLiveSubscription<TravelProfile | null>(
    enabled ? `travelProfile:${uid}` : undefined,
    (emit, fail) =>
      onSnapshot(
        doc(firestore(), paths.travelProfile(uid)),
        (s) => {
          if (!s.exists()) return emit(null);
          const result = TravelProfile.safeParse(s.data());
          if (result.success) emit(result.data);
          else console.error(`Malformed travel profile ${s.ref.path}`, result.error);
        },
        (error) => {
          console.error("Travel profile subscription failed", error);
          fail();
        },
      ),
  );
}

// Profiles other people have shared with this user, by any of their
// addresses (verified sign-in or linked).
export function useSharedProfiles(user: User, enabled = true): TravelProfile[] | undefined {
  const addresses = queryAddresses(useAddresses(user)).join("\n");
  const profiles = useLiveSubscription<TravelProfile[]>(
    enabled && addresses ? `sharedProfiles:${user.uid}:${addresses}` : undefined,
    (emit, fail) =>
      onSnapshot(
        query(collectionGroup(firestore(), "travelProfile"), where("trustedEmails", "array-contains-any", addresses.split("\n"))),
        (s) => {
          const out: TravelProfile[] = [];
          for (const d of s.docs) {
            const result = TravelProfile.safeParse(d.data());
            if (result.success) out.push(result.data);
            else console.error(`Skipping malformed travel profile ${d.ref.path}`, result.error);
          }
          emit(out);
        },
        (error) => {
          console.error("Shared profiles subscription failed", error);
          fail();
        },
      ),
  );
  // Without a verified address the user is trusted by nobody.
  return !enabled || !addresses ? EMPTY_PROFILES : profiles;
}

const EMPTY_PROFILES: TravelProfile[] = [];

export const maxTrusted = 20;

// One address per person, lowercased as the rules compare them; the owner
// themself is never on their own list.
export function normalizeTrusted(emails: readonly string[], ownEmail?: string | null): string[] {
  const own = ownEmail?.toLowerCase();
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@") && e !== own))];
}

// A merge, so it starts a profile before any import and, on one that exists,
// touches only the list (the rules refuse anything else). Each address
// newly trusted is invited in the same write, so it can open the profile
// without asking for access (SPEC "Access").
export async function saveTrusted(
  user: User,
  exists: boolean,
  emails: readonly string[],
  before: readonly string[] = [],
  db: Firestore = firestore(),
): Promise<void> {
  const trustedEmails = normalizeTrusted(emails, user.email);
  if (trustedEmails.length > maxTrusted) throw new Error(`Share with at most ${maxTrusted} people.`);
  const now = new Date().toISOString();
  const owner = exists ? {} : { ownerUid: user.uid, ...(user.email ? { ownerEmail: user.email.toLowerCase() } : {}) };
  const batch = writeBatch(db);
  batch.set(doc(db, paths.travelProfile(user.uid)), { ...owner, trustedEmails, updatedAt: now }, { merge: true });
  for (const email of trustedEmails) {
    if (!before.includes(email) && normalizeEmail(email)) batch.set(doc(db, paths.access(email)), accessInvite(email, user.uid, now), { merge: true });
  }
  await batch.commit();
}

// Removes one loyalty number found in the owner's emails, from the list as
// stored now, so an import adding another meanwhile keeps it.
export async function removeFoundLoyalty(uid: string, found: FoundLoyalty, db: Firestore = firestore()): Promise<void> {
  const ref = doc(db, paths.travelProfile(uid));
  await runTransaction(db, async (tx) => {
    const stored: unknown = (await tx.get(ref)).data()?.foundLoyalty;
    const current: unknown[] = Array.isArray(stored) ? stored : [];
    const next = current.filter((f) => {
      const entry = f as Partial<FoundLoyalty> | null;
      if (typeof entry?.program !== "string" || typeof entry?.number !== "string") return true;
      const sameOwner = !entry.person || !found.person || entry.person === found.person;
      return !(sameOwner && sameMembership({ program: entry.program, number: entry.number }, found));
    });
    tx.update(ref, { foundLoyalty: next, updatedAt: new Date().toISOString() });
  });
}

// Says whose a membership is (`person` undefined: the owner's), on the list
// as stored now, so a word given meanwhile on another one stays.
export async function setLoyaltyPerson(
  uid: string,
  membership: { program: string; number: string },
  person: string | undefined,
  db: Firestore = firestore(),
): Promise<void> {
  const ref = doc(db, paths.travelProfile(uid));
  await runTransaction(db, async (tx) => {
    const stored: unknown = (await tx.get(ref)).data()?.loyaltyPeople;
    const current = (Array.isArray(stored) ? stored : []).flatMap((p) => {
      const parsed = LoyaltyPerson.safeParse(p);
      return parsed.success ? [parsed.data] : [];
    });
    tx.update(ref, { loyaltyPeople: withLoyaltyPerson(current, membership, person), updatedAt: new Date().toISOString() });
  });
}

function storedEntries(raw: unknown): ProfileEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileEntry[] = [];
  for (const item of raw) {
    const parsed = ProfileEntry.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function saveTravelDocuments(
  user: User,
  mutate: (current: ProfileEntry[]) => ProfileEntry[],
  db: Firestore = firestore(),
): Promise<void> {
  const ref = doc(db, paths.travelProfile(user.uid));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = storedEntries(snap.data()?.documents);
    const next = mutate(current);
    const now = new Date().toISOString();
    if (snap.exists()) {
      tx.update(ref, { documents: next, updatedAt: now });
    } else {
      tx.set(ref, {
        ownerUid: user.uid,
        ...(user.email ? { ownerEmail: user.email.toLowerCase() } : {}),
        documents: next,
        updatedAt: now,
      });
    }
  });
}

export async function saveTravelLoyalty(
  user: User,
  mutate: (current: ProfileEntry[]) => ProfileEntry[],
  db: Firestore = firestore(),
): Promise<void> {
  const ref = doc(db, paths.travelProfile(user.uid));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = storedEntries(snap.data()?.loyalty);
    const next = mutate(current);
    const now = new Date().toISOString();
    if (snap.exists()) {
      tx.update(ref, { loyalty: next, updatedAt: now });
    } else {
      tx.set(ref, {
        ownerUid: user.uid,
        ...(user.email ? { ownerEmail: user.email.toLowerCase() } : {}),
        loyalty: next,
        updatedAt: now,
      });
    }
  });
}
