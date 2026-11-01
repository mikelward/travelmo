import { expect, test, type Page } from "@playwright/test";
import { owner, signIn, signOut } from "./helpers";
import { clearData, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The worker saves the page shown after a soft navigation, its runtime data
// and the build assets it loaded, on request from the app; wait for all of it.
async function pageSaved(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const assets = performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name, location.href))
      .filter((url) => url.origin === location.origin && url.pathname.startsWith("/_next/static/"));
    const saved = await Promise.all(
      [location.pathname, ...assets.map((url) => url.href)].map((url) => caches.match(url, { ignoreVary: true })),
    );
    const router = await (await caches.open("router")).keys();
    const resume = `${location.origin}${location.pathname}?_rsc=`;
    return saved.every((response) => response !== undefined) && router.some((request) => request.url.startsWith(resume));
  });
}

test("a trip opened before going offline reloads without a network", async ({ page, context }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-offline");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();

  await pageSaved(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("You're offline");
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();
  await expect(page.getByTestId("trip-dates")).toContainText("12–14 Dec 2026");
});

test("another account on the same browser cannot read a cached trip offline", async ({ page, context }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-offline");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();
  await pageSaved(page);

  await signOut(page);
  await signIn(page, "stranger@example.com");
  await expect(page.getByText("No trips yet.")).toBeVisible();

  await context.setOffline(true);
  await page.goto("/trips/e2e-offline");
  await expect(page.getByRole("status")).toContainText("You're offline");
  // Firestore answers from its cache once it notices it is offline; with the
  // owner's documents cleared, that answer is "no such trip".
  await expect(page.getByText("This trip does not exist or is not shared with you.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Cove Liverpool", { exact: true })).toHaveCount(0);
});

test("a page never opened shows the offline notice instead of failing", async ({ page, context }) => {
  await signIn(page, owner);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.goto("/trips/never-opened");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
});
