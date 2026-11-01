import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { paths } from "@travelmo/core";
import { doc, getDoc, type Firestore } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { domainOf, effectiveDecision, isListed, learnSender } from "./patterns";

let env: RulesTestEnvironment;
const owner = { uid: "owner", email: "owner@example.com" };
const asOwner = () =>
  env.authenticatedContext(owner.uid, { email: owner.email, email_verified: true }).firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-travelmo",
    firestore: { rules: readFileSync(new URL("../../../../firestore.rules", import.meta.url), "utf8") },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

describe("domainOf", () => {
  it("reads a From header or a bare domain", () => {
    expect(domainOf("Cove <stay@mail.cove.example>")).toBe("mail.cove.example");
    expect(domainOf("hello@cove.example")).toBe("cove.example");
    expect(domainOf("Cove.Example")).toBe("cove.example");
    expect(domainOf("nonsense")).toBeUndefined();
  });
});

describe("learnSender", () => {
  it("adds to one list and removes from the other, without duplicates", async () => {
    const db = asOwner();
    await learnSender(db, owner.uid, "cove.example", "allow");
    await learnSender(db, owner.uid, "cove.example", "allow");
    await learnSender(db, owner.uid, "spam.example", "deny");
    expect((await getDoc(doc(db, paths.senderPatterns(owner.uid)))).data()).toEqual({ allow: ["cove.example"], deny: ["spam.example"] });
    await learnSender(db, owner.uid, "cove.example", "deny");
    expect((await getDoc(doc(db, paths.senderPatterns(owner.uid)))).data()).toEqual({ allow: [], deny: ["spam.example", "cove.example"] });
  });

  it("lifts a parent-domain denial that would still block the sender being allowed", async () => {
    const db = asOwner();
    await learnSender(db, owner.uid, "cove.example", "deny");
    await learnSender(db, owner.uid, "mail.cove.example", "allow");
    expect((await getDoc(doc(db, paths.senderPatterns(owner.uid)))).data()).toEqual({ allow: ["mail.cove.example"], deny: [] });
    await learnSender(db, owner.uid, "cove.example", "allow");
    await learnSender(db, owner.uid, "mail.cove.example", "deny");
    expect((await getDoc(doc(db, paths.senderPatterns(owner.uid)))).data()).toEqual({ allow: [], deny: ["mail.cove.example"] });
  });
});

describe("effectiveDecision", () => {
  it("lets a child-domain denial beat a parent-domain allowance, as the parser does", () => {
    const patterns = { allow: ["cove.example"], deny: ["mail.cove.example"] };
    expect(effectiveDecision(patterns, "mail.cove.example")).toBe("deny");
    expect(effectiveDecision(patterns, "stay.cove.example")).toBe("allow");
    expect(effectiveDecision(patterns, "other.example")).toBeUndefined();
    expect(effectiveDecision(undefined, "cove.example")).toBeUndefined();
  });

  it("is reversed by learning the sender again", async () => {
    const db = asOwner();
    await learnSender(db, owner.uid, "mail.cove.example", "deny");
    await learnSender(db, owner.uid, "cove.example", "allow");
    const before = (await getDoc(doc(db, paths.senderPatterns(owner.uid)))).data();
    expect(effectiveDecision(before as never, "mail.cove.example")).toBe("deny");
    await learnSender(db, owner.uid, "mail.cove.example", "allow");
    const after = (await getDoc(doc(db, paths.senderPatterns(owner.uid)))).data();
    expect(after).toEqual({ allow: ["cove.example", "mail.cove.example"], deny: [] });
    expect(effectiveDecision(after as never, "mail.cove.example")).toBe("allow");
  });
});

describe("isListed", () => {
  it("matches a domain or its subdomains", () => {
    const patterns = { allow: ["cove.example"], deny: [] };
    expect(isListed(patterns, "cove.example", "allow")).toBe(true);
    expect(isListed(patterns, "mail.cove.example", "allow")).toBe(true);
    expect(isListed(patterns, "notcove.example", "allow")).toBe(false);
    expect(isListed(undefined, "cove.example", "allow")).toBe(false);
  });
});
