import { describe, expect, it } from "vitest";
import { forwardAddress, forwardTokenOf, isForwardToken, stripForwardPrefix, unwrapForwarded } from "./forward";

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
    });
  });

  it("reads Apple Mail's and Outlook's blocks too, bold markers included", () => {
    const apple = ["Begin forwarded message:", "", "From: Rail Co <tickets@rail.example>", "Subject: Fwd: Your tickets", "Date: 1 November 2026 at 10:00:00 GMT", "To: sam@example.com", "", "Coach B seat 12"].join("\n");
    expect(unwrapForwarded({ ...me, text: apple })).toEqual({ from: "Rail Co <tickets@rail.example>", subject: "Your tickets", unwrapped: true });
    const outlook = ["-----Original Message-----", "**From:** Air Co <noreply@air.example>", "**Sent:** Monday, November 1, 2026 10:00 AM", "**To:** Sam", "**Subject:** E-ticket receipt", "", "Flight 123"].join("\n");
    expect(unwrapForwarded({ ...me, text: outlook })).toEqual({ from: "Air Co <noreply@air.example>", subject: "E-ticket receipt", unwrapped: true });
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
