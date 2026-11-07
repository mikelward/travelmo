import { describe, expect, it } from "vitest";
import { formatBalance, loyaltyLine, loyaltySummary, nameWords, programsFor } from "./loyalty";
import type { ProfileEntry } from "./schema";

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
