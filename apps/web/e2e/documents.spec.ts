import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedFlight, seedTrip, seedTravelProfile } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The frozen date is 1 Nov 2026; the seeded trip runs 12–14 Dec 2026.
test("a passport that runs out soon after an upcoming trip is warned of on the list and the trip", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  // A flight to Dubai makes it a trip abroad.
  await seedFlight("e2e-trip");
  await seedTravelProfile(ownerUid, {
    ownerEmail: owner,
    trustedEmails: [],
    documents: [
      {
        title: "Travel document: Passport",
        fields: [
          { label: "Number", value: "X1234567" },
          { label: "Expiration date", value: "2027-03-01" },
          { label: "Issuing country", value: "GB" },
        ],
      },
    ],
    loyalty: [],
    travelers: [],
  });

  // The list carries one card of warnings at its top, naming the trip and linking to it; the trip's own page says "this trip".
  const listed = "Your passport expires on 1 Mar 2027, 2 months after Liverpool ends; many countries require six months’ validity.";
  const warning = "Your passport expires on 1 Mar 2027, 2 months after this trip ends; many countries require six months’ validity.";
  await expect(page.getByRole("list", { name: "Document warnings" })).toHaveText(listed);
  await expect(page.getByRole("link", { name: /^Liverpool/ })).not.toContainText("passport");
  await page.getByRole("link", { name: listed }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Document warnings" }).filter({ visible: true })).toHaveText(warning);
  // The number is never part of a warning.
  await expect(page.getByText("X1234567")).toHaveCount(0);
});
