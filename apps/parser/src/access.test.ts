import { paths, type Device, type PushSubscription, type ReminderNotification, type Trip } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { approvedUid, gateLinking, gateUser, onlyApproved, settleAccess, type SettleDeps } from "./access";
import { calendarForToken, firestoreExportIo, issueExport } from "./calendarExport";
import { confirmLink, removeLink, requestLink } from "./emails";
import type { Mail } from "./mail";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const iso = "2026-11-23T12:00:00.000Z";
let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++n}`;
const person = (prefix: string) => {
  const uid = unique(prefix);
  return { uid, email: `${uid}@example.com`, email_verified: true };
};

const adminEmail = "admin@example.com";
const adminUid = "admin-uid";

beforeEach(async () => {
  await db.doc(paths.accessConfig()).set({ admins: [adminEmail] });
});

async function seedTrip(ownerUid: string, sharedWith: string[] = []): Promise<void> {
  const id = unique("trip");
  const trip: Trip = { id, title: "Lisbon", start: "2026-12-01", end: "2026-12-03", ownerUid, sharedWith, createdAt: iso, updatedAt: iso };
  await db.doc(paths.trip(id)).set(trip);
}

type Logged = { severity: string; event: string; fields: Record<string, unknown> };

function fakeDeps(overrides: Partial<SettleDeps> = {}, emails: Record<string, string> = {}) {
  const logged: Logged[] = [];
  const sent = { mail: [] as Mail[], push: [] as [PushSubscription, ReminderNotification][], fcm: [] as [Device, ReminderNotification][] };
  const deps: SettleDeps = {
    db,
    now: () => iso,
    origin: "https://travelmo.example",
    log: (severity, event, fields) => void logged.push({ severity, event, fields }),
    channels: {
      mail: async (mail) => void sent.mail.push(mail),
      push: async (subscription, notification) => {
        sent.push.push([subscription, notification]);
        return "sent";
      },
      fcm: async (device, notification) => {
        sent.fcm.push([device, notification]);
        return device.token === "gone-token" ? "gone" : "sent";
      },
    },
    verifiedEmail: async (uid) => emails[uid],
    uidForEmail: async (email) => (email === adminEmail ? adminUid : undefined),
    ...overrides,
  };
  return { deps, logged, sent };
}

// The linking routes (SPEC "Linked email addresses") take an account not
// approved yet, so it can link the address it was invited at.
describe("gateLinking", () => {
  it("takes an approved account, and one waiting, but not one declined or deleted", async () => {
    const [approved, waiting, declined, deleted] = [person("approved"), person("waiting"), person("declined"), person("deleted")];
    await db.doc(paths.user(approved.uid)).set({ email: approved.email });
    await db.doc(paths.access(waiting.email)).set({ email: waiting.email, status: "requested", uid: waiting.uid, requestedAt: iso });
    await db.doc(paths.access(declined.email)).set({ email: declined.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    await db.doc(paths.deletedAccount(deleted.uid)).set({ uid: deleted.uid, requestedAt: iso });
    expect(await gateLinking(db, approved)).toBe("ok");
    expect(await gateLinking(db, waiting)).toBe("waiting");
    expect(await gateLinking(db, person("never-asked"))).toBe("waiting");
    expect(await gateLinking(db, declined)).toBe("declined");
    expect(await gateLinking(db, deleted)).toBe("deleted");
  });

  it("lets a waiting account link an admin's address, which lets it in", async () => {
    const me = person("waiting-admin");
    const mails: Mail[] = [];
    const deps = {
      db,
      mail: async (mail: Mail) => void mails.push(mail),
      origin: "https://travelmo.example",
      now: () => iso,
      log: () => {},
      signInOwner: async () => undefined,
    };
    expect(await gateLinking(db, me)).toBe("waiting");
    await requestLink(deps, me.uid, me.email, adminEmail, false);
    expect((await db.doc(paths.user(me.uid)).get()).exists).toBe(false);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mails[0]!.text)![1]!);
    expect(await confirmLink(deps, me.uid, token, false)).toEqual({ email: adminEmail });
    expect(await gateUser(db, me)).toBe("ok");
    // The claim is given back, so other tests may link the address.
    await removeLink(deps, me.uid, adminEmail);
  });
});

describe("gateUser", () => {
  it("lets in an admin listed by an address they linked, whatever their sign-in's record says", async () => {
    const admin = person("linked-admin");
    await db.doc(paths.user(admin.uid)).set({ emails: [adminEmail] });
    await db.doc(paths.emailLinks(admin.uid)).set({ pending: [], confirmed: [adminEmail] });
    await db.doc(paths.access(admin.email)).set({ email: admin.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    expect(await gateUser(db, admin)).toBe("ok");
    // A linked address's approval does not undo the sign-in's decline.
    const other = person("linked");
    const work = `${unique("work")}@company.example`;
    await db.doc(paths.user(other.uid)).set({ emails: [work] });
    await db.doc(paths.emailLinks(other.uid)).set({ pending: [], confirmed: [work] });
    await db.doc(paths.access(work)).set({ email: work, status: "approved", approvedBy: adminUid, approvedAt: iso });
    await db.doc(paths.access(other.email)).set({ email: other.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    expect(await gateUser(db, other)).toBe("unapproved");
  });

  it("trusts only the addresses the parser confirmed, not a list a client wrote on its profile", async () => {
    // The rules before linked addresses let a client write any field of its
    // own user document, `emails` included.
    const planter = person("planter");
    await db.doc(paths.user(planter.uid)).set({ emails: [adminEmail] });
    await db.doc(paths.access(planter.email)).set({ email: planter.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    expect(await gateUser(db, planter)).toBe("unapproved");
    // Nor Gmail mailboxes written there.
    await db.doc(paths.user(planter.uid)).set({ gmails: { [adminEmail]: { emailAddress: adminEmail, connectedAt: iso } } });
    expect(await gateUser(db, planter)).toBe("unapproved");
  });

  it("lets in an account from before approvals and keeps out a new one", async () => {
    const old = person("old");
    await db.doc(paths.user(old.uid)).set({ email: old.email });
    expect(await gateUser(db, old)).toBe("ok");
    expect(await gateUser(db, person("new"))).toBe("unapproved");
  });

  it("lets in an approved or invited address and an admin, and refuses a declined one", async () => {
    const approved = person("approved");
    await db.doc(paths.access(approved.email)).set({ email: approved.email, status: "approved", approvedBy: adminUid, approvedAt: iso });
    expect(await gateUser(db, approved)).toBe("ok");
    const invited = person("invited");
    await db.doc(paths.access(invited.email)).set({ email: invited.email, invitedBy: "friend", invitedAt: iso });
    expect(await gateUser(db, invited)).toBe("ok");
    expect(await gateUser(db, { uid: unique("admin"), email: "Admin@Example.com", email_verified: true })).toBe("ok");
    const revoked = person("revoked");
    await db.doc(paths.user(revoked.uid)).set({ email: revoked.email });
    await db.doc(paths.access(revoked.email)).set({ email: revoked.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    expect(await gateUser(db, revoked)).toBe("unapproved");
  });

  it("trusts a record only for an address Google verified", async () => {
    const unverified = person("unverified");
    await db.doc(paths.access(unverified.email)).set({ email: unverified.email, status: "approved", approvedBy: adminUid, approvedAt: iso });
    expect(await gateUser(db, { ...unverified, email_verified: false })).toBe("unapproved");
  });

  it("says a deleted account is deleted, before anything else", async () => {
    const gone = person("gone");
    await db.doc(paths.user(gone.uid)).set({ email: gone.email });
    await db.doc(paths.deletedAccount(gone.uid)).set({ uid: gone.uid, at: iso });
    expect(await gateUser(db, gone)).toBe("deleted");
  });
});

describe("approvedUid", () => {
  it("looks the address up for work done with no token at hand", async () => {
    const revoked = person("revoked");
    await db.doc(paths.user(revoked.uid)).set({ email: revoked.email });
    expect(await approvedUid(db, revoked.uid, async () => revoked.email)).toBe(true);
    await db.doc(paths.access(revoked.email)).set({ email: revoked.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    expect(await approvedUid(db, revoked.uid, async () => revoked.email)).toBe(false);
  });
});

describe("onlyApproved", () => {
  it("keeps the approved people's items in order, asking once per person", async () => {
    const asked: string[] = [];
    const kept = await onlyApproved(
      [{ uid: "a", n: 1 }, { uid: "b", n: 2 }, { uid: "a", n: 3 }],
      async (uid) => {
        asked.push(uid);
        return uid === "a";
      },
    );
    expect(kept.map((item) => item.n)).toEqual([1, 3]);
    expect(asked).toEqual(["a", "b"]);
  });

  it("leaves out someone whose approval cannot be looked up, and keeps going for the rest", async () => {
    const logged: Logged[] = [];
    const kept = await onlyApproved(
      [{ uid: "a" }, { uid: "gone" }, { uid: "b" }, { uid: "gone" }],
      async (uid) => {
        if (uid === "gone") throw Object.assign(new Error("There is no user record"), { code: "auth/user-not-found" });
        return true;
      },
      (severity, event, fields) => void logged.push({ severity, event, fields }),
    );
    expect(kept.map((item) => item.uid)).toEqual(["a", "b"]);
    expect(logged).toEqual([{ severity: "ERROR", event: "approval_check_failed", fields: { uid: "gone", error: "There is no user record" } }]);
  });
});

describe("the calendar link", () => {
  const options = { now: iso, tripUrl: (id: string) => `https://travelmo.example/trips/${id}` };
  const exportIo = (emails: Record<string, string>) => {
    const verifiedEmail = async (uid: string) => emails[uid];
    return firestoreExportIo(db, async (uid) => (emails[uid] ? [emails[uid]] : []), (uid) => approvedUid(db, uid, verifiedEmail));
  };

  it("serves an approved owner's trips and nothing once their access is revoked", async () => {
    const owner = person("owner");
    await db.doc(paths.user(owner.uid)).set({ email: owner.email });
    await seedTrip(owner.uid);
    const { token } = await issueExport(db, owner.uid, iso);
    const io = exportIo({ [owner.uid]: owner.email });
    expect(await calendarForToken(token, io, options)).toContain("SUMMARY:Lisbon");

    await db.doc(paths.access(owner.email)).set({ email: owner.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    expect(await calendarForToken(token, io, options)).toBeUndefined();
  });
});

describe("settleAccess", () => {
  it("lets in an account that owns a trip, made before approvals with no user document", async () => {
    const owner = person("owner");
    await seedTrip(owner.uid);
    const { deps, sent } = fakeDeps();
    expect(await settleAccess(deps, owner)).toBe("approved");
    expect((await db.doc(paths.access(owner.email)).get()).data()).toMatchObject({ status: "approved", approvedBy: owner.uid, uid: owner.uid });
    expect(await gateUser(db, owner)).toBe("ok");
    expect(sent.mail).toEqual([]);
  });

  it("lets in someone an approved user shared with before invites, naming the sharer", async () => {
    const sharer = person("sharer");
    await db.doc(paths.user(sharer.uid)).set({ email: sharer.email });
    const friend = person("friend");
    await seedTrip(sharer.uid, [friend.email]);
    const { deps } = fakeDeps({}, { [sharer.uid]: sharer.email });
    expect(await settleAccess(deps, friend)).toBe("approved");
    expect((await db.doc(paths.access(friend.email)).get()).data()).toMatchObject({ invitedBy: sharer.uid });
  });

  it("lets in someone trusted with an approved user's travel profile", async () => {
    const sharer = person("sharer");
    await db.doc(paths.user(sharer.uid)).set({ email: sharer.email });
    const friend = person("friend");
    await db.doc(paths.travelProfile(sharer.uid)).set({ ownerUid: sharer.uid, trustedEmails: [friend.email] });
    const { deps } = fakeDeps({}, { [sharer.uid]: sharer.email });
    expect(await settleAccess(deps, friend)).toBe("approved");
  });

  it("does not count a share by someone who may not use the app", async () => {
    const sharer = person("sharer");
    await db.doc(paths.user(sharer.uid)).set({ email: sharer.email });
    await db.doc(paths.access(sharer.email)).set({ email: sharer.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    const friend = person("friend");
    await seedTrip(sharer.uid, [friend.email]);
    const { deps } = fakeDeps({}, { [sharer.uid]: sharer.email });
    expect(await settleAccess(deps, friend)).toBe("none");
    expect((await db.doc(paths.access(friend.email)).get()).exists).toBe(false);
  });

  it("leaves a decline alone, even for an account that owns trips", async () => {
    const owner = person("owner");
    await seedTrip(owner.uid);
    await db.doc(paths.access(owner.email)).set({ email: owner.email, status: "declined", declinedBy: adminUid, declinedAt: iso });
    const { deps } = fakeDeps();
    expect(await settleAccess(deps, owner)).toBe("declined");
    expect((await db.doc(paths.access(owner.email)).get()).get("status")).toBe("declined");
  });

  it("tells nobody about an account that has not asked", async () => {
    const { deps, sent } = fakeDeps();
    expect(await settleAccess(deps, person("quiet"))).toBe("none");
    expect(sent.mail).toEqual([]);
  });

  it("tells each admin of a request once, by email and on their browsers and phones", async () => {
    const asker = person("asker");
    await db.doc(paths.access(asker.email)).set({ email: asker.email, status: "requested", uid: asker.uid, requestedAt: iso });
    const subscription = { endpoint: "https://push.example/s/1", keys: { p256dh: "p", auth: "a" }, createdAt: iso };
    await db.doc(paths.pushSubscription(adminUid, "s1")).set(subscription);
    await db.doc(paths.device(adminUid, "d1")).set({ token: "phone-token", platform: "android", createdAt: iso });
    await db.doc(paths.device(adminUid, "d2")).set({ token: "gone-token", platform: "android", createdAt: iso });
    const { deps, sent, logged } = fakeDeps();

    expect(await settleAccess(deps, asker)).toBe("requested");
    expect(sent.mail).toEqual([
      {
        to: adminEmail,
        subject: "Travelmo access request",
        text: `${asker.email} asked to use Travelmo.\n\nApprove or decline: https://travelmo.example/access\n`,
      },
    ]);
    const notification = { title: "Access request", body: `${asker.email} asked to use Travelmo.`, url: "https://travelmo.example/access", tag: `access-${asker.email}` };
    expect(sent.push).toEqual([[subscription, notification]]);
    expect(sent.fcm.map(([device]) => device.token).sort()).toEqual(["gone-token", "phone-token"]);
    expect((await db.doc(paths.device(adminUid, "d2")).get()).exists).toBe(false);
    expect((await db.doc(paths.access(asker.email)).get()).get("notifiedAt")).toBe(iso);
    // No address in the logs: the requester by uid, admins by position.
    expect(JSON.stringify(logged)).not.toContain("@");

    expect(await settleAccess(deps, asker)).toBe("requested");
    expect(sent.mail).toHaveLength(1);
    expect(sent.push).toHaveLength(1);
  });

  it("tries again later when there is no admin to tell yet", async () => {
    const asker = person("asker");
    await db.doc(paths.access(asker.email)).set({ email: asker.email, status: "requested", uid: asker.uid, requestedAt: iso });
    await db.doc(paths.accessConfig()).delete();
    const none = fakeDeps();
    expect(await settleAccess(none.deps, asker)).toBe("requested");
    expect(none.logged.map((l) => l.event)).toContain("access_request_no_admins");
    expect((await db.doc(paths.access(asker.email)).get()).get("notifiedAt")).toBeUndefined();

    await db.doc(paths.accessConfig()).set({ admins: [adminEmail] });
    const working = fakeDeps();
    await settleAccess(working.deps, asker);
    expect(working.sent.mail).toHaveLength(1);
    expect((await db.doc(paths.access(asker.email)).get()).get("notifiedAt")).toBe(iso);
  });

  it("tries again later when there is no way to reach the admins yet", async () => {
    const asker = person("asker");
    await db.doc(paths.access(asker.email)).set({ email: asker.email, status: "requested", uid: asker.uid, requestedAt: iso });
    const silent = fakeDeps({ channels: {} });
    expect(await settleAccess(silent.deps, asker)).toBe("requested");
    expect(silent.logged.find((l) => l.event === "access_request_notified")?.fields).toMatchObject({ admins: 1, delivered: 0, failed: 0 });
    expect((await db.doc(paths.access(asker.email)).get()).get("notifiedAt")).toBeUndefined();

    const working = fakeDeps();
    await settleAccess(working.deps, asker);
    expect(working.sent.mail).toHaveLength(1);
  });

  it("tries again later when nothing reached any admin", async () => {
    const asker = person("asker");
    await db.doc(paths.access(asker.email)).set({ email: asker.email, status: "requested", uid: asker.uid, requestedAt: iso });
    const broken = fakeDeps({
      channels: {
        mail: async () => {
          throw new Error("SMTP refused");
        },
      },
    });
    expect(await settleAccess(broken.deps, asker)).toBe("requested");
    expect(broken.logged.map((l) => l.event)).toContain("access_notify_mail_failed");
    expect((await db.doc(paths.access(asker.email)).get()).get("notifiedAt")).toBeUndefined();

    const working = fakeDeps();
    await settleAccess(working.deps, asker);
    expect(working.sent.mail).toHaveLength(1);
  });
});
