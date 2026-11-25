import { PersonDoc, paths } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { log } from "./log";

// The people a user's bookings name (users/{uid}/people), for whether they
// are only watching a trip (watchedTrip). One that doesn't parse is logged
// and left out rather than failing the run.
export async function readPeople(db: Firestore, uid: string): Promise<PersonDoc[]> {
  const snap = await db.collection(paths.people(uid)).get();
  return snap.docs.flatMap((d) => {
    const parsed = PersonDoc.safeParse(d.data());
    if (!parsed.success) log("WARNING", "person_unreadable", { uid, personId: d.id });
    return parsed.success ? [parsed.data] : [];
  });
}
