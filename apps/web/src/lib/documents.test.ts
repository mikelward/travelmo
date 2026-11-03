import type { Trip, TravelProfile } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { peopleDocuments, tripWarnings } from "@travelmo/core";
import { warningText } from "./documents";

const profile = (ownerUid: string, expires: string, extra: Partial<TravelProfile> = {}): TravelProfile => ({
  ownerUid,
  trustedEmails: [],
  travelers: [],
  loyalty: [],
  documents: [{ title: "Travel document: Passport", fields: [{ label: "Expiration date", value: expires }] }],
  ...extra,
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
const today = "2026-11-01";

describe("warningText", () => {
  it("names whose document it is and when it runs out", () => {
    const people = peopleDocuments(profile("me", "2027-02-01"), [
      profile("p", "2026-12-20", { ownerEmail: "partner@example.com" }),
      profile("s", "2026-12-01", { ownerEmail: "someone@example.com" }),
    ], "me");
    const warnings = tripWarnings(people, trip, undefined, today);
    expect(warnings.map((w) => warningText(w, today))).toEqual([
      "Your passport expires on 1 Feb 2027, 1 month after this trip ends; many countries require six months’ validity.",
      "partner@example.com’s passport expires on 20 Dec 2026, before this trip ends.",
    ]);
  });

  it("says a document has already expired", () => {
    const people = peopleDocuments(profile("me", "2026-10-01"), [], "me");
    expect(warningText(tripWarnings(people, trip, undefined, today)[0]!, today)).toBe("Your passport expired on 1 Oct 2026.");
  });

  it("counts days when the expiry is under a month after the trip", () => {
    const people = peopleDocuments(profile("me", "2026-12-25"), [], "me");
    expect(warningText(tripWarnings(people, trip, undefined, today)[0]!, today)).toContain("1 day after this trip ends");
  });
});
