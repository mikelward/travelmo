import { mergeProfileEntries, paths, profileBudgetBytes, ProfileEntry, type ImportedProfile } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { refuseIfDeleted } from "./deleted";

const maxDocuments = 100;
const maxLoyalty = 200;
const itemOverhead = 32;
const encoder = new TextEncoder();
const textBytes = (s: string) => encoder.encode(s).length + itemOverhead;
const entryBytes = (entry: ProfileEntry) =>
  textBytes(entry.title) + entry.fields.reduce((n, f) => n + textBytes(f.label) + textBytes(f.value), 0);

function entriesOf(raw: unknown): ProfileEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileEntry[] = [];
  for (const item of raw) {
    const parsed = ProfileEntry.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// Writes a TripIt export's profile parts into the traveler's wallet, leaving
// the owner's sharing list (`trustedEmails`) and any manually added documents
// or loyalty entries intact. Reserves the storage budget for all existing
// entries across both sections first, then admits incoming entries into the
// remaining budget so an import never evicts previously saved data.
export async function saveImportedProfile(
  db: Firestore,
  uid: string,
  ownerEmail: string | undefined,
  profile: ImportedProfile,
  now: string,
): Promise<{ truncated: boolean }> {
  let truncated = profile.truncated ?? false;
  await db.runTransaction(async (t) => {
    await refuseIfDeleted(db, t, uid);
    const ref = db.doc(paths.travelProfile(uid));
    const existing = (await t.get(ref)).data();
    const existingImportedAt = typeof existing?.importedAt === "string" ? existing.importedAt : undefined;
    const existingDocs = entriesOf(existing?.documents);
    const existingLoyalty = entriesOf(existing?.loyalty).map((e) =>
      e.updatedAt || !existingImportedAt ? e : { ...e, updatedAt: existingImportedAt },
    );
    const incomingLoyalty = profile.loyalty.map((e) => ({ ...e, updatedAt: now }));

    // Reserve budget for all existing entries across both sections first.
    let remaining =
      profileBudgetBytes -
      existingDocs.reduce((n, e) => n + entryBytes(e), 0) -
      existingLoyalty.reduce((n, e) => n + entryBytes(e), 0);

    const admit = (base: ProfileEntry[], incoming: ProfileEntry[], cap: number): ProfileEntry[] => {
      let current = [...base];
      const limit = Math.max(cap, base.length);
      for (const item of incoming) {
        const candidate = mergeProfileEntries(current, [item]);
        if (candidate.length > limit) {
          truncated = true;
          continue;
        }
        const delta =
          candidate.reduce((n, e) => n + entryBytes(e), 0) -
          current.reduce((n, e) => n + entryBytes(e), 0);
        if (delta > remaining) {
          truncated = true;
          continue;
        }
        remaining -= delta;
        current = candidate;
      }
      return current;
    };

    const documents = admit(existingDocs, profile.documents, maxDocuments);
    const loyalty = admit(existingLoyalty, incomingLoyalty, maxLoyalty);
    const travelers: ProfileEntry[] = [];
    for (const item of profile.travelers) {
      const size = entryBytes(item);
      if (size > remaining) {
        truncated = true;
        continue;
      }
      remaining -= size;
      travelers.push(item);
    }

    t.set(
      ref,
      {
        ownerUid: uid,
        ...(ownerEmail ? { ownerEmail: ownerEmail.toLowerCase() } : {}),
        travelers,
        loyalty,
        documents,
        importedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  });
  return { truncated };
}
