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

export function parseGmailPush(body: unknown): GmailNotification {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) throw new BadPushEnvelope("Not a Pub/Sub push envelope with message data");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(envelope.data.message.data, "base64").toString("utf8"));
  } catch {
    throw new BadPushEnvelope("Pub/Sub message data is not base64 JSON");
  }
  const notification = notificationSchema.safeParse(decoded);
  if (!notification.success) throw new BadPushEnvelope("Pub/Sub message is not a Gmail notification");
  return {
    ...notification.data,
    pubsubMessageId: envelope.data.message.messageId,
    deliveryAttempt: envelope.data.deliveryAttempt,
  };
}
