import { expect, test } from "@playwright/test";
import { entryLabel, entryRule } from "@travelmo/core";
import { visaTable } from "@travelmo/core/visaRules";
import { owner, signIn } from "./helpers";
import { clearData, seedFlight, seedTrip, seedTravelProfile } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The seeded trip (12–14 Dec 2026, after the frozen 1 Nov) stays in the
// United Kingdom until a flight to Dubai makes it a trip abroad. What a
// British passport needs there is read from the same table the page uses,
// so a regenerated table never breaks this test.
test("a trip abroad says what each country needs of the traveler's passport", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  await seedTravelProfile(ownerUid, {
    ownerEmail: owner,
    trustedEmails: [],
    documents: [
      {
        title: "Travel document: Passport",
        fields: [
          { label: "Number", value: "X1234567" },
          { label: "Nationality", value: "GB" },
          { label: "Expiration date", value: "2031-03-01" },
        ],
      },
    ],
    loyalty: [],
    travelers: [],
  });
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();
  // Home country only: nothing to say.
  await expect(page.getByRole("region", { name: "Entry requirements" })).toHaveCount(0);

  await seedFlight("e2e-trip");
  const box = page.getByRole("region", { name: "Entry requirements" });
  const expected = entryLabel(entryRule(visaTable, "GB", "AE")).toLowerCase();
  await expect(box.locator('[data-country="AE"]')).toHaveText(`United Arab Emirates: ${expected} with your United Kingdom passport`);
  await expect(box).toContainText("From Passport Index data as of");
  // The number is never shown.
  await expect(page.getByText("X1234567")).toHaveCount(0);
});
