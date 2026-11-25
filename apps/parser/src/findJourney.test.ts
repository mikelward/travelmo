import type { ParsedMessage } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { lookBatch, lookForJourney, lookQuery, type LookIo } from "./findJourney";
import type { EmailMessage } from "./gmail";
import type { ImportOutcome } from "./importer";

const email = (id: string): EmailMessage => ({ id, threadId: id, from: "Air <noreply@air.example>", subject: `Email ${id}`, date: "Mon, 1 Dec 2025 10:00:00 +0000", listUnsubscribe: false, text: "Adelaide to London" });

// A mailbox whose search finds `ids`, each read as `outcomes` says (not a booking otherwise).
function io(ids: string[], outcomes: Record<string, ImportOutcome> = {}, records: Record<string, ParsedMessage["outcome"]> = {}) {
  const read: string[] = [];
  const queries: string[] = [];
  const value: LookIo = {
    mailboxes: [
      {
        search: async (query) => (queries.push(query), ids),
        fetch: async (id) => {
          if (id === "gone") throw Object.assign(new Error("gone"), { code: 404 });
          return email(id);
        },
      },
    ],
    record: async (id) => (records[id] ? ({ messageId: id, outcome: records[id], subject: `Email ${id}`, from: "Air", sentAt: "2025-12-01T10:00:00Z" } as ParsedMessage) : undefined),
    read: async (message) => (read.push(message.id), outcomes[message.id] ?? "not_booking"),
    isNotFound: (error) => (error as { code?: number }).code === 404,
  };
  return { value, read, queries };
}

describe("lookQuery", () => {
  it("searches both ends in the emails sent in the months before the journey, until the day after the next leaves", () => {
    expect(lookQuery({ from: "Adelaide", fromCode: "ADL", to: "London", toCode: "LGW", date: "2026-01-08", until: "2026-02-15" })).toBe(
      '-in:spam -in:trash -category:promotions -category:social after:2025/07/08 before:2026/02/16 ("Adelaide" OR ADL) ("London" OR LGW)',
    );
    expect(lookQuery({ from: "Boston", to: "London", date: "2026-11-30" })).toContain("after:2026/05/30 before:2026/12/01 ");
  });
});

describe("lookForJourney", () => {
  it("reads a few matches at a time and says where to keep looking", async () => {
    const ids = Array.from({ length: lookBatch + 2 }, (_, i) => `m${i}`);
    const { value, read } = io(ids);
    const first = await lookForJourney("q", 0, value);
    expect(read).toHaveLength(lookBatch);
    expect(first.next).toBe(lookBatch);
    expect(first.emails.every((e) => e.outcome === "not_booking" && e.report?.includes("Travelmo import report"))).toBe(true);
    const rest = await lookForJourney("q", first.next!, value);
    expect(rest.emails.map((e) => e.messageId)).toEqual(["m5", "m6"]);
    expect(rest.next).toBeUndefined();
  });

  it("stops at the first booking", async () => {
    const { value, read } = io(["m0", "m1", "m2"], { m1: "imported" });
    const result = await lookForJourney("q", 0, value);
    expect(read).toEqual(["m0", "m1"]);
    expect(result.emails.map((e) => e.outcome)).toEqual(["not_booking", "imported"]);
    expect(result.next).toBe(2);
  });

  it("lists emails already imported without reading them again, or counting them, and passes over one gone", async () => {
    const ids = ["old", "gone", ...Array.from({ length: lookBatch }, (_, i) => `m${i}`)];
    const { value, read } = io(ids, {}, { old: "imported" });
    const result = await lookForJourney("q", 0, value);
    expect(read).toHaveLength(lookBatch);
    expect(result.emails[0]).toEqual({ messageId: "old", subject: "Email old", from: "Air", sent: "2025-12-01T10:00:00Z", outcome: "already" });
    expect(result.next).toBeUndefined();
  });

  it("says one being imported right now is busy", async () => {
    const { value } = io(["m0"], { m0: "skipped" });
    expect((await lookForJourney("q", 0, value)).emails).toEqual([expect.objectContaining({ messageId: "m0", outcome: "busy" })]);
  });
});
