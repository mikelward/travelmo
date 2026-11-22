import { expect, test } from "@playwright/test";

test("the privacy policy is readable without signing in", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gmail and Google Calendar" })).toBeVisible();
  await expect(page.getByText(/Limited Use requirements/)).toBeVisible();
  await expect(page.getByRole("link", { name: "play@mikelward.com" })).toHaveAttribute("href", "mailto:play@mikelward.com");
});

test("every page links to the privacy policy, the sign-in page included", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});
