import { z } from "zod";

// What a Pub/Sub push subscription POSTs: the message, base64 data, and the
// delivery attempt once the subscription has a dead-letter topic. Attempt
// numbers make a dead-lettered notification traceable in the logs.
const envelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().optional(),
  }),
  deliveryAttempt: z.number().int().positive().optional(),
});

const notificationSchema = z.object({
  emailAddress: z.string().min(1),
  historyId: z.union([z.number(), z.string()]).transform(String),
});

export type GmailNotification = {
  emailAddress: string;
  historyId: string;
  pubsubMessageId: string | undefined;
  deliveryAttempt: number | undefined;
};

export class BadPushEnvelope extends Error {}

// The decoded JSON a push carries, with its Pub/Sub message id and attempt.
export function parsePush(body: unknown): { data: unknown; pubsubMessageId: string | undefined; deliveryAttempt: number | undefined } {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) throw new BadPushEnvelope("Not a Pub/Sub push envelope with message data");
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(envelope.data.message.data, "base64").toString("utf8"));
  } catch {
    throw new BadPushEnvelope("Pub/Sub message data is not base64 JSON");
  }
  return { data, pubsubMessageId: envelope.data.message.messageId, deliveryAttempt: envelope.data.deliveryAttempt };
}

export function parseGmailPush(body: unknown): GmailNotification {
  const { data, pubsubMessageId, deliveryAttempt } = parsePush(body);
  const notification = notificationSchema.safeParse(data);
  if (!notification.success) throw new BadPushEnvelope("Pub/Sub message is not a Gmail notification");
  return { ...notification.data, pubsubMessageId, deliveryAttempt };
}

export type NotificationResult<C> =
  | { kind: "disconnected" }
  | { kind: "expired"; since: string }
  | { kind: "processed" | "superseded"; messages: number; counts: C };

// One Gmail notification for a known user. The reset generation is read
// before the connection, and the imports and the new history position are
// saved under it. If "Delete all trips" lands in between, the position is not
// moved on ("superseded"): the caller fails the push so Pub/Sub delivers it
// again, and the emails the reset overtook are read under the new generation.
export async function processNotification<S extends { historyId?: string | undefined }, C>(
  notificationHistoryId: string,
  deps: {
    resetGeneration: () => Promise<number>;
    loadState: () => Promise<S | undefined>;
    listAdded: (state: S, since: string) => Promise<{ messageIds: string[]; historyId: string } | "expired">;
    importIds: (state: S, ids: readonly string[], generation: number) => Promise<C>;
    saveHistoryId: (state: S, historyId: string, generation: number) => Promise<boolean>;
  },
): Promise<NotificationResult<C>> {
  const generation = await deps.resetGeneration();
  const state = await deps.loadState();
  if (!state) return { kind: "disconnected" };
  const since = state.historyId ?? notificationHistoryId;
  const added = await deps.listAdded(state, since);
  if (added === "expired") {
    // Nothing is imported, so a reset in between loses nothing: the next
    // notification finds the history expired again and skips ahead.
    await deps.saveHistoryId(state, notificationHistoryId, generation);
    return { kind: "expired", since };
  }
  const counts = await deps.importIds(state, added.messageIds, generation);
  const messages = added.messageIds.length;
  if (await deps.saveHistoryId(state, added.historyId, generation)) return { kind: "processed", messages, counts };
  if ((await deps.resetGeneration()) !== generation) return { kind: "superseded", messages, counts };
  return { kind: "disconnected" };
}
