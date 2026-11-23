import { backfillBatch, backfillQuery } from "./backfill";
import { gmailUnits, type Gmail } from "./gmail";
import { gmailSource } from "./mailSource";

describe("gmailSource", () => {
  const fakeGmail = () => {
    const calls: string[] = [];
    const gmail = {
      users: {
        messages: {
          list: async ({ q, maxResults, pageToken }: { q: string; maxResults: number; pageToken?: string }) => {
            calls.push(`list ${q === backfillQuery ? "backfill" : q} ${maxResults} ${pageToken ?? "-"}`);
            return { data: { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "p2" } };
          },
          get: async ({ id }: { id: string }) => {
            calls.push(`get ${id}`);
            return {
              data: {
                id,
                threadId: `t-${id}`,
                payload: { headers: [{ name: "Subject", value: "Your flight" }], mimeType: "text/plain", body: { data: Buffer.from("Hi").toString("base64url") } },
              },
            };
          },
        },
      },
    } as unknown as Gmail;
    return { gmail, calls };
  };

  it("pages through the backfill search a batch at a time", async () => {
    const { gmail, calls } = fakeGmail();
    const source = gmailSource(gmail);
    expect(await source.searchPage(undefined)).toEqual({ ids: ["m1", "m2"], nextPageToken: "p2" });
    await source.searchPage("p2");
    expect(calls).toEqual([`list backfill ${backfillBatch} -`, `list backfill ${backfillBatch} p2`]);
  });

  it("is Gmail's, so what it imports is recorded as Gmail's", () => {
    expect(gmailSource(fakeGmail().gmail).provider).toBe("gmail");
  });

  it("fetches a message as the import reads it", async () => {
    const { gmail } = fakeGmail();
    const message = await gmailSource(gmail).fetch("m1");
    expect(message).toMatchObject({ id: "m1", threadId: "t-m1", subject: "Your flight", text: "Hi" });
  });

  it("spends each call's quota before making it", async () => {
    const { gmail, calls } = fakeGmail();
    const source = gmailSource(gmail, async (units) => {
      calls.push(`pace ${units}`);
    });
    await source.searchPage(undefined);
    await source.fetch("m1");
    expect(calls).toEqual([`pace ${gmailUnits.list}`, `list backfill ${backfillBatch} -`, `pace ${gmailUnits.getFull}`, "get m1"]);
  });

  it("knows a stale cursor and a missing message by Gmail's answers", () => {
    const source = gmailSource(fakeGmail().gmail);
    expect(source.isStaleCursor(Object.assign(new Error("Invalid pageToken"), { status: 400 }))).toBe(true);
    expect(source.isStaleCursor(Object.assign(new Error("Backend Error"), { status: 500 }))).toBe(false);
    expect(source.isNotFound(Object.assign(new Error("Not Found"), { code: 404 }))).toBe(true);
    expect(source.isNotFound(new Error("socket hang up"))).toBe(false);
  });
});
