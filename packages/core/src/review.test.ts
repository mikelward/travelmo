import type { ParsedMessage } from "./schema";
import { describe, expect, it } from "vitest";
import { dayRange, matchesKeyword, reviewDate, toReview, withLatest } from "./review";

const record = (extra: Partial<ParsedMessage>): ParsedMessage => ({
  messageId: "m",
  uid: "u",
  outcome: "not_booking",
  segmentIds: [],
  processedAt: "2026-10-30T09:00:00Z",
  ...extra,
});

describe("matchesKeyword", () => {
  const sale = { subject: "Our summer sale", from: "News <news@cove.example>", reason: "a newsletter" };
  it("matches every word in the subject, sender or reason, ignoring case", () => {
    expect(matchesKeyword(sale, "")).toBe(true);
    expect(matchesKeyword(sale, "SUMMER")).toBe(true);
    expect(matchesKeyword(sale, "cove newsletter")).toBe(true);
    expect(matchesKeyword(sale, "summer winter")).toBe(false);
  });
});

describe("dayRange", () => {
  it("runs from the start of the first day to the start of the day after the last", () => {
    const { start, end } = dayRange("2026-10-01", "2026-10-31");
    expect(start).toBe(new Date(2026, 9, 1).toISOString());
    expect(end).toBe(new Date(2026, 10, 1).toISOString());
  });
  it("leaves out an empty or invalid end", () => {
    expect(dayRange("", "")).toEqual({});
    expect(dayRange("nonsense", "2026-10-31").start).toBeUndefined();
  });
});

describe("toReview", () => {
  it("keeps what did not become a booking and matches the keyword", () => {
    const records = [
      record({ messageId: "a", subject: "Summer sale" }),
      record({ messageId: "b", subject: "Summer stay", outcome: "imported" }),
      record({ messageId: "c", subject: "Summer stay", outcome: "processing" }),
      record({ messageId: "d", subject: "Winter sale", outcome: "failed" }),
    ];
    expect(toReview(records, "").map((r) => r.messageId)).toEqual(["a", "d"]);
    expect(toReview(records, "summer").map((r) => r.messageId)).toEqual(["a"]);
  });

  it("narrows to days by when the email was sent, or when it was read if that is unknown", () => {
    const base = { uid: "u1", segmentIds: [], outcome: "not_booking" as const, processedAt: "2026-11-23T12:00:00Z" };
    const records = [
      { ...base, messageId: "may", sentAt: "2026-05-23T07:22:58Z" },
      { ...base, messageId: "old" },
      { ...base, messageId: "sep", sentAt: "2026-09-01T07:00:00Z" },
    ];
    expect(toReview(records, "", dayRange("2026-05-01", "2026-08-01")).map((r) => r.messageId)).toEqual(["may"]);
    expect(toReview(records, "", dayRange("2026-11-01", "")).map((r) => r.messageId)).toEqual(["old"]);
  });
});

describe("withLatest", () => {
  it("shows a record read again since the search as it is now, once, and adds new ones", () => {
    const base = { uid: "u1", segmentIds: [] };
    const searched = [
      { ...base, messageId: "b", outcome: "not_booking" as const, processedAt: "2026-11-23T11:00:00Z" },
      { ...base, messageId: "a", outcome: "not_booking" as const, processedAt: "2026-11-23T10:00:00Z" },
    ];
    const latest = [
      { ...base, messageId: "a", outcome: "imported" as const, processedAt: "2026-11-23T12:00:00Z" },
      { ...base, messageId: "c", outcome: "filtered" as const, processedAt: "2026-11-23T11:30:00Z" },
    ];
    expect(withLatest(searched, latest).map((r) => [r.messageId, r.outcome])).toEqual([
      ["a", "imported"],
      ["c", "filtered"],
      ["b", "not_booking"],
    ]);
  });
});

describe("reviewDate", () => {
  it("says when the email was sent, or when it was read if that is unknown", () => {
    expect(reviewDate({ sentAt: "2026-05-23T07:22:58Z", processedAt: "2026-11-23T12:00:00Z" }, "en-GB", "Europe/London")).toBe("Sent 23 May 2026");
    expect(reviewDate({ processedAt: "2026-11-23T12:00:00Z" }, "en-GB", "Europe/London")).toBe("Read 23 Nov 2026");
  });
});
