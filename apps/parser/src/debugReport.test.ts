import { describe, expect, it } from "vitest";
import { importReport, reportExcerptChars } from "./debugReport";
import { readerVersion } from "./extract";
import type { EmailMessage } from "./gmail";

// Invented, shaped like an airline's e-ticket whose plain part is a footer.
const message: EmailMessage = {
  id: "m1",
  threadId: "m1",
  from: "Example Air <tickets@air.example>",
  subject: "Example Air e-Ticket AB12CD",
  date: "Sun, 18 Oct 2026 16:25:00 +0100",
  listUnsubscribe: false,
  text: "Flight 1 of 2 XX 11 LHR 17:20 BOS 20:15",
  textChoice: { from: "html", plainChars: 120, htmlChars: 4210, truncated: false },
};
const record = { messageId: "m1", uid: "u1", outcome: "not_booking" as const, reason: "sender air.example allowed", segmentIds: [], processedAt: "2026-11-24T23:00:00Z" };

describe("importReport", () => {
  it("says what was read, how, what the model said and what came of it", () => {
    const report = importReport(message, record, { attachments: 0, extraction: { isBooking: false, segments: [] } });
    expect(report.split("\n").slice(0, 8)).toEqual([
      "Travelmo import report",
      "Email: Example Air e-Ticket AB12CD",
      "From: Example Air <tickets@air.example>",
      "Sent: Sun, 18 Oct 2026 16:25:00 +0100",
      "Outcome: not_booking (sender air.example allowed)",
      `Reader: version ${readerVersion}`,
      "Text read: HTML (plain 120 characters, HTML 4,210), 39 characters sent",
      "PDFs sent: 0",
    ]);
    expect(report).toContain('Model said:\n{\n  "isBooking": false,\n  "segments": []\n}');
    expect(report.endsWith("Text the model read:\nFlight 1 of 2 XX 11 LHR 17:20 BOS 20:15")).toBe(true);
  });

  it("says why the model failed, and shows only the start of a long text", () => {
    const long = { ...message, text: "x".repeat(reportExcerptChars + 10) };
    const report = importReport(long, undefined, { error: "Gemini returned no text" });
    expect(report).toContain("Outcome: unknown");
    expect(report).toContain("Model failed: Gemini returned no text");
    expect(report).toContain(`Text the model read (first 4,000 characters):\n${"x".repeat(reportExcerptChars)}`);
    expect(report).not.toContain("x".repeat(reportExcerptChars + 1));
  });
});
