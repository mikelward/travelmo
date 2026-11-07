import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedLisbonTrip, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The frozen date is 1 Nov 2026; Liverpool runs 12–14 Dec 2026 and Lisbon
// 10–14 Jun 2025.
test("the calendar shows a month's trips as bars and moves between months", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-liverpool");
  await seedLisbonTrip(ownerUid, "e2e-lisbon");

  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "November 2026" })).toBeVisible();
  await expect(page.getByTestId("no-trips")).toHaveText("No trips in November 2026.");
  await expect(page.getByLabel("Today, 2026-11-01")).toHaveText("1");

  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "December 2026" })).toBeVisible();
  // 12–14 December 2026 is Saturday to Monday: the bar is split over two weeks.
  const week1 = page.locator('[data-week="2026-12-07"] [data-trip="e2e-liverpool"]');
  const week2 = page.locator('[data-week="2026-12-14"] [data-trip="e2e-liverpool"]');
  await expect(week1).toHaveText("Liverpool");
  await expect(week1).toHaveAttribute("data-days", "5-6");
  await expect(week2).toHaveText("… Liverpool");
  await expect(week2).toHaveAttribute("data-days", "0-0");
  await expect(page.getByTestId("no-trips")).toHaveCount(0);

  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "November 2026" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Today" })).toBeDisabled();

  // Back to a past year, and through to the trip.
  for (let i = 0; i < 17; i += 1) await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "June 2025" })).toBeVisible();
  await page.locator('[data-trip="e2e-lisbon"]').first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Lisbon" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("the navigation with its calendar link fits the width", async ({ page }) => {
    const ownerUid = await signIn(page, owner);
    await seedTrip(ownerUid, "e2e-liverpool");
    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "November 2026" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    for (const name of ["Calendar", "Reports", "Profile", "Settings"]) await expect(page.getByRole("link", { name })).toBeInViewport();
  });
});
