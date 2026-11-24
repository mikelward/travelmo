import { paths } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { gateUser } from "./access";
import { MailboxConflict, removeConnection, saveConnection } from "./connections";
import { addressesOf, confirmLink, LinkRefused, removeLink, requestLink, uidForAddress, type EmailDeps } from "./emails";
import type { Mail } from "./mail";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const now = "2026-11-23T10:00:00.000Z";
let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++n}`;

function setup(over: Partial<EmailDeps> & { signIns?: Record<string, string> } = {}) {
  const mails: Mail[] = [];
  const logged: string[] = [];
  let clock = now;
  const deps: EmailDeps = {
    db,
    mail: async (mail) => void mails.push(mail),
    origin: "https://travelmo.example",
    now: () => clock,
    log: (_severity, event) => void logged.push(event),
    signInOwner: async (email) => over.signIns?.[email],
    ...over,
  };
  const tokenOf = (mail: Mail) => decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
  return { deps, mails, logged, tokenOf, later: (iso: string) => void (clock = iso) };
}

async function person() {
  const uid = unique("u");
  await db.doc(paths.user(uid)).set({ email: `${uid}@example.com` });
  return { uid, email: `${uid}@example.com` };
}

const user = async (uid: string) => (await db.doc(paths.user(uid)).get()).data() ?? {};
const claim = async (email: string) => (await db.doc(paths.linkedEmail(email)).get()).get("uid");
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => "linked",
    (error: unknown) => (error instanceof LinkRefused ? error.refusal : `error: ${(error as Error).message}`),
  );

describe("linking an address", () => {
  it("mails a link that, opened by the account that asked, links the address", async () => {
    const me = await person();
    const work = `${unique("work")}@company.example`;
    const { deps, mails, tokenOf, logged } = setup();

    expect(await requestLink(deps, me.uid, me.email, ` ${work.toUpperCase()} `)).toEqual({ email: work });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(work);
    expect(mails[0]!.text).toContain("https://travelmo.example/settings/email?token=");
    // Settings shows it as waiting; only the token's hash is kept.
    expect((await user(me.uid)).pendingEmails).toEqual([{ email: work, sentAt: now, expiresAt: "2026-11-24T10:00:00.000Z" }]);
    const token = tokenOf(mails[0]!);
    expect(JSON.stringify((await db.doc(paths.emailLinks(me.uid)).get()).data())).not.toContain(token);
    expect((await user(me.uid)).emails).toEqual([]);

    expect(await confirmLink(deps, me.uid, token)).toEqual({ email: work });
    expect((await user(me.uid)).emails).toEqual([work]);
    expect((await user(me.uid)).pendingEmails).toEqual([]);
    expect(await claim(work)).toBe(me.uid);
    expect(await addressesOf(db, me.uid, async () => me.email)).toEqual([me.email, work]);
    // A link works once.
    expect(await refusal(confirmLink(deps, me.uid, token))).toBe("expired");
    // The logs name the account, never the address.
    expect(logged).toEqual(["email_link_sent", "email_linked", "email_link_unknown"]);
  });

  it("refuses a link opened by another account, or after a day", async () => {
    const [me, other] = [await person(), await person()];
    const work = `${unique("work")}@company.example`;
    const { deps, mails, tokenOf, later } = setup();
    await requestLink(deps, me.uid, me.email, work);
    const token = tokenOf(mails[0]!);
    expect(await refusal(confirmLink(deps, other.uid, token))).toBe("expired");
    expect(await claim(work)).toBeUndefined();
    later("2026-11-24T10:00:01.000Z");
    expect(await refusal(confirmLink(deps, me.uid, token))).toBe("expired");
    expect((await user(me.uid)).emails).toEqual([]);
  });

  it("refuses an address that is already the account's, or another account's", async () => {
    const [me, other] = [await person(), await person()];
    const work = `${unique("work")}@company.example`;
    const taken = `${unique("taken")}@company.example`;
    const mailbox = `${unique("mailbox")}@example.net`;
    await db.doc(paths.linkedEmail(taken)).set({ uid: other.uid, linkedAt: now });
    await saveConnection(db, other.uid, { refreshToken: "rt", emailAddress: mailbox, connectedAt: now, historyId: "1", watchExpiration: now });
    const { deps, mails } = setup({ signIns: { [other.email]: other.uid } });
    expect(await refusal(requestLink(deps, me.uid, me.email, me.email))).toBe("yours");
    expect(await refusal(requestLink(deps, me.uid, me.email, "not an address"))).toBe("invalid");
    expect(await refusal(requestLink(deps, me.uid, me.email, other.email))).toBe("taken");
    expect(await refusal(requestLink(deps, me.uid, me.email, taken))).toBe("taken");
    expect(await refusal(requestLink(deps, me.uid, me.email, mailbox))).toBe("taken");
    expect(mails).toHaveLength(0);
    // Linked once, it is already the account's.
    await db.doc(paths.emailLinks(me.uid)).set({ pending: [], confirmed: [work] }, { merge: true });
    expect(await refusal(requestLink(deps, me.uid, me.email, work))).toBe("yours");
  });

  it("refuses to confirm an address another account linked meanwhile, and withdraws the link", async () => {
    const [me, other] = [await person(), await person()];
    const work = `${unique("work")}@company.example`;
    const { deps, mails, tokenOf } = setup();
    await requestLink(deps, me.uid, me.email, work);
    await db.doc(paths.linkedEmail(work)).set({ uid: other.uid, linkedAt: now });
    expect(await refusal(confirmLink(deps, me.uid, tokenOf(mails[0]!)))).toBe("taken");
    expect(await claim(work)).toBe(other.uid);
    expect((await user(me.uid)).emails).toEqual([]);
    expect((await user(me.uid)).pendingEmails).toEqual([]);
  });

  it("sends a few links a day", async () => {
    const me = await person();
    const { deps, mails, later } = setup();
    for (let i = 0; i < 5; i++) await requestLink(deps, me.uid, me.email, `${unique("a")}@company.example`);
    expect(await refusal(requestLink(deps, me.uid, me.email, `${unique("a")}@company.example`))).toBe("limit");
    expect(mails).toHaveLength(5);
    later("2026-11-24T00:00:00.000Z");
    expect(await refusal(requestLink(deps, me.uid, me.email, `${unique("a")}@company.example`))).toBe("linked");
  });

  it("withdraws a link that could not be mailed", async () => {
    const me = await person();
    const { deps } = setup({
      mail: async () => {
        throw new Error("smtp down");
      },
    });
    expect(await refusal(requestLink(deps, me.uid, me.email, `${unique("a")}@company.example`))).toBe("error: smtp down");
    expect((await user(me.uid)).pendingEmails).toEqual([]);
  });

  it("counts only the addresses it confirmed, not a list a client wrote on its profile", async () => {
    const planter = await person();
    await db.doc(paths.user(planter.uid)).set({ emails: ["victim@example.com"] }, { merge: true });
    expect(await addressesOf(db, planter.uid, async () => planter.email)).toEqual([planter.email]);
    // The parser's next write puts the profile's list right.
    const { deps } = setup();
    await requestLink(deps, planter.uid, planter.email, `${unique("a")}@company.example`);
    expect((await user(planter.uid)).emails).toEqual([]);
  });

  it("withdraws only the link whose mail failed, not a newer one that went", async () => {
    const me = await person();
    const work = `${unique("work")}@company.example`;
    let fail: (() => void) | undefined;
    const sent: Mail[] = [];
    const { deps, tokenOf } = setup({
      mail: (mail) =>
        sent.length || fail
          ? Promise.resolve(void sent.push(mail))
          : new Promise((_, reject) => {
              fail = () => reject(new Error("smtp timed out"));
            }),
    });
    const first = refusal(requestLink(deps, me.uid, me.email, work));
    // The request reaches the mail only after its emulator round trips,
    // which a busy CI machine can take seconds over.
    await expect.poll(() => fail, { timeout: 15_000 }).toBeDefined();
    await requestLink(deps, me.uid, me.email, work);
    fail!();
    expect(await first).toBe("error: smtp timed out");
    await confirmLink(deps, me.uid, tokenOf(sent[0]!));
    expect((await user(me.uid)).emails).toEqual([work]);
  });

  it("removes a linked address and its claim, or a pending one", async () => {
    const me = await person();
    const [work, next] = [`${unique("work")}@company.example`, `${unique("next")}@company.example`];
    const { deps, mails, tokenOf } = setup();
    await requestLink(deps, me.uid, me.email, work);
    await confirmLink(deps, me.uid, tokenOf(mails[0]!));
    await requestLink(deps, me.uid, me.email, next);
    await removeLink(deps, me.uid, work.toUpperCase());
    await removeLink(deps, me.uid, next);
    expect(await claim(work)).toBeUndefined();
    expect((await user(me.uid)).emails).toEqual([]);
    expect((await user(me.uid)).pendingEmails).toEqual([]);
    expect(await refusal(confirmLink(deps, me.uid, tokenOf(mails[1]!)))).toBe("expired");
  });

  it("leaves another account's claim alone when removing", async () => {
    const [me, other] = [await person(), await person()];
    const work = `${unique("work")}@company.example`;
    await db.doc(paths.linkedEmail(work)).set({ uid: other.uid, linkedAt: now });
    await removeLink(setup().deps, me.uid, work);
    expect(await claim(work)).toBe(other.uid);
  });
});

// SPEC "Linked email addresses": someone invited at one address who signs
// in with another links the invited one from the invite-only page.
describe("linking from an account not approved yet", () => {
  // No user document: its existence would approve the account.
  const waiting = () => {
    const uid = unique("waiting");
    return { uid, email: `${uid}@example.com` };
  };
  const token = (who: { uid: string; email: string }) => ({ uid: who.uid, email: who.email, email_verified: true });
  const invite = (email: string) => db.doc(paths.access(email)).set({ email, invitedBy: "someone", invitedAt: now });

  it("links an address it was invited at, which lets it in", async () => {
    const me = waiting();
    const work = `${unique("work")}@company.example`;
    await invite(work);
    const { deps, mails, tokenOf } = setup();

    expect(await requestLink(deps, me.uid, me.email, work, false)).toEqual({ email: work });
    expect(mails.map((m) => m.to)).toEqual([work]);
    // Asking creates no user document, so the account is still waiting.
    expect((await db.doc(paths.user(me.uid)).get()).exists).toBe(false);
    expect(await gateUser(db, token(me))).toBe("unapproved");

    expect(await confirmLink(deps, me.uid, tokenOf(mails[0]!), false)).toEqual({ email: work });
    expect((await user(me.uid)).emails).toEqual([work]);
    expect(await claim(work)).toBe(me.uid);
    expect(await gateUser(db, token(me))).toBe("ok");
  });

  it("refuses, without mailing, an address no one invited", async () => {
    const me = waiting();
    const asked = `${unique("asked")}@company.example`;
    const declined = `${unique("declined")}@company.example`;
    await db.doc(paths.access(asked)).set({ email: asked, status: "requested", requestedAt: now });
    await db.doc(paths.access(declined)).set({ email: declined, invitedBy: "someone", status: "declined", declinedBy: "admin", declinedAt: now });
    const { deps, mails } = setup();
    for (const email of [`${unique("stranger")}@company.example`, asked, declined]) {
      expect(await refusal(requestLink(deps, me.uid, me.email, email, false))).toBe("notInvited");
    }
    expect(mails).toHaveLength(0);
    expect((await db.doc(paths.user(me.uid)).get()).exists).toBe(false);
    expect((await db.doc(paths.emailLinks(me.uid)).get()).exists).toBe(false);
  });

  it("refuses an address no one invited before telling whether another account has it", async () => {
    const [me, other] = [waiting(), await person()];
    const { deps } = setup({ signIns: { [other.email]: other.uid } });
    expect(await refusal(requestLink(deps, me.uid, me.email, other.email, false))).toBe("notInvited");
  });

  it("refuses to confirm an address whose invite was declined meanwhile, and withdraws the link", async () => {
    const me = waiting();
    const work = `${unique("work")}@company.example`;
    await invite(work);
    const { deps, mails, tokenOf } = setup();
    await requestLink(deps, me.uid, me.email, work, false);
    await db.doc(paths.access(work)).set({ status: "declined", declinedBy: "admin", declinedAt: now }, { merge: true });

    expect(await refusal(confirmLink(deps, me.uid, tokenOf(mails[0]!), false))).toBe("notInvited");
    expect(await claim(work)).toBeUndefined();
    expect((await db.doc(paths.user(me.uid)).get()).exists).toBe(false);
    expect((await db.doc(paths.emailLinks(me.uid)).get()).get("pending")).toEqual([]);
    expect(await gateUser(db, token(me))).toBe("unapproved");
  });

  it("withdraws a link that could not be mailed without creating a user document", async () => {
    const me = waiting();
    const work = `${unique("work")}@company.example`;
    await invite(work);
    const { deps } = setup({
      mail: async () => {
        throw new Error("smtp down");
      },
    });
    expect(await refusal(requestLink(deps, me.uid, me.email, work, false))).toBe("error: smtp down");
    expect((await db.doc(paths.user(me.uid)).get()).exists).toBe(false);
    expect((await db.doc(paths.emailLinks(me.uid)).get()).get("pending")).toEqual([]);
  });

  it("lets an approved account link any address, as before", async () => {
    const me = await person();
    const { deps } = setup();
    expect(await refusal(requestLink(deps, me.uid, me.email, `${unique("anyone")}@company.example`, true))).toBe("linked");
  });
});

describe("whose an address is", () => {
  it("is the account signing in with it, else the one that linked it or connected it as Gmail", async () => {
    const [signedIn, linker, connector] = [await person(), await person(), await person()];
    const work = `${unique("work")}@company.example`;
    const mailbox = `${unique("mailbox")}@example.net`;
    await db.doc(paths.linkedEmail(work)).set({ uid: linker.uid, linkedAt: now });
    await saveConnection(db, connector.uid, { refreshToken: "rt", emailAddress: mailbox, connectedAt: now, historyId: "1", watchExpiration: now });
    const uidFor = uidForAddress(db, async (email) => (email === signedIn.email ? signedIn.uid : undefined));
    expect(await uidFor(signedIn.email)).toBe(signedIn.uid);
    expect(await uidFor(work.toUpperCase())).toBe(linker.uid);
    expect(await uidFor(mailbox)).toBe(connector.uid);
    expect(await uidFor(`${unique("nobody")}@example.com`)).toBeUndefined();
    // The connected Gmail counts among the account's addresses.
    expect(await addressesOf(db, connector.uid, async () => connector.email)).toEqual([connector.email, mailbox]);
  });

  it("counts every connected mailbox while it stays connected, and one connected before there could be several", async () => {
    const me = await person();
    const [first, second] = [`${unique("a-first")}@example.net`, `${unique("b-second")}@example.org`];
    await saveConnection(db, me.uid, { refreshToken: "rt1", emailAddress: first, connectedAt: now });
    await saveConnection(db, me.uid, { refreshToken: "rt2", emailAddress: second, connectedAt: now });
    expect(await addressesOf(db, me.uid, async () => me.email)).toEqual([me.email, first, second]);
    const uidFor = uidForAddress(db, async () => undefined);
    expect(await uidFor(second)).toBe(me.uid);
    const { deps } = setup();
    expect(await refusal(requestLink(deps, me.uid, me.email, second))).toBe("yours");
    await removeConnection(db, me.uid, second);
    expect(await addressesOf(db, me.uid, async () => me.email)).toEqual([me.email, first]);
    expect(await uidFor(second)).toBeUndefined();
    // Not moved yet: still the account's.
    const old = await person();
    const legacy = `${unique("legacy")}@example.net`;
    await db.doc(paths.user(old.uid)).set({ gmail: { emailAddress: legacy, connectedAt: now } }, { merge: true });
    expect(await addressesOf(db, old.uid, async () => old.email)).toEqual([old.email, legacy]);
  });

  it("never counts mailboxes a client wrote on its profile before the rules locked them", async () => {
    const planter = await person();
    const victim = `${unique("victim")}@example.com`;
    await db.doc(paths.user(planter.uid)).set({ gmails: { [victim]: { emailAddress: victim, connectedAt: now } } }, { merge: true });
    expect(await addressesOf(db, planter.uid, async () => planter.email)).toEqual([planter.email]);
  });

  it("refuses connecting as Gmail a mailbox whose address another account linked", async () => {
    const [me, other] = [await person(), await person()];
    const work = `${unique("work")}@company.example`;
    await db.doc(paths.linkedEmail(work)).set({ uid: other.uid, linkedAt: now });
    await expect(
      saveConnection(db, me.uid, { refreshToken: "rt", emailAddress: work, connectedAt: now, historyId: "1", watchExpiration: now }),
    ).rejects.toBeInstanceOf(MailboxConflict);
  });
});
