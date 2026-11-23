import { describe, expect, it } from "vitest";
import { allLoyalty, couldBeOwner, formatBalance, loyaltyLine, loyaltySummary, nameWords, programsFor, withFoundLoyalty } from "./loyalty";
import { maxFoundLoyalty, type FoundLoyalty, type ProfileEntry } from "./schema";

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

  it("knows a program with no distinctive word by its name", () => {
    const ba = seen("123", { program: "BA" });
    expect(withFoundLoyalty(withFoundLoyalty([], ba), { ...ba, program: "ba ", messageId: "m2" })).toHaveLength(1);
  });

  it("keeps the newest when the list is full", () => {
    let found: FoundLoyalty[] = [];
    for (let i = 0; i < maxFoundLoyalty + 1; i++) found = withFoundLoyalty(found, seen(`n${i}`));
    expect(found).toHaveLength(maxFoundLoyalty);
    expect(found[0]!.number).toBe("n1");
  });

  it("tells the owner's membership from a fellow traveler's by name", () => {
    expect(couldBeOwner("MR J SMITH", "Jane Smith")).toBe(true);
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
