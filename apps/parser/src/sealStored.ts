import { type DocumentReference, type Firestore, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { errorKind } from "./log";
import { credentialContext, credentialSealer, sealedPrefix } from "./sealing";

// Seals every credential stored before sealing (sealing.ts), as the parser
// starts with a key: Gmail and Calendar refresh tokens and Fastmail tokens
// in `users/{uid}/private`, and tokens parked in `pendingConnections`.
// Until then each is read as it is, so this runs alongside serving.
// Idempotent: it finds only values without the sealed prefix, so once all
// are sealed each start costs a few empty queries. A document that fails is
// logged and left for the next start; one whose credential changed while it
// was being sealed is left as the new one was written.

type Kind = "gmail" | "calendar" | "fastmail" | "pending";
type Field = "refreshToken" | "token";
type Found = { kind: Kind; ref: DocumentReference; field: Field; plain: unknown; uid?: string; context: string };

// The values of `field` that sort outside the range of sealed ones
// (those starting `kms1:` sort from `kms1:` to just before `kms1;`).
async function unsealed(query: Query, field: Field): Promise<QueryDocumentSnapshot[]> {
  const end = sealedPrefix.slice(0, -1) + String.fromCharCode(sealedPrefix.charCodeAt(sealedPrefix.length - 1) + 1);
  const [before, after] = await Promise.all([query.where(field, "<", sealedPrefix).get(), query.where(field, ">=", end).get()]);
  return [...before.docs, ...after.docs];
}

// A credential in `users/{uid}/private`, by its document's id; undefined
// for any other document that happens to have the field.
function privateCredential(doc: QueryDocumentSnapshot, field: Field): Found | undefined {
  const user = doc.ref.parent.parent;
  if (!user || user.parent.id !== "users") return undefined;
  const uid = user.id;
  const id = doc.id;
  if (field === "refreshToken" && (id === "gmail" || id.startsWith("gmail-"))) {
    const emailAddress: unknown = doc.get("emailAddress");
    if (typeof emailAddress !== "string") return undefined;
    return { kind: "gmail", ref: doc.ref, field, plain: doc.get(field), uid, context: credentialContext.gmail(uid, emailAddress) };
  }
  if (field === "refreshToken" && id === "googleCalendar") return { kind: "calendar", ref: doc.ref, field, plain: doc.get(field), uid, context: credentialContext.calendar(uid) };
  if (field === "token" && id === "fastmail") return { kind: "fastmail", ref: doc.ref, field, plain: doc.get(field), uid, context: credentialContext.fastmail(uid) };
  return undefined;
}

async function findUnsealed(db: Firestore): Promise<Found[]> {
  const privates = db.collectionGroup("private");
  const [refreshTokens, tokens, pending] = await Promise.all([
    unsealed(privates, "refreshToken"),
    unsealed(privates, "token"),
    unsealed(db.collection("pendingConnections"), "refreshToken"),
  ]);
  return [
    ...refreshTokens.map((d) => privateCredential(d, "refreshToken")),
    ...tokens.map((d) => privateCredential(d, "token")),
    // Not logged by id: a pending connection's id is the code that redeems it.
    ...pending.map((d): Found => ({ kind: "pending", ref: d.ref, field: "refreshToken", plain: d.get("refreshToken"), context: credentialContext.pending(d.id) })),
  ].filter((f): f is Found => f !== undefined);
}

export async function sealStoredCredentials(
  db: Firestore,
  log: (severity: "INFO" | "ERROR", event: string, fields: Record<string, unknown>) => void,
): Promise<{ sealed: number; changed: number; failed: number }> {
  const found = await findUnsealed(db);
  let sealed = 0;
  let changed = 0;
  let failed = 0;
  for (const { kind, ref, field, plain, uid, context } of found) {
    if (typeof plain !== "string") continue;
    try {
      // KMS is called outside the transaction, which may run more than once.
      const value = await credentialSealer().seal(plain, context);
      const written = await db.runTransaction(async (t) => {
        const current = await t.get(ref);
        if (current.get(field) !== plain) return false;
        t.update(ref, field, value);
        return true;
      });
      if (written) sealed += 1;
      else changed += 1;
    } catch (error) {
      // Still read as it is; tried again on the next start.
      failed += 1;
      log("ERROR", "credential_seal_failed", { kind, ...(uid ? { uid } : {}), ...errorKind(error) });
    }
  }
  return { sealed, changed, failed };
}
