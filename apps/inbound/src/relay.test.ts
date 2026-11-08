import { describe, expect, it } from "vitest";
import { maxRawBytes, relayRequest, verdictOf } from "./relay";

const env = { PARSER_URL: "https://parser.example/", INBOUND_SECRET: "s3cret" };

describe("relayRequest", () => {
  it("posts the raw message to the parser's inbound route with the secret and the envelope", async () => {
    const raw = new TextEncoder().encode("From: a@example.com\r\nSubject: Hi\r\n\r\nBody");
    const request = relayRequest(env, { to: "abcdefghijklmnopqrst@travelmo.app", from: "sam@example.com" }, raw);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://parser.example/inbound/cloudflare");
    expect(request.headers.get("Authorization")).toBe("Bearer s3cret");
    expect(request.headers.get("Content-Type")).toBe("message/rfc822");
    expect(request.headers.get("X-Envelope-To")).toBe("abcdefghijklmnopqrst@travelmo.app");
    expect(request.headers.get("X-Envelope-From")).toBe("sam@example.com");
    expect(new TextDecoder().decode(await request.arrayBuffer())).toContain("Subject: Hi");
  });

  it("caps the message at the parser's own limit", () => {
    expect(maxRawBytes).toBe(2 * 1024 * 1024);
  });
});

describe("verdictOf", () => {
  it("accepts a 204, bounces the parser's refusals with their reason, and retries anything else", () => {
    expect(verdictOf(204)).toEqual({ kind: "accepted" });
    expect(verdictOf(404)).toMatchObject({ kind: "reject", reason: expect.stringContaining("No such") });
    expect(verdictOf(413)).toMatchObject({ kind: "reject", reason: expect.stringContaining("too large") });
    expect(verdictOf(429)).toMatchObject({ kind: "reject", reason: expect.stringContaining("limit") });
    for (const status of [401, 403, 500, 502, 503]) expect(verdictOf(status)).toMatchObject({ kind: "retry", reason: expect.stringContaining(String(status)) });
  });
});
