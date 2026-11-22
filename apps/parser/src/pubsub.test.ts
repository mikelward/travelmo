import { describe, expect, it } from "vitest";
import { BadPushEnvelope, parseGmailPush, processNotification } from "./pubsub";

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

describe("processNotification", () => {
  // A connection whose history position only moves while the reset
  // generation it was read under is current, as updateHistoryId does.
  function mailbox(resetDuringImport: boolean) {
    let generation = 0;
    const state = { historyId: "100" as string | undefined };
    const imported: { ids: readonly string[]; generation: number }[] = [];
    const deps = {
      resetGeneration: async () => generation,
      loadState: async () => ({ ...state }),
      listAdded: async (_state: unknown, since: string) => ({ messageIds: [`after-${since}`], historyId: "200" }),
      importIds: async (_state: unknown, ids: readonly string[], g: number) => {
        imported.push({ ids, generation: g });
        if (resetDuringImport) generation += 1;
        return { imported: ids.length };
      },
      saveHistoryId: async (_state: unknown, historyId: string, g: number) => {
        if (g !== generation) return false;
        state.historyId = historyId;
        return true;
      },
    };
    return { deps, state, imported };
  }

  it("moves the history position on after importing", async () => {
    const { deps, state, imported } = mailbox(false);
    expect(await processNotification("150", deps)).toEqual({ kind: "processed", messages: 1, counts: { imported: 1 } });
    expect(imported).toEqual([{ ids: ["after-100"], generation: 0 }]);
    expect(state.historyId).toBe("200");
  });

  it("keeps the position when trips are reset during the import, so the push is read again", async () => {
    const { deps, state, imported } = mailbox(true);
    expect((await processNotification("150", deps)).kind).toBe("superseded");
    expect(state.historyId).toBe("100");
    // Pub/Sub's redelivery reads the same emails under the new generation.
    deps.importIds = async (_state, ids, g) => {
      imported.push({ ids, generation: g });
      return { imported: ids.length };
    };
    expect((await processNotification("150", deps)).kind).toBe("processed");
    expect(imported[1]).toEqual({ ids: ["after-100"], generation: 1 });
    expect(state.historyId).toBe("200");
  });

  it("reports a connection gone during the import as disconnected", async () => {
    const { deps } = mailbox(false);
    deps.saveHistoryId = async () => false;
    expect((await processNotification("150", deps)).kind).toBe("disconnected");
  });
});
