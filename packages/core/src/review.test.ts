import type { ParsedMessage } from "./schema";
import { describe, expect, it } from "vitest";
import { dayRange, matchesKeyword, outcomeLabel, reviewCacheCoversLatest, reviewDate, toReview, withLatest } from "./review";

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
    // One whose Import anyway report is still to copy stays, even once imported.
    expect(toReview(records, "", {}, new Set(["b"])).map((r) => r.messageId)).toEqual(["a", "b", "d"]);
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
  it("says when the email was sent and when it was read, or only when it was read if the sending is unknown", () => {
    expect(reviewDate({ sentAt: "2026-05-23T07:22:58Z", processedAt: "2026-11-23T12:00:00Z" }, "en-GB", "Europe/London")).toBe("Sent 23 May 2026 · Read 23 Nov 2026");
    expect(reviewDate({ processedAt: "2026-11-23T12:00:00Z" }, "en-GB", "Europe/London")).toBe("Read 23 Nov 2026");
  });
});

describe("outcomeLabel", () => {
  it("says an email that gave loyalty kept it, rather than only that it was no booking", () => {
    expect(outcomeLabel({ outcome: "not_booking", loyalty: ["Delta: Silver Medallion · 49,606 Miles"] })).toBe("Read, loyalty kept");
    expect(outcomeLabel({ outcome: "not_booking" })).toBe("Read, not a booking");
    expect(outcomeLabel({ outcome: "filtered" })).toBe("Skipped before reading");
  });
});

describe("reviewCacheCoversLatest", () => {
  const at = (id: string, processedAt: string) => ({ messageId: id, processedAt });
  it("keeps the cache while latest has not filled its window or still overlaps the cached newest timestamp", () => {
    const cached = [at("c2", "2026-10-30T10:00:00Z"), at("c1", "2026-10-30T09:00:00Z")];
    expect(reviewCacheCoversLatest(cached, undefined, 3)).toBe(true);
    expect(reviewCacheCoversLatest(cached, [at("n1", "2026-10-30T11:00:00Z")], 3)).toBe(true);
    // 2 new records + 1 older record in a window of 3: oldest latest < cached newest, no gap.
    expect(
      reviewCacheCoversLatest(cached, [at("n2", "2026-10-30T12:00:00Z"), at("n1", "2026-10-30T11:00:00Z"), at("c1", "2026-10-30T09:00:00Z")], 3),
    ).toBe(true);
    // Identical timestamps with no new records still hit cache.
    const same = [at("s3", "2026-10-30T10:00:00Z"), at("s2", "2026-10-30T10:00:00Z"), at("s1", "2026-10-30T10:00:00Z")];
    expect(reviewCacheCoversLatest(same, same, 3)).toBe(true);
  });

  it("invalidates the cache once a full latest window advances past the cached newest timestamp or fills from empty", () => {
    const cached = [at("c2", "2026-10-30T10:00:00Z"), at("c1", "2026-10-30T09:00:00Z")];
    const newer = [at("n3", "2026-10-30T13:00:00Z"), at("n2", "2026-10-30T12:00:00Z"), at("n1", "2026-10-30T11:00:00Z")];
    expect(reviewCacheCoversLatest(cached, newer, 3)).toBe(false);
    expect(reviewCacheCoversLatest([], newer, 3)).toBe(false);
  });
});
