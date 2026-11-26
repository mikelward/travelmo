"use client";

import { PersonDoc, findPerson, guessMe, mergedPerson, paths, withAlias } from "@travelmo/core";
import { collection, doc, onSnapshot, updateDoc, writeBatch, type Firestore } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firestore } from "./firebase";

// The people the user's bookings name (SPEC "Travelers"), most often named
// first; undefined until they load. One that doesn't parse is left out.
export function usePeople(uid: string): PersonDoc[] | undefined {
  const [people, setPeople] = useState<PersonDoc[]>();
  useEffect(() => {
    return onSnapshot(
      collection(firestore(), paths.people(uid)),
      (snap) => {
        const parsed = snap.docs.flatMap((d) => {
          const result = PersonDoc.safeParse(d.data());
          if (!result.success) console.error(`Malformed person ${d.ref.path}`, result.error);
          return result.success ? [result.data] : [];
        });
        setPeople(parsed.sort((a, b) => b.bookings - a.bookings || a.name.localeCompare(b.name)));
      },
      (error) => console.error("People subscription failed", error),
    );
  }, [uid]);
  return people;
}

// Says which person is the user: that one marked, and no other.
export async function setMe(db: Firestore, uid: string, people: readonly PersonDoc[], personId: string): Promise<void> {
  const batch = writeBatch(db);
  const updatedAt = new Date().toISOString();
  for (const person of people) {
    if (person.id === personId) batch.update(doc(db, paths.person(uid, person.id)), { me: true, updatedAt });
    else if (person.me) batch.update(doc(db, paths.person(uid, person.id)), { me: false, updatedAt });
  }
  await batch.commit();
}

// Merges `fromId` into `intoId`, one person (SPEC "Travelers"): the one
// kept gains the other's name and spellings, and is the user when either
// was taken to be; the other goes. One batch, so neither is left half done.
export async function mergePeople(db: Firestore, uid: string, people: readonly PersonDoc[], fromId: string, intoId: string): Promise<void> {
  const from = people.find((p) => p.id === fromId);
  const into = people.find((p) => p.id === intoId);
  if (!from || !into || from.id === into.id) return;
  const me = guessMe(people)?.id;
  const batch = writeBatch(db);
  batch.update(doc(db, paths.person(uid, into.id)), { ...mergedPerson(into, from, me === from.id || me === into.id), updatedAt: new Date().toISOString() });
  batch.delete(doc(db, paths.person(uid, from.id)));
  await batch.commit();
}

// Says `name` (a loyalty number's holder) is `intoId`: merges the person
// by that name into them when the bookings named one, else adds it as one
// more spelling of theirs.
export async function sayWhoIs(db: Firestore, uid: string, people: readonly PersonDoc[], name: string, intoId: string): Promise<void> {
  const into = people.find((p) => p.id === intoId);
  if (!into) return;
  const named = findPerson(people, name);
  if (named && named.id !== into.id) return mergePeople(db, uid, people, named.id, into.id);
  const aliases = withAlias(into, name);
  if (aliases === into.aliases) return;
  await updateDoc(doc(db, paths.person(uid, into.id)), { aliases, updatedAt: new Date().toISOString() });
}
