import { imapRecordId } from "@travelmo/core";
import type { SearchObject } from "imapflow";
import {
  ImapCursorStale,
  ImapLoginPaused,
  ImapNotFound,
  backfillSearch,
  connectMailbox,
  currentMailboxState,
  imapFlowClient,
  imapLoginBackoffMs,
  imapMaxBytes,
  imapSource,
  inLoginBackoff,
  isImapAuthFailure,
  newSince,
  openInbox,
  searchPage,
  type ImapClient,
  type ImapInbox,
} from "./imap";
import { ImapServerRefused } from "./imap";

// A stand-in for imapflow's client over one inbox: messages by UID, each
// with a subject and when it arrived. SEARCH understands what the adapter
// sends (OR of SUBJECT terms, SINCE, UID ranges); anything else fails the
// test. It records every command, so a test can tell nothing wrote.
type FakeMessage = { uid: number; subject: string; from?: string; at?: string; raw?: string };

function fakeClient(options: { uidValidity?: bigint; messages?: FakeMessage[]; authFails?: boolean } = {}) {
  const commands: string[] = [];
  const messages = options.messages ?? [];
  const uidValidity = options.uidValidity ?? 1700000000n;
  const uidNext = Math.max(0, ...messages.map((m) => m.uid)) + 1;
  let opened = false;
  const matches = (m: FakeMessage, q: SearchObject): boolean => {
    for (const [key, value] of Object.entries(q)) {
      if (key === "or") {
        if (!(value as SearchObject[]).some((sub) => matches(m, sub))) return false;
      } else if (key === "subject") {
        if (!m.subject.toLowerCase().includes(String(value).toLowerCase())) return false;
      } else if (key === "from") {
        if (!(m.from ?? "").toLowerCase().includes(String(value).toLowerCase())) return false;
      } else if (key === "since") {
        if (!m.at || Date.parse(m.at) < (value as Date).getTime()) return false;
      } else if (key === "uid") {
        const [from, to] = String(value).split(":");
        const lo = Number(from);
        // `n:*`, as IMAP servers answer it: the newest message is in range
        // even when its UID is below n.
        const hi = to === "*" ? Infinity : Number(to);
        const newest = Math.max(...messages.map((x) => x.uid));
        if (!((m.uid >= lo && m.uid <= hi) || (to === "*" && m.uid === newest))) return false;
      } else {
        throw new Error(`The fake does not search by ${key}`);
      }
    }
    return true;
  };
  const client: ImapClient = {
    async connect() {
      commands.push("LOGIN");
      if (options.authFails) throw Object.assign(new Error("Authentication failed"), { authenticationFailed: true });
    },
    async getMailboxLock(path, lockOptions) {
      commands.push(lockOptions.readOnly ? `EXAMINE ${path}` : `SELECT ${path}`);
      opened = true;
      return { release: () => {} };
    },
    get mailbox() {
      return opened ? { uidValidity, uidNext, readOnly: true } : false;
    },
    async search(query) {
      commands.push("UID SEARCH");
      return messages.filter((m) => matches(m, query)).map((m) => m.uid);
    },
    async fetchOne(uid, query) {
      commands.push(`UID FETCH ${uid} ${query.source.maxLength}`);
      const found = messages.find((m) => m.uid === Number(uid));
      // As a server sends it: no more than the length asked for.
      return found ? { uid: found.uid, source: Buffer.from(found.raw ?? `Subject: ${found.subject}\r\nFrom: Air <air@example.com>\r\n\r\nYour flight`).subarray(0, query.source.maxLength) } : false;
    },
    async logout() {
      commands.push("LOGOUT");
    },
    close() {
      commands.push("CLOSE");
    },
  };
  return { client, commands };
}

const key = "k1";
const uids = (ids: readonly string[]) => ids.map((id) => Number(id.split("-").pop()));

describe("the inbox", () => {
  it("is opened read-only (EXAMINE), and nothing the adapter does writes", async () => {
    const { client, commands } = fakeClient({ messages: [{ uid: 3, subject: "Your booking" }] });
    const source = imapSource(key, () => openInbox(client));
    await source.searchPage(undefined);
    await source.fetch(imapRecordId(key, "1700000000", 3));
    await source.close();
    expect(commands).toEqual(["LOGIN", "EXAMINE INBOX", "UID SEARCH", `UID FETCH 3 ${imapMaxBytes}`, "LOGOUT"]);
  });

  it("drops the connection when the login is refused", async () => {
    const { client, commands } = fakeClient({ authFails: true });
    const error = await openInbox(client).catch((e: unknown) => e);
    expect(isImapAuthFailure(error)).toBe(true);
    expect(commands).toEqual(["LOGIN", "CLOSE"]);
  });
});

describe("the backfill's search", () => {
  const messages: FakeMessage[] = [
    { uid: 1, subject: "Flight confirmation" },
    { uid: 2, subject: "Lunch on Friday?" },
    { uid: 4, subject: "Hotel reservation" },
    { uid: 7, subject: "Your e-ticket" },
    { uid: 9, subject: "Your account statement", at: "2026-11-20T00:00:00Z" },
    { uid: 10, subject: "Old statement", at: "2026-01-01T00:00:00Z" },
  ];
  const now = new Date("2026-11-24T00:00:00Z");

  it("finds booking-like subjects, and statements from the last 60 days", async () => {
    const { client } = fakeClient({ messages });
    const inbox = await openInbox(client);
    const page = await searchPage(inbox, key, backfillSearch(now), undefined);
    expect(uids(page.ids)).toEqual([9, 7, 4, 1]);
    expect(page.nextPageToken).toBeUndefined();
  });

  it("pages down by UID, newest first, with a cursor naming the UIDVALIDITY", async () => {
    const { client } = fakeClient({ messages });
    const inbox = await openInbox(client);
    const first = await searchPage(inbox, key, backfillSearch(now), undefined, 2);
    expect(uids(first.ids)).toEqual([9, 7]);
    expect(first.nextPageToken).toBe("1700000000:7");
    const second = await searchPage(inbox, key, backfillSearch(now), first.nextPageToken, 2);
    expect(uids(second.ids)).toEqual([4, 1]);
    // UID 1 is the lowest there can be: nothing below it to read.
    expect(second.nextPageToken).toBeUndefined();
    expect(await searchPage(inbox, key, backfillSearch(now), "1700000000:4", 1)).toEqual({ ids: [imapRecordId(key, "1700000000", 1)] });
    expect(await searchPage(inbox, key, backfillSearch(now), "1700000000:1", 2)).toEqual({ ids: [] });
  });

  it("starts over when the inbox's UIDVALIDITY changed", async () => {
    const { client } = fakeClient({ messages, uidValidity: 42n });
    const source = imapSource(key, () => openInbox(client), () => now);
    const error = await source.searchPage("1700000000:7").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImapCursorStale);
    expect(source.isStaleCursor(error)).toBe(true);
  });

  it("includes travel document subjects and sender domains in historical search", () => {
    const query = backfillSearch(now);
    expect(query.or).toContainEqual({ subject: "immigration status" });
    expect(query.or).toContainEqual({ subject: "electronic travel authorisation" });
    expect(query.or).toContainEqual({ from: "notifications.service.gov.uk" });
  });
});

describe("one message", () => {
  it("is downloaded and reduced as a forwarded one is", async () => {
    const raw = [
      "From: Example Air <bookings@example-air.com>",
      "Subject: Your flight to Lisbon",
      "Date: Tue, 24 Nov 2026 08:00:00 +0000",
      "List-Unsubscribe: <mailto:unsubscribe@example-air.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Booking reference ABC123",
    ].join("\r\n");
    const { client } = fakeClient({ messages: [{ uid: 5, subject: "Your flight to Lisbon", raw }] });
    const source = imapSource(key, () => openInbox(client));
    const id = imapRecordId(key, "1700000000", 5);
    expect(await source.fetch(id)).toEqual({
      id,
      threadId: id,
      from: "Example Air <bookings@example-air.com>",
      subject: "Your flight to Lisbon",
      date: expect.stringContaining("2026-11-24"),
      listUnsubscribe: true,
      text: expect.stringContaining("ABC123"),
    });
  });

  it("offers its PDFs for the model, unless the message was too big to read whole", async () => {
    const withPdf = (padding: string) =>
      [
        "Subject: Your e-ticket",
        "From: Example Air <bookings@example-air.com>",
        'Content-Type: multipart/mixed; boundary="m1"',
        "",
        "--m1",
        "Content-Type: text/plain",
        "",
        `Ticket attached.${padding}`,
        "--m1",
        'Content-Type: application/pdf; name="ticket.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("%PDF-1.4 ticket").toString("base64"),
        "--m1--",
        "",
      ].join("\r\n");
    const { client } = fakeClient({ messages: [{ uid: 5, subject: "x", raw: withPdf("") }, { uid: 6, subject: "x", raw: withPdf(" ".repeat(imapMaxBytes)) }] });
    const source = imapSource(key, () => openInbox(client));
    const whole = await source.fetch(imapRecordId(key, "1700000000", 5));
    expect(await whole.attachments?.()).toEqual([{ name: "ticket.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.4 ticket").toString("base64") }]);
    const cut = await source.fetch(imapRecordId(key, "1700000000", 6));
    expect(cut.text).toContain("Ticket attached.");
    expect(cut.attachments).toBeUndefined();
  });

  it("names new mail with ids it then fetches", async () => {
    const { client } = fakeClient({ messages: [{ uid: 5, subject: "Booking confirmed" }, { uid: 6, subject: "Hotel booking" }] });
    const source = imapSource(key, () => openInbox(client));
    const changes = await source.newSince("1700000000:4");
    if (changes === "expired") throw new Error("expired");
    expect(changes.created).toHaveLength(2);
    for (const id of changes.created) expect((await source.fetch(id)).id).toBe(id);
  });

  it("is not found once it has left the inbox, or its UID no longer names it", async () => {
    const { client } = fakeClient({ messages: [{ uid: 5, subject: "x" }], uidValidity: 9n });
    const source = imapSource(key, () => openInbox(client));
    await expect(source.fetch(imapRecordId(key, "9", 6))).rejects.toBeInstanceOf(ImapNotFound);
    await expect(source.fetch(imapRecordId(key, "8", 5))).rejects.toBeInstanceOf(ImapNotFound);
    expect(source.isNotFound(new ImapNotFound())).toBe(true);
  });

  it("must belong to this mailbox", async () => {
    const { client } = fakeClient({ messages: [{ uid: 5, subject: "x" }] });
    const source = imapSource(key, () => openInbox(client));
    await expect(source.fetch(imapRecordId("other", "1700000000", 5))).rejects.toThrow("Not a record id of this IMAP mailbox");
  });
});

describe("new mail", () => {
  const open = async (messages: FakeMessage[], uidValidity?: bigint): Promise<ImapInbox> => openInbox(fakeClient({ messages, ...(uidValidity ? { uidValidity } : {}) }).client);

  it("is every UID above the last one read, oldest first", async () => {
    const inbox = await open([{ uid: 3, subject: "a" }, { uid: 5, subject: "b" }, { uid: 8, subject: "c" }]);
    expect(currentMailboxState(inbox)).toBe("1700000000:8");
    const changes = await newSince(inbox, key, "1700000000:3");
    expect(changes).toEqual({ created: [imapRecordId(key, "1700000000", 5), imapRecordId(key, "1700000000", 8)], state: "1700000000:8" });
  });

  it("is nothing when no UID is above the last one read, despite `n:*` answering the newest", async () => {
    const inbox = await open([{ uid: 3, subject: "a" }]);
    expect(await newSince(inbox, key, "1700000000:3")).toEqual({ created: [], state: "1700000000:3" });
  });

  it("is taken a batch at a time, the place moving only as far as was taken", async () => {
    const inbox = await open([1, 2, 3, 4, 5].map((uid) => ({ uid, subject: "x" })));
    const changes = await newSince(inbox, key, "1700000000:0", 2);
    expect(changes).toEqual({ created: [imapRecordId(key, "1700000000", 1), imapRecordId(key, "1700000000", 2)], state: "1700000000:2" });
  });

  it("starts from now once the inbox's UIDVALIDITY changed", async () => {
    const inbox = await open([{ uid: 1, subject: "x" }], 77n);
    expect(await newSince(inbox, key, "1700000000:3")).toBe("expired");
    expect(currentMailboxState(inbox)).toBe("77:1");
  });
});

describe("a refused password", () => {
  const failedAt = "2026-11-24T10:00:00.000Z";
  const at = (minutes: number) => Date.parse(failedAt) + minutes * 60 * 1000;

  it("is recorded, and background reads leave the mailbox alone for an hour", async () => {
    const recorded: string[] = [];
    const { client, commands } = fakeClient({ authFails: true });
    const error = await connectMailbox({
      background: true,
      nowMs: at(0),
      open: () => openInbox(client),
      loginFailed: async () => void recorded.push("failed"),
    }).catch((e: unknown) => e);
    expect(isImapAuthFailure(error)).toBe(true);
    expect(recorded).toEqual(["failed"]);
    commands.length = 0;
    await expect(
      connectMailbox({ loginFailedAt: failedAt, background: true, nowMs: at(30), open: () => openInbox(client), loginFailed: async () => {} }),
    ).rejects.toBeInstanceOf(ImapLoginPaused);
    expect(commands).toEqual([]);
    expect(inLoginBackoff({ loginFailedAt: failedAt }, at(59))).toBe(true);
    expect(inLoginBackoff({ loginFailedAt: failedAt }, at(0) + imapLoginBackoffMs)).toBe(false);
  });

  it("does not stop a read the user asks for", async () => {
    const { client } = fakeClient({ messages: [{ uid: 1, subject: "x" }] });
    const inbox = await connectMailbox({ loginFailedAt: failedAt, background: false, nowMs: at(1), open: () => openInbox(client), loginFailed: async () => {} });
    expect(inbox.uidValidity).toBe("1700000000");
  });
});

describe("imapflow's client", () => {
  it("refuses servers on private networks before connecting", () => {
    const login = { port: 993, user: "me@example.org", password: "app-password" };
    expect(() => imapFlowClient({ ...login, host: "localhost" }, () => {})).toThrow(ImapServerRefused);
    expect(() => imapFlowClient({ ...login, host: "10.0.0.1" }, () => {})).toThrow(ImapServerRefused);
    expect(() => imapFlowClient({ ...login, host: "metadata.google.internal" }, () => {})).toThrow(ImapServerRefused);
  });

  it("connects with implicit TLS only, logs nothing, and never idles", () => {
    const client = imapFlowClient({ host: "imap.example.org", port: 993, user: "me@example.org", password: "app-password" }, () => {}) as unknown as {
      secureConnection: boolean;
      options: { secure: boolean; logger: unknown; disableAutoIdle: boolean; tls: { rejectUnauthorized: boolean; lookup: unknown } };
    };
    expect(client.options.secure).toBe(true);
    expect(client.secureConnection).toBe(true);
    expect(client.options.logger).toBe(false);
    expect(client.options.disableAutoIdle).toBe(true);
    expect(client.options.tls.rejectUnauthorized).toBe(true);
    expect(typeof client.options.tls.lookup).toBe("function");
  });
});
