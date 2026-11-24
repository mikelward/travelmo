import { RefreshProgress, paths, type BackfillProgress } from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { wasDeleted } from "./deleted";
import { generationOf } from "./store";

// Where "Refresh from email" keeps how far it got: `refresh` on the user's
// document, which Settings follows and only the parser writes (the rules
// list it among the server's keys). Each change runs in one transaction
// that also reads the trips' reset generation (backfillChain.ts's
// ChainIo.change); progress saved under an older generation counts as
// none, so a reset leaves a refresh behind however its messages arrive.
// Undefined when the user's document is gone (the account was deleted).
export async function changeRefresh<R>(
  db: Firestore,
  uid: string,
  change: (current: BackfillProgress | undefined, generation: number) => { next?: BackfillProgress | undefined; result: R },
): Promise<{ state: undefined; generation: number; result: R } | undefined> {
  return db.runTransaction(async (t) => {
    const userRef = db.doc(paths.user(uid));
    const [user, lock] = await Promise.all([t.get(userRef), t.get(db.doc(paths.importLock(uid)))]);
    if (!user.exists || (await wasDeleted(db, t, uid))) return undefined;
    const generation = generationOf(lock);
    const stored = RefreshProgress.safeParse(user.get("refresh"));
    const current = stored.success && (stored.data.generation ?? 0) === generation ? stored.data : undefined;
    const { next, result } = change(current, generation);
    if (next) t.update(userRef, { refresh: { ...next, generation } });
    return { state: undefined, generation, result };
  });
}

// Drops progress a reset left behind, so Settings no longer shows it; a
// refresh started since, under the new generation, stays.
export async function dropStaleRefresh(db: Firestore, uid: string): Promise<boolean> {
  return db.runTransaction(async (t) => {
    const userRef = db.doc(paths.user(uid));
    const [user, lock] = await Promise.all([t.get(userRef), t.get(db.doc(paths.importLock(uid)))]);
    const stored: unknown = user.get("refresh");
    if (!user.exists || stored === undefined) return false;
    const parsed = RefreshProgress.safeParse(stored);
    if (parsed.success && (parsed.data.generation ?? 0) === generationOf(lock)) return false;
    t.update(userRef, { refresh: FieldValue.delete() });
    return true;
  });
}
