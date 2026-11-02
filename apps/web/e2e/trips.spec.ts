import { expect, test } from "@playwright/test";
import { owner, partner, signIn, signOut } from "./helpers";
import { clearData, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("the owner sees an imported trip, shares it, and the partner can add a booking", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");

  await expect(page.getByRole("heading", { name: "Liverpool" })).toBeVisible();
  await expect(page.getByText("Check-in Cove Liverpool", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();
  // Next keeps the previous page mounted but hidden across a soft navigation,
  // so text lookups must be exact or role-based to avoid matching it.
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();
  // Every source of the booking, the email opening in Gmail for the owner.
  await expect(page.getByTestId("segment-sources")).toHaveText("Sources (2): Email “Your stay at Cove” · TripIt “Liverpool weekend”");
  await expect(page.getByRole("link", { name: "Email “Your stay at Cove”" })).toHaveAttribute("href", /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/m1$/);

  await page.getByPlaceholder("partner@example.com").fill(partner);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(partner, { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, partner);
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card).toBeVisible();
  await expect(card.getByText("Shared")).toBeVisible();
  await card.click();

  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  // The email is in the owner's mailbox, so a partner sees it named, not linked.
  await expect(page.getByTestId("segment-sources").first()).toContainText("Email “Your stay at Cove”");
  await expect(page.getByRole("link", { name: "Email “Your stay at Cove”" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add a booking" }).click();
  await page.getByPlaceholder("BA 117 LHR to JFK").fill("FR 123 MAN to DUB");
  const startDate = page.locator('input[type="date"]').first();
  await startDate.fill("2026-12-15");
  // Airport codes preselect each end's time zone once the table has loaded.
  const zone = page.getByTitle("Time zone");
  await page.getByPlaceholder("LHR", { exact: true }).fill("MAN");
  await expect(zone.first()).toHaveValue("Europe/London");
  await page.getByPlaceholder("JFK", { exact: true }).fill("DUB");
  await expect(zone.nth(1)).toHaveValue("Europe/Dublin");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("FR 123 MAN to DUB", { exact: true })).toBeVisible();
  await expect(page.getByTestId("trip-dates")).toContainText("12–15 Dec 2026");
});

test("a stranger sees no trips", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-private");
  await signOut(page);
  await signIn(page, "stranger@example.com");
  await expect(page.getByText("No trips yet.")).toBeVisible();
});
