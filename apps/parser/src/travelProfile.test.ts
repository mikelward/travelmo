import { TravelProfile, paths } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { saveImportedProfile } from "./travelProfile";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
let n = 0;
const unique = () => `u-${Date.now()}-${++n}`;

describe("saveImportedProfile", () => {
  it("replaces the imported sections and keeps who the owner shares with", async () => {
    const uid = unique();
    const ref = db.doc(paths.travelProfile(uid));
    await ref.set({ ownerUid: uid, trustedEmails: ["partner@example.com"] });
    const passport = { title: "Passport", fields: [{ label: "Number", value: "X1234567" }] };
    await saveImportedProfile(db, uid, "Owner@Example.com", { travelers: [], loyalty: [], documents: [passport, passport] }, "2026-11-03T00:00:00Z");
    await saveImportedProfile(db, uid, "Owner@Example.com", { travelers: [], loyalty: [], documents: [passport] }, "2026-11-04T00:00:00Z");
    const saved = TravelProfile.parse((await ref.get()).data());
    expect(saved).toMatchObject({ ownerUid: uid, ownerEmail: "owner@example.com", trustedEmails: ["partner@example.com"], documents: [passport], importedAt: "2026-11-04T00:00:00Z" });
  });
});
