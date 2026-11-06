import { describe, expect, it } from "vitest";
import { extractTripItProfile, fitProfile, flatten, humanize, isEmptyProfile, loyaltyEntries, profileBudgetBytes, profileEntries, travelerEntries } from "./travelProfile";

// Invented people and numbers in the export's shape.
describe("humanize", () => {
  it("turns TripIt's keys into labels", () => {
    expect(humanize("passport_number")).toBe("Passport number");
    expect(humanize("ExpirationDate")).toBe("Expiration date");
    expect(humanize("elite-status")).toBe("Elite status");
  });
});

describe("flatten", () => {
  it("keeps every value, labeled by where it was", () => {
    expect(flatten({ number: "X1234567", issued: { country: "GB", date: "2020-01-02" }, names: ["Ann", "Example"], active: true })).toEqual([
      { label: "Number", value: "X1234567" },
      { label: "Issued › Country", value: "GB" },
      { label: "Issued › Date", value: "2020-01-02" },
      { label: "Names", value: "Ann, Example" },
      { label: "Active", value: "true" },
    ]);
  });

  it("numbers repeated records and skips empty values", () => {
    expect(flatten({ Address: [{ city: "Exampleton" }, { city: "Sampleville" }], blank: " " })).toEqual([
      { label: "Address 1 › City", value: "Exampleton" },
      { label: "Address 2 › City", value: "Sampleville" },
    ]);
  });
});

describe("loyaltyEntries", () => {
  it("titles each program by its name, unwrapping TripIt's list wrapper, a list of one included", () => {
    const wrapped = { LoyaltyProgram: [{ name: "Example Air Miles", account_number: "EA123", elite_status: "Gold", balance: "12000" }, { program: "Sample Hotels" }] };
    expect(loyaltyEntries(wrapped)).toEqual([
      {
        title: "Example Air Miles",
        fields: [
          { label: "Name", value: "Example Air Miles" },
          { label: "Account number", value: "EA123" },
          { label: "Elite status", value: "Gold" },
          { label: "Balance", value: "12000" },
        ],
      },
      { title: "Sample Hotels", fields: [{ label: "Program", value: "Sample Hotels" }] },
    ]);
    expect(loyaltyEntries({ account_number: "N1" })).toEqual([{ title: "Loyalty program 1", fields: [{ label: "Account number", value: "N1" }] }]);
    expect(loyaltyEntries(undefined)).toEqual([]);
  });
});

describe("profileEntries", () => {
  it("gives the profile its own entry and each document another", () => {
    const profile = {
      first_name: "Ann",
      last_name: "Example",
      home_city: "Exampleton",
      TravelDocument: [
        { type: "Passport", number: "X1234567", expiration_date: "2031-05-06", issuing_country: "GB" },
        { type: "Visa", number: "V99" },
      ],
      EmergencyContact: { name: "Bob Example", phone: "+15550100" },
    };
    const entries = profileEntries(profile);
    expect(entries.map((e) => e.title)).toEqual(["Ann Example", "Travel document: Passport", "Travel document: Visa", "Emergency contact: Bob Example"]);
    expect(entries[1]!.fields).toContainEqual({ label: "Number", value: "X1234567" });
    expect(entries[0]!.fields).toContainEqual({ label: "Home city", value: "Exampleton" });
  });
});

describe("travelerEntries", () => {
  it("lists everyone named on reservations once, with every detail given for them", () => {
    const trips = [
      {
        Objects: [
          { Traveler: { first_name: "Ann", last_name: "Example", frequent_traveler_num: "EA123" }, Segment: [{ Passenger: { name: "Cal Example" } }] },
          { Guest: [{ first_name: "ann", last_name: "example", meal_preference: "Vegetarian" }, { first_name: "Bob", last_name: "Example" }] },
        ],
      },
    ];
    const entries = travelerEntries(trips, [{ Driver: { first_name: "Bob", last_name: "Example", license: "D1" } }]);
    expect(entries.map((e) => e.title)).toEqual(["Ann Example", "Cal Example", "Bob Example"]);
    expect(entries[0]!.fields).toContainEqual({ label: "Frequent traveler num", value: "EA123" });
    expect(entries[0]!.fields).toContainEqual({ label: "Meal preference", value: "Vegetarian" });
    expect(entries[2]!.fields).toContainEqual({ label: "License", value: "D1" });
  });
});

describe("templated profiles", () => {
  // The shape TripIt's own export uses: a list of templates by name.
  const json = {
    first_name: "Ann",
    last_name: "Example",
    home_airport_code: { code: "AAA", name: "Exampleville" },
    home_location: "Exampleville, Australia",
    country_code: "AU",
    photo_url: "https://example.invalid/ann.png",
    sms_phone_number: "+15550100",
    EmailAddresses: [{ email_address: "ann@example.com", is_primary: "true" }, { email_address: "a.example@example.org" }],
    LoyaltyPrograms: [
      {
        name: "Example Air Miles",
        account_number: "EA123",
        balance: "12000",
        error_message: "",
        Activity: [{ date: "2030-01-01", description: "Flight", base: "100", bonus: "0", total: "100" }],
        SubAccount: [{ name: "Partner", balance: "5" }],
      },
    ],
    TravelerProfile: [
      {
        template_name: "TravelDocumentPassport",
        full_name: "Ann Example",
        first_name: "Ann",
        last_name: "Example",
        document_number: "X1234567",
        nationality: "Australia",
        country_of_birth: "New Zealand",
        date_issue: "2021-05-06",
        date_expire: "2031-05-06",
      },
      { template_name: "TravelAccountAir", name: "Example Air Miles", account_number: "EA123", nickname: "Ann's" },
      { template_name: "TravelAccountCar", name: "Example Cars Club", account_number: "C9" },
      { template_name: "UserProfilePublic", screen_name: "ann_e", full_name: "Ann Example", company: "Example Co", photo_url: "https://example.invalid/a.png" },
    ],
  };
  const profile = extractTripItProfile(json);

  it("files passports as documents, titled by kind and holder", () => {
    expect(profile.documents.map((d) => d.title)).toEqual(["Ann Example", "Passport: Ann Example"]);
    const passport = profile.documents[1]!;
    expect(passport.fields).toContainEqual({ label: "Date expire", value: "2031-05-06" });
    expect(passport.fields).toContainEqual({ label: "Nationality", value: "Australia" });
    expect(passport.fields.some((f) => f.label === "Template name")).toBe(false);
  });

  it("files loyalty accounts with the programs, adding details to a program already listed", () => {
    expect(profile.loyalty.map((l) => l.title)).toEqual(["Example Air Miles", "Example Cars Club"]);
    const air = profile.loyalty[0]!;
    expect(air.fields).toContainEqual({ label: "Balance", value: "12000" });
    expect(air.fields).toContainEqual({ label: "Nickname", value: "Ann's" });
    expect(air.fields).toContainEqual({ label: "Sub account › Name", value: "Partner" });
    expect(air.fields.filter((f) => f.label === "Account number")).toHaveLength(1);
    expect(air.fields.some((f) => f.label.startsWith("Activity") || f.label === "Error message")).toBe(false);
  });

  it("keeps a second account in the same program apart, by its number", () => {
    const two = extractTripItProfile({
      LoyaltyPrograms: [{ name: "Example Air Miles", account_number: "ANN123", balance: "1" }],
      TravelerProfile: [
        { template_name: "TravelAccountAir", name: "Example Air Miles", account_number: "BOB456", nickname: "Bob's" },
        { template_name: "TravelAccountAir", name: "Example Air Miles", account_number: "ANN123", nickname: "Ann's" },
        { template_name: "TravelAccountAir", name: "Sample Hotels", account_number: "S1" },
        { template_name: "TravelAccountAir", name: "Sample Hotels", account_number: "S2" },
      ],
    });
    expect(two.loyalty.map((l) => [l.title, l.fields.find((f) => f.label === "Account number")?.value, l.fields.find((f) => f.label === "Nickname")?.value])).toEqual([
      ["Example Air Miles", "ANN123", "Ann's"],
      ["Example Air Miles", "BOB456", "Bob's"],
      ["Sample Hotels", "S1", undefined],
      ["Sample Hotels", "S2", undefined],
    ]);
  });

  it("makes one entry of the traveler's own details, without photo or phone", () => {
    const own = profile.documents[0]!;
    expect(own.fields).toEqual([
      { label: "Name", value: "Ann Example" },
      { label: "Home airport code › Code", value: "AAA" },
      { label: "Home airport code › Name", value: "Exampleville" },
      { label: "Home location", value: "Exampleville, Australia" },
      { label: "Country code", value: "AU" },
      { label: "Screen name", value: "ann_e" },
      { label: "Company", value: "Example Co" },
      { label: "Emails", value: "ann@example.com, a.example@example.org" },
    ]);
  });

  it("takes the owner's name from the public profile when the root has none", () => {
    const only = extractTripItProfile({ TravelerProfile: [{ template_name: "UserProfilePublic", full_name: "Ann Example", company: "Example Co" }] });
    expect(only.documents).toEqual([
      { title: "Ann Example", fields: [{ label: "Name", value: "Ann Example" }, { label: "Company", value: "Example Co" }] },
    ]);
  });

  it("leaves a profile without template names to the generic reading", () => {
    const plain = extractTripItProfile({ TravelerProfile: { first_name: "Ann", Passport: { number: "X1" } } });
    expect(plain.documents.map((d) => d.title)).toEqual(["Ann", "Passport"]);
  });
});

describe("extractTripItProfile", () => {
  it("reads all three parts of an export, and nothing from an export without them", () => {
    const json = {
      Trips: [{ Objects: [{ Traveler: { first_name: "Ann", last_name: "Example" } }] }],
      LoyaltyPrograms: [{ name: "Example Air Miles" }],
      TravelerProfile: { first_name: "Ann", last_name: "Example", Passport: { number: "X1234567" } },
    };
    const profile = extractTripItProfile(json);
    expect(profile.travelers).toHaveLength(1);
    expect(profile.loyalty).toHaveLength(1);
    expect(profile.documents.map((d) => d.title)).toEqual(["Ann Example", "Passport"]);
    expect(isEmptyProfile(extractTripItProfile({ Trips: [] }))).toBe(true);
  });
});

describe("fitProfile", () => {
  it("keeps the whole profile within one stored document, documents first, and says what it left out", () => {
    // Three programs of 200 fields of 2,000 characters: well past 1 MB.
    const big = { LoyaltyPrograms: Array.from({ length: 3 }, (_, p) => Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`f${p}_${i}`, "x".repeat(2000)]))) };
    const json = { ...big, TravelerProfile: { Passport: { number: "X1234567" } } };
    const profile = extractTripItProfile(json);
    const size = JSON.stringify(profile).length;
    expect(size).toBeLessThan(profileBudgetBytes + 10_000);
    expect(profile.truncated).toBe(true);
    expect(profile.documents.map((d) => d.title)).toEqual(["Passport"]);
    expect(profile.loyalty.length).toBeLessThan(3);
    const small = { travelers: [], loyalty: [{ title: "A", fields: [{ label: "B", value: "C" }] }], documents: [] };
    expect(fitProfile(small)).toEqual(small);
  });
});
