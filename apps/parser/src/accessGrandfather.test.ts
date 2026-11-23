import { paths, type Trip } from "@travelmo/core";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { gateUser, grandfatherAccounts, grandfatherOnStart, type GrandfatherDeps } from "./access";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
// grandfatherAccounts reads every trip and profile there is, so these tests
// get a project of their own, emptied before each, rather than share the
// other files' data.
const projectId = "demo-travelmo-grandfather";
const app = initializeApp({ projectId }, "grandfather");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const iso = "2026-11-23T12:00:00.000Z";
const adminEmail = "admin@example.com";

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is not set");
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Clearing the emulator failed: ${response.status}`);
  await db.doc(paths.accessConfig()).set({ admins: [adminEmail] });
});

const person = (uid: string) => ({ uid, email: `${uid}@example.com`, email_verified: true });

async function seedTrip(id: string, ownerUid: string, sharedWith: string[] = []): Promise<void> {
  const trip: Trip = { id, title: "Lisbon", start: "2026-12-01", end: "2026-12-03", ownerUid, sharedWith, createdAt: iso, updatedAt: iso };
  await db.doc(paths.trip(id)).set(trip);
}

type Logged = { severity: string; event: string; fields: Record<string, unknown> };

function deps(emails: Record<string, string | Error>) {
  const logged: Logged[] = [];
  const value: GrandfatherDeps = {
    db,
    now: () => iso,
    log: (severity, event, fields) => void logged.push({ severity, event, fields }),
    verifiedEmail: async (uid) => {
      const email = emails[uid];
      if (email instanceof Error) throw email;
      return email;
    },
  };
  return { deps: value, logged };
}

const record = async (email: string) => (await db.doc(paths.access(email)).get()).data();

describe("grandfatherAccounts", () => {
  it("lets in an Android-only owner and everyone they shared with, before the rules ask", async () => {
    const owner = person("android-owner");
    const friend = person("friend");
    const trusted = person("trusted");
    await seedTrip("t1", owner.uid, [friend.email, "  Friend@Example.com "]);
    await db.doc(paths.travelProfile(owner.uid)).set({ ownerUid: owner.uid, trustedEmails: [trusted.email] });
    expect(await gateUser(db, owner)).toBe("unapproved");

    const { deps: d, logged } = deps({ [owner.uid]: owner.email });
    expect(await grandfatherAccounts(d)).toEqual({ owners: 1, sharees: 2, recorded: 3, failed: 0 });

    expect(await record(owner.email)).toEqual({ email: owner.email, status: "approved", uid: owner.uid, approvedBy: "migration", approvedAt: iso, grandfathered: true });
    expect(await record(friend.email)).toMatchObject({ status: "approved", approvedBy: "migration", grandfathered: true });
    for (const someone of [owner, friend, trusted]) expect(await gateUser(db, someone)).toBe("ok");
    // No address in the logs.
    expect(JSON.stringify(logged)).not.toContain("@");
  });

  it("writes nothing for those already let in, and nothing on a second run", async () => {
    const web = person("web-owner");
    const invited = person("invited");
    await db.doc(paths.user(web.uid)).set({ email: web.email });
    await db.doc(paths.access(invited.email)).set({ email: invited.email, invitedBy: web.uid, invitedAt: iso });
    await seedTrip("t1", web.uid, [invited.email, adminEmail]);

    const { deps: d } = deps({ [web.uid]: web.email });
    expect(await grandfatherAccounts(d)).toEqual({ owners: 1, sharees: 2, recorded: 0, failed: 0 });
    expect(await record(web.email)).toBeUndefined();
    expect(await record(adminEmail)).toBeUndefined();
    expect(await record(invited.email)).toEqual({ email: invited.email, invitedBy: web.uid, invitedAt: iso });

    const android = person("android-owner");
    await seedTrip("t2", android.uid);
    const again = deps({ [web.uid]: web.email, [android.uid]: android.email });
    expect((await grandfatherAccounts(again.deps)).recorded).toBe(1);
    expect((await grandfatherAccounts(again.deps)).recorded).toBe(0);
  });

  it("approves a request still waiting from someone already in", async () => {
    const owner = person("owner");
    await seedTrip("t1", owner.uid);
    await db.doc(paths.access(owner.email)).set({ email: owner.email, status: "requested", uid: owner.uid, requestedAt: iso, notifiedAt: iso });
    expect((await grandfatherAccounts(deps({ [owner.uid]: owner.email }).deps)).recorded).toBe(1);
    expect(await record(owner.email)).toMatchObject({ status: "approved", requestedAt: iso, grandfathered: true });
  });

  it("leaves a revocation alone, and does not count a revoked owner's shares as invites", async () => {
    const revoked = person("revoked");
    const friend = person("friend");
    await db.doc(paths.user(revoked.uid)).set({ email: revoked.email });
    await db.doc(paths.access(revoked.email)).set({ email: revoked.email, status: "declined", declinedBy: "admin", declinedAt: iso });
    await seedTrip("t1", revoked.uid, [friend.email]);

    expect(await grandfatherAccounts(deps({ [revoked.uid]: revoked.email }).deps)).toEqual({ owners: 1, sharees: 0, recorded: 0, failed: 0 });
    expect((await record(revoked.email))?.status).toBe("declined");
    expect(await record(friend.email)).toBeUndefined();
  });

  it("skips an account being deleted or gone from Auth, and carries on past one that fails", async () => {
    const deleting = person("deleting");
    const gone = person("gone");
    const broken = person("broken");
    const fine = person("fine");
    await db.doc(paths.deletedAccount(deleting.uid)).set({ uid: deleting.uid, at: iso });
    for (const [i, someone] of [deleting, gone, broken, fine].entries()) await seedTrip(`t${i}`, someone.uid);

    const { deps: d, logged } = deps({
      [deleting.uid]: deleting.email,
      [gone.uid]: Object.assign(new Error("There is no user record"), { code: "auth/user-not-found" }),
      [broken.uid]: new Error("Auth unavailable"),
      [fine.uid]: fine.email,
    });
    expect(await grandfatherAccounts(d)).toEqual({ owners: 4, sharees: 0, recorded: 1, failed: 1 });
    expect(await record(deleting.email)).toBeUndefined();
    expect((await record(fine.email))?.status).toBe("approved");
    expect(logged.find((l) => l.event === "access_grandfather_owner_failed")?.fields).toEqual({ uid: broken.uid, error: "Auth unavailable" });
  });
});

describe("grandfatherOnStart", () => {
  const result = { owners: 1, sharees: 0, recorded: 1, failed: 0 };

  it("waits for the first run, and does not count one that failed", async () => {
    const { deps: d } = deps({});
    await expect(grandfatherOnStart(d, async () => ({ ...result, failed: 1 }))).rejects.toThrow("1 accounts could not be recorded");
    expect((await db.doc(paths.accessGrandfathered()).get()).exists).toBe(false);

    let runs = 0;
    expect(
      await grandfatherOnStart(d, async () => {
        runs += 1;
        return result;
      }),
    ).toEqual({ run: "first" });
    expect(runs).toBe(1);
    expect((await db.doc(paths.accessGrandfathered()).get()).data()).toEqual({ ranAt: iso, ...result });
  });

  it("runs again in the background once a first run succeeded, logging a failure", async () => {
    await db.doc(paths.accessGrandfathered()).set({ ranAt: iso, ...result });
    const { deps: d, logged } = deps({});
    const started = await grandfatherOnStart(d, async () => {
      throw new Error("Firestore unavailable");
    });
    if (started.run !== "again") throw new Error(`expected a background run, got ${started.run}`);
    await started.settled;
    expect(logged).toContainEqual({ severity: "ERROR", event: "access_grandfather_failed", fields: { error: "Firestore unavailable" } });
  });
});
