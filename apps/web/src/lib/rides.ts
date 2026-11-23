"use client";

import { RideCompany, maxHiddenRideNeeds, maxRideCompanies, paths } from "@travelmo/core";
import { doc, runTransaction, type DocumentReference, type Transaction } from "firebase/firestore";
import { firestore } from "./firebase";

// The stored companies as they are now, malformed ones left out.
async function storedCompanies(tx: Transaction, ref: DocumentReference): Promise<RideCompany[]> {
  const stored = (await tx.get(ref)).data()?.rideCompanies;
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((c) => {
    const parsed = RideCompany.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
}

const sameCompany = (a: RideCompany, b: RideCompany) => a.name === b.name && a.url === b.url && a.near === b.near;

// Adds one of the user's own companies to the list as stored now, so another
// tab's change in the meantime is kept.
export async function addRideCompany(uid: string, company: RideCompany): Promise<void> {
  const ref = doc(firestore(), paths.user(uid));
  await runTransaction(firestore(), async (tx) => {
    const companies = await storedCompanies(tx, ref);
    if (companies.some((c) => sameCompany(c, company))) return;
    if (companies.length >= maxRideCompanies) throw new Error(`At most ${maxRideCompanies}.`);
    tx.set(ref, { rideCompanies: [...companies, company] }, { merge: true });
  });
}

// Removes one of the user's own companies from the list as stored now.
export async function removeRideCompany(uid: string, company: RideCompany): Promise<void> {
  const ref = doc(firestore(), paths.user(uid));
  await runTransaction(firestore(), async (tx) => {
    const companies = await storedCompanies(tx, ref);
    tx.set(ref, { rideCompanies: companies.filter((c) => !sameCompany(c, company)) }, { merge: true });
  });
}

// The hidden list with one more key, keeping the newest when it is full.
export function withHidden(hidden: readonly string[], key: string): string[] {
  return [...hidden.filter((k) => k !== key), key].slice(-maxHiddenRideNeeds);
}

// Hides one ride suggestion for good. Read and written in one transaction,
// so two tabs hiding different suggestions keep both.
export async function hideRideNeed(uid: string, key: string): Promise<void> {
  const ref = doc(firestore(), paths.user(uid));
  await runTransaction(firestore(), async (tx) => {
    const stored = (await tx.get(ref)).data()?.hiddenRideNeeds;
    const hidden = Array.isArray(stored) ? stored.filter((k): k is string => typeof k === "string") : [];
    tx.set(ref, { hiddenRideNeeds: withHidden(hidden, key) }, { merge: true });
  });
}
