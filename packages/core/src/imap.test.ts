import { describe, expect, it } from "vitest";
import { imapMailboxes, imapRecordId, imapRecordKey, imapRedirect, imapServerFor, maxImapMailboxes, parseImapRecordId, parseImapServer } from "./imap";

describe("the server for an address", () => {
  it("is filled in for known providers, implicit TLS", () => {
    expect(imapServerFor("me@icloud.com")).toEqual({ kind: "known", provider: expect.objectContaining({ name: "iCloud", host: "imap.mail.me.com", port: 993 }) });
    expect(imapServerFor("Me@ME.com")).toMatchObject({ kind: "known", provider: { name: "iCloud" } });
    expect(imapServerFor("me@mac.com")).toMatchObject({ kind: "known", provider: { name: "iCloud" } });
    expect(imapServerFor("me@yahoo.com")).toMatchObject({ kind: "known", provider: { host: "imap.mail.yahoo.com", port: 993 } });
    expect(imapServerFor("me@yahoo.co.uk")).toMatchObject({ kind: "known", provider: { name: "Yahoo" } });
    expect(imapServerFor("me@ik.me")).toMatchObject({ kind: "known", provider: { host: "mail.infomaniak.com", port: 993 } });
  });

  it("sends Gmail and Fastmail addresses to their own sections", () => {
    expect(imapServerFor("me@gmail.com")).toEqual({ kind: "gmail" });
    expect(imapServerFor("me@fastmail.com")).toEqual({ kind: "fastmail" });
    expect(imapRedirect("me@googlemail.com")).toBe("For a Gmail address, use Connect Gmail above.");
    expect(imapRedirect("me@fastmail.fm")).toBe("For a Fastmail address, use the Fastmail section above.");
    expect(imapRedirect("me@icloud.com")).toBeUndefined();
  });

  it("is the user's to name otherwise", () => {
    expect(imapServerFor("me@example.org")).toEqual({ kind: "other" });
    expect(imapServerFor("not an address")).toEqual({ kind: "other" });
  });
});

describe("a typed server", () => {
  it("is a host name with an optional port, 993 by default", () => {
    expect(parseImapServer(" Mail.Example.org ")).toEqual({ host: "mail.example.org", port: 993 });
    expect(parseImapServer("imap.example.org:1993")).toEqual({ host: "imap.example.org", port: 1993 });
    expect(parseImapServer("imaps://imap.example.org")).toEqual({ host: "imap.example.org", port: 993 });
  });

  it("is refused when it is not one", () => {
    expect(parseImapServer("localhost")).toBeUndefined();
    expect(parseImapServer("imap.example.org:99999")).toBeUndefined();
    expect(parseImapServer("imap.example.org/path")).toBeUndefined();
    expect(parseImapServer("")).toBeUndefined();
  });
});

describe("a user's IMAP mailboxes", () => {
  it("are listed oldest connection first, at most five", () => {
    const user = {
      imaps: {
        "b@example.org": { emailAddress: "b@example.org", connectedAt: "2026-11-02T00:00:00.000Z" },
        "a@example.org": { emailAddress: "a@example.org", connectedAt: "2026-11-01T00:00:00.000Z" },
      },
    };
    expect(imapMailboxes(user).map((m) => m.emailAddress)).toEqual(["a@example.org", "b@example.org"]);
    expect(imapMailboxes(undefined)).toEqual([]);
    expect(maxImapMailboxes).toBe(5);
  });
});

describe("IMAP record ids", () => {
  it("name the mailbox, the inbox's UIDVALIDITY and the UID, and read back", () => {
    const id = imapRecordId("k3y", "1700000000", 42);
    expect(id).toBe("imap-k3y-1700000000-42");
    expect(parseImapRecordId(id)).toEqual({ key: "k3y", uidValidity: "1700000000", uid: 42 });
  });

  it("refuse anything else", () => {
    expect(parseImapRecordId("fm-abc")).toBeUndefined();
    expect(parseImapRecordId("imap-k3y-1-0")).toBeUndefined();
    expect(parseImapRecordId("imap-k3y-x-1")).toBeUndefined();
  });
});

describe("imapRecordKey", () => {
  it("names an address on its server, so the same address on another server records its emails apart", () => {
    const old = imapRecordKey("Me@Example.com", "imap.example.com", 993);
    expect(imapRecordKey("me@example.com", "IMAP.example.com", 993)).toBe(old);
    expect(imapRecordKey("me@example.com", "mail.other.example", 993)).not.toBe(old);
    expect(imapRecordKey("me@example.com", "imap.example.com", 994)).not.toBe(old);
    expect(imapRecordId(old, "1700000000", 42)).not.toBe(imapRecordId(imapRecordKey("me@example.com", "mail.other.example", 993), "1700000000", 42));
  });
});
