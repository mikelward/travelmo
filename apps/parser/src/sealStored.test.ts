import { mailboxKey, paths, type FastmailState, type GmailState, type GoogleCalendarState } from "@travelmo/core";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCalendarState, loadMailbox, loadMailboxes, changeBackfill, pendingTokens, resolveMailbox, saveCalendarState, saveConnection, savePending, takePending } from "./connections";
import { changeFastmailBackfill, loadFastmailState, saveFastmailConnection } from "./fastmailConnection";
import { sealStoredCredentials } from "./sealStored";
import { credentialContext, isSealed, kmsSealer, useSealer, type Sealer } from "./sealing";
import { fakeKms, testKeyName } from "./testSealer";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
// sealStoredCredentials reads every user's credentials there are, so these
// tests get a project of their own, emptied before each, rather than seal
// the other files' plaintext ones.
const projectId = "demo-travelmo-sealing";
const app = initializeApp({ projectId }, "sealing");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const iso = "2026-11-23T12:00:00.000Z";
const now = Date.parse(iso);

let sealer: Sealer;
beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is not set");
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Clearing the emulator failed: ${response.status}`);
  sealer = kmsSealer(testKeyName, fakeKms());
  useSealer(sealer);
});

const raw = async (path: string, field: string) => (await db.doc(path).get()).get(field) as unknown;

const gmail = (emailAddress: string, refreshToken: string): GmailState => ({ refreshToken, emailAddress, connectedAt: iso, historyId: "1", watchExpiration: iso });
const calendar = (refreshToken: string): GoogleCalendarState => ({ refreshToken, emailAddress: "me@example.com", connectedAt: iso, calendars: [] });
const fastmail = (token: string): FastmailState => ({ token, accountId: "u1", emailAddress: "me@fastmail.com", connectedAt: iso, emailState: "1" });
const progress = { scanned: 10, imported: 1, done: false, updatedAt: iso };

// A KMS that is down for decryption, as during an outage.
function failingOpens(): Sealer {
  return {
    seal: (plain, context) => sealer.seal(plain, context),
    open: async () => {
      throw Object.assign(new Error("Cloud KMS unavailable"), { code: 503 });
    },
  };
}

describe("a KMS failure", () => {
  it("leaves a parked consent parked, so completing it again works once KMS is back", async () => {
    await savePending(db, "code-1", { uid: "u1", refreshToken: "rt-pending", createdAt: iso });
    const working = sealer;
    useSealer(failingOpens());
    await expect(takePending(db, "code-1", now)).rejects.toThrow("Cloud KMS unavailable");
    useSealer(working);
    expect((await takePending(db, "code-1", now))?.refreshToken).toBe("rt-pending");
    expect(await takePending(db, "code-1", now)).toBeUndefined();
  });

  it("changes no Gmail or Fastmail reading's progress before its token can be read", async () => {
    await saveConnection(db, "u1", gmail("me@example.com", "rt-gmail"));
    await saveFastmailConnection(db, "u1", fastmail("fmu1-token"));
    const working = sealer;
    useSealer(failingOpens());
    await expect(changeBackfill(db, "u1", "me@example.com", () => ({ next: progress, result: "ok" }))).rejects.toThrow("Cloud KMS unavailable");
    await expect(changeFastmailBackfill(db, "u1", () => ({ next: progress, result: "ok" }))).rejects.toThrow("Cloud KMS unavailable");
    useSealer(working);
    expect((await loadMailbox(db, "u1", "me@example.com"))?.backfill).toBeUndefined();
    expect((await loadFastmailState(db, "u1"))?.backfill).toBeUndefined();
  });
});

describe("stored credentials", () => {
  it("keeps Gmail refresh tokens as ciphertext and loads them as given", async () => {
    const saved = await saveConnection(db, "u1", gmail("Me@example.com", "rt-gmail"));
    expect(saved.refreshToken).toBe("rt-gmail");
    const stored = await raw(paths.gmailMailbox("u1", mailboxKey("me@example.com")), "refreshToken");
    expect(typeof stored === "string" && isSealed(stored)).toBe(true);
    expect(stored).not.toContain("rt-gmail");
    // Nor on the user document the apps read.
    expect(JSON.stringify((await db.doc(paths.user("u1")).get()).data())).not.toContain("refreshToken");

    expect((await loadMailboxes(db, "u1")).map((m) => m.refreshToken)).toEqual(["rt-gmail"]);
    expect((await loadMailbox(db, "u1", "me@example.com"))?.refreshToken).toBe("rt-gmail");
    expect((await resolveMailbox(db, "u1"))?.refreshToken).toBe("rt-gmail");
    const changed = await changeBackfill(db, "u1", "me@example.com", () => ({ next: progress, result: "ok" }));
    expect(changed?.state.refreshToken).toBe("rt-gmail");
  });

  it("refuses a Gmail token copied into another user's mailbox", async () => {
    await saveConnection(db, "u1", gmail("me@example.com", "rt-gmail"));
    const copied = await raw(paths.gmailMailbox("u1", mailboxKey("me@example.com")), "refreshToken");
    await db.doc(paths.gmailMailbox("u2", mailboxKey("me@example.com"))).set({ ...gmail("me@example.com", "x"), refreshToken: copied });
    await expect(loadMailboxes(db, "u2")).rejects.toThrow("additional authenticated data");
  });

  it("still reads a mailbox connected before there could be several once it moves", async () => {
    const legacy = gmail("old@example.com", await sealer.seal("rt-old", credentialContext.gmail("u1", "old@example.com")));
    await db.doc(paths.gmailState("u1")).set(legacy);
    expect((await loadMailboxes(db, "u1")).map((m) => m.refreshToken)).toEqual(["rt-old"]);
    expect((await db.doc(paths.gmailState("u1")).get()).exists).toBe(false);
  });

  it("reads tokens stored before sealing as they are", async () => {
    await db.doc(paths.gmailMailbox("u1", mailboxKey("me@example.com"))).set(gmail("me@example.com", "rt-plain"));
    await db.doc(paths.fastmailState("u1")).set(fastmail("fmu1-plain"));
    expect((await loadMailboxes(db, "u1")).map((m) => m.refreshToken)).toEqual(["rt-plain"]);
    expect((await loadFastmailState(db, "u1"))?.token).toBe("fmu1-plain");
  });

  it("keeps the Calendar refresh token as ciphertext", async () => {
    await saveCalendarState(db, "u1", calendar("rt-cal"));
    const stored = await raw(paths.googleCalendarState("u1"), "refreshToken");
    expect(typeof stored === "string" && isSealed(stored)).toBe(true);
    expect((await loadCalendarState(db, "u1"))?.refreshToken).toBe("rt-cal");
  });

  it("keeps parked tokens as ciphertext until redeemed", async () => {
    await savePending(db, "code1", { uid: "u1", refreshToken: "rt-pending", createdAt: iso });
    const stored = await raw(paths.pendingConnection("code1"), "refreshToken");
    expect(typeof stored === "string" && isSealed(stored)).toBe(true);
    expect(await pendingTokens(db, "u1")).toEqual(["rt-pending"]);
    expect((await takePending(db, "code1", now))?.refreshToken).toBe("rt-pending");
  });

  it("keeps the Fastmail token as ciphertext", async () => {
    const saved = await saveFastmailConnection(db, "u1", fastmail("fmu1-secret"));
    expect(saved.token).toBe("fmu1-secret");
    const stored = await raw(paths.fastmailState("u1"), "token");
    expect(typeof stored === "string" && isSealed(stored)).toBe(true);
    expect((await loadFastmailState(db, "u1"))?.token).toBe("fmu1-secret");
    expect((await changeFastmailBackfill(db, "u1", () => ({ next: progress, result: undefined })))?.state.token).toBe("fmu1-secret");
    // Connecting again with a new token replaces it.
    await saveFastmailConnection(db, "u1", fastmail("fmu1-new"));
    expect((await loadFastmailState(db, "u1"))?.token).toBe("fmu1-new");
  });
});

describe("sealStoredCredentials", () => {
  type Logged = { severity: string; event: string; fields: Record<string, unknown> };
  const logger = () => {
    const logged: Logged[] = [];
    return { logged, log: (severity: string, event: string, fields: Record<string, unknown>) => void logged.push({ severity, event, fields }) };
  };

  async function seedPlaintext(uid: string): Promise<void> {
    await db.doc(paths.gmailMailbox(uid, mailboxKey("me@example.com"))).set(gmail("me@example.com", `rt-${uid}`));
    await db.doc(paths.gmailState(uid)).set(gmail("old@example.com", `rt-old-${uid}`));
    await db.doc(paths.googleCalendarState(uid)).set(calendar(`rt-cal-${uid}`));
    await db.doc(paths.fastmailState(uid)).set(fastmail(`fmu1-${uid}`));
  }

  it("seals every plaintext credential, leaves sealed ones and other documents alone, and is idempotent", async () => {
    await seedPlaintext("u1");
    await db.doc(paths.pendingConnection("code1")).set({ uid: "u1", refreshToken: "rt-pending", createdAt: iso });
    await saveConnection(db, "u2", gmail("two@example.com", "rt-two"));
    const alreadySealed = await raw(paths.gmailMailbox("u2", mailboxKey("two@example.com")), "refreshToken");
    // Not a credential, though it has a field of that name.
    await db.doc(paths.importLock("u1")).set({ token: "not-a-credential" });

    const { logged, log } = logger();
    expect(await sealStoredCredentials(db, log)).toEqual({ sealed: 5, changed: 0, failed: 0 });
    expect(logged).toEqual([]);

    for (const [path, field] of [
      [paths.gmailMailbox("u1", mailboxKey("me@example.com")), "refreshToken"],
      [paths.gmailState("u1"), "refreshToken"],
      [paths.googleCalendarState("u1"), "refreshToken"],
      [paths.fastmailState("u1"), "token"],
      [paths.pendingConnection("code1"), "refreshToken"],
    ] as const) {
      const stored = await raw(path, field);
      expect(typeof stored === "string" && isSealed(stored), path).toBe(true);
    }
    expect(await raw(paths.gmailMailbox("u2", mailboxKey("two@example.com")), "refreshToken")).toBe(alreadySealed);
    expect(await raw(paths.importLock("u1"), "token")).toBe("not-a-credential");

    // Each still reads back as it was, the legacy mailbox after its move.
    expect((await loadMailboxes(db, "u1")).map((m) => m.refreshToken).sort()).toEqual(["rt-old-u1", "rt-u1"]);
    expect((await loadCalendarState(db, "u1"))?.refreshToken).toBe("rt-cal-u1");
    expect((await loadFastmailState(db, "u1"))?.token).toBe("fmu1-u1");
    expect((await takePending(db, "code1", now))?.refreshToken).toBe("rt-pending");

    expect(await sealStoredCredentials(db, log)).toEqual({ sealed: 0, changed: 0, failed: 0 });
  });

  it("logs a document it cannot seal, without its credential, and carries on", async () => {
    await seedPlaintext("u1");
    await seedPlaintext("u2");
    useSealer({
      seal: async (plain, context) => {
        if (context === credentialContext.fastmail("u2")) throw Object.assign(new Error(`KMS unavailable for ${plain}`), { code: 503 });
        return sealer.seal(plain, context);
      },
      open: (stored, context) => sealer.open(stored, context),
    });
    const { logged, log } = logger();
    expect(await sealStoredCredentials(db, log)).toEqual({ sealed: 7, changed: 0, failed: 1 });
    expect(logged).toEqual([{ severity: "ERROR", event: "credential_seal_failed", fields: { kind: "fastmail", uid: "u2", error: "Error", code: 503 } }]);
    expect(JSON.stringify(logged)).not.toContain("fmu1-u2");
    expect(await raw(paths.fastmailState("u2"), "token")).toBe("fmu1-u2");
    expect(isSealed(String(await raw(paths.fastmailState("u1"), "token")))).toBe(true);
  });

  it("leaves a credential that changed while it was being sealed", async () => {
    await db.doc(paths.fastmailState("u1")).set(fastmail("fmu1-old"));
    useSealer({
      seal: async (plain, context) => {
        // A new connection lands between the read and the write.
        await db.doc(paths.fastmailState("u1")).update({ token: "fmu1-replaced" });
        return sealer.seal(plain, context);
      },
      open: (stored, context) => sealer.open(stored, context),
    });
    const { log } = logger();
    expect(await sealStoredCredentials(db, log)).toEqual({ sealed: 0, changed: 1, failed: 0 });
    expect(await raw(paths.fastmailState("u1"), "token")).toBe("fmu1-replaced");
  });
});
