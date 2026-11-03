import { describe, expect, it } from "vitest";
import { documentWarnings, parseDocumentDate, peopleDocuments, travelDocuments, tripWarnings, type TravelDocument } from "./documents";
import type { TravelProfile, Trip } from "./schema";

describe("parseDocumentDate", () => {
  it.each([
    ["2031-05-06", "2031-05-06"],
    ["2031-05-06T00:00:00Z", "2031-05-06"],
    ["6 May 2031", "2031-05-06"],
    ["6th May, 2031", "2031-05-06"],
    ["May 6, 2031", "2031-05-06"],
    ["Sept 6 2031", "2031-09-06"],
  ])("reads %s", (value, date) => {
    expect(parseDocumentDate(value)).toBe(date);
  });

  it.each(["06/05/2031", "2031-02-30", "soon", "31 Foo 2031"])("leaves %s alone", (value) => {
    expect(parseDocumentDate(value)).toBeUndefined();
  });
});

describe("travelDocuments", () => {
  it("finds expiry dates, kinds and countries by their labels", () => {
    const docs = travelDocuments([
      {
        title: "Travel document: Passport",
        fields: [
          { label: "Number", value: "X1234567" },
          { label: "Expiration date", value: "2031-05-06" },
          { label: "Issuing country", value: "gb" },
        ],
      },
      { title: "Travel document 2", fields: [{ label: "Type", value: "Visa" }, { label: "Valid until", value: "1 Jan 2027" }, { label: "Country", value: "US" }] },
      { title: "Trusted traveler", fields: [{ label: "Card › Expiry", value: "March 3, 2028" }] },
      { title: "Ann Example", fields: [{ label: "Home city", value: "Exampleton" }] },
    ]);
    expect(docs).toEqual([
      { title: "Travel document: Passport", kind: "passport", expires: "2031-05-06", country: "GB" },
      { title: "Travel document 2", kind: "visa", expires: "2027-01-01", country: "US" },
      { title: "Trusted traveler", kind: "other", expires: "2028-03-03" },
    ]);
  });
});

describe("travelDocuments countries", () => {
  it("never takes a visa's country from its holder's nationality", () => {
    const [visa, bare, passport] = travelDocuments([
      { title: "Visa", fields: [{ label: "Nationality", value: "GB" }, { label: "Country", value: "US" }, { label: "Expiry", value: "2027-01-01" }] },
      { title: "Visa", fields: [{ label: "Nationality", value: "GB" }, { label: "Expiry", value: "2027-01-01" }] },
      { title: "Passport", fields: [{ label: "Nationality", value: "GB" }, { label: "Expiry", value: "2030-01-01" }] },
    ]);
    expect(visa?.country).toBe("US");
    expect(bare?.country).toBeUndefined();
    expect(passport?.country).toBe("GB");
  });
});

describe("documentWarnings", () => {
  const passport: TravelDocument = { title: "Passport", kind: "passport", expires: "2027-03-01", country: "GB" };
  const visa: TravelDocument = { title: "US visa", kind: "visa", expires: "2026-12-20", country: "US" };
  const trip = { start: "2026-12-12", end: "2026-12-24" };
  const today = "2026-11-01";
  const abroad = { countries: new Set(["GB", "US"]), complete: true };

  it("warns of a passport that runs out within six months of the trip", () => {
    expect(documentWarnings([passport], trip, today, abroad)).toEqual([{ document: passport, when: "soon", daysAfterTrip: 67 }]);
  });

  it("warns of a document that runs out before the trip ends", () => {
    expect(documentWarnings([visa], trip, today, abroad)).toEqual([{ document: visa, when: "before", daysAfterTrip: -4 }]);
    const expired = { ...passport, expires: "2026-10-01" };
    expect(documentWarnings([expired], trip, today, abroad)[0]?.when).toBe("before");
  });

  it("says nothing of a document that lasts", () => {
    expect(documentWarnings([{ ...passport, expires: "2027-06-24" }, { ...visa, expires: "2030-01-01" }], trip, today, abroad)).toEqual([]);
  });

  it("only margins a passport, not a visa", () => {
    expect(documentWarnings([{ ...visa, expires: "2027-01-01" }], trip, today, abroad)).toEqual([]);
  });

  it("skips a passport for a trip known to stay in its country, and a visa for a trip not going to its", () => {
    const home = { countries: new Set(["GB"]), complete: true };
    expect(documentWarnings([passport, visa], trip, today, home)).toEqual([]);
  });

  it("warns when the trip's countries are not all known", () => {
    const partly = { countries: new Set(["GB"]), complete: false };
    expect(documentWarnings([passport, visa], trip, today, partly).map((w) => w.document.title)).toEqual(["Passport", "US visa"]);
    expect(documentWarnings([passport], trip, today).length).toBe(1);
  });

  it("says nothing for a trip that is over", () => {
    expect(documentWarnings([passport], { start: "2026-01-01", end: "2026-01-05" }, today, abroad)).toEqual([]);
  });
});

describe("tripWarnings", () => {
  const profile = (ownerUid: string, expires: string, ownerEmail?: string): TravelProfile => ({
    ownerUid,
    ...(ownerEmail ? { ownerEmail } : {}),
    trustedEmails: [],
    travelers: [],
    loyalty: [],
    documents: [{ title: "Passport", fields: [{ label: "Expiration date", value: expires }] }],
  });
  const trip: Trip = {
    id: "t",
    title: "Example",
    start: "2026-12-12",
    end: "2026-12-24",
    ownerUid: "me",
    sharedWith: ["partner@example.com"],
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };

  it("checks the viewer's documents and those of people on the trip, not others'", () => {
    const people = peopleDocuments(
      profile("me", "2027-02-01"),
      [profile("p", "2026-12-20", "partner@example.com"), profile("s", "2026-12-01", "someone@example.com"), profile("me", "2026-12-01")],
      "me",
    );
    expect(tripWarnings(people, trip, undefined, "2026-11-01").map((w) => [w.person.uid, w.warning.when])).toEqual([
      ["me", "soon"],
      ["p", "before"],
    ]);
  });

  it("counts the trip's owner as on it", () => {
    const people = peopleDocuments(null, [profile("me-too", "2026-12-20", "owner@example.com")], "viewer");
    expect(tripWarnings(people, { ...trip, ownerUid: "me-too" }, undefined, "2026-11-01")).toHaveLength(1);
  });
});
