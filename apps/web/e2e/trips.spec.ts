import { expect, test, type Page } from "@playwright/test";
import { clearData, seedTrip } from "./seed";

const owner = "owner@example.com";
const partner = "partner@example.com";

// The fixture's dates are fixed, so the browser's clock is too: before the
// stay's check-in, so "next up" is the check-in whenever the test runs.
// Only Date is pinned; timers keep running for Firestore and Auth.
const frozenNow = new Date("2026-11-01T12:00:00Z");

async function signIn(page: Page, email: string): Promise<string> {
  await page.clock.setFixedTime(frozenNow);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.travelmoTestSignIn === "function");
  return page.evaluate((address) => window.travelmoTestSignIn!(address), email);
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
}

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
  await page.getByRole("button", { name: "Add a booking" }).click();
  await page.getByPlaceholder("BA 117 LHR to JFK").fill("FR 123 MAN to DUB");
  const startDate = page.locator('input[type="date"]').first();
  await startDate.fill("2026-12-15");
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
