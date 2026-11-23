"use client";

import {
  AccessConfig,
  AccessRecord,
  accessDecision,
  accessInvite,
  accessRequest,
  accessStatus,
  linkedEmails,
  paths,
  UserProfile,
  type AccountAccess,
} from "@travelmo/core";
import type { User } from "firebase/auth";
import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
  type FirestoreError,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { firestore } from "./firebase";

// Who may use the app (SPEC "Access"; the decision is packages/core's
// accessStatus, the same one the rules and the parser make).

export type Access =
  | { state: "loading" }
  // `admins` is known to admins alone, who may read the list.
  | { state: AccountAccess; admin: boolean; admins: string[]; hasProfile: boolean; record?: AccessRecord };

const verifiedEmail = (user: User): string | undefined =>
  user.emailVerified && user.email ? user.email.toLowerCase() : undefined;

// A missing document read from this browser's cache may only be missing
// from the cache, so "not approved" waits for the server's word; anything
// that approves is taken from the cache at once, so the app opens offline.
// Each answer is kept with the document it came from, so a change of
// account never reads the last one's.
type Seen<T> = { path: string; value: T; confirmed: boolean };

// `retry` names what else the read depends on: a change of it subscribes
// afresh, so a read the rules refused is tried again once they may allow it.
function useDocument<T>(
  path: string | undefined,
  read: (snapshot: DocumentSnapshot) => T,
  onError: (error: FirestoreError) => T,
  retry = "",
): Seen<T> | undefined {
  const [answer, setAnswer] = useState<Seen<T>>();
  const readRef = useRef(read);
  const errorRef = useRef(onError);
  useEffect(() => {
    readRef.current = read;
    errorRef.current = onError;
  });
  useEffect(() => {
    if (!path) return;
    return onSnapshot(
      doc(firestore(), path),
      { includeMetadataChanges: true },
      (s) => setAnswer({ path, value: readRef.current(s), confirmed: !s.metadata.fromCache }),
      (error) => setAnswer({ path, value: errorRef.current(error), confirmed: true }),
    );
  }, [path, retry]);
  return answer?.path === path ? answer : undefined;
}

export function useAccess(user: User | null | undefined): Access {
  const email = user ? verifiedEmail(user) : undefined;
  // Whether it exists, and the addresses the account linked (SPEC "Linked
  // email addresses"), any of which may be an admin's.
  const profile = useDocument<{ exists: boolean; linked: string[] }>(
    user ? paths.user(user.uid) : undefined,
    (s) => ({ exists: s.exists(), linked: s.exists() ? linkedEmails(UserProfile.safeParse(s.data()).data) : [] }),
    (error) => {
      console.error("Reading the user document failed", error);
      return { exists: false, linked: [] };
    },
  );
  const record = useDocument<AccessRecord | undefined>(
    user && email ? paths.access(email) : undefined,
    (s) => {
      if (!s.exists()) return undefined;
      const parsed = AccessRecord.safeParse(s.data());
      if (!parsed.success) console.error("Skipping a malformed access record", parsed.error);
      return parsed.data;
    },
    (error) => {
      console.error("Reading the access record failed", error);
      return undefined;
    },
  );
  const config = useDocument<AccessConfig | undefined>(
    user ? paths.accessConfig() : undefined,
    (s) => (s.exists() ? AccessConfig.safeParse(s.data()).data : undefined),
    // Expected for everyone but admins: the list is theirs alone to read.
    (error) => {
      if (error.code !== "permission-denied") console.error("Reading the admins' list failed", error);
      return undefined;
    },
    // Linking an admin's address (or connecting its Gmail) opens the list.
    profile?.value.linked.join(" "),
  );

  // An unverified address has no record.
  const none = { value: undefined, confirmed: true };
  const recordSeen = email ? record : none;
  if (!user || !profile || !recordSeen || !config) return { state: "loading" };
  const { exists: hasProfile, linked } = profile.value;
  const status = accessStatus({ email, hasProfile, record: recordSeen.value, config: config.value, linked });
  if (status !== "approved" && !(profile.confirmed && recordSeen.confirmed && config.confirmed)) return { state: "loading" };
  const admins = config.value?.admins ?? [];
  const admin = admins.some((address) => address === email || linked.includes(address));
  return { state: status, admin, admins, hasProfile, ...(recordSeen.value ? { record: recordSeen.value } : {}) };
}

// Asking for access, for the signed-in address.
export async function requestAccess(db: Firestore, email: string, uid: string, now: string): Promise<void> {
  await setDoc(doc(db, paths.access(email)), accessRequest(email, uid, now));
}

// An account from before approvals records itself once, so it shows on the
// Access page and an admin can revoke it.
export async function recordSelf(db: Firestore, email: string, uid: string, now: string): Promise<void> {
  await setDoc(doc(db, paths.access(email)), { email, status: "approved", uid, approvedBy: uid, approvedAt: now });
}

// Sharing a trip invites the address in the same write, so it can open what
// was shared without asking (unless an admin declined it).
export async function shareTrip(db: Firestore, tripId: string, email: string, inviterUid: string, now: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, paths.trip(tripId)), { sharedWith: arrayUnion(email), updatedAt: now });
  batch.set(doc(db, paths.access(email)), accessInvite(email, inviterUid, now), { merge: true });
  await batch.commit();
}

// An admin's decision: approve (or invite an address that never asked),
// decline, or revoke.
export async function decideAccess(db: Firestore, email: string, decision: "approved" | "declined", adminUid: string, now: string): Promise<void> {
  await setDoc(doc(db, paths.access(email)), { email, ...accessDecision(decision, adminUid, now) }, { merge: true });
}

// Every record, for the Access page (admins alone may list them).
export function useAccessRecords(): AccessRecord[] | undefined {
  const [records, setRecords] = useState<AccessRecord[]>();
  useEffect(() => {
    return onSnapshot(
      collection(firestore(), paths.accessRecords()),
      (s) => {
        const out: AccessRecord[] = [];
        for (const d of s.docs) {
          const parsed = AccessRecord.safeParse(d.data());
          if (parsed.success) out.push(parsed.data);
          else console.error(`Skipping malformed access record ${d.ref.path}`, parsed.error);
        }
        setRecords(out);
      },
      (error) => console.error("Access records subscription failed", error),
    );
  }, []);
  return records;
}
