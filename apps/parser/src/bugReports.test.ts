import { checkBugReport, paths, type BugReport } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { AccountDeletedError } from "./deleted";
import { isPng, sendBugReport, type BugReportDeps } from "./bugReports";
import type { Mail } from "./mail";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

let n = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++n}`;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup(over: Partial<BugReportDeps> = {}) {
  const mails: Mail[] = [];
  const logged: { severity: string; event: string; fields: Record<string, unknown> }[] = [];
  let clock = "2026-11-24T10:00:00.000Z";
  const deps: BugReportDeps = {
    db,
    mail: async (mail) => void mails.push(mail),
    to: "maintainer@example.com",
    now: () => clock,
    newId: () => unique("r"),
    log: (severity, event, fields) => void logged.push({ severity, event, fields }),
    ...over,
  };
  return { deps, mails, logged, later: (iso: string) => void (clock = iso) };
}

function checked(body: unknown): BugReport {
  const result = checkBugReport(body);
  if (!result.ok) throw new Error(result.reason);
  return result.report;
}

// An invented trip, as the trip page holds it.
const trip = {
  id: "t1",
  title: "Liverpool",
  bookings: [
    {
      type: "hotel",
      title: "Cove Paradise Street",
      confirmation: "CV123",
      start: "2027-01-08T15:00:00+00:00",
      destination: { name: "Cove Paradise Street", address: "39 Paradise Street, Liverpool L1 3ED", city: "Liverpool", country: "GB", lat: 53.4, lon: -2.98 },
    },
  ],
};

describe("sendBugReport", () => {
  it("emails the report to the maintainer, replying to the reporter, with the screenshot and bookings attached", async () => {
    const { deps, mails, logged } = setup();
    const uid = unique("u");
    const report = checked({ text: "The hotel is in the wrong city", log: "Travelmo 1.0\nline", page: "TripDetail", app: "android", version: "1.0 (40)", trip });
    const sent = await sendBugReport(deps, uid, "traveler@example.com", report, png);

    expect(sent.status).toBe("sent");
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail!.to).toBe("maintainer@example.com");
    expect(mail!.replyTo).toBe("traveler@example.com");
    expect(mail!.subject).toBe("Travelmo bug report from traveler@example.com");
    expect(mail!.text).toContain("The hotel is in the wrong city");
    expect(mail!.text).toContain("Page: TripDetail");
    expect(mail!.text).toContain("App: Android 1.0 (40)");
    expect(mail!.text).toContain("Destination: Cove Paradise Street, 39 Paradise Street, Liverpool L1 3ED · Liverpool, GB · 53.4,-2.98");
    expect(mail!.text).toContain("Confirmation: CV123");
    expect(mail!.text).toContain("--- Debug log ---\nTravelmo 1.0\nline");
    expect(mail!.attachments?.map((a) => [a.filename, a.contentType])).toEqual([
      ["screenshot.png", "image/png"],
      ["trip.json", "application/json"],
    ]);
    expect(mail!.attachments![0]!.content).toEqual(png);
    expect(JSON.parse(new TextDecoder().decode(mail!.attachments![1]!.content))).toEqual(trip);

    // The copy keeps what was written and sizes, never the log, screenshot or bookings.
    const id = sent.status === "sent" ? sent.id : "";
    const copy = (await db.doc(paths.bugReport(id)).get()).data();
    expect(copy).toEqual({
      id,
      uid,
      at: "2026-11-24T10:00:00.000Z",
      app: "android",
      page: "TripDetail",
      version: "1.0 (40)",
      text: "The hotel is in the wrong city",
      logChars: report.log!.length,
      hasScreenshot: true,
      tripBookings: 1,
    });
    // The logs carry ids and sizes, never what was written or the bookings.
    const shown = JSON.stringify(logged);
    expect(shown).not.toContain("wrong city");
    expect(shown).not.toContain("CV123");
    expect(shown).not.toContain("traveler@example.com");
    expect(logged.map((l) => l.event)).toEqual(["bug_report_sent"]);
  });

  it("names the account and sets no reply address without a verified one", async () => {
    const { deps, mails } = setup();
    const uid = unique("u");
    await sendBugReport(deps, uid, undefined, checked({ text: "Hi", app: "web", userAgent: "Mozilla/5.0" }), undefined);
    expect(mails[0]!.subject).toBe(`Travelmo bug report from account ${uid}`);
    expect(mails[0]!.replyTo).toBeUndefined();
    expect(mails[0]!.attachments).toBeUndefined();
    expect(mails[0]!.text).toContain("Browser: Mozilla/5.0");
  });

  it("stops at the day's limit and starts again the next day", async () => {
    const { deps, mails, later } = setup({ limit: 2 });
    const uid = unique("u");
    const report = checked({ text: "Again", app: "web" });
    expect((await sendBugReport(deps, uid, undefined, report, undefined)).status).toBe("sent");
    expect((await sendBugReport(deps, uid, undefined, report, undefined)).status).toBe("sent");
    expect((await sendBugReport(deps, uid, undefined, report, undefined)).status).toBe("limit");
    expect(mails).toHaveLength(2);
    // Another account has its own count.
    expect((await sendBugReport(deps, unique("u"), undefined, report, undefined)).status).toBe("sent");
    later("2026-11-25T00:00:01.000Z");
    expect((await sendBugReport(deps, uid, undefined, report, undefined)).status).toBe("sent");
  });

  it("keeps the copy when the email fails, and logs which report it was", async () => {
    const { deps, logged } = setup({
      mail: async () => {
        throw new Error("SMTP refused traveler@example.com");
      },
    });
    const sent = await sendBugReport(deps, unique("u"), "traveler@example.com", checked({ text: "Hi", app: "web" }), undefined);
    expect(sent.status).toBe("mail_failed");
    const id = sent.status === "mail_failed" ? sent.id : "";
    expect((await db.doc(paths.bugReport(id)).get()).exists).toBe(true);
    expect(logged.map((l) => [l.severity, l.event, l.fields.id])).toEqual([["ERROR", "bug_report_mail_failed", id]]);
    expect(JSON.stringify(logged)).not.toContain("traveler@example.com");
  });

  it("refuses a deleted account without keeping or sending anything", async () => {
    const { deps, mails } = setup();
    const uid = unique("u");
    await db.doc(paths.deletedAccount(uid)).set({ uid, at: "2026-11-24T09:00:00.000Z" });
    await expect(sendBugReport(deps, uid, undefined, checked({ text: "Hi", app: "web" }), undefined)).rejects.toBeInstanceOf(AccountDeletedError);
    expect(mails).toHaveLength(0);
    expect((await db.collection(paths.bugReports()).where("uid", "==", uid).get()).empty).toBe(true);
  });
});

describe("isPng", () => {
  it("knows a PNG by its first bytes", () => {
    expect(isPng(png)).toBe(true);
    expect(isPng(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
    expect(isPng(new Uint8Array())).toBe(false);
  });
});
