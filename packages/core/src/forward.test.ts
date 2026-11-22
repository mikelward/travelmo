import { describe, expect, it } from "vitest";
import { forwardAddress, forwardedDate, forwardTokenOf, isForwardToken, stripForwardPrefix, unwrapForwarded } from "./forward";

describe("forward tokens and addresses", () => {
  it("accepts twenty lowercase base32 characters and nothing else", () => {
    expect(isForwardToken("abcdefghijklmnopqrst")).toBe(true);
    expect(isForwardToken("abcdefghijklmnopqrs")).toBe(false);
    expect(isForwardToken("ABCDEFGHIJKLMNOPQRST")).toBe(false);
    expect(isForwardToken("abcdefghijklmnopqr01")).toBe(false);
    expect(isForwardToken("")).toBe(false);
  });

  it("builds the address and reads the token back out of it, whatever the case and wrapping", () => {
    const address = forwardAddress("abcdefghijklmnopqrst", "travelmo.app");
    expect(address).toBe("abcdefghijklmnopqrst@travelmo.app");
    expect(forwardTokenOf(address, "travelmo.app")).toBe("abcdefghijklmnopqrst");
    expect(forwardTokenOf("ABCDEFGHIJKLMNOPQRST@Travelmo.App", "travelmo.app")).toBe("abcdefghijklmnopqrst");
    expect(forwardTokenOf("Travelmo <abcdefghijklmnopqrst@travelmo.app>", "travelmo.app")).toBe("abcdefghijklmnopqrst");
  });

  it("knows an address that is not one of ours", () => {
    expect(forwardTokenOf("abcdefghijklmnopqrst@example.com", "travelmo.app")).toBeUndefined();
    expect(forwardTokenOf("hello@travelmo.app", "travelmo.app")).toBeUndefined();
    expect(forwardTokenOf("abcdefghijklmnopqrst@in.travelmo.app", "travelmo.app")).toBeUndefined();
    expect(forwardTokenOf("not an address", "travelmo.app")).toBeUndefined();
  });
});

describe("stripForwardPrefix", () => {
  it("removes every forwarding prefix the clients add, in any language and case", () => {
    expect(stripForwardPrefix("Fwd: Your booking")).toBe("Your booking");
    expect(stripForwardPrefix("FW: Fwd: Your booking")).toBe("Your booking");
    expect(stripForwardPrefix("Fw:Your booking")).toBe("Your booking");
    expect(stripForwardPrefix("TR: Votre réservation")).toBe("Votre réservation");
    expect(stripForwardPrefix("WG: Ihre Buchung")).toBe("Ihre Buchung");
    expect(stripForwardPrefix("Forward planning")).toBe("Forward planning");
    expect(stripForwardPrefix("Your booking")).toBe("Your booking");
  });
});

describe("forwardedDate", () => {
  it("reads the dates the mail clients write in a forwarding block", () => {
    expect(forwardedDate("Mon, 1 May 2026 10:00:00 +0100")).toBe("2026-05-01T09:00:00.000Z");
    expect(forwardedDate("Mon, May 1, 2026 at 10:00 AM")).toBe("2026-05-01T10:00:00.000Z");
    expect(forwardedDate("1 May 2026 at 10:00:00 BST")).toBe("2026-05-01T10:00:00.000Z");
    expect(forwardedDate("May 1, 2026 at 10:00:00 AM GMT+1")).toBe("2026-05-01T09:00:00.000Z");
    expect(forwardedDate("Monday, May 1, 2026 2:30 PM")).toBe("2026-05-01T14:30:00.000Z");
  });

  it("refuses a date in numbers only, and anything unreadable", () => {
    expect(forwardedDate("01/05/2026 10:00")).toBeUndefined();
    expect(forwardedDate("last Tuesday")).toBeUndefined();
    expect(forwardedDate(undefined)).toBeUndefined();
  });

  it("is the original's, from a Date: or Sent: line in the block", () => {
    const block = (line: string) =>
      unwrapForwarded({ from: "Me <me@example.com>", subject: "Fwd: Your booking", text: `Hi\n\n---------- Forwarded message ---------\nFrom: Example Air <noreply@air.example>\n${line}\nSubject: Your booking\n\nBody` });
    expect(block("Date: Mon, May 1, 2026 at 10:00 AM").date).toBe("2026-05-01T10:00:00.000Z");
    expect(block("Sent: Monday, May 1, 2026 10:00 AM").date).toBe("2026-05-01T10:00:00.000Z");
    expect(block("To: me@example.com").date).toBeUndefined();
  });
});

describe("unwrapForwarded", () => {
  const me = { from: "Sam Traveler <sam@example.com>", subject: "Fwd: Your booking confirmation - Cove Liverpool" };

  it("reads the original sender and subject from Gmail's forwarding block", () => {
    const text = [
      "FYI",
      "",
      "---------- Forwarded message ---------",
      "From: Cove <stay@cove.example>",
      "Date: Mon, 1 Nov 2026 at 10:00",
      "Subject: Your booking confirmation - Cove Liverpool",
      "To: <sam@example.com>",
      "",
      "Check-in 12 Dec, check-out 14 Dec",
    ].join("\n");
    expect(unwrapForwarded({ ...me, text })).toEqual({
      from: "Cove <stay@cove.example>",
      subject: "Your booking confirmation - Cove Liverpool",
      unwrapped: true,
      date: "2026-11-01T10:00:00.000Z",
    });
  });

  it("reads Apple Mail's and Outlook's blocks too, bold markers included", () => {
    const apple = ["Begin forwarded message:", "", "From: Rail Co <tickets@rail.example>", "Subject: Fwd: Your tickets", "Date: 1 November 2026 at 10:00:00 GMT", "To: sam@example.com", "", "Coach B seat 12"].join("\n");
    expect(unwrapForwarded({ ...me, text: apple })).toEqual({ from: "Rail Co <tickets@rail.example>", subject: "Your tickets", unwrapped: true, date: "2026-11-01T10:00:00.000Z" });
    const outlook = ["-----Original Message-----", "**From:** Air Co <noreply@air.example>", "**Sent:** Monday, November 1, 2026 10:00 AM", "**To:** Sam", "**Subject:** E-ticket receipt", "", "Flight 123"].join("\n");
    expect(unwrapForwarded({ ...me, text: outlook })).toEqual({ from: "Air Co <noreply@air.example>", subject: "E-ticket receipt", unwrapped: true, date: "2026-11-01T10:00:00.000Z" });
  });

  it("takes the first block only, so a forwarded forward keeps the outer original", () => {
    const text = [
      "---------- Forwarded message ---------",
      "From: Friend <friend@example.com>",
      "Subject: Fwd: Hotel",
      "",
      "---------- Forwarded message ---------",
      "From: Hotel <res@hotel.example>",
      "Subject: Hotel",
    ].join("\n");
    expect(unwrapForwarded({ ...me, text })).toMatchObject({ from: "Friend <friend@example.com>", subject: "Hotel" });
  });

  it("keeps the forwarder's own sender when there is no block, and still strips the prefix", () => {
    expect(unwrapForwarded({ ...me, text: "Booked this, see below. From: nobody really" })).toEqual({
      from: me.from,
      subject: "Your booking confirmation - Cove Liverpool",
      unwrapped: false,
    });
    const markerOnly = "---------- Forwarded message ---------\n\nnothing else";
    expect(unwrapForwarded({ ...me, text: markerOnly })).toMatchObject({ from: me.from, unwrapped: false });
  });
});
