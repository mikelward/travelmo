import { describe, expect, it } from "vitest";
import { travelDocuments } from "./documents";
import { allLoyalty, loyaltySummary } from "./loyalty";
import type { ProfileEntry, Segment, Trip } from "./schema";
import {
  buildDocumentEntry,
  buildLoyaltyEntry,
  defaultDocumentTitle,
  mergeProfileEntries,
  parseDocumentEntry,
  parseLoyaltyEntry,
  upcomingBoardingFlights,
} from "./wallet";

describe("wallet document entries", () => {
  it("builds a passport entry that travelDocuments parses with country and expiry", () => {
    const entry = buildDocumentEntry({
      type: "passport",
      title: "",
      country: "United States",
      number: "P12345678",
      expires: "2031-05-06",
      issued: "2021-05-06",
      notes: "Biometric",
    });
    expect(entry.title).toBe("United States Passport");
    expect(travelDocuments([entry])).toEqual([
      { title: "United States Passport", kind: "passport", expires: "2031-05-06", country: "US" },
    ]);
    expect(parseDocumentEntry(entry)).toEqual({
      type: "passport",
      title: "United States Passport",
      country: "United States",
      number: "P12345678",
      expires: "2031-05-06",
      issued: "2021-05-06",
      notes: "Biometric",
    });
  });

  it("reads a visa's admission country independently of nationality and preserves unmanaged imported fields on edit", () => {
    const imported: ProfileEntry = {
      title: "US Visa",
      fields: [
        { label: "Document type", value: "Visa" },
        { label: "Full name", value: "Sam Example" },
        { label: "Nationality", value: "GB" },
        { label: "Country", value: "US" },
        { label: "Country of birth", value: "GB" },
        { label: "Number", value: "V123" },
        { label: "Expiration date", value: "2029-04-01" },
      ],
    };
    const parsed = parseDocumentEntry(imported);
    expect(parsed.type).toBe("visa");
    expect(parsed.country).toBe("US");
    const edited = buildDocumentEntry({ ...parsed, title: "US B1/B2 Visa" }, imported);
    expect(travelDocuments([edited])).toEqual([
      { title: "US B1/B2 Visa", kind: "visa", expires: "2029-04-01", country: "US" },
    ]);
    expect(edited.fields).toContainEqual({ label: "Full name", value: "Sam Example" });
    expect(edited.fields).toContainEqual({ label: "Nationality", value: "GB" });
    expect(edited.fields).toContainEqual({ label: "Country of birth", value: "GB" });
  });

  it("recognizes UK share code, KTN, ID, and insurance types on round-trip", () => {
    const sc = buildDocumentEntry({ type: "share_code", title: "UK share code", country: "GB", number: "ABC 12D 3EF", expires: "2026-12-03" });
    expect(parseDocumentEntry(sc).type).toBe("share_code");
    const ktn = buildDocumentEntry({ type: "ktn", title: "Global Entry", number: "987654321", expires: "2030-01-01" });
    expect(parseDocumentEntry(ktn).type).toBe("ktn");
    const ins = buildDocumentEntry({ type: "insurance", title: "", number: "POL-42" });
    expect(ins.title).toBe(defaultDocumentTitle("insurance"));
    expect(parseDocumentEntry(ins).type).toBe("insurance");
  });
});

describe("wallet loyalty entries", () => {
  it("builds and parses a loyalty entry matching loyaltySummary, preserving unmanaged imported fields", () => {
    const imported: ProfileEntry = {
      title: "Qatar Airways Privilege Club",
      fields: [
        { label: "Account number", value: "820342520" },
        { label: "Elite status", value: "Silver" },
        { label: "Elite next status", value: "Gold" },
        { label: "Nickname", value: "Main" },
      ],
    };
    const parsed = parseLoyaltyEntry(imported);
    const edited = buildLoyaltyEntry({ ...parsed, status: "Gold", balance: "45000", person: "Alex" }, imported);
    expect(loyaltySummary(edited)).toEqual({
      title: "Qatar Airways Privilege Club",
      account: "820342520",
      status: "Gold",
      nextStatus: "Gold",
      balance: "45,000",
      person: "Alex",
    });
    expect(edited.fields).toContainEqual({ label: "Nickname", value: "Main" });
  });

  it("reconciles manual loyalty owner with loyaltyPeople overrides (reassignment and Mine)", () => {
    const manual = buildLoyaltyEntry({ program: "Example Air", number: "EA123", person: "Alex" });
    const base = { loyalty: [manual], foundLoyalty: [] };
    expect(loyaltySummary(allLoyalty({ ...base, loyaltyPeople: [] })[0]!).person).toBe("Alex");
    expect(
      loyaltySummary(allLoyalty({ ...base, loyaltyPeople: [{ program: "Example Air", number: "EA123", person: "Sam" }] })[0]!).person,
    ).toBe("Sam");
    expect(
      loyaltySummary(allLoyalty({ ...base, loyaltyPeople: [{ program: "Example Air", number: "EA123" }] })[0]!).person,
    ).toBeUndefined();
  });

  it("clears editable values sourced from nested fields while preserving unrelated sub-account fields", () => {
    const imported: ProfileEntry = {
      title: "Example Air",
      fields: [
        { label: "Account › Number", value: "EA123" },
        { label: "Account › Balance", value: "5000" },
        { label: "Partner › Nickname", value: "Family pool" },
      ],
    };
    const parsed = parseLoyaltyEntry(imported);
    expect(parsed.number).toBe("EA123");
    expect(parsed.balance).toBe("5,000");
    const cleared = buildLoyaltyEntry({ ...parsed, number: "", balance: "" }, imported);
    expect(loyaltySummary(cleared).account).toBeUndefined();
    expect(loyaltySummary(cleared).balance).toBeUndefined();
    expect(cleared.fields).toContainEqual({ label: "Partner › Nickname", value: "Family pool" });
  });
});

describe("mergeProfileEntries", () => {
  it("keeps manually added entries intact on match and updates matching imported entries", () => {
    const manual = buildDocumentEntry({
      type: "passport",
      title: "US Passport",
      number: "P1",
      expires: "2031-05-06",
      notes: "Renewed",
    });
    const importedMatchingManual: ProfileEntry = {
      title: "US Passport",
      fields: [
        { label: "Number", value: "P1" },
        { label: "Expiration date", value: "2028-01-01" },
      ],
    };
    const sharedOld: ProfileEntry = {
      title: "UK Visa",
      fields: [
        { label: "Number", value: "V1" },
        { label: "Expiration date", value: "2027-01-01" },
      ],
    };
    const sharedNew: ProfileEntry = {
      title: "UK Visa",
      fields: [
        { label: "Number", value: "V1" },
        { label: "Expiration date", value: "2029-01-01" },
      ],
    };
    const importedOnly: ProfileEntry = {
      title: "Global Entry",
      fields: [{ label: "Number", value: "K1" }],
    };

    const merged = mergeProfileEntries([manual, sharedOld], [importedMatchingManual, sharedNew, importedOnly]);
    expect(merged.map((e) => e.title)).toEqual(["US Passport", "UK Visa", "Global Entry"]);
    expect(merged[0]?.manual).toBe(true);
    expect(parseDocumentEntry(merged[0]!).expires).toBe("2031-05-06");
    expect(parseDocumentEntry(merged[0]!).notes).toBe("Renewed");
    expect(parseDocumentEntry(merged[1]!).expires).toBe("2029-01-01");
  });
});

describe("upcomingBoardingFlights", () => {
  const trip = (id: string, cancelledAt?: string): Trip => ({
    id,
    title: `Trip ${id}`,
    start: "2026-11-28",
    end: "2026-12-05",
    ownerUid: "u1",
    sharedWith: [],
    ...(cancelledAt ? { cancelledAt } : {}),
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  });

  const flight = (id: string, tripId: string, start: string, extra: Partial<Segment> = {}): Segment => ({
    id,
    tripId,
    type: "flight",
    title: `Flight ${id}`,
    start,
    source: "gmail",
    gmailMessageIds: [],
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...extra,
  });

  it("returns non-cancelled flights within [-3h, +48h] sorted by departure", () => {
    const nowMs = Date.parse("2026-11-28T12:00:00Z");
    const t1 = trip("t1");
    const tCancelled = trip("t2", "2026-11-20T00:00:00Z");
    const byTrip = new Map<string, Segment[]>([
      [
        "t1",
        [
          flight("too-old", "t1", "2026-11-28T08:00:00Z"),
          flight("recent", "t1", "2026-11-28T10:30:00Z"),
          flight("later", "t1", "2026-11-29T18:00:00Z"),
          flight("soon", "t1", "2026-11-28T15:00:00Z"),
          flight("too-far", "t1", "2026-12-01T12:00:00Z"),
          flight("cancelled", "t1", "2026-11-28T16:00:00Z", { cancelledAt: "2026-11-27T00:00:00Z" }),
          flight("hotel", "t1", "2026-11-28T14:00:00Z", { type: "lodging" }),
        ],
      ],
      ["t2", [flight("on-cancelled-trip", "t2", "2026-11-28T14:00:00Z")]],
    ]);

    const upcoming = upcomingBoardingFlights([t1, tCancelled], byTrip, nowMs);
    expect(upcoming.map((f) => f.segment.id)).toEqual(["recent", "soon", "later"]);
  });

  it("prefers explicit Document type over words in the title", () => {
    const edited = buildDocumentEntry({
      type: "visa",
      title: "US Passport",
      country: "Japan",
      expires: "2028-06-01",
    });
    expect(parseDocumentEntry(edited).type).toBe("visa");
    expect(travelDocuments([edited])[0]?.kind).toBe("visa");
  });

  it("gives manual loyalty edits precedence over older email statements per membership", () => {
    const edited = buildLoyaltyEntry(
      { program: "Delta SkyMiles", number: "987654", status: "Gold", balance: "2,000 miles" },
      undefined,
      "2026-11-28T12:00:00Z",
    );
    const unedited: ProfileEntry = {
      title: "British Airways Club",
      fields: [
        { label: "Account number", value: "112233" },
        { label: "Status", value: "Bronze" },
        { label: "Balance", value: "500 Avios" },
      ],
    };
    const entries = allLoyalty({
      loyalty: [edited, unedited],
      foundLoyalty: [
        {
          program: "Delta SkyMiles",
          number: "987654",
          status: "Silver",
          statusAt: "2026-11-20T00:00:00Z",
          balance: "1,000 miles",
          balanceAt: "2026-11-20T00:00:00Z",
          messageId: "m1",
          at: "2026-11-20T00:00:00Z",
        },
        {
          program: "British Airways Club",
          number: "112233",
          status: "Silver",
          statusAt: "2026-11-20T00:00:00Z",
          balance: "12,000 Avios",
          balanceAt: "2026-11-20T00:00:00Z",
          messageId: "m2",
          at: "2026-11-20T00:00:00Z",
        },
      ],
      importedAt: "2026-11-01T00:00:00Z",
      loyaltyPeople: [],
    });
    const delta = loyaltySummary(entries.find((e) => e.title === "Delta SkyMiles")!);
    expect(delta.status).toBe("Gold");
    expect(delta.balance).toBe("2,000 miles");

    const ba = loyaltySummary(entries.find((e) => e.title === "British Airways Club")!);
    expect(ba.status).toBe("Silver");
    expect(ba.balance).toBe("12,000 Avios");
  });

  it("keeps newer email values on a retained manual membership after an unrelated later import", () => {
    const manual = buildLoyaltyEntry(
      { program: "Delta SkyMiles", number: "987654", status: "Silver", balance: "100 miles" },
      undefined,
      "2026-11-01T00:00:00Z",
    );
    const entries = allLoyalty({
      loyalty: [manual],
      foundLoyalty: [
        {
          program: "Delta SkyMiles",
          number: "987654",
          status: "Gold",
          statusAt: "2026-11-20T00:00:00Z",
          balance: "200 miles",
          balanceAt: "2026-11-20T00:00:00Z",
          messageId: "m1",
          at: "2026-11-20T00:00:00Z",
        },
      ],
      importedAt: "2026-11-28T00:00:00Z",
      loyaltyPeople: [],
    });
    const delta = loyaltySummary(entries[0]!);
    expect(delta.status).toBe("Gold");
    expect(delta.balance).toBe("200 miles");
  });

  it("preserves distinct numberless documents with the same title during merge", () => {
    const usVisa = buildDocumentEntry({ type: "visa", title: "Visa", country: "United States", expires: "2028-01-01" });
    const inVisa = buildDocumentEntry({ type: "visa", title: "Visa", country: "India", expires: "2029-01-01" });
    const merged = mergeProfileEntries([usVisa, inVisa], []);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => parseDocumentEntry(e).country)).toEqual(["United States", "India"]);
  });
});
