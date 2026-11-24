import { paths, type ExtractedBooking, type FoundLoyalty } from "@travelmo/core";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { EmailMessage } from "./gmail";
import { reviseFoundLoyaltyOnce, type RevisionDeps } from "./loyaltyRevision";
import type { MailSource } from "./mailSource";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
// The pass reads every user's travel profile, so these tests get a project
// of their own, emptied before each.
const projectId = "demo-travelmo-loyalty-revision";
const app = initializeApp({ projectId }, "loyaltyRevision");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const iso = "2026-11-24T12:00:00.000Z";

async function clear() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is not set");
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Clearing the emulator failed: ${response.status}`);
}
beforeEach(clear);

const found = (program: string, number: string, extra: Partial<FoundLoyalty> = {}): FoundLoyalty => ({
  program,
  number,
  messageId: "m1",
  label: "Your United booking",
  at: "2026-10-01T00:00:00.000Z",
  ...extra,
});

const said = [{ program: "Frequent Flyer", number: "XXXXX166", person: "Jess" }];

// A user whose numbers were kept by an earlier version: a United booking's
// two numbers under "Frequent Flyer", his daughter's taken for his, and a
// hotel number with no holder from another email.
async function seedUser(uid: string, extra: { hotelSource?: string } = {}) {
  await db.doc(paths.user(uid)).set({ displayName: "Mikel Ward" });
  await db.doc(paths.trip(`trip-${uid}`)).set({ id: `trip-${uid}`, ownerUid: uid, title: "Denver", start: "2026-12-15", end: "2026-12-20" });
  await db.doc(paths.segment(`trip-${uid}`, "s1")).set({ id: "s1", tripId: `trip-${uid}`, type: "flight", title: "UA 123 LHR to DEN", start: "2026-12-15T09:00:00+00:00", source: "gmail" });
  await db.doc(paths.parsedMessage(uid, "m1")).set({ messageId: "m1", uid, outcome: "imported", segmentIds: ["s1"], tripId: `trip-${uid}`, processedAt: iso });
  await db.doc(paths.parsedMessage(uid, "m2")).set({ messageId: "m2", uid, outcome: "imported", segmentIds: [], processedAt: iso, ...(extra.hotelSource ? { source: extra.hotelSource } : {}) });
  await db.doc(paths.travelProfile(uid)).set({
    ownerUid: uid,
    trustedEmails: [],
    loyalty: [],
    foundLoyalty: [
      found("Frequent Flyer", "XXXXX505", { holder: "Mikel Ward" }),
      found("Frequent Flyer", "XXXXX166", { holder: "Jessica Ward" }),
      found("Sample Hotels Rewards", "SH777", { messageId: "m2", label: "Your stay", status: "Gold", statusAt: "2026-09-01T00:00:00.000Z" }),
    ],
    loyaltyPeople: said,
  });
}

// Everything but the travel profile, to show the pass leaves it alone.
async function snapshotOthers(uid: string) {
  const [trip, segment, records] = await Promise.all([
    db.doc(paths.trip(`trip-${uid}`)).get(),
    db.doc(paths.segment(`trip-${uid}`, "s1")).get(),
    db.collection(paths.parsedMessages(uid)).get(),
  ]);
  return { trip: trip.data(), segment: segment.data(), records: records.docs.map((d) => d.data()) };
}

const hotelEmail: EmailMessage = { id: "m2", threadId: "t2", from: "Sample Hotels <stay@hotels.example>", subject: "Your stay", date: "Mon, 1 Sep 2026 10:00:00 +0000", listUnsubscribe: false, text: "Member SH777, Mikel Ward" };
const hotelBooking: ExtractedBooking = { isBooking: true, segments: [], memberships: [{ program: "Sample Hotels Rewards", number: "SH 777", holder: "MR MIKEL WARD" }] };

function fakes(options: { connected?: boolean; gone?: boolean } = {}) {
  const fetched: string[] = [];
  const extracted: string[] = [];
  const logged: unknown[] = [];
  const source: MailSource = {
    provider: "gmail",
    searchPage: async () => ({ ids: [] }),
    fetch: async (id) => {
      fetched.push(id);
      if (options.gone) throw Object.assign(new Error("Not Found"), { code: 404 });
      return hotelEmail;
    },
    isStaleCursor: () => false,
    isNotFound: (error) => (error as { code?: number }).code === 404,
  };
  const deps: RevisionDeps = {
    db,
    extract: async (message) => {
      extracted.push(message.id);
      return hotelBooking;
    },
    mailbox: async (_uid, messageId) => (options.connected === false ? undefined : { source, id: messageId }),
    now: () => iso,
    log: (severity, event, fields) => void logged.push({ severity, event, ...fields }),
  };
  return { deps, fetched, extracted, logged };
}

const profileOf = async (uid: string) => (await db.doc(paths.travelProfile(uid)).get()).data();

describe("reviseFoundLoyaltyOnce", () => {
  it("files stored numbers as they would be read now, reading again only the email that needs it, once", async () => {
    await seedUser("u1");
    const before = await snapshotOthers("u1");
    const { deps, fetched, extracted, logged } = fakes();
    expect(await reviseFoundLoyaltyOnce(deps)).toEqual({ users: 1, fixed: 2, reread: 1, skipped: 0, failed: 0 });
    const profile = await profileOf("u1");
    expect(profile?.foundLoyalty).toEqual([
      found("United MileagePlus", "XXXXX505", { holder: "Mikel Ward" }),
      found("United MileagePlus", "XXXXX166", { holder: "Jessica Ward", person: "Jessica Ward" }),
      // Read again: its holder now known, its status kept.
      found("Sample Hotels Rewards", "SH 777", { messageId: "m2", label: "Your stay", holder: "MR MIKEL WARD", status: "Gold", statusAt: "2026-09-01T00:00:00.000Z" }),
    ]);
    // The owner's own answers, the trip, the booking and the import records stand.
    expect(profile?.loyaltyPeople).toEqual(said);
    expect(await snapshotOthers("u1")).toEqual(before);
    // Only the email whose number had no holder was read, and only once.
    expect(fetched).toEqual(["m2"]);
    expect(extracted).toEqual(["m2"]);
    expect(logged).toContainEqual(expect.objectContaining({ event: "found_loyalty_reread", uid: "u1", messageId: "m2" }));
    expect(JSON.stringify(logged)).not.toMatch(/SH ?777|XXXXX|Ward/);
    expect((await db.doc(paths.foundLoyaltyRevision()).get()).data()).toMatchObject({ revision: 1, ranAt: iso, users: 1 });

    // The marker makes it run once.
    const again = fakes();
    expect(await reviseFoundLoyaltyOnce(again.deps)).toBeUndefined();
    expect(again.extracted).toEqual([]);
  });

  it("leaves a deleted account alone", async () => {
    await seedUser("gone");
    await db.doc(paths.deletedAccount("gone")).set({ uid: "gone", at: iso });
    const before = await profileOf("gone");
    const { deps, extracted } = fakes();
    expect(await reviseFoundLoyaltyOnce(deps)).toEqual({ users: 0, fixed: 0, reread: 0, skipped: 0, failed: 0 });
    expect(await profileOf("gone")).toEqual(before);
    expect(extracted).toEqual([]);
  });

  it("skips an email that is gone, in a mailbox no longer connected, or forwarded, keeping its numbers", async () => {
    for (const [uid, options, hotelSource] of [
      ["u-gone", { gone: true }, undefined],
      ["u-disconnected", { connected: false }, undefined],
      ["u-forwarded", {}, "forward"],
    ] as const) {
      await clear();
      await seedUser(uid, hotelSource ? { hotelSource } : {});
      const { deps, extracted, logged } = fakes(options);
      expect(await reviseFoundLoyaltyOnce(deps)).toMatchObject({ users: 1, fixed: 2, reread: 0, skipped: 1, failed: 0 });
      expect(extracted).toEqual([]);
      expect((await profileOf(uid))?.foundLoyalty[2]).toEqual(found("Sample Hotels Rewards", "SH777", { messageId: "m2", label: "Your stay", status: "Gold", statusAt: "2026-09-01T00:00:00.000Z" }));
      expect(logged).toContainEqual(expect.objectContaining({ event: "found_loyalty_reread_skipped", uid }));
      expect(JSON.stringify(logged)).not.toMatch(/SH ?777|Ward/);
    }
  });

  it("logs and skips a user whose email fails to read, and runs no second pass while one is under way", async () => {
    await seedUser("u1");
    const { deps, logged } = fakes();
    deps.extract = async () => {
      throw new Error("model unavailable for Mikel Ward");
    };
    expect(await reviseFoundLoyaltyOnce(deps)).toMatchObject({ users: 1, reread: 0, failed: 1 });
    expect(logged).toContainEqual({ severity: "WARNING", event: "found_loyalty_reread_failed", uid: "u1", messageId: "m2", stage: "extract", error: "Error" });
    expect(JSON.stringify(logged)).not.toContain("Ward");

    await db.doc(paths.foundLoyaltyRevision()).set({ running: { revision: 2, at: iso } });
    expect(await reviseFoundLoyaltyOnce(fakes().deps, 2)).toBeUndefined();
  });
});
