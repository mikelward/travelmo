import { describe, expect, it } from "vitest";
import { allLoyalty, couldBeOwner, foundLoyaltyEntry, formatBalance, loyaltyByPerson, loyaltyLine, loyaltySummary, nameWords, personName, programsFor, withFoundLoyalties, withFoundLoyalty, withLoyaltyPerson } from "./loyalty";
import { foundLoyaltyBudgetBytes, isMembershipNumber, maxFoundLoyalty, TravelProfile, type FoundLoyalty, type ProfileEntry } from "./schema";

// Invented programs and numbers.
const air: ProfileEntry = {
  title: "Example Air Miles",
  fields: [
    { label: "Name", value: "Example Air Miles" },
    { label: "Account number", value: "EA123" },
    { label: "Elite status", value: "Gold" },
    { label: "Elite next status", value: "Platinum" },
    { label: "Balance", value: "12000" },
    { label: "Supplier code", value: "exampleair" },
  ],
};
const hotels: ProfileEntry = {
  title: "Sample Hotels Honors",
  fields: [
    { label: "Account › Number", value: "SH-9" },
    { label: "Points", value: "350" },
    { label: "Tier", value: "Silver" },
  ],
};
const bare: ProfileEntry = { title: "Loyalty program 3", fields: [{ label: "Note", value: "lapsed" }] };

describe("loyaltySummary", () => {
  it("reads the account, balance and status by their usual labels, with the balance grouped", () => {
    expect(loyaltySummary(air)).toEqual({ title: "Example Air Miles", account: "EA123", balance: "12,000", status: "Gold", nextStatus: "Platinum" });
  });

  it("takes a nested label by its last part and other wordings for the same thing", () => {
    expect(loyaltySummary(hotels)).toEqual({ title: "Sample Hotels Honors", account: "SH-9", balance: "350", status: "Silver" });
    expect(loyaltySummary(bare)).toEqual({ title: "Loyalty program 3" });
  });

  it("prefers the more specific label and skips empty values", () => {
    const entry: ProfileEntry = {
      title: "P",
      fields: [
        { label: "Number", value: "wrong" },
        { label: "Account number", value: "right" },
        { label: "Balance", value: "  " },
        { label: "Points", value: "7" },
      ],
    };
    expect(loyaltySummary(entry)).toEqual({ title: "P", account: "right", balance: "7" });
  });

  it("prefers the program's own value to a sub-account's, whichever the import listed first", () => {
    const entry: ProfileEntry = {
      title: "P",
      fields: [
        { label: "Sub account › Balance", value: "5" },
        { label: "Sub account › Account number", value: "SUB-1" },
        { label: "Points", value: "12000" },
        { label: "Account number", value: "MAIN-1" },
      ],
    };
    expect(loyaltySummary(entry)).toEqual({ title: "P", account: "MAIN-1", balance: "12,000" });
    expect(loyaltySummary({ title: "P", fields: [{ label: "Sub account › Balance", value: "5" }] })).toEqual({ title: "P", balance: "5" });
  });

  it("formats only plain numbers", () => {
    expect(formatBalance("1234567")).toBe("1,234,567");
    expect(formatBalance("12,000 pts")).toBe("12,000 pts");
    expect(formatBalance("-5")).toBe("-5");
  });
});

describe("programsFor", () => {
  it("matches a booking's provider to a program by a distinctive word of its name", () => {
    expect(nameWords("Example Air Miles")).toEqual(new Set(["example"]));
    expect(nameWords("Sample Hotels Honors")).toEqual(new Set(["sample"]));
    expect(programsFor("Example Air", [air, hotels, bare])).toEqual([air]);
    expect(programsFor("Sample Hotels & Resorts, Exampleville", [air, hotels])).toEqual([hotels]);
    expect(programsFor("example-air.com", [air])).toEqual([air]);
    expect(programsFor("www.example-air.com", [air])).toEqual([air]);
  });

  it("never matches on the parts of a web address", () => {
    const dotCom: ProfileEntry = { title: "Example.com Rewards", fields: [{ label: "Account number", value: "EX123" }] };
    expect(nameWords("www.example.com")).toEqual(new Set(["example"]));
    expect(nameWords("Frequent Flyer number").size).toBe(0);
    expect(nameWords("Frequent flier no.").size).toBe(0);
    expect(programsFor("Other-air.com", [dotCom])).toEqual([]);
    expect(programsFor("https://www.other.net", [dotCom])).toEqual([]);
    expect(programsFor("example.com", [dotCom])).toEqual([dotCom]);
  });

  it("matches nothing on generic words, an unknown provider or none", () => {
    expect(programsFor("Air Miles", [air, hotels])).toEqual([]);
    expect(programsFor("Other Airlines", [air, hotels])).toEqual([]);
    expect(programsFor(undefined, [air])).toEqual([]);
    expect(programsFor("Example Air", [])).toEqual([]);
  });
});

describe("loyaltyLine", () => {
  it("is the program, the number and the status, whichever are known", () => {
    expect(loyaltyLine(air)).toBe("Example Air Miles · EA123 · Gold");
    expect(loyaltyLine(bare)).toBe("Loyalty program 3");
  });
});

describe("loyalty from emails", () => {
  const seen = (number: string, extra: Partial<FoundLoyalty> = {}): FoundLoyalty => ({
    program: "Example Air Club",
    number,
    messageId: "m1",
    label: "Your booking",
    at: "2026-11-01T00:00:00Z",
    ...extra,
  });

  it("refreshes a membership seen again rather than adding it twice", () => {
    const first = withFoundLoyalty([], seen("12 345 678", { status: "Silver" }));
    const again = withFoundLoyalty(first, seen("12345678", { messageId: "m2", at: "2026-11-05T00:00:00Z" }));
    expect(again).toEqual([seen("12345678", { messageId: "m2", at: "2026-11-05T00:00:00Z", status: "Silver" })]);
    expect(withFoundLoyalty(again, seen("999")).map((f) => f.number)).toEqual(["12345678", "999"]);
  });

  it("keeps the newest balance, with its status, whatever order statements arrive in", () => {
    const march = seen("123", { balance: "9,000 points", balanceAt: "2026-03-01T00:00:00Z", status: "Silver", statusAt: "2026-03-01T00:00:00Z" });
    const april = seen("123", { messageId: "m2", balance: "12,400 points", balanceAt: "2026-04-01T00:00:00Z", status: "Gold", statusAt: "2026-04-01T00:00:00Z" });
    const [latest] = withFoundLoyalty(withFoundLoyalty([], april), march);
    expect(latest).toMatchObject({ balance: "12,400 points", balanceAt: "2026-04-01T00:00:00Z", status: "Gold", balanceLabel: "Your booking" });
    // A booking email with no balance leaves it as the statement said.
    const [after] = withFoundLoyalty([latest!], seen("123", { messageId: "m3" }));
    expect(after).toMatchObject({ balance: "12,400 points", status: "Gold", messageId: "m3" });
    expect(Object.values(after!)).not.toContain(undefined);
    // The balance still names the statement it came from.
    const april2 = seen("123", { messageId: "m2", label: "April statement", balance: "12,400 points", balanceAt: "2026-04-01T00:00:00Z" });
    const march2 = seen("123", { label: "March statement", balance: "9,000 points", balanceAt: "2026-03-01T00:00:00Z" });
    const [kept] = withFoundLoyalty(withFoundLoyalty([], april2), march2);
    expect(kept).toMatchObject({ label: "March statement", balance: "12,400 points", balanceLabel: "April statement" });
    const imported = { title: "Example Air Club", fields: [{ label: "Account number", value: "123" }] };
    expect(allLoyalty({ loyalty: [imported], foundLoyalty: [kept!] })[0]!.fields.at(-1)).toEqual({ label: "Balance from email", value: "April statement" });
    expect(loyaltySummary(foundLoyaltyEntry(after!))).toMatchObject({ balance: "12,400 points", status: "Gold" });
  });

  it("brings a newer statement's balance and status to the program TripIt imported", () => {
    const imported = { title: "Emerald Club", fields: [{ label: "Account number", value: "EC 77" }, { label: "Balance", value: "1" }, { label: "Elite status", value: "Member" }] };
    const statement = seen("EC77", { program: "Emerald Club", balance: "3 free rental days", balanceAt: "2026-11-01T00:00:00Z", status: "Executive", statusAt: "2026-11-01T00:00:00Z", label: "Your Emerald Club eStatement" });
    const newer = allLoyalty({ loyalty: [imported], foundLoyalty: [statement], importedAt: "2026-06-01T00:00:00Z" });
    expect(newer).toHaveLength(1);
    expect(loyaltySummary(newer[0]!)).toMatchObject({ account: "EC 77", balance: "3 free rental days", status: "Executive" });
    expect(newer[0]!.fields.at(-1)).toEqual({ label: "Balance from email", value: "Your Emerald Club eStatement" });
    // A TripIt upload after the statement is the newer word.
    const older = allLoyalty({ loyalty: [imported], foundLoyalty: [statement], importedAt: "2026-11-20T00:00:00Z" });
    expect(loyaltySummary(older[0]!)).toMatchObject({ balance: "1", status: "Member" });
  });

  it("brings a statement only to the same program, whatever the number", () => {
    const air = { title: "Example Air Club", fields: [{ label: "Account number", value: "123" }, { label: "Balance", value: "10" }] };
    const hotel = seen("123", { program: "Sample Hotels Rewards", balance: "999", balanceAt: "2026-11-01T00:00:00Z" });
    const all = allLoyalty({ loyalty: [air], foundLoyalty: [hotel] });
    expect(loyaltySummary(all[0]!)).toMatchObject({ title: "Example Air Club", balance: "10" });
    expect(loyaltySummary(all[1]!)).toMatchObject({ title: "Sample Hotels Rewards", balance: "999" });
  });

  it("takes a newer status from an email with no balance, keeping the statement's balance", () => {
    const statement = seen("123", { label: "November statement", balance: "41,000 miles", balanceAt: "2026-11-01T00:00:00Z", status: "Silver", statusAt: "2026-11-01T00:00:00Z" });
    const booking = seen("123", { messageId: "m2", label: "Your flight", status: "Gold", statusAt: "2026-11-20T00:00:00Z" });
    const [after] = withFoundLoyalty(withFoundLoyalty([], statement), booking);
    expect(after).toMatchObject({ status: "Gold", statusAt: "2026-11-20T00:00:00Z", balance: "41,000 miles", balanceLabel: "November statement" });
    // An older status read late does not undo it.
    const [still] = withFoundLoyalty([after!], seen("123", { messageId: "m3", status: "Member", statusAt: "2026-10-01T00:00:00Z" }));
    expect(still).toMatchObject({ status: "Gold" });
  });

  it("knows a program with no distinctive word by its name", () => {
    const ba = seen("123", { program: "BA" });
    expect(withFoundLoyalty(withFoundLoyalty([], ba), { ...ba, program: "ba ", messageId: "m2" })).toHaveLength(1);
  });

  it("keeps every number, refusing a new one only once the list is full, never dropping one", () => {
    let found: FoundLoyalty[] = [];
    // Past the fifty once kept, every one stays.
    for (let i = 0; i < 51; i++) found = withFoundLoyalty(found, seen(`n${i}`));
    expect(found).toHaveLength(51);
    expect(found[0]!.number).toBe("n0");
    const full = Array.from({ length: maxFoundLoyalty }, (_, i) => seen(`n${i}`));
    expect(withFoundLoyalty(full, seen("new"))).toEqual(full);
    expect(withFoundLoyalties(full, [seen("new"), seen("n3", { status: "Gold" })])).toEqual({
      found: [...full.filter((f) => f.number !== "n3"), seen("n3", { status: "Gold" })],
      refused: 1,
    });
  });

  it("refuses a new number once the list would outgrow its share of the profile document", () => {
    // Long email subjects: the size fills before the count does.
    const long = Array.from({ length: 400 }, (_, i) => seen(`n${i}`, { label: "x".repeat(1000) }));
    const { found, refused } = withFoundLoyalties([], long);
    expect(refused).toBeGreaterThan(0);
    expect(found.length + refused).toBe(400);
    expect(new TextEncoder().encode(JSON.stringify(found)).length).toBeLessThanOrEqual(foundLoyaltyBudgetBytes);
    // One already kept is still refreshed.
    expect(withFoundLoyalties(found, [seen("n0", { status: "Gold" })]).refused).toBe(0);
  });

  it("tells the owner's membership from a fellow traveler's by name", () => {
    expect(couldBeOwner("MR J SMITH", "Jane Smith")).toBe(true);
    expect(couldBeOwner("SMITH/JANE MRS", "Jane Smith")).toBe(true);
    expect(couldBeOwner("Ann Smith", "Jane Ann Smith")).toBe(true);
    expect(couldBeOwner("Smith", "Jane Smith")).toBe(true);
    // Family on the same booking: a surname in common is not enough.
    expect(couldBeOwner("Jessica Ward", "Mikel Ward")).toBe(false);
    expect(couldBeOwner("MS J WARD", "Mikel Ward")).toBe(false);
    expect(couldBeOwner("WARD/MIKEL MR", "Mikel Ward")).toBe(true);
    expect(couldBeOwner("Alex Example", "Jane Smith")).toBe(false);
    expect(couldBeOwner(undefined, "Jane Smith")).toBe(true);
    expect(couldBeOwner("Alex Example", undefined)).toBe(true);
  });

  it("lists what TripIt imported, then what emails showed that it did not have", () => {
    const imported = { title: "Example Air Club", fields: [{ label: "Account Number", value: "12345678" }] };
    const profile = { loyalty: [imported], foundLoyalty: [seen("12 345 678"), seen("777", { program: "Sample Hotels Rewards", status: "Gold" })] };
    const all = allLoyalty(profile);
    expect(all).toHaveLength(2);
    expect(loyaltySummary(all[1]!)).toEqual({ title: "Sample Hotels Rewards", account: "777", status: "Gold" });
    expect(all[1]!.fields.at(-1)).toEqual({ label: "From email", value: "Your booking" });
    expect(programsFor("Sample Hotels", all)).toEqual([all[1]]);
  });
});

describe("whose a membership is", () => {
  const seen = (program: string, number: string, extra: Partial<FoundLoyalty> = {}): FoundLoyalty => ({ program, number, messageId: "m1", at: "2026-11-01T00:00:00Z", ...extra });
  const tripIt: ProfileEntry = { title: "Example Air", fields: [{ label: "Account number", value: "111222333" }] };
  const people = (entries: ProfileEntry[]) => loyaltyByPerson(entries).map((g) => [g.person ?? "You", g.entries.map((e) => loyaltySummary(e).account)]);

  it("groups the owner's first, then each person an email named, and says whose on a booking's line", () => {
    const found = [seen("SkyMiles", "9168692292", { person: "Sam Ward" }), seen("SkyMiles", "9099656416"), seen("SkyMiles", "9368712163", { person: "Alex Ward" })];
    const all = allLoyalty({ loyalty: [tripIt], foundLoyalty: found });
    expect(people(all)).toEqual([
      ["You", ["111222333", "9099656416"]],
      ["Alex Ward", ["9368712163"]],
      ["Sam Ward", ["9168692292"]],
    ]);
    expect(all.map(loyaltyLine)).toContain("SkyMiles · 9168692292 · Sam Ward");
  });

  it("follows the owner's word over the email's, for TripIt's programs too", () => {
    const found = [seen("SkyMiles", "9168692292", { person: "Sam Ward" })];
    let said = withLoyaltyPerson([], { program: "SkyMiles", number: "9168692292" }, undefined);
    said = withLoyaltyPerson(said, { program: "Example Air", number: "111 222 333" }, " Sam Ward ");
    expect(said).toHaveLength(2);
    expect(people(allLoyalty({ loyalty: [tripIt], foundLoyalty: found, loyaltyPeople: said }))).toEqual([
      ["You", ["9168692292"]],
      ["Sam Ward", ["111222333"]],
    ]);
    // A second word on one membership replaces the first.
    expect(withLoyaltyPerson(said, { program: "SkyMiles", number: "9168692292" }, "Alex Ward").filter((p) => p.number === "9168692292")).toEqual([
      { program: "SkyMiles", number: "9168692292", person: "Alex Ward" },
    ]);
  });

  it("keeps whose it is as first seen when the membership is seen again", () => {
    const first = withFoundLoyalty([], seen("SkyMiles", "9168692292", { person: "Sam Ward" }));
    expect(withFoundLoyalty(first, seen("SkyMiles", "9168692292", { messageId: "m2" }))[0]).toMatchObject({ person: "Sam Ward", messageId: "m2" });
  });

  it("keeps the program's distinctive name when an email calls it something generic", () => {
    const first = withFoundLoyalty([], seen("QATAR AIRWAYS", "820342520"));
    const both = withFoundLoyalty(first, seen("Privilege Club", "820342520", { messageId: "m2" }));
    expect(both).toEqual([expect.objectContaining({ program: "QATAR AIRWAYS", messageId: "m2" })]);
    expect(programsFor("Qatar Airways", allLoyalty({ loyalty: [], foundLoyalty: both }))).toHaveLength(1);
    // A distinctive name later still replaces a generic one.
    expect(withFoundLoyalty(withFoundLoyalty([], seen("Privilege Club", "820342520")), seen("Qatar Airways Privilege Club", "820342520"))[0]!.program).toBe("Qatar Airways Privilege Club");
  });

  it("shows a number written with padding zeros once", () => {
    const all = allLoyalty({ loyalty: [], foundLoyalty: withFoundLoyalty(withFoundLoyalty([], seen("Emirates Skywards", "EK557710580")), seen("Emirates Skywards", "EK00557710580", { status: "BLUE" })) });
    expect(all.map(loyaltySummary)).toEqual([expect.objectContaining({ account: "EK00557710580", status: "BLUE" })]);
  });

  it("shows a number TripIt has under a program name with nothing distinctive once", () => {
    const qatar: ProfileEntry = { title: "QATAR AIRWAYS", fields: [{ label: "Account number", value: "820342520" }] };
    const all = allLoyalty({ loyalty: [qatar], foundLoyalty: [seen("Privilege Club", "820342520")] });
    expect(all.map((e) => e.title)).toEqual(["QATAR AIRWAYS"]);
  });

  it("drops a balance read as a membership number", () => {
    const profile = TravelProfile.parse({
      ownerUid: "u1",
      foundLoyalty: [seen("Marriott Bonvoy", "9,600 Points"), seen("Marriott Bonvoy", "XXXXX8400"), seen("Example Air", "1200 miles")],
    });
    expect(profile.foundLoyalty?.map((f) => f.number)).toEqual(["XXXXX8400"]);
    expect(["9,600 Points", "XXXXX8400", "1200 miles", "UA-XXXXX166", "Gold"].map(isMembershipNumber)).toEqual([false, true, false, true, false]);
  });
});

describe("personName", () => {
  it("calls a member as a person is called", () => {
    expect(personName("MR ALEX SAMPLE")).toBe("Alex Sample");
    expect(personName("SAMPLE/ALEX MS")).toBe("Alex Sample");
    expect(personName("Jo O'Brien-Smith")).toBe("Jo O'Brien-Smith");
    expect(personName("MRS")).toBe("Mrs");
    expect(personName("  ")).toBeUndefined();
  });
});

describe("allLoyalty with the owner's people", () => {
  const people = [
    { id: "me", name: "Mikel Ward", aliases: ["Mikel Bradlee Ward", "Michael Ward"], me: true, bookings: 9, direct: 9 },
    { id: "jess", name: "Jessica Ward", aliases: ["Jessica Wilkes"], bookings: 4, direct: 0 },
  ];
  const found = (number: string, person?: string): FoundLoyalty => ({ program: "Example Air", number, messageId: `m${number}`, at: "2027-01-01T00:00:00Z", ...(person ? { person } : {}) });
  const profile = TravelProfile.parse({
    ownerUid: "u1",
    trustedEmails: [],
    foundLoyalty: [found("1", "Mikelbradlee Ward"), found("2", "Mikelb Ward"), found("3", "Michael Ward"), found("4", "Jessica Wilkes"), found("5", "Jessica Ward"), found("6", "Alex Sample")],
    // The owner said this one is "Jessica Wilkes"'s.
    loyaltyPeople: [{ program: "Example Air", number: "6", person: "Jessica Wilkes" }],
  });

  it("shows every spelling of someone as one person, and the owner's own as theirs", () => {
    const groups = loyaltyByPerson(allLoyalty(profile, people)).map((g) => [g.person, g.entries.map((e) => loyaltySummary(e).account)]);
    expect(groups).toEqual([
      [undefined, ["1", "2", "3"]],
      ["Jessica Ward", ["4", "5", "6"]],
    ]);
  });

  it("goes by the names emails gave without them", () => {
    expect(loyaltyByPerson(allLoyalty(profile)).map((g) => g.person)).toEqual(["Jessica Ward", "Jessica Wilkes", "Michael Ward", "Mikelb Ward", "Mikelbradlee Ward"]);
  });
});
