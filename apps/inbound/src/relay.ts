// What the Worker sends the parser and what it makes of the answer, kept
// apart from the runtime so it can be tested without one.

export type RelayEnv = {
  // The parser's URL, from wrangler.toml.
  PARSER_URL: string;
  // The shared secret the parser checks, a Worker secret.
  INBOUND_SECRET: string;
};

// The parser refuses bigger messages (inboundMaxBytes there); refusing here
// first saves relaying what would be refused.
export const maxRawBytes = 2 * 1024 * 1024;

export type Envelope = { to: string; from: string };

// The message as it arrived, bytes and envelope, for the parser to parse:
// the Worker holds no parsing of its own, so the free plan's CPU allowance
// is never the limit.
export function relayRequest(env: RelayEnv, envelope: Envelope, raw: ArrayBuffer | Uint8Array): Request {
  return new Request(`${env.PARSER_URL.replace(/\/$/, "")}/inbound/cloudflare`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.INBOUND_SECRET}`,
      "Content-Type": "message/rfc822",
      "X-Envelope-To": envelope.to,
      "X-Envelope-From": envelope.from,
    },
    body: raw,
  });
}

export type Verdict =
  // Delivered: the parser has it, whatever it made of it.
  | { kind: "accepted" }
  // Bounced to the sender with the reason, so a wrong or retired address
  // or a spent day is seen rather than silently dropped.
  | { kind: "reject"; reason: string }
  // Not delivered for now: the Worker fails, and the sending server tries
  // again later.
  | { kind: "retry"; reason: string };

export function verdictOf(status: number): Verdict {
  switch (status) {
    case 204:
      return { kind: "accepted" };
    case 404:
      return { kind: "reject", reason: "No such Travelmo forwarding address" };
    case 413:
      return { kind: "reject", reason: "Message too large for Travelmo; forward it without attachments" };
    case 429:
      return { kind: "reject", reason: "This Travelmo address has reached today's forwarding limit; try again tomorrow" };
    default:
      // 503 is the parser saying the model could not read the message this
      // time; anything else unexpected gets the same second chance.
      return { kind: "retry", reason: `Travelmo's parser answered ${status}` };
  }
}

export const tooLargeReason = "Message too large for Travelmo; forward it without attachments";
