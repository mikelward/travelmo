import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { FeedFetchFailed, FeedUrlRefused, fetchFeed, type Requester, isPublicAddress, normalizeFeedUrl, publicOnlyLookup, readCapped } from "./safefetch";

describe("isPublicAddress", () => {
  it("refuses private, loopback, link-local and metadata addresses", () => {
    for (const a of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPublicAddress(a)).toBe(false);
    }
  });
  it("accepts public ones", () => {
    for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(a)).toBe(true);
  });
});

describe("normalizeFeedUrl", () => {
  it("turns webcal into https and keeps the rest", () => {
    expect(normalizeFeedUrl("webcal://www.example.com/feed/ics?token=abc").toString()).toBe("https://www.example.com/feed/ics?token=abc");
  });
  it("refuses other schemes, ports, credentials and private hosts", () => {
    for (const bad of [
      "http://example.com/feed.ics",
      "file:///etc/passwd",
      "https://example.com:8443/feed.ics",
      "https://user:pass@example.com/feed.ics",
      "https://169.254.169.254/computeMetadata/v1/",
      "https://[::1]/feed.ics",
      "https://localhost/feed.ics",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://intranet/feed.ics",
      "not a url",
    ]) {
      expect(() => normalizeFeedUrl(bad), bad).toThrow(FeedUrlRefused);
    }
  });
});

describe("publicOnlyLookup", () => {
  const lookupWith = (addresses: string[]) =>
    publicOnlyLookup((_host, cb) => cb(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))));
  const run = (lookup: ReturnType<typeof publicOnlyLookup>) =>
    new Promise<string>((ok, fail) => lookup("feed.example.com", {}, (error, address) => (error ? fail(error) : ok(address as string))));

  it("connects to the public address it checked", async () => {
    await expect(run(lookupWith(["93.184.216.34"]))).resolves.toBe("93.184.216.34");
  });
  it("refuses a name with any private address, so DNS cannot point it inside", async () => {
    await expect(run(lookupWith(["93.184.216.34", "10.0.0.5"]))).rejects.toThrow(FeedUrlRefused);
  });
});

describe("readCapped", () => {
  it("reads up to the cap and refuses past it", async () => {
    await expect(readCapped(Readable.from([Buffer.from("BEGIN:"), Buffer.from("VCALENDAR")]), 100)).resolves.toBe("BEGIN:VCALENDAR");
    await expect(readCapped(Readable.from([Buffer.alloc(60), Buffer.alloc(60)]), 100)).rejects.toThrow(FeedUrlRefused);
  });
});

describe("fetchFeed", () => {
  it("never connects to a host that resolves to a private address", async () => {
    const resolve = (_host: string, cb: (e: Error | null, a: { address: string; family: number }[]) => void) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }]);
    await expect(fetchFeed("https://rebind.example.com/feed.ics", undefined, resolve)).rejects.toThrow(FeedUrlRefused);
  });
});

describe("fetchFeed responses", () => {
  // A server answering with an endless body: one that is not wanted must be
  // dropped at once rather than drained.
  function endless(statusCode: number, headers: Record<string, string> = {}) {

    const body = new Readable({
      read() {
        this.push(Buffer.alloc(1024));
      },
    }) as Readable & Partial<IncomingMessage>;
    Object.assign(body, { statusCode, headers });
    return { body: body as unknown as IncomingMessage };
  }
  const answering = (responses: IncomingMessage[]): Requester =>
    ((_url: unknown, _opts: unknown, cb: (r: IncomingMessage) => void) => {
      const req = new EventEmitter() as EventEmitter & { end(): void; destroy(error?: Error): void };
      req.end = () => {
        const next = responses.shift();
        if (next) queueMicrotask(() => cb(next));
      };
      req.destroy = (error?: Error) => void (error && req.emit("error", error));
      return req;
    }) as unknown as Requester;

  it("drops the body of an error answer instead of downloading it", async () => {
    const error = endless(500);
    await expect(fetchFeed("https://feeds.example.com/x.ics", undefined, undefined, answering([error.body]))).rejects.toThrow(FeedFetchFailed);
    // Destroyed, the body can produce nothing more: it is not being drained.
    expect(error.body.destroyed).toBe(true);
    expect(error.body.readableFlowing).not.toBe(true);
  });

  it("drops a redirect's body and refuses a redirect to a private address", async () => {
    const redirect = endless(302, { location: "https://169.254.169.254/latest" });
    await expect(fetchFeed("https://feeds.example.com/x.ics", undefined, undefined, answering([redirect.body]))).rejects.toThrow(FeedUrlRefused);
    expect(redirect.body.destroyed).toBe(true);
  });
});

describe("fetchFeed deadline", () => {
  const quick = { maxBytes: 1024 * 1024, timeoutMs: 40, maxRedirects: 3 };
  const silent: Requester = ((_u: unknown, _o: unknown, _cb: unknown) => {
    const req = new EventEmitter() as EventEmitter & { end(): void; destroy(error?: Error): void };
    req.end = () => {};
    req.destroy = (error?: Error) => void (error && req.emit("error", error));
    return req;
  }) as unknown as Requester;

  afterEach(() => void vi.useRealTimers());

  it("gives up on a server that never answers", async () => {
    vi.useFakeTimers();
    const fetching = fetchFeed("https://feeds.example.com/x.ics", quick, undefined, silent);
    const outcome = expect(fetching).rejects.toThrow("took too long");
    await vi.advanceTimersByTimeAsync(quick.timeoutMs);
    await outcome;
  });

  it("gives up on a body trickled in forever, however steadily", async () => {
    let timer: NodeJS.Timeout | undefined;
    const body = new Readable({
      read() {
        timer = setTimeout(() => this.push(Buffer.from("x")), 5);
      },
      destroy(error, cb) {
        clearTimeout(timer);
        cb(error);
      },
    });
    Object.assign(body, { statusCode: 200, headers: {} });
    const send = ((_u: unknown, _o: unknown, cb: (r: IncomingMessage) => void) => {
      const req = new EventEmitter() as EventEmitter & { end(): void; destroy(error?: Error): void };
      req.end = () => queueMicrotask(() => cb(body as unknown as IncomingMessage));
      req.destroy = () => {};
      return req;
    }) as unknown as Requester;
    vi.useFakeTimers();
    const fetching = fetchFeed("https://feeds.example.com/x.ics", quick, undefined, send);
    const outcome = expect(fetching).rejects.toThrow("took too long");
    // A byte every 5 ms, steadily, for the whole allowance and past it.
    await vi.advanceTimersByTimeAsync(quick.timeoutMs + 10);
    await outcome;
  });
});
