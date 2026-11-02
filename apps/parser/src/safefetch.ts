import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";

// Fetches a URL a user typed in (a calendar feed) from inside our network,
// where it could otherwise reach internal services: the metadata server,
// other Cloud Run services, anything on a private range. Only https on the
// default port, only to public addresses, checked at every connection (the
// address checked is the address used, so DNS cannot be switched between
// check and connect), a few redirects at most, each checked again, and a
// cap on time and size.

export class FeedUrlRefused extends Error {}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked.check(address, "ipv6");
  }
  return false;
}

// webcal:// is how calendar apps hand out feed links; it means https.
export function normalizeFeedUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    throw new FeedUrlRefused("That is not a web address.");
  }
  if (url.protocol !== "https:") throw new FeedUrlRefused("Only https:// (or webcal://) feed addresses are accepted.");
  if (url.port && url.port !== "443") throw new FeedUrlRefused("Feed addresses must use the standard https port.");
  if (url.username || url.password) throw new FeedUrlRefused("Feed addresses with a user name or password are not accepted.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new FeedUrlRefused("That address is on a private network.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || !host.includes(".")) {
    throw new FeedUrlRefused("That address is on a private network.");
  }
  return url;
}

type Resolver = (hostname: string, callback: (error: Error | null, addresses: LookupAddress[]) => void) => void;

const systemResolver: Resolver = (hostname, callback) => dnsLookup(hostname, { all: true }, callback);

// A lookup for https.request that refuses a host any of whose addresses is
// not public, and connects to the address it checked.
export function publicOnlyLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (error, addresses) => {
      if (error) return callback(error, "", 4);
      if (addresses.length === 0) return callback(new FeedUrlRefused(`No address for ${hostname}`), "", 4);
      if (!addresses.every((a) => isPublicAddress(a.address))) {
        return callback(new FeedUrlRefused("That address is on a private network."), "", 4);
      }
      const chosen = addresses[0]!;
      if ((options as { all?: boolean }).all) {
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [chosen]);
      }
      callback(null, chosen.address, chosen.family);
    });
  };
}

export async function readCapped(body: Readable, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > maxBytes) {
      body.destroy();
      throw new FeedUrlRefused(`The feed is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type FetchLimits = { maxBytes: number; timeoutMs: number; maxRedirects: number };

export const feedLimits: FetchLimits = { maxBytes: 5 * 1024 * 1024, timeoutMs: 15_000, maxRedirects: 3 };

export class FeedFetchFailed extends Error {}

// https.request, or a stand-in for tests.
export type Requester = typeof request;

export async function fetchFeed(
  input: string,
  limits: FetchLimits = feedLimits,
  resolve?: Resolver,
  send: Requester = request,
): Promise<string> {
  let url = normalizeFeedUrl(input);
  const lookup = publicOnlyLookup(resolve);
  // One deadline for the whole fetch, from DNS to the last byte, across
  // redirects: a server trickling headers or body cannot stretch it.
  const deadline = Date.now() + limits.timeoutMs;
  for (let redirects = 0; ; redirects++) {
    let response: IncomingMessage | undefined;
    let timer: NodeJS.Timeout | undefined;
    const expired = new FeedFetchFailed("The feed took too long to answer.");
    try {
      response = await new Promise<IncomingMessage>((ok, fail) => {
        const req = send(
          url,
          { lookup, timeout: limits.timeoutMs, headers: { accept: "text/calendar, */*;q=0.5", "user-agent": "Travelmo calendar import" } },
          ok,
        );
        timer = setTimeout(() => {
          req.destroy(expired);
          response?.destroy(expired);
        }, Math.max(0, deadline - Date.now()));
        req.on("timeout", () => req.destroy(expired));
        req.on("error", fail);
        req.end();
      });
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        // Unread bodies are dropped, not drained: a server could send one
        // forever, outside the size cap.
        response.destroy();
        if (redirects >= limits.maxRedirects) throw new FeedFetchFailed("The feed redirected too many times.");
        url = normalizeFeedUrl(new URL(response.headers.location, url).toString());
        continue;
      }
      if (status !== 200) {
        response.destroy();
        throw new FeedFetchFailed(`The feed answered ${status}.`);
      }
      try {
        return await readCapped(response, limits.maxBytes);
      } catch (error) {
        // A body cut off by the deadline reads as the deadline.
        throw response.destroyed && Date.now() >= deadline ? expired : error;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
