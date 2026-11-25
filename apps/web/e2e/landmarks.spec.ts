import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// Each trip shows the landmark of the city its title names, and a place
// with no landmark drawn shows the suitcase.
test("each trip in the list shows its city's landmark", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-liverpool");
  await seedTrip(ownerUid, "e2e-woburn", {}, { title: "Woburn", start: "2027-01-08", end: "2027-01-10" });
  await page.goto("/");
  const landmark = (title: string) => page.getByTestId("trip-card").filter({ hasText: title }).locator("svg[data-landmark]");
  await expect(landmark("Liverpool")).toHaveAttribute("data-landmark", "liverpool");
  await expect(landmark("Woburn")).toHaveAttribute("data-landmark", "trip");
});
