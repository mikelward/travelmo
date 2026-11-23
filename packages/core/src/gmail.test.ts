import { describe, expect, it } from "vitest";
import { gmailIdPrefix, gmailMailboxes, gmailSourceLink, mailboxKey, maxGmailMailboxes, parseGmailSourceId } from "./gmail";

const connectedAt = "2026-11-01T00:00:00.000Z";

describe("a user's mailboxes", () => {
  it("are those in `gmails`, oldest connection first", () => {
    const user = {
      gmails: {
        "work@example.com": { emailAddress: "work@example.com", connectedAt: "2026-11-02T00:00:00.000Z", idPrefix: gmailIdPrefix("work@example.com") },
        "me@example.com": { emailAddress: "Me@example.com", connectedAt, idPrefix: "" },
      },
    };
    expect(gmailMailboxes(user).map((m) => m.emailAddress)).toEqual(["Me@example.com", "work@example.com"]);
  });

  it("include one connected before there could be several, until the parser moves it", () => {
    expect(gmailMailboxes({ gmail: { emailAddress: "me@example.com", connectedAt } })).toEqual([{ emailAddress: "me@example.com", connectedAt }]);
    // Moved already: counted once.
    const both = {
      gmail: { emailAddress: "Me@example.com", connectedAt },
      gmails: { "me@example.com": { emailAddress: "me@example.com", connectedAt, idPrefix: "" } },
    };
    expect(gmailMailboxes(both)).toHaveLength(1);
    expect(gmailMailboxes(undefined)).toEqual([]);
  });

  it("are at most five", () => {
    expect(maxGmailMailboxes).toBe(5);
  });
});

describe("a Gmail source id", () => {
  it("is the message id for the first mailbox and carries any other mailbox's key", () => {
    expect(mailboxKey(" Work@Example.com ")).toBe(mailboxKey("work@example.com"));
    expect(mailboxKey("work@example.com")).not.toBe(mailboxKey("me@example.com"));
    const prefix = gmailIdPrefix("work@example.com");
    expect(prefix).toBe(`gmail-${mailboxKey("work@example.com")}-`);
    expect(parseGmailSourceId(`${prefix}18c0ffee`)).toEqual({ key: mailboxKey("work@example.com"), messageId: "18c0ffee" });
    expect(parseGmailSourceId("18c0ffee")).toEqual({ messageId: "18c0ffee" });
  });

  it("can never be another mailbox's: Gmail's ids are hexadecimal", () => {
    expect(parseGmailSourceId("18c0ffee").key).toBeUndefined();
    expect(/^[0-9a-f]+$/.test(gmailIdPrefix("me@example.com"))).toBe(false);
  });
});

describe("gmailSourceLink", () => {
  const first = { emailAddress: "me@example.com", connectedAt, idPrefix: "" };
  const work = { emailAddress: "work@example.com", connectedAt, idPrefix: gmailIdPrefix("work@example.com") };

  it("opens an email in the mailbox it came from", () => {
    expect(gmailSourceLink(`${work.idPrefix}18c0ffee`, [first, work])).toBe("https://mail.google.com/mail/u/?authuser=work%40example.com#all/18c0ffee");
    expect(gmailSourceLink("18c0ffee", [first, work])).toBe("https://mail.google.com/mail/u/?authuser=me%40example.com#all/18c0ffee");
  });

  it("takes a mailbox connected before there could be several for the first", () => {
    expect(gmailSourceLink("18c0ffee", [{ emailAddress: "me@example.com", connectedAt }])).toBe(
      "https://mail.google.com/mail/u/?authuser=me%40example.com#all/18c0ffee",
    );
  });

  it("opens the browser's own account once the mailbox is disconnected", () => {
    expect(gmailSourceLink(`${work.idPrefix}18c0ffee`, [first])).toBe("https://mail.google.com/mail/u/0/#all/18c0ffee");
    expect(gmailSourceLink("18c0ffee", [work])).toBe("https://mail.google.com/mail/u/0/#all/18c0ffee");
  });
});
