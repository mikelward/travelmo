import { GmailRateLimited, gmailPacer, rateLimitWaitMs, withRateLimitRetry } from "./gmail";

const gaxiosError = (status: number, message: string, reasons: string[] = [], headers: unknown = undefined) =>
  Object.assign(new Error(message), {
    status,
    response: { status, headers, data: { error: { errors: reasons.map((reason) => ({ reason })) } } },
  });

describe("rateLimitWaitMs", () => {
  it("takes 429s, and 403s for rate or quota, as rate limits", () => {
    expect(rateLimitWaitMs(gaxiosError(429, "Quota exceeded for quota metric 'Total Query Cost'"))).toBe(0);
    expect(rateLimitWaitMs(gaxiosError(403, "Rate Limit Exceeded", ["rateLimitExceeded"]))).toBe(0);
    expect(rateLimitWaitMs(gaxiosError(403, "User-rate limit exceeded", ["userRateLimitExceeded"]))).toBe(0);
    expect(rateLimitWaitMs(gaxiosError(403, "Quota exceeded for quota metric 'Queries'"))).toBe(0);
    expect(rateLimitWaitMs(Object.assign(new Error("Too Many Requests"), { code: 429 }))).toBe(0);
  });

  it("takes anything else as an error", () => {
    expect(rateLimitWaitMs(gaxiosError(403, "Insufficient Permission", ["insufficientPermissions"]))).toBeUndefined();
    expect(rateLimitWaitMs(gaxiosError(500, "Backend Error"))).toBeUndefined();
    expect(rateLimitWaitMs(gaxiosError(400, "Invalid pageToken"))).toBeUndefined();
    expect(rateLimitWaitMs(new Error("socket hang up"))).toBeUndefined();
    expect(rateLimitWaitMs("nope")).toBeUndefined();
  });

  it("reads how long Gmail asks to wait, in seconds or as a date", () => {
    expect(rateLimitWaitMs(gaxiosError(429, "x", [], new Headers({ "Retry-After": "7" })))).toBe(7000);
    expect(rateLimitWaitMs(gaxiosError(429, "x", [], { "retry-after": "Thu, 01 Jan 2030 00:00:20 GMT" }), Date.parse("2030-01-01T00:00:00Z"))).toBe(
      20_000,
    );
  });
});

describe("withRateLimitRetry", () => {
  it("gives up as rate limited rather than wait past the time left", async () => {
    const waits: number[] = [];
    let left = 5000;
    const call = withRateLimitRetry(async () => Promise.reject(gaxiosError(429, "Quota exceeded")), {
      timeLeftMs: () => left,
      sleep: async (ms) => {
        waits.push(ms);
        left -= ms;
      },
      log: () => {},
    });
    await expect(call).rejects.toBeInstanceOf(GmailRateLimited);
    // 2 s, then 4 s would overrun what is left.
    expect(waits).toEqual([2000]);
  });
});

describe("gmailPacer", () => {
  it("spreads calls so they spend no more than the units a minute", async () => {
    let clock = 0;
    const pace = gmailPacer(6000, { nowMs: () => clock, sleep: async (ms) => void (clock += ms) });
    for (let i = 0; i < 200; i++) await pace(60);
    // 200 full messages at 60 units, 100 a minute: the last starts at 199 × 0.6 s.
    expect(clock).toBe(119_400);
  });
});
