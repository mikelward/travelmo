import { backfillBatch } from "./backfill";
import { isNotFound, rateLimitWaitMs } from "./gmail";
import {
  backfillFilter,
  currentEmailState,
  fastmailRecordId,
  fastmailSessionUrl,
  fastmailSource,
  inboxCreatedSince,
  jmapClient,
  jmapSession,
  mailboxRoles,
  type FetchFn,
} from "./jmap";

type Email = {
  id: string;
  threadId: string;
  mailboxIds: Record<string, boolean>;
  from: { name?: string; email: string }[];
  subject: string;
  sentAt: string;
  receivedAt: string;
  text?: string | undefined;
  html?: string | undefined;
  unsubscribe?: string | undefined;
};

// Just enough of a JMAP server: a session, mailboxes, a search over subject
// and mailbox, emails with bodies, and changes since a state.
function fakeFastmail(options: { readOnly?: boolean; apiUrl?: string; emails?: Email[]; maxObjectsInGet?: number } = {}) {
  const token = "fmu1-token";
  const emails: Email[] = options.emails ?? [];
  const mailboxes = [
    { id: "inbox", role: "inbox" },
    { id: "trash", role: "trash" },
    { id: "spam", role: "junk" },
    { id: "trips", role: null },
  ];
  let state = 1;
  const created: Record<number, string[]> = {};
  const requests: { url: string; calls: unknown[] }[] = [];
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  const matches = (email: Email, filter: Record<string, unknown>): boolean => {
    if (filter.operator === "AND") return (filter.conditions as Record<string, unknown>[]).every((c) => matches(email, c));
    if (filter.operator === "OR") return (filter.conditions as Record<string, unknown>[]).some((c) => matches(email, c));
    if (filter.operator === "NOT") return !(filter.conditions as Record<string, unknown>[]).some((c) => matches(email, c));
    // As RFC 8621 §4.4.1 has them.
    if (filter.inMailboxOtherThan) return Object.keys(email.mailboxIds).some((m) => !(filter.inMailboxOtherThan as string[]).includes(m));
    if (filter.inMailbox) return email.mailboxIds[String(filter.inMailbox)] === true;
    if (filter.subject) return email.subject.toLowerCase().includes(String(filter.subject).toLowerCase());
    if (filter.from) return email.from.some((f) => f.email.endsWith(String(filter.from)));
    if (filter.after) return email.receivedAt >= String(filter.after);
    throw new Error(`unknown filter ${JSON.stringify(filter)}`);
  };
  const method = (name: string, args: Record<string, unknown>): [string, Record<string, unknown>] => {
    switch (name) {
      case "Mailbox/get":
        return [name, { list: mailboxes, state: "m1" }];
      case "Email/query": {
        const sorted = emails.filter((e) => matches(e, args.filter as Record<string, unknown>)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
        let start = Number(args.position ?? 0);
        if (args.anchor) {
          const at = sorted.findIndex((e) => e.id === args.anchor);
          if (at < 0) return ["error", { type: "anchorNotFound" }];
          start = at + Number(args.anchorOffset ?? 0);
        }
        return [name, { ids: sorted.slice(start, start + Number(args.limit)).map((e) => e.id) }];
      }
      case "Email/get": {
        if (options.maxObjectsInGet && (args.ids as string[]).length > options.maxObjectsInGet) return ["error", { type: "requestTooLarge" }];
        const found = emails.filter((e) => (args.ids as string[]).includes(e.id));
        return [
          name,
          {
            state: String(state),
            list: found.map((e) => ({
              id: e.id,
              threadId: e.threadId,
              mailboxIds: e.mailboxIds,
              from: e.from,
              subject: e.subject,
              sentAt: e.sentAt,
              receivedAt: e.receivedAt,
              "header:List-Unsubscribe:asText": e.unsubscribe ?? null,
              textBody: e.text !== undefined ? [{ partId: "1" }] : [],
              htmlBody: e.html !== undefined ? [{ partId: "2" }] : e.text !== undefined ? [{ partId: "1" }] : [],
              bodyValues: { ...(e.text !== undefined ? { 1: { value: e.text } } : {}), ...(e.html !== undefined ? { 2: { value: e.html } } : {}) },
            })),
            notFound: (args.ids as string[]).filter((id) => !found.some((e) => e.id === id)),
          },
        ];
      }
      case "Email/changes": {
        const since = Number(args.sinceState);
        if (since < 1) return ["error", { type: "cannotCalculateChanges" }];
        if (since >= state) return [name, { created: [], updated: [], destroyed: [], newState: String(state), hasMoreChanges: false }];
        const next = since + 1;
        return [name, { created: created[next] ?? [], updated: [], destroyed: [], newState: String(next), hasMoreChanges: next < state }];
      }
      default:
        return ["error", { type: "unknownMethod" }];
    }
  };
  const fetchFn: FetchFn = async (url, init) => {
    if ((init.headers as Record<string, string>).Authorization !== `Bearer ${token}`) return json({}, 401);
    if (url === fastmailSessionUrl) {
      return json({
        apiUrl: options.apiUrl ?? "https://api.fastmail.com/jmap/api/",
        username: "traveler@fastmail.com",
        primaryAccounts: { "urn:ietf:params:jmap:mail": "u1" },
        accounts: { u1: { isReadOnly: options.readOnly ?? true } },
        capabilities: { "urn:ietf:params:jmap:core": { maxObjectsInGet: options.maxObjectsInGet ?? 500 } },
      });
    }
    const body = JSON.parse(String(init.body)) as { methodCalls: [string, Record<string, unknown>, string][] };
    requests.push({ url, calls: body.methodCalls });
    return json({ methodResponses: body.methodCalls.map(([name, args, tag]) => [...method(name, args), tag]) });
  };
  return {
    token,
    fetchFn,
    requests,
    emails,
    // New mail arrives: one more state, with these emails created in it.
    deliver: (...more: Email[]) => {
      state += 1;
      created[state] = more.map((e) => e.id);
      emails.push(...more);
    },
  };
}

const email = (id: string, subject: string, receivedAt: string, over: Partial<Email> = {}): Email => ({
  id,
  threadId: `T${id}`,
  mailboxIds: { inbox: true },
  from: [{ name: "Example Air", email: "noreply@example-air.com" }],
  subject,
  sentAt: receivedAt,
  receivedAt,
  text: `Your booking ${id}`,
  ...over,
});

describe("jmapSession", () => {
  it("finds the mail account, its address and whether the token is read-only", async () => {
    const fm = fakeFastmail();
    expect(await jmapSession(fm.token, fm.fetchFn)).toEqual({
      apiUrl: "https://api.fastmail.com/jmap/api/",
      accountId: "u1",
      username: "traveler@fastmail.com",
      readOnly: true,
      maxObjectsInGet: 500,
    });
    expect((await jmapSession(fm.token, fakeFastmail({ readOnly: false }).fetchFn)).readOnly).toBe(false);
  });

  it("refuses a bad token, and an API anywhere but Fastmail", async () => {
    await expect(jmapSession("wrong", fakeFastmail().fetchFn)).rejects.toMatchObject({ status: 401 });
    const elsewhere = fakeFastmail({ apiUrl: "https://attacker.example/jmap/" });
    await expect(jmapSession(elsewhere.token, elsewhere.fetchFn)).rejects.toThrow("unexpectedApiUrl");
  });
});

describe("fastmailSource", () => {
  const setup = async (emails: Email[]) => {
    const fm = fakeFastmail({ emails });
    const session = await jmapSession(fm.token, fm.fetchFn);
    const jmap = jmapClient(fm.token, session, fm.fetchFn);
    const now = new Date("2026-11-23T12:00:00Z");
    const source = fastmailSource(async () => jmap, () => now);
    return { fm, jmap, source };
  };

  it("searches booking-like mail newest first, outside trash and junk", async () => {
    const { source } = await setup([
      email("M1", "Your flight confirmation", "2026-01-01T10:00:00Z"),
      email("M2", "Lunch on Friday?", "2026-01-02T10:00:00Z"),
      email("M3", "Hotel reservation", "2026-01-03T10:00:00Z"),
      email("M4", "Your booking", "2026-01-04T10:00:00Z", { mailboxIds: { trash: true } }),
      // Deleted or spam, though it keeps another label too.
      email("M6", "Hotel booking", "2026-01-05T10:00:00Z", { mailboxIds: { trash: true, trips: true } }),
      email("M7", "Flight booking", "2026-01-06T10:00:00Z", { mailboxIds: { spam: true, inbox: true } }),
      email("M5", "Monthly statement", "2026-11-01T10:00:00Z", { from: [{ email: "points@example.com" }] }),
    ]);
    expect(await source.searchPage(undefined)).toEqual({ ids: [fastmailRecordId("M3"), fastmailRecordId("M1")] });
  });

  it("carries on after the last email of a full page, however much mail arrives meanwhile", async () => {
    const emails = Array.from({ length: backfillBatch + 2 }, (_, i) =>
      email(`M${i}`, "Booking confirmed", new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString()),
    );
    const { fm, source } = await setup(emails);
    const first = await source.searchPage(undefined);
    expect(first.ids).toHaveLength(backfillBatch);
    expect(first.nextPageToken).toBe(`M2`);
    fm.emails.push(email("Mnew", "Booking confirmed", "2026-11-23T00:00:00Z"));
    const rest = await source.searchPage(first.nextPageToken);
    expect(rest).toEqual({ ids: [fastmailRecordId("M1"), fastmailRecordId("M0")] });
  });

  it("starts over when the email it carried on after is gone", async () => {
    const { source } = await setup([email("M1", "Booking confirmed", "2026-01-01T10:00:00Z")]);
    const error = await source.searchPage("Mdeleted").catch((e: unknown) => e);
    expect(source.isStaleCursor(error)).toBe(true);
    expect(source.isStaleCursor(new Error("socket hang up"))).toBe(false);
  });

  it("reads an email as the import does, plain text over a richer HTML", async () => {
    const { source } = await setup([
      email("M1", "Your flight", "2026-01-01T10:00:00Z", { text: "Flight XY123 on 2 Feb", unsubscribe: "<mailto:u@example.com>" }),
      email("M2", "Hotel", "2026-01-01T11:00:00Z", { text: undefined, html: "<p>Room for <b>two</b> nights</p>" }),
    ]);
    expect(await source.fetch(fastmailRecordId("M1"))).toEqual({
      id: "fm-M1",
      threadId: "fm-TM1",
      from: "Example Air <noreply@example-air.com>",
      subject: "Your flight",
      date: "2026-01-01T10:00:00Z",
      listUnsubscribe: true,
      text: "Flight XY123 on 2 Feb",
    });
    expect((await source.fetch(fastmailRecordId("M2"))).text).toBe("Room for two nights");
  });

  it("says when an email is gone, as Gmail's 404 does", async () => {
    const { source } = await setup([]);
    const error = await source.fetch(fastmailRecordId("Mgone")).catch((e: unknown) => e);
    expect(source.isNotFound(error)).toBe(true);
    expect(isNotFound(error)).toBe(true);
  });

  it("reaches Fastmail only once something is read, and connects once", async () => {
    const fm = fakeFastmail({ emails: [email("M1", "Booking confirmed", "2026-01-01T10:00:00Z")] });
    let connects = 0;
    const source = fastmailSource(async () => {
      connects += 1;
      return jmapClient(fm.token, await jmapSession(fm.token, fm.fetchFn), fm.fetchFn);
    });
    expect(source.isStaleCursor(new Error("x"))).toBe(false);
    expect(connects).toBe(0);
    await source.searchPage(undefined);
    await source.fetch(fastmailRecordId("M1"));
    expect(connects).toBe(1);
  });

  it("is Fastmail's, so what it imports is recorded as Fastmail's", async () => {
    const { source } = await setup([]);
    expect(source.provider).toBe("fastmail");
  });

  it("refuses an id that is not a Fastmail record's", async () => {
    const { source } = await setup([]);
    await expect(source.fetch("18c2f0a1b2c3d4e5")).rejects.toThrow("Not a Fastmail record id");
  });
});

describe("inboxCreatedSince", () => {
  it("lists new inbox mail across pages of changes, and where the mailbox is now", async () => {
    const fm = fakeFastmail();
    const session = await jmapSession(fm.token, fm.fetchFn);
    const jmap = jmapClient(fm.token, session, fm.fetchFn);
    const start = await currentEmailState(jmap);
    fm.deliver(email("M1", "Flight", "2026-11-23T10:00:00Z"));
    fm.deliver(email("M2", "Sent reply", "2026-11-23T10:01:00Z", { mailboxIds: { sent: true } }), email("M3", "Hotel", "2026-11-23T10:02:00Z"));
    const { inbox } = await mailboxRoles(jmap);
    expect(await inboxCreatedSince(jmap, start, inbox)).toEqual({ created: ["M1", "M3"], state: "3" });
    expect(await inboxCreatedSince(jmap, "3", inbox)).toEqual({ created: [], state: "3" });
  });

  it("looks up a long run of new mail in batches the server takes", async () => {
    const fm = fakeFastmail({ maxObjectsInGet: 2 });
    const jmap = jmapClient(fm.token, await jmapSession(fm.token, fm.fetchFn), fm.fetchFn);
    const start = await currentEmailState(jmap);
    fm.deliver(...["M1", "M2", "M3", "M4", "M5"].map((id) => email(id, "Flight", "2026-11-23T10:00:00Z")));
    expect(await inboxCreatedSince(jmap, start, ["inbox"])).toEqual({ created: ["M1", "M2", "M3", "M4", "M5"], state: "2" });
  });

  it("says so when the server can no longer tell what changed", async () => {
    const fm = fakeFastmail();
    const jmap = jmapClient(fm.token, await jmapSession(fm.token, fm.fetchFn), fm.fetchFn);
    expect(await inboxCreatedSince(jmap, "0", ["inbox"])).toBe("expired");
  });
});

describe("Fastmail rate limits", () => {
  it("reads as Gmail's do, with how long to wait", async () => {
    const limited: FetchFn = async () => new Response("", { status: 429, headers: { "Retry-After": "3" } });
    const jmap = jmapClient("t", { apiUrl: "https://api.fastmail.com/jmap/api/", accountId: "u1" }, limited);
    const error = await mailboxRoles(jmap).catch((e: unknown) => e);
    expect(rateLimitWaitMs(error)).toBe(3000);
  });
});
