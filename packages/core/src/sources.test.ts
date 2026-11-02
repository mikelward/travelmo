import { describe, expect, it } from "vitest";
import { gmailMessageUrl, segmentSources } from "./sources";

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
