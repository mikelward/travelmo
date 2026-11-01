import { prefilter, senderDomain } from "./prefilter";

describe("senderDomain", () => {
  it("reads the domain from display-name and bare forms", () => {
    expect(senderDomain("British Airways <noreply@ba.com>")).toBe("ba.com");
    expect(senderDomain("bookings@mail.trainline.com")).toBe("mail.trainline.com");
    expect(senderDomain("nonsense")).toBeUndefined();
  });
});

describe("prefilter", () => {
  it("passes a booking keyword from an unknown sender", () => {
    expect(
      prefilter({ from: "Cove <hello@cove.example>", subject: "Your booking confirmation – Cove Liverpool" }),
    ).toMatchObject({ pass: true });
  });

  it("passes any non-promotional mail from a seed domain", () => {
    expect(
      prefilter({ from: "Airbnb <automated@airbnb.com>", subject: "Reservation reminder: Lisbon" }),
    ).toMatchObject({ pass: true, reason: "sender airbnb.com allowed" });
  });

  it("drops promotional mail even from a seed domain", () => {
    expect(
      prefilter({ from: "easyJet <deals@easyjet.com>", subject: "Flash sale: 20% off flights" }),
    ).toMatchObject({ pass: false });
  });

  it("drops mail with no booking signal", () => {
    expect(prefilter({ from: "a friend <friend@example.com>", subject: "Lunch tomorrow?" })).toMatchObject({
      pass: false,
      reason: "no booking signal",
    });
  });

  it("honors user allow and deny patterns, deny winning", () => {
    const patterns = { allow: ["cove.example"], deny: ["spam.example"] };
    expect(prefilter({ from: "x@cove.example", subject: "Welcome back" }, patterns)).toMatchObject({ pass: true });
    expect(
      prefilter({ from: "x@spam.example", subject: "Your flight itinerary" }, patterns),
    ).toMatchObject({ pass: false, reason: "sender spam.example denied" });
  });

  it("matches subdomains of a pattern", () => {
    expect(prefilter({ from: "no-reply@mail.hertz.com", subject: "Rental agreement" })).toMatchObject({ pass: true });
  });
});
