import { gmailIdPrefix } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { emailLinkFor, isFromMailbox, recordSourceLabels, sourceKindLabels } from "./sourceLinks";

const email = { kind: "gmail" as const, id: "m1", label: "Your stay", at: "2026-11-01T00:00:00Z" };
const alex = { emailAddress: "alex@example.com", idPrefix: "" };

describe("emailLinkFor", () => {
  it("links an email for the user who imported it, wherever the booking now is", () => {
    const mine = { ...email, uid: "alex" };
    expect(emailLinkFor(mine, { uid: "alex", mailboxes: [alex], ownsTrip: false })).toBe(
      "https://mail.google.com/mail/u/?authuser=alex%40example.com#all/m1",
    );
    // Moved into someone else's trip: its owner gets no link to a mailbox
    // that is not theirs.
    expect(emailLinkFor(mine, { uid: "sam", mailboxes: [{ emailAddress: "sam@example.com", idPrefix: "" }], ownsTrip: true })).toBeUndefined();
  });

  it("opens an email in the mailbox it came from, of several", () => {
    const work = { emailAddress: "alex@work.example", idPrefix: gmailIdPrefix("alex@work.example") };
    const fromWork = { ...email, id: `${work.idPrefix}m2`, uid: "alex" };
    expect(emailLinkFor(fromWork, { uid: "alex", mailboxes: [alex, work], ownsTrip: true })).toBe(
      "https://mail.google.com/mail/u/?authuser=alex%40work.example#all/m2",
    );
    expect(emailLinkFor({ ...email, uid: "alex" }, { uid: "alex", mailboxes: [alex, work], ownsTrip: true })).toBe(
      "https://mail.google.com/mail/u/?authuser=alex%40example.com#all/m1",
    );
  });

  it("takes the trip's owner as the importer of an unattributed email", () => {
    expect(emailLinkFor(email, { uid: "alex", ownsTrip: true })).toBe("https://mail.google.com/mail/u/0/#all/m1");
    expect(emailLinkFor(email, { uid: "sam", ownsTrip: false })).toBeUndefined();
  });

  it("never links other kinds of source", () => {
    expect(emailLinkFor({ ...email, kind: "tripit", uid: "alex" }, { uid: "alex", ownsTrip: true })).toBeUndefined();
  });

  it("never links a Fastmail email, which has no stable address", () => {
    expect(emailLinkFor({ ...email, kind: "fastmail", id: "fm-1", uid: "alex" }, { uid: "alex", mailboxes: [alex], ownsTrip: true })).toBeUndefined();
  });
});

describe("source labels", () => {
  it("never links an email read over IMAP", () => {
    expect(emailLinkFor({ ...email, kind: "imap", id: "imap-k-1-2", uid: "alex" }, { uid: "alex", mailboxes: [alex], ownsTrip: true })).toBeUndefined();
  });

  it("names a Fastmail or IMAP email apart from a Gmail or forwarded one", () => {
    expect(sourceKindLabels.fastmail).toBe("Fastmail email");
    expect(sourceKindLabels.imap).toBe("Other email");
    expect(recordSourceLabels.imap).toBe("Other email");
    expect(new Set(Object.values(sourceKindLabels)).size).toBe(Object.keys(sourceKindLabels).length);
    expect(recordSourceLabels.fastmail).toBe("Fastmail");
    expect(recordSourceLabels.gmail).toBe("Gmail");
  });
});

describe("isFromMailbox", () => {
  it("offers reading again and teaching the sender for records read from a mailbox only", () => {
    expect(isFromMailbox({})).toBe(true);
    expect(isFromMailbox({ source: "gmail" })).toBe(true);
    expect(isFromMailbox({ source: "fastmail" })).toBe(true);
    expect(isFromMailbox({ source: "imap" })).toBe(true);
    expect(isFromMailbox({ source: "forward" })).toBe(false);
    expect(isFromMailbox({ source: "tripit" })).toBe(false);
    expect(isFromMailbox({ source: "ics" })).toBe(false);
  });
});
