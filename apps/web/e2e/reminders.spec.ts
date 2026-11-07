import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readUser } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("reminders by email are off until asked for, and the choice is kept", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await page.goto("/settings");
  const box = page.getByRole("checkbox", { name: /Email me before a trip/ });
  await expect(box).not.toBeChecked();
  await expect(page.getByText(`(to ${owner})`)).toBeVisible();
  await box.check();
  await expect(page.getByText("On", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readUser(ownerUid))?.reminders?.email).toBe(true);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Email me before a trip/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /Email me before a trip/ }).uncheck();
  await expect.poll(async () => (await readUser(ownerUid))?.reminders?.email).toBe(false);
});
