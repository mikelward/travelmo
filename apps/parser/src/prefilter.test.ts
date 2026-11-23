import { calendarPrefilter, prefilter, senderDomain } from "./prefilter";

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
