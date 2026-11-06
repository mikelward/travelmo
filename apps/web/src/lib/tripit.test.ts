import { NotATripItExport } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { describeTripItResult, previewTripIt } from "./tripit";

const at = (date: string, time: string) => ({ date, time, timezone: "UTC", utc_offset: "+00:00" });
const file = JSON.stringify({
  Trips: [
    {
      TripData: { display_name: "Example trip" },
      Objects: [
        { Segment: [{ StartDateTime: at("2030-01-01", "08:00"), start_airport_code: "AAA", end_airport_code: "BBB" }] },
        { Segment: { StartDateTime: at("2030-01-05", "08:00"), start_airport_code: "BBB", end_airport_code: "AAA" } },
        { room_type: "Single", StartDateTime: at("2030-01-01", "15:00"), EndDateTime: at("2030-01-05", "11:00") },
        { text: "A note" },
      ],
    },
  ],
  UnfiledItems: [{ cuisine: "Example", DateTime: at("2031-02-02", "19:00") }],
});

describe("previewTripIt", () => {
  it("says what the file holds before anything is sent", () => {
    expect(previewTripIt(file).text).toBe(
      '1 trip with 4 bookings (2 flights, 1 stay, 1 activity), from 2030-01-01 to 2031-02-02. 1 booking TripIt never filed into a trip will go into "Unfiled from TripIt". 1 item can\'t be imported (listed below).',
    );
  });

  it("says when bookings keep a time the file gave no zone for", () => {
    const zoneless = JSON.stringify({ Trips: [{ Objects: [{ detail_type_code: "T", display_name: "Tour", StartDateTime: { date: "2030-01-01", time: "10:00" } }] }] });
    expect(previewTripIt(zoneless).text).toBe(
      "1 trip with 1 booking (1 activity), from 2030-01-01 to 2030-01-01. 1 booking has no time zone in the file and will keep the time as written.",
    );
  });

  it("says what the travel profile gets from the file", () => {
    const withProfile = JSON.stringify({
      ...JSON.parse(file),
      LoyaltyPrograms: [{ name: "Example Air Miles" }, { name: "Sample Hotels" }],
      TravelerProfile: { first_name: "Ann", Passport: { number: "X1234567" } },
    });
    expect(previewTripIt(withProfile).text).toMatch(/ Your travel profile gets 2 profile and document entries, 2 loyalty programs\.$/);
    expect(previewTripIt(withProfile).hasProfile).toBe(true);
    expect(previewTripIt(file).hasProfile).toBe(false);
  });

  it("takes an export that holds only a profile, with nothing to file into trips", () => {
    const only = previewTripIt(JSON.stringify({ LoyaltyPrograms: [{ name: "Example Air Miles" }] }));
    expect(only.hasProfile).toBe(true);
    expect(only.parsed.trips).toHaveLength(0);
  });

  it("refuses a file that is not JSON or not an export", () => {
    expect(() => previewTripIt("not json")).toThrow(NotATripItExport);
    expect(() => previewTripIt("{}")).toThrow(NotATripItExport);
  });
});

describe("describeTripItResult", () => {
  it("names what happened, leaving out what did not", () => {
    expect(describeTripItResult({ trips: 1, imported: 3, duplicates: 0, skipped: 0, failed: 0, notImported: 2 })).toBe(
      "Imported 3 bookings into 1 new or existing trip.",
    );
    expect(describeTripItResult({ trips: 0, imported: 0, duplicates: 1, skipped: 4, failed: 1, notImported: 0 })).toBe(
      "Imported 0 bookings into 0 new or existing trips; 1 booking was already there; 4 items were imported before; 1 item failed; try the upload again.",
    );
    expect(describeTripItResult({ trips: 0, imported: 0, duplicates: 0, skipped: 0, failed: 0, notImported: 0, loyaltyPrograms: 2 })).toBe(
      "Imported 0 bookings into 0 new or existing trips; your travel profile was updated (see Profile).",
    );
  });
});
