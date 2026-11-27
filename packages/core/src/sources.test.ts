import { describe, expect, it } from "vitest";
import { gmailMessageUrl, gmailSearch, segmentSources, sourceGroups, sourceSearch } from "./sources";

describe("segmentSources", () => {
  it("lists recorded sources and older Gmail ids once each, oldest first", () => {
    const sources = segmentSources({
      createdAt: "2030-01-01T00:00:00Z",
      gmailMessageIds: ["m1", "m2"],
      sources: [
        { kind: "tripit", id: "tripit-abc", label: "Paris", at: "2030-02-01T00:00:00Z" },
        { kind: "gmail", id: "m2", label: "Your booking", at: "2030-01-15T00:00:00Z" },
        { kind: "gmail", id: "m2", label: "Your booking", at: "2030-01-15T00:00:00Z" },
      ],
    });
    expect(sources.map((s) => `${s.kind}/${s.id}`)).toEqual(["gmail/m1", "gmail/m2", "tripit/tripit-abc"]);
  });
});

describe("gmailMessageUrl", () => {
  it("opens the message in the account it came from", () => {
    expect(gmailMessageUrl("18c0ffee", "traveler@example.com")).toBe(
      "https://mail.google.com/mail/u/?authuser=traveler%40example.com#all/18c0ffee",
    );
    expect(gmailMessageUrl("18c0ffee")).toBe("https://mail.google.com/mail/u/0/#all/18c0ffee");
  });
});

describe("gmailSearch", () => {
  it("finds an email by its sender, subject and the days around it, across a month's end", () => {
    expect(gmailSearch({ sender: "cove.example", subject: 'Your "Cove"  stay', sentAt: "2026-11-30T23:30:00-08:00" })).toBe(
      'from:cove.example subject:"Your Cove stay" after:2026/11/29 before:2026/12/02',
    );
  });

  it("leaves out what it doesn't know", () => {
    expect(gmailSearch({ sentAt: "2026-03-01T10:00:00Z" })).toBe("after:2026/02/28 before:2026/03/03");
    expect(gmailSearch({ sender: "cove.example", sentAt: "" })).toBe("from:cove.example");
  });
});

describe("sourceSearch", () => {
  const confirmation = { kind: "gmail" as const, id: "m1", label: "Your stay", at: "2026-11-20T00:00:00Z", sentAt: "2026-10-01T09:00:00Z" };
  const segment = { sender: "cove.example", sources: [confirmation], gmailMessageIds: [], createdAt: "2026-11-20T00:00:00Z" };

  it("searches by the booking's sender when the email is its only one", () => {
    expect(sourceSearch(segment, confirmation)).toBe('from:cove.example subject:"Your stay" after:2026/09/30 before:2026/10/03');
  });

  it("leaves the sender out when another email may be the sender's, and the date when only the import's is known", () => {
    const agency = { kind: "gmail" as const, id: "m2", label: "Booking confirmed", at: "2026-11-21T00:00:00Z" };
    expect(sourceSearch({ ...segment, sources: [confirmation, agency] }, agency)).toBe('subject:"Booking confirmed"');
  });

  it("searches a forward by its subject alone, as its sender and date are the original's", () => {
    const forward = { ...confirmation, label: "Fwd: Your stay" };
    expect(sourceSearch({ ...segment, sources: [forward] }, forward)).toBe('subject:"Fwd: Your stay"');
  });
});

describe("sourceGroups", () => {
  const at = "2026-01-01T00:00:00Z";
  const booking = (id: string, ...emails: string[]) => ({
    id,
    createdAt: at,
    gmailMessageIds: [],
    sources: emails.map((e, i) => ({ kind: "gmail" as const, id: e, label: `Subject ${e}`, at: `2026-01-0${i + 1}T00:00:00Z` })),
  });

  it("gives each email that some of a trip's bookings came from, with them, the most first", () => {
    const groups = sourceGroups([booking("a", "theirs"), booking("b", "theirs"), booking("c", "mine"), booking("d", "theirs", "mine")]);
    expect(groups.map((g) => [g.source.id, g.segmentIds])).toEqual([
      ["theirs", ["a", "b", "d"]],
      ["mine", ["c", "d"]],
    ]);
  });

  it("leaves out an email every booking came from, which splits nothing off", () => {
    expect(sourceGroups([booking("a", "all"), booking("b", "all", "one")]).map((g) => g.source.id)).toEqual(["one"]);
  });
});
