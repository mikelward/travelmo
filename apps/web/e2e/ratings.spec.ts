import { expect, test } from "@playwright/test";
import { owner, partner, signIn, signOut } from "./helpers";
import { clearData, readSegments, seedTrip, updateSegment } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("a booking can be rated and marked a favorite, which the reports list", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-rated");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();

  const verdict = page.getByTestId("segment-verdict");
  await expect(verdict.getByRole("group")).toHaveAttribute("aria-label", "Not rated");
  await verdict.getByRole("button", { name: "Rate 4 stars" }).click();
  await expect(verdict.getByRole("group")).toHaveAttribute("aria-label", "Rated 4 stars");
  await verdict.getByRole("button", { name: "Add to favorites" }).click();
  await expect(verdict.getByRole("button", { name: "Remove from favorites" })).toBeVisible();
  await expect.poll(async () => (await readSegments("e2e-rated"))[0]?.rating).toBe(4);
  await expect.poll(async () => (await readSegments("e2e-rated"))[0]?.favorite).toBe(true);

  await page.getByRole("link", { name: "Reports" }).click();
  const favorites = page.getByRole("list", { name: "Favorite places" });
  await expect(favorites.getByRole("listitem")).toHaveText(["♥Cove LiverpoolLiverpool, United Kingdom★★★★☆Liverpool"]);
  await favorites.getByRole("link", { name: "Liverpool" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();

  // Tapping the current rating clears it; the favorite stays.
  await verdict.getByRole("button", { name: "Clear the rating" }).click();
  await expect(verdict.getByRole("group")).toHaveAttribute("aria-label", "Not rated");
  await expect.poll(async () => (await readSegments("e2e-rated"))[0]?.rating).toBeUndefined();
});

test("a sharee can rate too; a viewer who cannot edit only sees the verdict", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-rated", { rating: 5, favorite: true });
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await page.getByPlaceholder("partner@example.com").fill(partner);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(partner, { exact: true })).toBeVisible();
  await signOut(page);
  await signIn(page, partner);
  await page.getByRole("link", { name: /Liverpool/ }).click();
  const verdict = page.getByTestId("segment-verdict");
  await expect(verdict.getByRole("group")).toHaveAttribute("aria-label", "Rated 5 stars");
  await verdict.getByRole("button", { name: "Rate 3 stars" }).click();
  await expect.poll(async () => (await readSegments("e2e-rated"))[0]?.rating).toBe(3);
});

test("saving an edit form keeps a verdict given elsewhere while it was open", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-rated", { rating: 2 });
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  // A sharee in another tab changes the verdict while the form is open.
  await updateSegment("e2e-rated", "e2e-rated-stay", { rating: 5, favorite: true, updatedAt: "2026-11-01T12:30:00Z" });
  await page.getByPlaceholder("BA 117 LHR to JFK").fill("Cove Liverpool, renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Cove Liverpool, renamed", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readSegments("e2e-rated"))[0]?.rating).toBe(5);
  expect((await readSegments("e2e-rated"))[0]?.favorite).toBe(true);
});
