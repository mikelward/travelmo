import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedParsedMessage } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("Settings links to the import review page, which lists what was not imported", async ({ page }) => {
  const uid = await signIn(page, owner);
  const base = { uid, segmentIds: [], processedAt: "2026-10-30T09:00:00Z" };
  await seedParsedMessage({ ...base, messageId: "skipped", source: "gmail", outcome: "not_booking", from: "News <news@cove.example>", subject: "Our summer sale" });
  await seedParsedMessage({ ...base, messageId: "booked", source: "gmail", outcome: "imported", from: "Bookings <hi@stay.example>", subject: "Your stay is confirmed" });

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Our summer sale")).toBeHidden();
  await page.getByRole("link", { name: "Review them" }).click();

  await expect(page).toHaveURL(/\/settings\/review$/);
  await expect(page.getByRole("heading", { level: 1, name: "Import review" })).toBeVisible();
  await expect(page.getByText("Our summer sale")).toBeVisible();
  await expect(page.getByText("News <news@cove.example> · Read, not a booking")).toBeVisible();
  await expect(page.getByRole("button", { name: "Always import cove.example" })).toBeVisible();
  await expect(page.getByText("Your stay is confirmed")).toBeHidden();

  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
});
