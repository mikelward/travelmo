import {
  canSendLink,
  checkNewLink,
  confirmationMessage,
  confirmationUrl,
  emailRows,
  isMine,
  isRemovable,
  linkRefusalText,
  linkedEmails,
  maxLinkedEmails,
  myAddresses,
  pendingLink,
  queryAddresses,
  refusalOf,
  sharedWithAny,
  shownPending,
  withSentLink,
  withoutLink,
  type EmailLinks,
} from "./emails";

const now = "2026-11-23T10:00:00.000Z";
const later = "2026-11-24T10:00:00.000Z";
const user = {
  emails: ["work@company.example"],
  gmail: { emailAddress: "Mail@Example.net" },
  pendingEmails: [
    { email: "new@company.example", sentAt: now, expiresAt: later },
    { email: "old@company.example", sentAt: "2026-11-01T00:00:00.000Z", expiresAt: "2026-11-02T00:00:00.000Z" },
  ],
};

describe("my addresses", () => {
  it("are the sign-in first, then those confirmed and the connected Gmail, lowercased once each", () => {
    expect(myAddresses("Me@Example.com", user)).toEqual(["me@example.com", "work@company.example", "mail@example.net"]);
    expect(linkedEmails(user)).toEqual(["work@company.example", "mail@example.net"]);
    expect(myAddresses("mail@example.net", user)).toEqual(["mail@example.net", "work@company.example"]);
  });

  it("never count one waiting for confirmation", () => {
    expect(myAddresses("me@example.com", user)).not.toContain("new@company.example");
  });

  it("are the sign-in alone without a user document or a verified sign-in", () => {
    expect(myAddresses("me@example.com", undefined)).toEqual(["me@example.com"]);
    expect(myAddresses(undefined, { emails: ["work@company.example"] })).toEqual(["work@company.example"]);
  });

  it("tell whether a list names the account by any of them", () => {
    const mine = myAddresses("me@example.com", user);
    expect(isMine("WORK@company.example", mine)).toBe(true);
    expect(isMine("new@company.example", mine)).toBe(false);
    expect(sharedWithAny(["partner@example.com", "mail@example.net"], mine)).toBe(true);
    expect(sharedWithAny(["partner@example.com"], mine)).toBe(false);
  });

  it("fit one query", () => {
    const many = Array.from({ length: 40 }, (_, i) => `p${i}@example.com`);
    expect(queryAddresses(many)).toHaveLength(30);
    expect(queryAddresses(many)[0]).toBe("p0@example.com");
  });
});

describe("Settings' rows", () => {
  it("list the sign-in, those confirmed, Gmail and live pending ones, removable where linked", () => {
    const rows = emailRows("me@example.com", user, now);
    expect(rows).toEqual([
      { email: "me@example.com", kind: "signIn" },
      { email: "work@company.example", kind: "confirmed" },
      { email: "mail@example.net", kind: "gmail" },
      { email: "new@company.example", kind: "pending" },
    ]);
    expect(rows.map(isRemovable)).toEqual([false, true, false, true]);
  });

  it("show a Gmail address also confirmed once, as confirmed, so it can be removed", () => {
    const rows = emailRows("me@example.com", { emails: ["mail@example.net"], gmail: { emailAddress: "mail@example.net" } }, now);
    expect(rows).toEqual([
      { email: "me@example.com", kind: "signIn" },
      { email: "mail@example.net", kind: "confirmed" },
    ]);
  });
});

describe("checkNewLink", () => {
  it("normalizes a new address", () => {
    expect(checkNewLink("  Other@Example.org ", "me@example.com", user, now)).toEqual({ email: "other@example.org" });
  });

  it("sends a fresh link for one still waiting", () => {
    expect(checkNewLink("new@company.example", "me@example.com", user, now)).toEqual({ email: "new@company.example" });
  });

  it("refuses what is not an address, or already the account's", () => {
    expect(checkNewLink("not an address", "me@example.com", user, now)).toEqual({ refusal: "invalid" });
    for (const mine of ["ME@example.com", "work@company.example", "mail@example.net"]) {
      expect(checkNewLink(mine, "me@example.com", user, now)).toEqual({ refusal: "yours" });
    }
  });

  it("refuses more than the limit, counting live pending links", () => {
    const emails = Array.from({ length: maxLinkedEmails - 1 }, (_, i) => `a${i}@example.com`);
    expect(checkNewLink("x@example.com", "me@example.com", { emails }, now)).toEqual({ email: "x@example.com" });
    expect(checkNewLink("x@example.com", "me@example.com", { ...user, emails }, now)).toEqual({ refusal: "full" });
    // An expired link takes no place.
    expect(checkNewLink("x@example.com", "me@example.com", { emails, pendingEmails: [user.pendingEmails[1]!] }, now)).toEqual({ email: "x@example.com" });
  });
});

describe("refusalOf", () => {
  it("reads the parser's refusal, and nothing else", () => {
    expect(refusalOf('{"refusal":"taken"}')).toBe("taken");
    expect(refusalOf('{"refusal":"other"}')).toBeUndefined();
    expect(refusalOf("Internal error")).toBeUndefined();
    expect(refusalOf('{"refusal":"notInvited"}')).toBe("notInvited");
  });
  it("puts every refusal in plain words", () => {
    expect(linkRefusalText.notInvited).toBe("That address hasn't been invited to Travelmo.");
  });
});

describe("confirmation links", () => {
  it("open the confirming page with the token", () => {
    expect(confirmationUrl("https://travelmo.example", "a+b/c")).toBe("https://travelmo.example/settings/email?token=a%2Bb%2Fc");
    const message = confirmationMessage("work@company.example", "https://travelmo.example/settings/email?token=t");
    expect(message.subject).toBe("Confirm your email address for Travelmo");
    expect(message.text).toContain("work@company.example");
    expect(message.text).toContain("https://travelmo.example/settings/email?token=t");
  });

  it("keep one live link per address and count the day's sends", () => {
    let links: EmailLinks = { pending: [{ email: "old@example.com", tokenHash: "h0", sentAt: "2026-11-01T00:00:00.000Z", expiresAt: "2026-11-02T00:00:00.000Z" }] };
    links = withSentLink(links, "a@example.com", "h1", now);
    links = withSentLink(links, "a@example.com", "h2", now);
    expect(links.pending).toEqual([{ email: "a@example.com", tokenHash: "h2", sentAt: now, expiresAt: later }]);
    expect(links).toMatchObject({ day: "2026-11-23", sent: 2 });
    expect(pendingLink(links, "h2", now)?.email).toBe("a@example.com");
    expect(pendingLink(links, "h1", now)).toBeUndefined();
    expect(pendingLink(links, "h2", later)).toBeUndefined();
    expect(shownPending(links)).toEqual([{ email: "a@example.com", sentAt: now, expiresAt: later }]);
    expect(withoutLink(links, "a@example.com", now).pending).toEqual([]);
  });

  it("allow a few sends a day", () => {
    const spent: EmailLinks = { pending: [], day: "2026-11-23", sent: 5 };
    expect(canSendLink(spent, now)).toBe(false);
    expect(canSendLink({ ...spent, sent: 4 }, now)).toBe(true);
    expect(canSendLink(spent, later)).toBe(true);
    expect(withSentLink(spent, "a@example.com", "h", later)).toMatchObject({ day: "2026-11-24", sent: 1 });
  });
});
