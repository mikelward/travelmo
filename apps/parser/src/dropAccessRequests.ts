import { paths } from "@travelmo/core";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { AccessLog } from "./access";

// Travelmo once let accounts ask for access (`access/{email}` with status
// "requested"); bots filled the list, so asking was dropped (SPEC "Access").
// This removes what asking left behind, once: a record that was only a
// request is deleted, and one someone also shared with keeps its invite and
// loses the request's fields. Nothing else reads them. To bring asking
// back, revert the change that removed it; this pass is safe to keep or
// delete then.

export type DropResult = { deleted: number; kept: number };

export async function dropAccessRequests(db: Firestore, log: AccessLog): Promise<DropResult | undefined> {
  const marker = db.doc(paths.accessRequestsDropped());
  if ((await marker.get()).exists) return undefined;
  const result: DropResult = { deleted: 0, kept: 0 };
  const requests = await db.collection(paths.accessRecords()).where("status", "==", "requested").get();
  for (const doc of requests.docs) {
    const outcome = await db.runTransaction(async (t) => {
      const current = await t.get(doc.ref);
      if (current.get("status") !== "requested") return undefined;
      if (typeof current.get("invitedBy") === "string") {
        t.update(doc.ref, { status: FieldValue.delete(), requestedAt: FieldValue.delete(), notifiedAt: FieldValue.delete() });
        return "kept" as const;
      }
      t.delete(doc.ref);
      return "deleted" as const;
    });
    if (outcome) result[outcome] += 1;
  }
  await marker.set({ droppedAt: new Date().toISOString(), ...result });
  // Counts only: the records are email addresses.
  log("INFO", "access_requests_dropped", result);
  return result;
}
