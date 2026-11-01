import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedFlight, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("editing an imported booking keeps its offsets although its airports have zones", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-edit");
  await seedFlight("e2e-edit");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByText("XX 100 MAN to DXB", { exact: true })).toBeVisible();

  // Make sure the airport table is loaded in this page before the edit form
  // opens: a code typed into a new booking's form changes its zone.
  await page.getByRole("button", { name: "Add a booking" }).click();
  await page.getByPlaceholder("LHR", { exact: true }).fill("MAN");
  await expect(page.getByTitle("Time zone").first()).toHaveValue("Europe/London");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  const zone = page.getByTitle("Time zone");
  await expect(zone.first()).toHaveValue("offset:+05:00");
  await expect(zone.nth(1)).toHaveValue("offset:+04:00");
  // The stored instants survive an edit that touches neither code nor zone.
  await page.getByRole("textbox", { name: "Notes" }).fill("Seat 14A");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Seat 14A", { exact: false })).toBeVisible();
  await expect(zone).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  await expect(zone.first()).toHaveValue("offset:+05:00");
  await expect(zone.nth(1)).toHaveValue("offset:+04:00");
});
