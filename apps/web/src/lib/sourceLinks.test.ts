import { describe, expect, it } from "vitest";
import { emailLinkFor } from "./sourceLinks";

const email = { kind: "gmail" as const, id: "m1", label: "Your stay", at: "2026-11-01T00:00:00Z" };

describe("emailLinkFor", () => {
  it("links an email for the user who imported it, wherever the booking now is", () => {
    const mine = { ...email, uid: "alex" };
    expect(emailLinkFor(mine, { uid: "alex", account: "alex@example.com", ownsTrip: false })).toBe(
      "https://mail.google.com/mail/u/?authuser=alex%40example.com#all/m1",
    );
    // Moved into someone else's trip: its owner gets no link to a mailbox
    // that is not theirs.
    expect(emailLinkFor(mine, { uid: "sam", account: "sam@example.com", ownsTrip: true })).toBeUndefined();
  });

  it("takes the trip's owner as the importer of an unattributed email", () => {
    expect(emailLinkFor(email, { uid: "alex", ownsTrip: true })).toBe("https://mail.google.com/mail/u/0/#all/m1");
    expect(emailLinkFor(email, { uid: "sam", ownsTrip: false })).toBeUndefined();
  });

  it("never links other kinds of source", () => {
    expect(emailLinkFor({ ...email, kind: "tripit", uid: "alex" }, { uid: "alex", ownsTrip: true })).toBeUndefined();
  });
});
