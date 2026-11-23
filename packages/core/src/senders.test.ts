import { describe, expect, it } from "vitest";
import { cleanSenderList, domainOf, effectiveDecision, isListed, withLearned } from "./senders";

describe("cleanSenderList", () => {
  it("reads a typed list of senders as one domain a line", () => {
    expect(cleanSenderList([" Air.Example ", "", "cove.example", "air.example"])).toEqual(["air.example", "cove.example"]);
  });
});

describe("domainOf", () => {
  it("reads a From header or a bare domain", () => {
    expect(domainOf("Cove <stay@Cove.Example>")).toBe("cove.example");
    expect(domainOf("stay@cove.example")).toBe("cove.example");
    expect(domainOf("cove.example")).toBe("cove.example");
    expect(domainOf("Cove Hotels")).toBeUndefined();
  });
});

describe("withLearned", () => {
  it("adds to one list once and lifts a covering pattern from the other", () => {
    const current = { allow: ["air.example"], deny: ["example"] };
    expect(withLearned(current, "air.example", "allow")).toEqual({ allow: ["air.example"], deny: [] });
    expect(withLearned({ allow: ["air.example"], deny: [] }, "mail.air.example", "deny")).toEqual({ allow: [], deny: ["mail.air.example"] });
  });
});

describe("effectiveDecision", () => {
  it("lets a child-domain denial beat a parent-domain allowance, as the parser does", () => {
    const patterns = { allow: ["air.example"], deny: ["mail.air.example"] };
    expect(effectiveDecision(patterns, "mail.air.example")).toBe("deny");
    expect(effectiveDecision(patterns, "air.example")).toBe("allow");
    expect(effectiveDecision(patterns, "other.example")).toBeUndefined();
    expect(isListed(patterns, "x.air.example", "allow")).toBe(true);
  });
});
