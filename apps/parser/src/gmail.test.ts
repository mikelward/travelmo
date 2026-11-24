import { GmailRateLimited, fetchMessage, gmailPacer, maxAttachmentBytes, pdfParts, rateLimitWaitMs, withRateLimitRetry, type Gmail } from "./gmail";

describe("pdfParts", () => {
  const pdf = (name: string, size: number, more: object = {}) => ({ filename: name, mimeType: "application/pdf", body: { attachmentId: `a-${name}`, size }, ...more });
  it("finds PDFs however deep, by type or by name, up to three and within the size limits", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: "aGk", size: 2 } },
        { mimeType: "multipart/related", parts: [pdf("ticket.pdf", 1000)] },
        { filename: "receipt.PDF", mimeType: "application/octet-stream", body: { attachmentId: "a-receipt", size: 500 } },
        pdf("huge.pdf", maxAttachmentBytes + 1),
        { filename: "photo.jpg", mimeType: "image/jpeg", body: { attachmentId: "a-photo", size: 100 } },
        pdf("third.pdf", 100),
        pdf("fourth.pdf", 100),
      ],
    };
    expect(pdfParts(payload).map((p) => p.name)).toEqual(["ticket.pdf", "receipt.PDF", "third.pdf"]);
  });
  it("stops at the total limit", () => {
    const four = maxAttachmentBytes - 1;
    expect(pdfParts({ parts: [pdf("a.pdf", four), pdf("b.pdf", four), pdf("c.pdf", four)] }).map((p) => p.name)).toEqual(["a.pdf", "b.pdf"]);
  });
});

describe("fetchMessage", () => {
  it("fetches a message's PDFs only when asked, as standard base64", async () => {
    const fetched: string[] = [];
    const gmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "m1",
              threadId: "t1",
              payload: { headers: [{ name: "Subject", value: "Tickets" }], parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Tickets attached").toString("base64url"), size: 16 } }, { filename: "ticket.pdf", mimeType: "application/pdf", body: { attachmentId: "att1", size: 4 } }] },
            },
          }),
          attachments: { get: async ({ id }: { id: string }) => (fetched.push(id), { data: { data: Buffer.from([0xfb, 0xff, 0x01]).toString("base64url") } }) },
        },
      },
    } as unknown as Gmail;
    const message = await fetchMessage(gmail, "m1");
    expect(fetched).toEqual([]);
    expect(await message.attachments!()).toEqual([{ name: "ticket.pdf", mimeType: "application/pdf", data: Buffer.from([0xfb, 0xff, 0x01]).toString("base64") }]);
    expect(fetched).toEqual(["att1"]);
  });
});

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
