import { describe, expect, it } from "vitest";
import { BadPushEnvelope, parseGmailPush } from "./pubsub";

function envelope(notification: unknown, extra: Record<string, unknown> = {}) {
  return {
    message: { data: Buffer.from(JSON.stringify(notification)).toString("base64"), messageId: "m-1" },
    ...extra,
  };
}

describe("parseGmailPush", () => {
  it("decodes the notification and keeps the delivery attempt", () => {
    const parsed = parseGmailPush(envelope({ emailAddress: "a@example.com", historyId: 42 }, { deliveryAttempt: 3 }));
    expect(parsed).toEqual({
      emailAddress: "a@example.com",
      historyId: "42",
      pubsubMessageId: "m-1",
      deliveryAttempt: 3,
    });
  });

  it("accepts a string history id and a first delivery without an attempt count", () => {
    const parsed = parseGmailPush(envelope({ emailAddress: "a@example.com", historyId: "7" }));
    expect(parsed.historyId).toBe("7");
    expect(parsed.deliveryAttempt).toBeUndefined();
  });

  it("rejects envelopes without message data", () => {
    expect(() => parseGmailPush({ message: {} })).toThrow(BadPushEnvelope);
    expect(() => parseGmailPush({})).toThrow(BadPushEnvelope);
    expect(() => parseGmailPush("nonsense")).toThrow(BadPushEnvelope);
  });

  it("rejects data that is not base64 JSON", () => {
    expect(() => parseGmailPush({ message: { data: Buffer.from("not json").toString("base64") } })).toThrow(
      BadPushEnvelope,
    );
  });

  it("rejects a message that is not a Gmail notification", () => {
    expect(() => parseGmailPush(envelope({ hello: "world" }))).toThrow(BadPushEnvelope);
    expect(() => parseGmailPush(envelope({ emailAddress: "", historyId: 1 }))).toThrow(BadPushEnvelope);
  });
});
