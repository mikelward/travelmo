import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// docs/PRIVACY.md is the same policy for readers of the repository; the two
// must say the same thing word for word.
function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links keep their text
    .replace(/\*\*/g, "")
    .replace(/^#+ /gm, "")
    .replace(/^- /gm, "");
}
const words = (text: string) => text.replace(/[‘’]/g, "'").split(/\s+/).filter(Boolean).join(" ");

test("says the same as docs/PRIVACY.md", async ({ page }) => {
  const markdown = readFileSync(join(__dirname, "../../../docs/PRIVACY.md"), "utf8");
  await page.goto("/privacy");
  const shown = (await page.locator("article").innerText()).replace(/Back to Travelmo\s*$/, "");
  expect(words(shown)).toBe(words(plainText(markdown)));
});
