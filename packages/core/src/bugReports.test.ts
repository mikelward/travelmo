import { describe, expect, it } from "vitest";
import { base64Bytes, bugReportFailure, bugReportPath, bugReportLimits, bugReportMail, checkBugReport, reportedPlaceText, type ReportedTrip } from "./bugReports";

// An invented trip, as the trip page holds it.
const trip: ReportedTrip = {
  id: "t1",
  title: "Liverpool",
  bookings: [
    {
      id: "s1",
      type: "hotel",
      title: "Cove Paradise Street",
      provider: "Cove",
      confirmation: "CV123",
      start: "2027-01-08T15:00:00+00:00",
      end: "2027-01-10T11:00:00+00:00",
      destination: { name: "Cove Paradise Street", address: "39 Paradise Street, Liverpool L1 3ED", city: "Liverpool", country: "GB", lat: 53.4, lon: -2.98 },
      notes: "Late check-in\nRoom 4",
      sources: [{ kind: "gmail", id: "m1", label: "Your stay", at: "2026-11-01T10:00:00Z" }],
      tripId: "t1",
      createdAt: "2026-11-01T10:00:00Z",
    },
    {
      type: "flight",
      title: "XX 100",
      start: "2027-01-08T09:00:00+00:00",
      origin: { name: "Heathrow", code: "LHR", country: "GB" },
      destination: { name: "Liverpool John Lennon", code: "LPL" },
      cancelledAt: "2026-12-01T10:00:00Z",
    },
  ],
};

const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
// The base64 of `n` zero bytes, without building them.
const zeros = (n: number) => "AAAA".repeat(Math.floor(n / 3)) + ["", "AA==", "AAA="][n % 3];

describe("base64Bytes", () => {
  it("counts the decoded bytes, padding included", () => {
    expect(base64Bytes("")).toBe(0);
    expect(base64Bytes(btoa("a"))).toBe(1);
    expect(base64Bytes(btoa("ab"))).toBe(2);
    expect(base64Bytes(btoa("abc"))).toBe(3);
    expect(base64Bytes(png)).toBe(8);
  });

  it("refuses what isn't base64", () => {
    expect(base64Bytes("abc")).toBeUndefined();
    expect(base64Bytes("ab c")).toBeUndefined();
    expect(base64Bytes("ab\ncd==")).toBeUndefined();
    expect(base64Bytes("a=bc")).toBeUndefined();
  });
});

describe("checkBugReport", () => {
  it("takes a web report of words alone and an Android one with nothing typed", () => {
    expect(checkBugReport({ text: "The map is blank", page: "/reports", app: "web" })).toEqual({
      ok: true,
      report: { text: "The map is blank", page: "/reports", app: "web" },
    });
    const android = checkBugReport({ log: "Travelmo 1.0 (40)\n", screenshot: png, page: "Trips", app: "android", version: "1.0 (40)" });
    expect(android.ok && android.report.text).toBe("");
  });

  it("refuses a body of the wrong shape, an empty report or a screenshot that isn't base64", () => {
    expect(checkBugReport(undefined)).toMatchObject({ ok: false, status: 400 });
    expect(checkBugReport({ text: "x", app: "ios" })).toMatchObject({ ok: false, status: 400 });
    expect(checkBugReport({ text: 5, app: "web" })).toMatchObject({ ok: false, status: 400 });
    expect(checkBugReport({ text: "  ", app: "web" })).toMatchObject({ ok: false, status: 400, reason: "The report is empty" });
    expect(checkBugReport({ text: "x", screenshot: "not base64!", app: "android" })).toMatchObject({ ok: false, status: 400 });
    expect(checkBugReport({ text: "x", page: "p".repeat(bugReportLimits.page + 1), app: "web" })).toMatchObject({ ok: false, status: 400 });
    expect(checkBugReport({ text: "x", userAgent: "u".repeat(bugReportLimits.userAgent + 1), app: "web" })).toMatchObject({ ok: false, status: 400 });
    expect(checkBugReport({ text: "x", app: "web", trip: { id: "t1", title: "Liverpool", bookings: [{ type: "hotel" }] } })).toMatchObject({ ok: false, status: 400 });
  });

  it("takes a trip's bookings as stored, fields it doesn't know included", () => {
    const checked = checkBugReport({ text: "x", app: "web", trip });
    expect(checked.ok && checked.report.trip).toEqual(trip);
  });

  it("refuses a trip with too many bookings or too much in them as too large", () => {
    const many = { ...trip, bookings: Array.from({ length: bugReportLimits.bookings + 1 }, () => trip.bookings[0]) };
    expect(checkBugReport({ text: "x", app: "web", trip: many })).toMatchObject({ ok: false, status: 413 });
    const long = { ...trip, bookings: [{ ...trip.bookings[0], notes: "n".repeat(bugReportLimits.tripJson) }] };
    expect(checkBugReport({ text: "x", app: "web", trip: long })).toMatchObject({ ok: false, status: 413 });
  });

  it("refuses a report past its limits as too large", () => {
    expect(checkBugReport({ text: "x".repeat(bugReportLimits.text), app: "web" }).ok).toBe(true);
    expect(checkBugReport({ text: "x".repeat(bugReportLimits.text + 1), app: "web" })).toMatchObject({ ok: false, status: 413 });
    expect(checkBugReport({ log: "x".repeat(bugReportLimits.log + 1), app: "android" })).toMatchObject({ ok: false, status: 413 });
    const atLimit = zeros(bugReportLimits.screenshotBytes);
    expect(checkBugReport({ screenshot: atLimit, app: "android" }).ok).toBe(true);
    const over = zeros(bugReportLimits.screenshotBytes + 1);
    expect(checkBugReport({ screenshot: over, app: "android" })).toMatchObject({ ok: false, status: 413 });
  });
});

describe("bugReportMail", () => {
  it("leads with what was written, then where, the build and the log", () => {
    const mail = bugReportMail(
      { text: "Sharing does nothing\n", log: "line 1\nline 2", screenshot: png, page: "TripDetail", app: "android", version: "1.4 (72)" },
      { id: "r1", uid: "u1", from: "traveler@example.com" },
    );
    expect(mail.subject).toBe("Travelmo bug report from traveler@example.com");
    expect(mail.text).toBe(
      [
        "Sharing does nothing",
        "",
        "Page: TripDetail",
        "App: Android 1.4 (72)",
        "Account: u1",
        "Report: r1",
        "Screenshot: attached",
        "",
        "--- Debug log ---",
        "line 1",
        "line 2",
        "",
      ].join("\n"),
    );
  });

  it("names the account when there is no address, and says when nothing was written", () => {
    const mail = bugReportMail({ text: "", app: "web" }, { id: "r2", uid: "u2" });
    expect(mail.subject).toBe("Travelmo bug report from account u2");
    expect(mail.text).toBe("(Nothing written.)\n\nPage: unknown\nApp: Web\nAccount: u2\nReport: r2\n");
  });
});

describe("a report with a trip's bookings", () => {
  it("puts every booking in the email, each place in full", () => {
    const mail = bugReportMail({ text: "The hotel is in the wrong city", page: "/trips/t1", app: "web", version: "abc123", userAgent: "Mozilla/5.0 (X11; Linux x86_64)", trip }, { id: "r3", uid: "u3", from: "traveler@example.com" });
    expect(mail.text).toBe(
      [
        "The hotel is in the wrong city",
        "",
        "Page: /trips/t1",
        "App: Web abc123",
        "Browser: Mozilla/5.0 (X11; Linux x86_64)",
        "Account: u3",
        "Report: r3",
        "",
        "--- Trip: Liverpool (t1), 2 bookings ---",
        "",
        "1. hotel: Cove Paradise Street",
        "   When: 2027-01-08T15:00:00+00:00 to 2027-01-10T11:00:00+00:00",
        "   Destination: Cove Paradise Street, 39 Paradise Street, Liverpool L1 3ED · Liverpool, GB · 53.4,-2.98",
        "   Provider: Cove",
        "   Confirmation: CV123",
        "   Notes: Late check-in Room 4",
        "   Sources: Your stay (gmail)",
        "",
        "2. flight: XX 100 (cancelled)",
        "   When: 2027-01-08T09:00:00+00:00",
        "   Origin: Heathrow · GB · LHR",
        "   Destination: Liverpool John Lennon · LPL",
        "",
        "The bookings are attached as JSON too.",
        "",
      ].join("\n"),
    );
  });

  it("writes a place with only some of its fields", () => {
    expect(reportedPlaceText(undefined)).toBeUndefined();
    expect(reportedPlaceText({})).toBeUndefined();
    expect(reportedPlaceText({ city: "Liverpool" })).toBe("Liverpool");
    expect(reportedPlaceText({ name: "Spot", lat: 0, lon: 0 })).toBe("Spot · 0,0");
  });
});

describe("bugReportFailure", () => {
  it("says why a report did not go", () => {
    expect(bugReportFailure(null)).toBe("Couldn't reach Travelmo. Check your connection and try again.");
    expect(bugReportFailure(401)).toBe("Couldn't confirm it's you. Sign out, sign in again and try again.");
    expect(bugReportFailure(413)).toBe("The report is too large to send.");
    expect(bugReportFailure(429)).toBe("You've sent the most reports for today. Try again tomorrow.");
    expect(bugReportFailure(503)).toBe("Sending reports isn't set up yet.");
    expect(bugReportFailure(500)).toBe("That didn't work (error 500). Try again.");
  });
});

describe("the limits", () => {
  it("are the ones Android's :core holds a report to", () => {
    expect(bugReportPath).toBe("/reports");
    expect(bugReportLimits).toMatchObject({ text: 5_000, log: 200_000, screenshotBytes: 2_097_152, bookings: 100 });
  });
});
