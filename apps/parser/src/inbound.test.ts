import type { ExtractedBooking, ForwardAddress } from "@travelmo/core";
import { describe, expect, it, vi } from "vitest";
import { hashToken } from "./calendarExport";
import type { EmailMessage } from "./gmail";
import type { ImportDeps } from "./importer";
import {
  forwardRecord,
  inboundMessageId,
  newForwardToken,
  parseInbound,
  receiveForwarded,
  secretMatches,
  type ForwardStore,
  type Received,
} from "./inbound";
import { memoryStore } from "./testStore";

const token = "abcdefghijklmnopqrst";
const domain = "travelmo.app";
const address = `${token}@${domain}`;

const lodging: ExtractedBooking = {
  isBooking: true,
  segments: [
    {
      type: "lodging",
      title: "Cove Liverpool",
      start: "2026-12-12T15:00:00+00:00",
      end: "2026-12-14T11:00:00+00:00",
      destination: { name: "Cove Liverpool", city: "Liverpool", country: "GB" },
    },
  ],
};

// A Gmail forward of a hotel confirmation: multipart/alternative, the plain
// part quoted-printable, the HTML part base64, a Message-ID of its own.
const forwarded = (over: { messageId?: string; subject?: string } = {}) =>
  new TextEncoder().encode(
    [
      "MIME-Version: 1.0",
      "Date: Mon, 2 Nov 2026 09:00:00 +0000",
      `Message-ID: <${over.messageId ?? "fwd-1@mail.example.com"}>`,
      `Subject: ${over.subject ?? "Fwd: Your booking confirmation - Cove Liverpool"}`,
      "From: Sam Traveler <sam@example.com>",
      `To: ${address}`,
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "FYI",
      "",
      "---------- Forwarded message ---------",
      "From: Cove <stay@cove.example>",
      "Date: Mon, 1 Nov 2026 at 10:00",
      "Subject: Your booking confirmation - Cove Liverpool",
      "To: <sam@example.com>",
      "",
      "Check-in 12 Dec, check-out 14 Dec =E2=80=94 see you soon",
      "",
      "--b1",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("<div>FYI<br><b>Check-in 12 Dec</b></div>").toString("base64"),
      "--b1--",
      "",
    ].join("\r\n"),
  );

function memoryForwardStore(known: Record<string, string> = {}): ForwardStore & { records: Map<string, ForwardAddress>; counts: Map<string, number> } {
  const tokens = new Map(Object.entries(known));
  const records = new Map<string, ForwardAddress>();
  const counts = new Map<string, number>();
  return {
    records,
    counts,
    uidForToken: async (hash) => tokens.get(hash),
    issue: async (uid, record, hash) => {
      for (const [h, u] of tokens) if (u === uid) tokens.delete(h);
      tokens.set(hash, uid);
      records.set(uid, record);
    },
    stop: async (uid) => {
      for (const [h, u] of tokens) if (u === uid) tokens.delete(h);
      records.delete(uid);
    },
    reserve: async (uid, day, limit) => {
      const key = `${uid}/${day}`;
      const count = counts.get(key) ?? 0;
      if (count >= limit) return false;
      counts.set(key, count + 1);
      return true;
    },
  };
}

function deps(store = memoryStore(), extract: ImportDeps["extract"] = async () => lodging): ImportDeps {
  return { store, extract, now: () => "2026-11-02T09:30:00Z", log: () => {} };
}

describe("tokens and secrets", () => {
  it("mints twenty-character lowercase tokens that differ each time", () => {
    const a = newForwardToken();
    const b = newForwardToken();
    expect(a).toMatch(/^[a-z2-7]{20}$/);
    expect(b).toMatch(/^[a-z2-7]{20}$/);
    expect(a).not.toBe(b);
    expect(forwardRecord(a, domain, "2026-11-02T09:30:00Z")).toEqual({ address: `${a}@${domain}`, createdAt: "2026-11-02T09:30:00Z" });
  });

  it("compares the relay's secret without caring about its length", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches("", "s3cret")).toBe(false);
  });
});

describe("parseInbound", () => {
  it("reads the headers and the plain part, decoded", async () => {
    const mail = await parseInbound(forwarded());
    expect(mail).toMatchObject({
      messageId: "<fwd-1@mail.example.com>",
      from: "Sam Traveler <sam@example.com>",
      subject: "Fwd: Your booking confirmation - Cove Liverpool",
      listUnsubscribe: false,
    });
    expect(mail.date).toContain("2026-11-02");
    expect(mail.text).toContain("Check-in 12 Dec, check-out 14 Dec — see you soon");
    expect(mail.text).not.toContain("<b>");
  });

  it("flattens the HTML when there is no plain part", async () => {
    const raw = new TextEncoder().encode(
      ["Subject: Tickets", "From: Rail <t@rail.example>", "Content-Type: text/html", "", "<p>Coach <b>B</b></p><style>p{}</style>", ""].join("\r\n"),
    );
    const mail = await parseInbound(raw);
    expect(mail.text).toBe("Coach B");
    expect(mail.messageId).toBeUndefined();
  });

  it("derives one record id per message, from its id when it has one and its bytes otherwise", async () => {
    const withId = await parseInbound(forwarded());
    expect(inboundMessageId(withId, forwarded())).toBe(inboundMessageId(withId, forwarded({ subject: "changed" })));
    expect(inboundMessageId(withId, forwarded())).toMatch(/^fwd-[0-9a-f]{40}$/);
    const noId = new TextEncoder().encode("Subject: A\r\n\r\nbody");
    const noId2 = new TextEncoder().encode("Subject: A\r\n\r\nbody two");
    const mail = await parseInbound(noId);
    expect(inboundMessageId(mail, noId)).not.toBe(inboundMessageId(mail, noId2));
  });
});

describe("receiveForwarded", () => {
  const known = { [hashToken(token)]: "u1" };

  it("imports a forwarded confirmation for the address's owner as the original sender's email", async () => {
    const store = memoryStore();
    const extract = vi.fn(async () => lodging);
    const received = await receiveForwarded({ to: address, raw: forwarded() }, { store: memoryForwardStore(known), domain, limit: 50, deps: deps(store, extract) });
    expect(received).toMatchObject({ status: "accepted", uid: "u1", outcome: "imported" });
    const { messageId } = received as Extract<Received, { status: "accepted" }>;
    expect(store.parsed.get(`u1/${messageId}`)).toMatchObject({
      outcome: "imported",
      source: "forward",
      from: "Cove <stay@cove.example>",
      subject: "Your booking confirmation - Cove Liverpool",
    });
    const segment = [...store.segments.values()][0]!;
    expect(segment).toMatchObject({ source: "forward", sender: "cove.example" });
    expect(segment.gmailMessageIds ?? []).toEqual([]);
    expect(segment.sources).toEqual([expect.objectContaining({ kind: "forward", id: messageId, uid: "u1" })]);
    // The forwarder's request is the pre-filter: the model read it.
    expect(extract).toHaveBeenCalledTimes(1);
    expect((extract.mock.calls[0] as unknown as [EmailMessage])[0].text).toContain("Check-in 12 Dec");
  });

  it("refuses an address that is not one of ours, or one nobody holds", async () => {
    const io = { store: memoryForwardStore(known), domain, limit: 50, deps: deps() };
    expect(await receiveForwarded({ to: `zzzzzzzzzzzzzzzzzzzz@${domain}`, raw: forwarded() }, io)).toEqual({ status: "unknown_address" });
    expect(await receiveForwarded({ to: "sam@example.com", raw: forwarded() }, io)).toEqual({ status: "unknown_address" });
    expect(await receiveForwarded({ to: `${token}@other.example`, raw: forwarded() }, io)).toEqual({ status: "unknown_address" });
  });

  it("counts a day's forwards and stops at the limit, without counting a relay retry", async () => {
    const forwardStore = memoryForwardStore(known);
    const store = memoryStore();
    const io = { store: forwardStore, domain, limit: 2, deps: deps(store) };
    expect(await receiveForwarded({ to: address, raw: forwarded({ messageId: "a@x" }) }, io)).toMatchObject({ status: "accepted" });
    expect(await receiveForwarded({ to: address, raw: forwarded({ messageId: "b@x" }) }, io)).toMatchObject({ status: "accepted" });
    expect(await receiveForwarded({ to: address, raw: forwarded({ messageId: "c@x" }) }, io)).toEqual({ status: "limit", uid: "u1" });
    // The same message again is one import, not another count.
    expect(await receiveForwarded({ to: address, raw: forwarded({ messageId: "a@x" }) }, io)).toMatchObject({ status: "accepted", outcome: "skipped" });
    expect(forwardStore.counts.get("u1/2026-11-02")).toBe(2);
  });

  it("does not acknowledge a message the model could not read, and reads it again when it comes back", async () => {
    const store = memoryStore();
    const forwardStore = memoryForwardStore(known);
    let broken = true;
    const extract = vi.fn(async () => {
      if (broken) throw new Error("model unavailable");
      return lodging;
    });
    const io = { store: forwardStore, domain, limit: 50, deps: deps(store, extract) };
    const first = await receiveForwarded({ to: address, raw: forwarded() }, io);
    expect(first).toMatchObject({ status: "failed", uid: "u1" });
    expect([...store.parsed.values()][0]).toMatchObject({ outcome: "failed", source: "forward" });
    // The sending server tries again once the model is back: the failed
    // record is claimed afresh, and the day's count does not move.
    broken = false;
    const second = await receiveForwarded({ to: address, raw: forwarded() }, io);
    expect(second).toMatchObject({ status: "accepted", outcome: "imported" });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(forwardStore.counts.get("u1/2026-11-02")).toBe(1);
  });

  it("does not acknowledge a redelivery while another delivery's claim is live, but does once it has finished", async () => {
    const store = memoryStore();
    const forwardStore = memoryForwardStore(known);
    const io = { store: forwardStore, domain, limit: 50, deps: deps(store) };
    const messageId = inboundMessageId(await parseInbound(forwarded()), forwarded());
    const live = { messageId, uid: "u1", outcome: "processing" as const, segmentIds: [], processedAt: "2026-11-02T09:29:00Z" };
    store.parsed.set(`u1/${messageId}`, live);
    expect(await receiveForwarded({ to: address, raw: forwarded() }, io)).toEqual({ status: "pending", uid: "u1", messageId });
    expect(forwardStore.counts.size).toBe(0);
    // Finished meanwhile: the redelivery is the duplicate it looks like.
    store.parsed.set(`u1/${messageId}`, { ...live, outcome: "imported", segmentIds: [`${messageId}-0`] });
    expect(await receiveForwarded({ to: address, raw: forwarded() }, io)).toMatchObject({ status: "accepted", outcome: "skipped" });
    // Abandoned (the lease ran out): claimed afresh and imported.
    store.parsed.set(`u1/${messageId}`, { ...live, processedAt: "2026-11-02T09:00:00Z" });
    expect(await receiveForwarded({ to: address, raw: forwarded() }, io)).toMatchObject({ status: "accepted", outcome: "imported" });
  });

  it("does not acknowledge the loser of two deliveries racing for the claim", async () => {
    const store = memoryStore();
    const io = { store: memoryForwardStore(known), domain, limit: 50, deps: deps(store, () => reading) };
    let finish!: (booking: ExtractedBooking) => void;
    const reading = new Promise<ExtractedBooking>((resolve) => {
      finish = resolve;
    });
    // Both read "no record yet"; the first claims and waits on the model.
    const winner = receiveForwarded({ to: address, raw: forwarded() }, io);
    const loser = await receiveForwarded({ to: address, raw: forwarded() }, io);
    expect(loser).toMatchObject({ status: "pending", uid: "u1" });
    finish(lodging);
    expect(await winner).toMatchObject({ status: "accepted", outcome: "imported" });
  });

  it("records a forwarded email the model found no booking in, under the original sender", async () => {
    const store = memoryStore();
    const io = { store: memoryForwardStore(known), domain, limit: 50, deps: deps(store, async () => ({ isBooking: false, segments: [] })) };
    const received = await receiveForwarded({ to: address, raw: forwarded() }, io);
    expect(received).toMatchObject({ status: "accepted", outcome: "not_booking" });
    const record = [...store.parsed.values()][0]!;
    expect(record).toMatchObject({ source: "forward", from: "Cove <stay@cove.example>", outcome: "not_booking" });
  });
});
