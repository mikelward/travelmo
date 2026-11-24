import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("the trip list hides cancelled trips and local events when asked, and remembers it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  // A stay away, a show in town, and a trip its owner cancelled.
  await seedTrip(ownerUid, "e2e-away");
  await seedTrip(ownerUid, "e2e-show", { type: "activity", title: "Example Theatre", destination: { name: "Example Theatre", city: "London", country: "GB" } }, { title: "Example Theatre" });
  await seedTrip(ownerUid, "e2e-off", {}, { title: "Called off", cancelledAt: "2026-11-01T00:00:00Z" });
  const cards = page.getByTestId("trip-card");
  await expect(cards).toHaveCount(3);

  await page.getByRole("checkbox", { name: "Hide cancelled" }).check();
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("Called off")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Hide local events" }).check();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Liverpool");

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Hide local events" })).toBeChecked();
  await expect(cards).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Hide cancelled" }).uncheck();
  await page.getByRole("checkbox", { name: "Hide local events" }).uncheck();
  await expect(cards).toHaveCount(3);
});
