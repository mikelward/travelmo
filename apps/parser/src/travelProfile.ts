import { paths, type ImportedProfile } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";

// Writes a TripIt export's profile parts over what an earlier import left,
// leaving the owner's choice of who may read it (`trustedEmails`) as it is.
// TripIt is the source of these sections, so each import replaces them.
export async function saveImportedProfile(
  db: Firestore,
  uid: string,
  ownerEmail: string | undefined,
  profile: ImportedProfile,
  now: string,
): Promise<void> {
  await db.doc(paths.travelProfile(uid)).set(
    {
      ownerUid: uid,
      ...(ownerEmail ? { ownerEmail: ownerEmail.toLowerCase() } : {}),
      travelers: profile.travelers,
      loyalty: profile.loyalty,
      documents: profile.documents,
      importedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
}
