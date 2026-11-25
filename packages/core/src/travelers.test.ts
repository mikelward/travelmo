import { describe, expect, it } from "vitest";
import { mergeDetails } from "./trips";
import { canonicalName, canonicalTravelers, findPerson, guessMe, notePeople, sameTraveler } from "./travelers";

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

  it("finds no one through an initial when the whole first name known is another", () => {
    const smiths = [{ id: "john", name: "J Smith", aliases: ["John Smith"] }];
    expect(findPerson(smiths, "Jane Smith")).toBeUndefined();
    expect(findPerson(smiths, "SMITH/JOHN MR")?.id).toBe("john");
    expect(findPerson(smiths, "J Smith")?.id).toBe("john");
    expect(findPerson([{ id: "j", name: "J Smith" }], "Jane Smith")?.id).toBe("j");
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

describe("notePeople", () => {
  const at = "2026-05-01T00:00:00Z";
  let n = 0;
  const options = (direct: boolean) => ({ direct, timestamp: at, newId: () => `p${++n}` });
  const sam = { id: "sam", name: "Sam Example", aliases: [], bookings: 3, direct: 2, createdAt: at, updatedAt: at };

  it("counts a known traveler once more, keeping a new spelling", () => {
    const [changed] = notePeople([sam], [{ travelers: ["EXAMPLE/SAM JAMES MR"] }], options(true));
    expect(changed).toMatchObject({ id: "sam", aliases: ["Sam James Example"], bookings: 4, direct: 3 });
    expect(notePeople([sam], [{ travelers: ["Sam Example"] }], options(false))[0]).toMatchObject({ aliases: [], bookings: 4, direct: 2 });
  });

  it("adds someone new, once however often the booking names them", () => {
    n = 0;
    const changed = notePeople([sam], [{ travelers: ["DOE/JANE MRS", "Jane Doe", "Sam Example"] }], options(false));
    expect(changed.map((p) => [p.id, p.name, p.bookings])).toEqual([
      ["p1", "Jane Doe", 1],
      ["sam", "Sam Example", 4],
    ]);
  });
});

describe("guessMe", () => {
  const person = (id: string, bookings: number, direct: number, me?: boolean) => ({ id, name: id, bookings, direct, ...(me ? { me } : {}) });

  it("is whoever the user said", () => {
    expect(guessMe([person("a", 9, 9), person("b", 1, 0, true)])?.id).toBe("b");
  });

  it("else whoever emails sent straight to the user name most, then any booking", () => {
    expect(guessMe([person("mum", 9, 0), person("me", 4, 4)])?.id).toBe("me");
    expect(guessMe([person("a", 2, 0), person("b", 5, 0)])?.id).toBe("b");
    expect(guessMe([])).toBeUndefined();
  });
});

describe("notePeople across bookings", () => {
  const none: { id: string; name: string; aliases: string[]; bookings: number; direct: number; createdAt: string; updatedAt: string }[] = [];
  const options = { direct: true, timestamp: "2026-05-01T00:00:00Z", newId: (() => { let n = 0; return () => `p${++n}`; })() };

  it("counts a person once for each booking that names them", () => {
    const changed = notePeople(none, [{ travelers: ["Sam Example"] }, { travelers: ["SAMPLE/SAM MR", "Sam Example", "EXAMPLE/SAM MR"] }, { travelers: ["Pat Example"] }], options);
    // Sam twice, once in each booking, however often a booking names him.
    expect(changed.map((p) => [p.name, p.bookings, p.direct])).toEqual([
      ["Sam Example", 2, 2],
      ["Sam Sample", 1, 1],
      ["Pat Example", 1, 1],
    ]);
  });

  it("counts only whom a booking filed before newly names, still keeping a new spelling", () => {
    const j = { id: "j", name: "J Smith", aliases: [], bookings: 1, direct: 1, createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" };
    const changed = notePeople([j], [{ travelers: ["John Smith", "Amy Smith"], before: ["J Smith"] }], options);
    expect(changed.map((p) => [p.name, p.aliases, p.bookings])).toEqual([
      ["J Smith", ["John Smith"], 1],
      ["Amy Smith", [], 1],
    ]);
    // So Jane, on the next booking, is someone else.
    expect(findPerson(changed, "Jane Smith")).toBeUndefined();
    expect(notePeople(changed, [{ travelers: ["John Smith"], before: ["John Smith"] }], options)).toEqual([]);
  });

  it("counts someone a booking newly names whom an initial it named before could be taken for", () => {
    const at = { createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z" };
    const john = { id: "john", name: "J Smith", aliases: ["John Smith"], bookings: 1, direct: 0, ...at };
    const jane = { id: "jane", name: "Jane Smith", aliases: [], bookings: 1, direct: 0, ...at };
    const changed = notePeople([john, jane], [{ travelers: ["John Smith", "Jane Smith"], before: ["J Smith"] }], options);
    expect(changed.map((p) => [p.id, p.bookings])).toEqual([["jane", 2]]);
  });

  it("keeps a whole first name seen beside an initial in one email, so the next stays apart", () => {
    const changed = notePeople(none, [{ travelers: ["J Smith", "John Smith", "Jane Smith"] }], options);
    expect(changed.map((p) => [p.name, p.aliases, p.bookings])).toEqual([
      ["J Smith", ["John Smith"], 1],
      ["Jane Smith", [], 1],
    ]);
  });
});

describe("people named through an initial", () => {
  it("stay two once both whole first names are known", () => {
    let people: { id: string; name: string; aliases: string[]; bookings: number; direct: number; createdAt: string; updatedAt: string }[] = [];
    let n = 0;
    for (const name of ["J Smith", "John Smith", "Jane Smith"]) {
      const changed = notePeople(people, [{ travelers: [name] }], { direct: false, timestamp: "2026-05-01T00:00:00Z", newId: () => `p${++n}` });
      people = [...people.filter((p) => !changed.some((c) => c.id === p.id)), ...changed];
    }
    expect(people.map((p) => [p.name, p.bookings]).sort()).toEqual([
      ["J Smith", 2],
      ["Jane Smith", 1],
    ]);
  });
});
