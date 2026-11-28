import { brandOf, calendarPrefilter, prefilter, senderDomain, travelSender } from "./prefilter";

describe("travelSender", () => {
  const none = { allow: [], deny: [] };
  it("is a travel company or a sender the user always imports, never one they never import", () => {
    expect(travelSender("Virgin Atlantic <booking@service.virginatlantic.com>", none)).toBe(true);
    expect(travelSender("Booking.com <noreply@booking.com>", none)).toBe(true);
    expect(travelSender("Shop <orders@shop.example>", none)).toBe(false);
    expect(travelSender("Shop <orders@shop.example>", { allow: ["shop.example"], deny: [] })).toBe(true);
    expect(travelSender("Virgin Atlantic <booking@service.virginatlantic.com>", { allow: [], deny: ["virginatlantic.com"] })).toBe(false);
    expect(travelSender(undefined, none)).toBe(false);
  });

  it("is a travel company writing from another of its countries' domains", () => {
    expect(travelSender("Qantas <documents@yourbooking.qantas.com.au>", none)).toBe(true);
    expect(travelSender("easyJet <donotreply@easyjet.co.uk>", none)).toBe(true);
    expect(travelSender("Lufthansa <info@lufthansa.de>", none)).toBe(true);
    // Short brands name many companies; a lookalike is no brand.
    expect(travelSender("AA <help@aa.co.uk>", none)).toBe(false);
    expect(travelSender("Shop <orders@qantasshop.example>", none)).toBe(false);
    expect(travelSender("Qantas <documents@yourbooking.qantas.com.au>", { allow: [], deny: ["qantas.com.au"] })).toBe(false);
  });
});

describe("brandOf", () => {
  it("is the label before the country's suffix", () => {
    expect(brandOf("yourbooking.qantas.com.au")).toBe("qantas");
    expect(brandOf("qantas.com")).toBe("qantas");
    expect(brandOf("easyjet.co.uk")).toBe("easyjet");
    expect(brandOf("lufthansa.de")).toBe("lufthansa");
    expect(brandOf("ba.com")).toBeUndefined();
    expect(brandOf("localhost")).toBeUndefined();
  });
});

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

  it("passes a cancellation from an unknown sender, however it's spelled", () => {
    for (const subject of ["Cancellation: Gamla Stan, 10 June", "Your stay has been cancelled", "Canceled: Hamlet, 10 June", "Cancelation notice"]) {
      expect(prefilter({ from: "Example Hotel <stay@hotel.example>", subject })).toMatchObject({ pass: true, reason: "subject keyword" });
    }
  });

  it("passes any non-promotional mail from a seed domain", () => {
    expect(
      prefilter({ from: "Airbnb <automated@airbnb.com>", subject: "Reservation reminder: Lisbon" }),
    ).toMatchObject({ pass: true, reason: "sender airbnb.com allowed" });
  });

  it("passes any non-promotional mail from a seed company under another of its countries' domains", () => {
    for (const from of [
      "Qatar Airways <email@qr.qatarairways.com>",
      "QR ebooking <ebooking@qatarairways.com.qa>",
      "Emirates <do-not-reply@emirates.email>",
      "Air New Zealand <airnewzealand@airnz.co.nz>",
      "TUI <email@customerservices.tui.co.uk>",
      "Southwest Airlines <southwestairlines@luv.southwest.com>",
      "OpenTable <no-reply@opentable.co.uk>",
    ]) {
      expect(prefilter({ from, subject: "Your flight to London is almost here" })).toMatchObject({ pass: true, reason: expect.stringMatching(/^sender .* allowed$/) });
    }
    // A short brand is no brand: two or three letters name many companies.
    expect(prefilter({ from: "Shop <news@sj.example>", subject: "Hello" })).toMatchObject({ pass: false });
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

describe("prefilter, loyalty statements", () => {
  const statement = (from: string, subject: string) => prefilter({ from, subject });

  it("reads a travel program's statement, though it talks of points", () => {
    expect(statement("Emerald Club <EmeraldClub@email.emeraldclub.com>", "Account notification: we're pleased to present your Emerald Club eStatement")).toEqual({
      pass: true,
      reason: "loyalty statement",
    });
    expect(statement("Example Air <club@email.ba.com>", "Your Avios balance").pass).toBe(true);
    // A statement with an offer in its subject is still one.
    expect(statement("MileagePlus Statement <MyMileagePlus@enews.united.com>", "November statement: Cardmembers save 10% or more on flights booked with miles + earn up to 100K bonus miles")).toEqual({
      pass: true,
      reason: "loyalty statement",
    });
  });

  it("reads a travel program's news of a new status, though it opens with a welcome", () => {
    expect(statement("Example Air <ExampleAir@t.delta.com>", "Welcome to Silver Medallion® Status")).toEqual({ pass: true, reason: "loyalty statement" });
    expect(statement("Example Hotels <rewards@email.hilton.com>", "Welcome to Gold status")).toEqual({ pass: true, reason: "loyalty statement" });
    expect(statement("Example Hotels <rewards@email.marriott.com>", "Congratulations, you're now Platinum Elite")).toEqual({ pass: true, reason: "loyalty statement" });
    // A shop's welcome stays out.
    expect(statement("Example Shop <hello@shop.example>", "Welcome to Gold status").pass).toBe(false);
  });

  it("keeps out a shop's, a coffee chain's or a bank's statement", () => {
    expect(statement("Example Mart <rewards@examplemart.example>", "Your Clubcard points statement").pass).toBe(false);
    expect(statement("Example Coffee <hello@examplecoffee.example>", "Your rewards statement is here").pass).toBe(false);
    expect(statement("Example Bank <alerts@examplebank.example>", "Your monthly statement is ready").pass).toBe(false);
    expect(statement("Example Health <members@examplehealth.example>", "Your membership statement").pass).toBe(false);
  });

  it("reads one from a sender the user always imports", () => {
    expect(prefilter({ from: "Club <club@smallairline.example>", subject: "Your miles statement" }, { allow: ["smallairline.example"], deny: [] }).pass).toBe(true);
  });
});

describe("calendarPrefilter", () => {
  it("passes travel titles, with or without a booking word", () => {
    expect(calendarPrefilter("XX123 LHR to CDG", false)).toEqual({ pass: true, reason: "subject keyword" });
    expect(calendarPrefilter("BA 117", false).pass).toBe(true);
    expect(calendarPrefilter("LHR - JFK", false).pass).toBe(true);
    expect(calendarPrefilter("Check-in: Hotel Example", false).pass).toBe(true);
  });
  it("drops everyday events and promotions", () => {
    expect(calendarPrefilter("Dentist", false)).toEqual({ pass: false, reason: "no booking signal" });
    expect(calendarPrefilter("Lunch with Sam", false).pass).toBe(false);
    expect(calendarPrefilter("Flight sale this weekend", false)).toEqual({ pass: false, reason: "subject looks promotional" });
  });
  it("lets everything from a travel calendar through", () => {
    expect(calendarPrefilter("Dentist", true)).toEqual({ pass: true, reason: "travel calendar" });
  });
});

describe("travel documents and boarding passes", () => {
  it("passes GOV.UK immigration status share code emails", () => {
    const verdict = prefilter({
      from: "Status service <status.service@notifications.service.gov.uk>",
      subject: "SAM EXAMPLE – immigration status details",
    });
    expect(verdict.pass).toBe(true);
  });

  it("passes ETA, ESTA, and eVisa approval emails from government domains", () => {
    expect(prefilter({ from: "UK Visas <noreply@homeoffice.gov.uk>", subject: "Your Electronic Travel Authorisation (ETA) is approved" }).pass).toBe(true);
    expect(prefilter({ from: "ESTA <noreply@cbp.dhs.gov>", subject: "ESTA Authorization Approved" }).pass).toBe(true);
  });

  it("passes boarding pass emails from airlines", () => {
    expect(prefilter({ from: "Qatar Airways <noreply@qatarairways.com>", subject: "Your boarding pass for QR 008" }).pass).toBe(true);
    expect(prefilter({ from: "TUI Airways <noreply@tui.co.uk>", subject: "Your boarding passes are ready" }).pass).toBe(true);
  });
});
