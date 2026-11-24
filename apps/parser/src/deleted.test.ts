import { deletionUnfinishedText, paths } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { deletedAccountText, deletedText } from "./deleted";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);

const started = "2026-11-24T10:00:00.000Z";
let n = 0;
const marked = async () => {
  const uid = `deleted-${Date.now()}-${++n}`;
  await db.doc(paths.deletedAccount(uid)).set({ uid, at: started });
  return uid;
};
const events: string[] = [];
const log = (_severity: string, event: string) => void events.push(event);

describe("deletedAccountText", () => {
  it("says the deletion didn't finish when the sign-in outlived it", async () => {
    const uid = await marked();
    expect(await deletedAccountText(db, uid, "2026-11-24T11:00:00.000Z", async () => true, log)).toBe(deletionUnfinishedText);
    expect(events).toContain("account_deletion_unfinished");
  });

  it("says the account was deleted once the sign-in is gone", async () => {
    const uid = await marked();
    expect(await deletedAccountText(db, uid, "2026-11-24T11:00:00.000Z", async () => false, log)).toBe(deletedText);
  });

  it("leaves a deletion that may still be running alone", async () => {
    const uid = await marked();
    let asked = false;
    const exists = async () => (asked = true);
    expect(await deletedAccountText(db, uid, "2026-11-24T10:05:00.000Z", exists, log)).toBe(deletedText);
    expect(asked).toBe(false);
  });

  it("refuses as deleted when the sign-in cannot be looked up", async () => {
    const uid = await marked();
    const failing = async (): Promise<boolean> => {
      throw new Error("Auth unreachable");
    };
    expect(await deletedAccountText(db, uid, "2026-11-24T11:00:00.000Z", failing, log)).toBe(deletedText);
    expect(events).toContain("deleted_sign_in_lookup_failed");
  });
});
