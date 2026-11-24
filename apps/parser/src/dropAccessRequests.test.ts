import { paths } from "@travelmo/core";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { dropAccessRequests } from "./dropAccessRequests";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST;
// in a project of its own, since it reads every access record.
const app = initializeApp({ projectId: "demo-travelmo-drop-access-requests" }, "dropAccessRequests");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const at = "2026-11-24T00:00:00.000Z";

describe("dropAccessRequests", () => {
  it("removes what asking left, once, keeping invites and decisions", async () => {
    await db.doc(paths.accessRequestsDropped()).delete();
    const logged: unknown[] = [];
    const log = (severity: string, event: string, fields: Record<string, unknown>) => void logged.push({ severity, event, fields });
    await db.doc(paths.access("bot@example.com")).set({ email: "bot@example.com", status: "requested", uid: "u1", requestedAt: at, notifiedAt: at });
    await db.doc(paths.access("shared@example.com")).set({ email: "shared@example.com", status: "requested", uid: "u2", requestedAt: at, invitedBy: "friend", invitedAt: at });
    await db.doc(paths.access("ok@example.com")).set({ email: "ok@example.com", status: "approved", approvedBy: "admin", approvedAt: at });
    await db.doc(paths.access("no@example.com")).set({ email: "no@example.com", status: "declined", declinedBy: "admin", declinedAt: at });

    expect(await dropAccessRequests(db, log)).toEqual({ deleted: 1, kept: 1 });
    expect((await db.doc(paths.access("bot@example.com")).get()).exists).toBe(false);
    expect((await db.doc(paths.access("shared@example.com")).get()).data()).toEqual({ email: "shared@example.com", uid: "u2", invitedBy: "friend", invitedAt: at });
    expect((await db.doc(paths.access("ok@example.com")).get()).get("status")).toBe("approved");
    expect((await db.doc(paths.access("no@example.com")).get()).get("status")).toBe("declined");
    expect(JSON.stringify(logged)).not.toContain("@");

    // Once: a later start leaves anything alone.
    await db.doc(paths.access("late@example.com")).set({ email: "late@example.com", status: "requested" });
    expect(await dropAccessRequests(db, log)).toBeUndefined();
    expect((await db.doc(paths.access("late@example.com")).get()).exists).toBe(true);
  });
});
