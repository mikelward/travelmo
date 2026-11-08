import { maxRawBytes, relayRequest, tooLargeReason, verdictOf, type RelayEnv } from "./relay";

// Cloudflare Email Routing hands every message for the forwarding domain
// to this handler (a catch-all rule); the parser decides whose it is.
export default {
  async email(message: ForwardableEmailMessage, env: RelayEnv): Promise<void> {
    if (message.rawSize > maxRawBytes) {
      message.setReject(tooLargeReason);
      return;
    }
    const raw = await new Response(message.raw).arrayBuffer();
    const response = await fetch(relayRequest(env, { to: message.to, from: message.from }, raw));
    const verdict = verdictOf(response.status);
    if (verdict.kind === "reject") message.setReject(verdict.reason);
    else if (verdict.kind === "retry") throw new Error(verdict.reason);
  },
};
