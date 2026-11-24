import { bugReportDailyLimit, bugReportMail, paths, type BugReport } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { refuseIfDeleted } from "./deleted";
import { errorKind } from "./log";
import type { Attachment, Mailer } from "./mail";

// Bug reports sent from the apps (SPEC "Bug reports"): each is counted
// against the account's daily limit and copied to `bugReports/{id}` in one
// transaction, then emailed to the maintainer with Reply-To the reporter's
// verified address. The copy keeps what was written and the sizes of the
// rest, never the screenshot, log or bookings, so a report whose email
// failed is still found; account deletion removes the copies.

type Severity = "INFO" | "WARNING" | "ERROR";

export type BugReportDeps = {
  db: Firestore;
  mail: Mailer;
  // The maintainer's address (BUG_REPORT_TO).
  to: string;
  now: () => string;
  newId: () => string;
  log: (severity: Severity, event: string, fields: Record<string, unknown>) => void;
  limit?: number;
};

export type BugReportSent = { status: "sent"; id: string } | { status: "limit" } | { status: "mail_failed"; id: string };

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Whether bytes start as a PNG does.
export function isPng(bytes: Uint8Array): boolean {
  return pngSignature.every((b, i) => bytes[i] === b);
}

// Sends one checked report for `uid`. `from` is the reporter's verified
// sign-in address, if they have one; `screenshot` the decoded PNG.
export async function sendBugReport(
  deps: BugReportDeps,
  uid: string,
  from: string | undefined,
  report: BugReport,
  screenshot: Uint8Array | undefined,
): Promise<BugReportSent> {
  const { db } = deps;
  const at = deps.now();
  const day = at.slice(0, 10);
  const id = deps.newId();
  const limit = deps.limit ?? bugReportDailyLimit;
  const budget = db.doc(paths.bugReportBudget(uid));
  const reserved = await db.runTransaction(async (tx) => {
    // Every read before any write.
    await refuseIfDeleted(db, tx, uid);
    const data = (await tx.get(budget)).data() as { day?: string; count?: number } | undefined;
    const count = data?.day === day ? (data.count ?? 0) : 0;
    if (count >= limit) return false;
    tx.set(budget, { day, count: count + 1 });
    tx.set(db.doc(paths.bugReport(id)), {
      id,
      uid,
      at,
      app: report.app,
      ...(report.page ? { page: report.page } : {}),
      ...(report.version ? { version: report.version } : {}),
      ...(report.userAgent ? { userAgent: report.userAgent } : {}),
      text: report.text,
      logChars: report.log?.length ?? 0,
      hasScreenshot: screenshot !== undefined,
      ...(report.trip ? { tripBookings: report.trip.bookings.length } : {}),
    });
    return true;
  });
  // Sizes and ids only: never what was written, the log or the bookings.
  const sizes = {
    uid,
    id,
    app: report.app,
    textChars: report.text.length,
    logChars: report.log?.length ?? 0,
    screenshotBytes: screenshot?.length ?? 0,
    bookings: report.trip?.bookings.length ?? 0,
  };
  if (!reserved) {
    deps.log("INFO", "bug_report_limit", { uid, limit });
    return { status: "limit" };
  }
  const { subject, text } = bugReportMail(report, { id, uid, from });
  const attachments: Attachment[] = [
    ...(screenshot ? [{ filename: "screenshot.png", contentType: "image/png", content: screenshot }] : []),
    ...(report.trip
      ? [{ filename: "trip.json", contentType: "application/json", content: new TextEncoder().encode(`${JSON.stringify(report.trip, null, 2)}\n`) }]
      : []),
  ];
  try {
    await deps.mail({ to: deps.to, subject, text, ...(from ? { replyTo: from } : {}), ...(attachments.length ? { attachments } : {}) });
  } catch (error) {
    // The copy is kept; the maintainer finds it by its id.
    deps.log("ERROR", "bug_report_mail_failed", { ...sizes, ...errorKind(error) });
    return { status: "mail_failed", id };
  }
  deps.log("INFO", "bug_report_sent", sizes);
  return { status: "sent", id };
}
