"use client";

import { PersonDoc, paths } from "@travelmo/core";
import { collection, doc, onSnapshot, writeBatch, type Firestore } from "firebase/firestore";
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
