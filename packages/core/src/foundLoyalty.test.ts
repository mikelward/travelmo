import { describe, expect, it } from "vitest";
import { foundLoyaltyFrom, foundLoyaltyLine, needsReread, rereadFoundLoyalty, revisedFoundLoyalty } from "./foundLoyalty";
import { allLoyalty, loyaltySummary, withFoundLoyalty } from "./loyalty";
import type { FoundLoyalty, LoyaltyPerson } from "./schema";

const seen = (program: string, number: string, extra: Partial<FoundLoyalty> = {}): FoundLoyalty => ({
  program,
  number,
  messageId: "m1",
  label: "Your booking",
  at: "2026-11-01T00:00:00Z",
  ...extra,
});
const flight = (title: string) => ({ type: "flight" as const, title });
const none = () => [];

describe("foundLoyaltyFrom", () => {
  it("files an email's numbers by program and person, leaving out a balance read as a number", () => {
    const found = foundLoyaltyFrom(
      [
        { program: "Frequent Flyer", number: "UA-*****505", holder: "Mikel Ward", status: "Gold" },
        { program: "Frequent Flyer", number: "UA-*****166", holder: "Jessica Ward" },
        { program: "Example Air", number: "1,200 miles" },
      ],
      [],
      "Mikel Ward",
      { messageId: "m1", label: "Your trip", at: "2026-11-02T00:00:00Z", sent: "2026-11-01T00:00:00Z" },
    );
    expect(found).toEqual([
      { program: "United MileagePlus", number: "UA-*****505", holder: "Mikel Ward", status: "Gold", statusAt: "2026-11-01T00:00:00Z", messageId: "m1", label: "Your trip", at: "2026-11-02T00:00:00Z" },
      { program: "United MileagePlus", number: "UA-*****166", holder: "Jessica Ward", person: "Jessica Ward", messageId: "m1", label: "Your trip", at: "2026-11-02T00:00:00Z" },
    ]);
  });
});

describe("revisedFoundLoyalty", () => {
  it("files a number under a generic label by its airline code, else its booking's one airline", () => {
    const found = [seen("Frequent Flyer", "UA-*****505"), seen("Frequent Flyer", "XXXXX777", { messageId: "m2" }), seen("Frequent Flyer", "XXXXX888", { messageId: "m3" })];
    const segments: Record<string, ReturnType<typeof flight>[]> = { m2: [flight("DL 9 SLC to JFK")] };
    expect(revisedFoundLoyalty(found, undefined, (id) => segments[id] ?? []).map((f) => f.program)).toEqual(["United MileagePlus", "Delta SkyMiles", "Frequent Flyer"]);
  });

  it("names a fellow traveler who shares the owner's surname, and leaves the owner's own unset", () => {
    const found = [
      seen("United MileagePlus", "UA1", { holder: "Mikel Ward" }),
      // Taken for the owner's before, by the surname alone.
      seen("United MileagePlus", "UA2", { holder: "JESSICA WARD" }),
      // Taken for someone else's before: it is the owner's.
      seen("United MileagePlus", "UA3", { holder: "WARD/MIKEL MR", person: "Mikel Ward" }),
      // No holder to go on: as it was.
      seen("United MileagePlus", "UA4", { person: "Sam Ward" }),
    ];
    const revised = revisedFoundLoyalty(found, "Mikel Ward", none);
    expect(revised.map((f) => f.person)).toEqual([undefined, "Jessica Ward", undefined, "Sam Ward"]);
    expect(revised[0]).not.toHaveProperty("person");
    // Without the owner's name, whose each is stays as it was.
    expect(revisedFoundLoyalty(found, undefined, none).map((f) => f.person)).toEqual([undefined, undefined, "Mikel Ward", "Sam Ward"]);
  });

  it("merges entries that now name one membership, keeping the newest status", () => {
    const found = [
      seen("Frequent Flyer", "UA-12345", { status: "Silver", statusAt: "2026-10-01T00:00:00Z" }),
      seen("Delta SkyMiles", "999"),
      seen("United MileagePlus", "UA 12345", { messageId: "m2", at: "2026-11-05T00:00:00Z", status: "Gold", statusAt: "2026-11-01T00:00:00Z" }),
    ];
    const revised = revisedFoundLoyalty(found, undefined, none);
    expect(revised).toHaveLength(2);
    expect(revised[1]).toMatchObject({ program: "United MileagePlus", number: "UA 12345", status: "Gold", messageId: "m2" });
  });

  it("changes nothing already right, and never what the owner said about whose each is", () => {
    const found = [seen("United MileagePlus", "UA1", { holder: "Mikel Ward" }), seen("Delta SkyMiles", "DL2", { holder: "Jessica Ward", person: "Jessica Ward", balance: "1,000 miles" })];
    expect(revisedFoundLoyalty(found, "Mikel Ward", none)).toEqual(found);
    // The owner's answer still wins over the revised person.
    const said: LoyaltyPerson[] = [{ program: "United MileagePlus", number: "UA2" }];
    const profile = { loyalty: [], foundLoyalty: revisedFoundLoyalty([seen("Frequent Flyer", "UA2", { holder: "Jessica Ward" })], "Mikel Ward", none), loyaltyPeople: said };
    expect(profile.foundLoyalty[0]!.person).toBe("Jessica Ward");
    expect(loyaltySummary(allLoyalty(profile)[0]!).person).toBeUndefined();
  });
});

describe("reading an email again", () => {
  it("is needed only for a number with no holder or a program any could have", () => {
    expect(needsReread(seen("United MileagePlus", "UA1", { holder: "Mikel Ward" }))).toBe(false);
    expect(needsReread(seen("United MileagePlus", "UA1"))).toBe(true);
    expect(needsReread(seen("Frequent Flyer", "12345", { holder: "Mikel Ward" }))).toBe(true);
  });

  it("replaces the email's numbers with what the new read found, keeping their balance and status", () => {
    const found = [
      seen("Frequent Flyer", "12345", { status: "Gold", statusAt: "2026-10-01T00:00:00Z" }),
      seen("Delta SkyMiles", "DL2", { messageId: "m2" }),
      seen("Frequent Flyer", "99999"),
    ];
    const fresh = [seen("Example Air Club", "12345", { holder: "Jessica Ward", person: "Jessica Ward" }), seen("Example Air Club", "55555", { holder: "Mikel Ward" })];
    expect(rereadFoundLoyalty(found, "m1", fresh)).toEqual([
      found[1],
      seen("Example Air Club", "12345", { holder: "Jessica Ward", person: "Jessica Ward", status: "Gold", statusAt: "2026-10-01T00:00:00Z" }),
      seen("Example Air Club", "55555", { holder: "Mikel Ward" }),
    ]);
  });

  it("keeps whose a number was when the new read names no holder, and everything when it finds none", () => {
    const found = [seen("Frequent Flyer", "12345", { person: "Sam Ward" })];
    expect(rereadFoundLoyalty(found, "m1", [seen("Example Air Club", "12345")])).toEqual([seen("Example Air Club", "12345", { person: "Sam Ward" })]);
    expect(rereadFoundLoyalty(found, "m1", [])).toEqual(found);
  });

  it("leaves out a number the owner removed while the email was being read", () => {
    const read = [seen("Frequent Flyer", "12345"), seen("Frequent Flyer", "55555")];
    const now = [read[1]!];
    const fresh = [seen("United MileagePlus", "12345", { holder: "Mikel Ward" }), seen("United MileagePlus", "55555", { holder: "Mikel Ward" })];
    expect(rereadFoundLoyalty(now, "m1", fresh, read)).toEqual([seen("United MileagePlus", "55555", { holder: "Mikel Ward" })]);
  });

  it("keeps the other program's number when one sharing it was removed meanwhile", () => {
    const read = [seen("Hilton Honors", "12345"), seen("United MileagePlus", "12345")];
    const fresh = [seen("Hilton Honors", "12345", { holder: "Mikel Ward" }), seen("United MileagePlus", "12345", { holder: "Mikel Ward" })];
    expect(rereadFoundLoyalty([read[1]!], "m1", fresh, read)).toEqual([seen("United MileagePlus", "12345", { holder: "Mikel Ward" })]);
  });

  it("keeps a number an import respelled meanwhile", () => {
    const read = [seen("United MileagePlus", "UA-12345")];
    const fresh = [seen("United MileagePlus", "UA-12345", { holder: "Mikel Ward" })];
    expect(rereadFoundLoyalty([seen("United MileagePlus", "UA 12345")], "m1", fresh, read)).toHaveLength(1);
  });

  it("keeps a number read again when the list is full", () => {
    const big = { label: "x".repeat(1000) };
    let found: FoundLoyalty[] = [];
    for (let i = 0; found.length === i; i++) found = withFoundLoyalty(found, seen("Frequent Flyer", `n${i}`, { ...big, messageId: `m${i}` }));
    const fresh = [seen("United MileagePlus", "n0", { ...big, holder: "x".repeat(1500) })];
    const after = rereadFoundLoyalty(found, "m0", fresh);
    expect(after).toHaveLength(found.length);
    expect(after.at(-1)).toMatchObject({ program: "United MileagePlus", number: "n0" });
  });

  it("keeps each program's status when two programs share a number", () => {
    const found = [
      seen("Hilton Honors", "12345", { status: "Diamond", statusAt: "2026-10-01T00:00:00Z" }),
      seen("United MileagePlus", "12345", { status: "Silver", statusAt: "2026-10-01T00:00:00Z" }),
    ];
    const fresh = [seen("Hilton Honors", "12345", { holder: "Mikel Ward" }), seen("United MileagePlus", "12345", { holder: "Mikel Ward" })];
    expect(rereadFoundLoyalty(found, "m1", fresh)).toEqual([
      seen("Hilton Honors", "12345", { holder: "Mikel Ward", status: "Diamond", statusAt: "2026-10-01T00:00:00Z" }),
      seen("United MileagePlus", "12345", { holder: "Mikel Ward", status: "Silver", statusAt: "2026-10-01T00:00:00Z" }),
    ]);
  });
});

describe("foundLoyaltyLine", () => {
  it("names the program, then its status and balance, never the number", () => {
    expect(foundLoyaltyLine({ program: "Delta", status: "Silver Medallion", balance: "49,606 Miles" })).toBe("Delta: Silver Medallion · 49,606 Miles");
    expect(foundLoyaltyLine({ program: "Avios", balance: "12,400 Avios" })).toBe("Avios: 12,400 Avios");
    expect(foundLoyaltyLine({ program: "Emerald Club" })).toBe("Emerald Club");
  });
});
