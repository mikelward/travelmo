import { describe, expect, it } from "vitest";
import { mergeDetails } from "./trips";
import { canonicalName, canonicalTravelers, findPerson, sameTraveler } from "./travelers";

describe("canonicalName", () => {
  it("reads an airline record's surname/given name, with or without a title", () => {
    expect(canonicalName("SMITH/JOHN MR")).toBe("John Smith");
    expect(canonicalName("SMITH/JOHNMR")).toBe("John Smith");
    expect(canonicalName("SMITH/JANE MS")).toBe("Jane Smith");
    // MS glued on is left, as names end in it too; it matches the name without (below).
    expect(canonicalName("SMITH/SHAMS")).toBe("Shams Smith");
    expect(canonicalName("DOE/JANE ANNE MRS")).toBe("Jane Anne Doe");
    expect(canonicalName("O'NEIL-WARD/MARY MISS")).toBe("Mary O'Neil-Ward");
  });

  it("reads a list's surname, given name and a greeting's title first", () => {
    expect(canonicalName("Smith, John")).toBe("John Smith");
    expect(canonicalName("MRS JANE DOE")).toBe("Jane Doe");
    expect(canonicalName("Dr. Ada Example")).toBe("Ada Example");
  });

  it("keeps a name's own mixed case, and spacing tidied", () => {
    expect(canonicalName("  Ronan   McDonald ")).toBe("Ronan McDonald");
    expect(canonicalName("josé álvarez")).toBe("José Álvarez");
  });

  it("finds no name in titles or punctuation alone", () => {
    expect(canonicalName("MR")).toBeUndefined();
    expect(canonicalName(" - ")).toBeUndefined();
  });

  it("leaves a given name that only ends like a title as it is", () => {
    expect(canonicalName("SMITH/AMIR")).toBe("Amir Smith");
  });
});

describe("sameTraveler", () => {
  it("matches a name however it is written", () => {
    expect(sameTraveler("SMITH/JOHN MR", "John Smith")).toBe(true);
    expect(sameTraveler("José Álvarez", "JOSE ALVAREZ")).toBe(true);
  });

  it("matches with or without a middle name, and an initial for a first name", () => {
    expect(sameTraveler("Jane Anne Doe", "Jane Doe")).toBe(true);
    expect(sameTraveler("J Smith", "John Smith")).toBe(true);
  });

  it("compares accented letters as plain ones, as Android does", () => {
    expect(sameTraveler("Trần An", "Tran An")).toBe(true);
    expect(sameTraveler("Søren Hansen", "Soren Hansen")).toBe(true);
  });

  it("keeps apart different first names, or the same first name in different families", () => {
    expect(sameTraveler("John Smith", "Jane Smith")).toBe(false);
    expect(sameTraveler("John Smith", "John Jones")).toBe(false);
    expect(sameTraveler("Smith", "John Smith")).toBe(false);
  });
});

describe("findPerson", () => {
  const people = [
    { id: "me", name: "Sam Example", aliases: ["S Example"], me: true },
    { id: "mum", name: "Pat Example", aliases: ["EXAMPLE/PATRICIA MRS"] },
  ];

  it("finds someone by their name or any way it was written", () => {
    expect(findPerson(people, "EXAMPLE/SAM MR")?.id).toBe("me");
    expect(findPerson(people, "Patricia Example")?.id).toBe("mum");
  });

  it("finds no one for a new name or no name", () => {
    expect(findPerson(people, "Alex Example")).toBeUndefined();
    expect(findPerson(people, "MR")).toBeUndefined();
  });
});

describe("canonicalTravelers", () => {
  it("writes each name once as people write it, in the email's order", () => {
    expect(canonicalTravelers(["SMITH/JOHN MR", "SMITH/JANE MRS", "John Smith"])).toEqual(["John Smith", "Jane Smith"]);
  });

  it("matches a name with MS glued on to it without, keeping the one without", () => {
    expect(sameTraveler("SMITH/JANEMS", "Jane Smith")).toBe(true);
    expect(canonicalTravelers(["SMITH/JANEMS", "SMITH/JANE MS"])).toEqual(["Jane Smith"]);
    expect(canonicalTravelers(["SMITH/SHAMS", "Shams Smith"])).toEqual(["Shams Smith"]);
  });

  it("keeps the fuller spelling, so an initial doesn't hide two people", () => {
    expect(canonicalTravelers(["J Smith", "John Smith", "Jane Smith"])).toEqual(["John Smith", "Jane Smith"]);
  });

  it("keeps at most twenty, however many several emails name together", () => {
    const many = Array.from({ length: 25 }, (_, i) => `Person${String.fromCharCode(65 + i)} Example`);
    expect(canonicalTravelers(many)).toHaveLength(20);
    const stay = { type: "lodging" as const, title: "Example Hotel", start: "2026-12-12T15:00:00+00:00", travelers: many.slice(0, 15) };
    expect(mergeDetails(stay, { ...stay, travelers: many.slice(10) }).travelers).toHaveLength(20);
  });

  it("is nothing when no entry is a name", () => {
    expect(canonicalTravelers(["MR", " "])).toBeUndefined();
    expect(canonicalTravelers(undefined)).toBeUndefined();
  });
});

describe("mergeDetails with travelers", () => {
  it("keeps everyone either email names, each once", () => {
    const stay = { type: "lodging" as const, title: "Example Hotel", start: "2026-12-12T15:00:00+00:00", travelers: ["John Smith"] };
    expect(mergeDetails(stay, { ...stay, travelers: ["SMITH/JOHN MR", "SMITH/JANE MRS"] }).travelers).toEqual(["John Smith", "Jane Smith"]);
    expect(mergeDetails({ ...stay, travelers: undefined }, stay).travelers).toEqual(["John Smith"]);
  });
});
