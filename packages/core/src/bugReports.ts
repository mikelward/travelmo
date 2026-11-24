import { z } from "zod";

// Bug reports sent from inside the apps (SPEC "Bug reports"): what the
// user wrote, the page or screen it was sent from, and on Android the debug
// log and a screenshot. The parser checks a report against these limits,
// emails it to the maintainer and keeps a copy without the screenshot.
// Android's :core mirrors the limits and the failure wording
// (BugReports.kt).

export const bugReportPath = "/reports";

export const bugReportLimits = {
  // Characters the user may type.
  text: 5_000,
  // Characters of debug log; Android's report is well under this.
  log: 200_000,
  // Bytes of PNG, once decoded from base64.
  screenshotBytes: 2 * 1024 * 1024,
  page: 500,
  version: 100,
  userAgent: 1_000,
  // The bookings of the trip a report is sent from, which always go: how
  // many, and the characters of their JSON.
  bookings: 100,
  tripJson: 200_000,
} as const;

// Reports an account may send a day (UTC), so a stuck button or a script
// can't fill the maintainer's inbox.
export const bugReportDailyLimit = 5;

// A booking as the trip page has it, as stored: read leniently (a field
// an older import left out, or one added since, still goes), since it is
// only shown to the maintainer, never written anywhere.
const ReportedPlace = z.looseObject({
  name: z.string().optional(),
  code: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});
const ReportedBooking = z.looseObject({
  id: z.string().optional(),
  type: z.string(),
  title: z.string(),
  provider: z.string().optional(),
  confirmation: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  origin: ReportedPlace.optional(),
  destination: ReportedPlace.optional(),
  notes: z.string().optional(),
  sources: z.array(z.looseObject({ kind: z.string().optional(), label: z.string().optional() })).optional(),
  cancelledAt: z.string().optional(),
});
export type ReportedBooking = z.infer<typeof ReportedBooking>;

// The trip a report was sent from, with every booking on it: always sent
// from a trip's page and the screens under it, never another trip's.
const ReportedTrip = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(500),
  bookings: z.array(ReportedBooking),
});
export type ReportedTrip = z.infer<typeof ReportedTrip>;

// The request body as sent, before the limits; `text` may be empty on
// Android, where the log and screenshot say what happened.
const BugReportBody = z.object({
  text: z.string().default(""),
  log: z.string().optional(),
  screenshot: z.string().optional(),
  page: z.string().optional(),
  app: z.enum(["web", "android"]),
  version: z.string().optional(),
  // The browser's user agent, on the web.
  userAgent: z.string().optional(),
  trip: ReportedTrip.optional(),
});
export type BugReport = z.infer<typeof BugReportBody>;

export type BugReportCheck = { ok: true; report: BugReport } | { ok: false; status: 400 | 413; reason: string };

const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

// The bytes a base64 string decodes to, or undefined for one that isn't
// base64 (whitespace included, which no client sends).
export function base64Bytes(value: string): number | undefined {
  if (value.length % 4 !== 0 || !base64Pattern.test(value)) return undefined;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

// A body checked against the shape (400) and then the limits (413). An
// empty report, with nothing typed, no log and no screenshot, is refused.
export function checkBugReport(body: unknown): BugReportCheck {
  const parsed = BugReportBody.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, reason: "Not a bug report" };
  const report = parsed.data;
  const screenshotBytes = report.screenshot === undefined ? 0 : base64Bytes(report.screenshot);
  if (screenshotBytes === undefined) return { ok: false, status: 400, reason: "The screenshot is not base64" };
  if (!report.text.trim() && !report.log && !report.screenshot) return { ok: false, status: 400, reason: "The report is empty" };
  if (report.text.length > bugReportLimits.text) return { ok: false, status: 413, reason: "The description is too long" };
  if ((report.log?.length ?? 0) > bugReportLimits.log) return { ok: false, status: 413, reason: "The log is too long" };
  if (screenshotBytes > bugReportLimits.screenshotBytes) return { ok: false, status: 413, reason: "The screenshot is too large" };
  if (report.trip && (report.trip.bookings.length > bugReportLimits.bookings || JSON.stringify(report.trip).length > bugReportLimits.tripJson)) {
    return { ok: false, status: 413, reason: "The trip has too many bookings to send" };
  }
  if (
    (report.page?.length ?? 0) > bugReportLimits.page ||
    (report.version?.length ?? 0) > bugReportLimits.version ||
    (report.userAgent?.length ?? 0) > bugReportLimits.userAgent
  ) {
    return { ok: false, status: 400, reason: "The page, version or browser is too long" };
  }
  return { ok: true, report };
}

const appNames: Record<BugReport["app"], string> = { web: "Web", android: "Android" };

// A place in full, so a wrong city, country or spot shows: its name and
// address, city and country, code, and where the map puts it.
export function reportedPlaceText(place: z.infer<typeof ReportedPlace> | undefined): string | undefined {
  if (!place) return undefined;
  const parts = [
    [place.name, place.address].filter(Boolean).join(", "),
    [place.city, place.country].filter(Boolean).join(", "),
    place.code ?? "",
    place.lat !== undefined && place.lon !== undefined ? `${place.lat},${place.lon}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

// The trip's bookings as lines a person reads; the JSON attachment holds
// them whole.
export function reportedTripText(trip: ReportedTrip): string {
  const lines = [`--- Trip: ${trip.title} (${trip.id}), ${trip.bookings.length} booking${trip.bookings.length === 1 ? "" : "s"} ---`];
  trip.bookings.forEach((b, i) => {
    lines.push("", `${i + 1}. ${b.type}: ${b.title}${b.cancelledAt ? " (cancelled)" : ""}`);
    const when = [b.start, b.end].filter(Boolean).join(" to ");
    if (when) lines.push(`   When: ${when}`);
    const origin = reportedPlaceText(b.origin);
    const destination = reportedPlaceText(b.destination);
    if (origin) lines.push(`   Origin: ${origin}`);
    if (destination) lines.push(`   Destination: ${destination}`);
    if (b.provider) lines.push(`   Provider: ${b.provider}`);
    if (b.confirmation) lines.push(`   Confirmation: ${b.confirmation}`);
    if (b.notes) lines.push(`   Notes: ${b.notes.replace(/\n/g, " ")}`);
    const sources = (b.sources ?? []).map((s) => `${s.label ?? "(no label)"} (${s.kind ?? "unknown"})`);
    if (sources.length) lines.push(`   Sources: ${sources.join("; ")}`);
  });
  return lines.join("\n");
}

// The email the maintainer gets: the subject names the reporter's address
// (else the account), and the body leads with what they wrote, then where
// and which build, then the log. The screenshot goes as an attachment.
export function bugReportMail(report: BugReport, at: { id: string; uid: string; from?: string | undefined }): { subject: string; text: string } {
  const lines = [
    report.text.trim() || "(Nothing written.)",
    "",
    `Page: ${report.page?.trim() || "unknown"}`,
    `App: ${appNames[report.app]}${report.version?.trim() ? ` ${report.version.trim()}` : ""}`,
    ...(report.userAgent?.trim() ? [`Browser: ${report.userAgent.trim()}`] : []),
    `Account: ${at.uid}`,
    `Report: ${at.id}`,
    ...(report.screenshot ? ["Screenshot: attached"] : []),
  ];
  if (report.trip) lines.push("", reportedTripText(report.trip), "", "The bookings are attached as JSON too.");
  if (report.log) lines.push("", "--- Debug log ---", report.log);
  return { subject: `Travelmo bug report from ${at.from ?? `account ${at.uid}`}`, text: `${lines.join("\n")}\n` };
}

// What the apps say when a report did not go: by the parser's status, or
// with none when it could not be reached.
export function bugReportFailure(status: number | null): string {
  switch (status) {
    case null:
      return "Couldn't reach Travelmo. Check your connection and try again.";
    case 401:
    case 403:
      return "Couldn't confirm it's you. Sign out, sign in again and try again.";
    case 413:
      return "The report is too large to send.";
    case 429:
      return "You've sent the most reports for today. Try again tomorrow.";
    case 503:
      return "Sending reports isn't set up yet.";
    default:
      return `That didn't work (error ${status}). Try again.`;
  }
}
