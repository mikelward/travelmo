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

test("a place's country can be chosen, but is never asked for, and a flight shows none", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-country");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();

  // An imported stay shows the country it came with.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("combobox", { name: "Country" })).toHaveValue("GB");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Add a booking" }).click();
  // A flight's airport codes say where it is.
  await expect(page.getByRole("combobox", { name: /country/i })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Type" }).selectOption("activity");
  await page.getByPlaceholder("BA 117 LHR to JFK").fill("Example walking tour");
  await page.locator('input[type="date"]').first().fill("2026-12-13");
  // Saved without a country: nothing insists on one.
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Example walking tour", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  const country = page.getByRole("combobox", { name: "Country" });
  await expect(country).toHaveValue("");
  // A country with no place name is kept, the place named by the country.
  await country.selectOption({ label: "Ireland" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  await expect(page.getByRole("combobox", { name: "Country" })).toHaveValue("IE");
  await expect(page.getByRole("textbox", { name: "Where" })).toHaveValue("Ireland");
});
