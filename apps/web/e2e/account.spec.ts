import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The parser is stubbed; what it deletes is its own tests' concern.
test("deleting the account asks first, then signs out and says it is gone", async ({ page }) => {
  await signIn(page, owner);
  const calls: (string | undefined)[] = [];
  await page.route("http://localhost:8080/account/delete", async (route) => {
    calls.push(route.request().headers()["authorization"]);
    await route.fulfill({ status: 204 });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText("Delete your account and everything in it? This cannot be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible();
  expect(calls).toEqual([]);

  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account deleted" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatch(/^Bearer /);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("a failed deletion says so and keeps the user signed in", async ({ page }) => {
  await signIn(page, owner);
  await page.route("http://localhost:8080/account/delete", (route) => route.fulfill({ status: 500, body: "Internal error" }));

  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(/Couldn't delete your account: .*500.* Try again\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("the header leads with Trips and signing out is at the foot of Settings", async ({ page }) => {
  await signIn(page, owner);
  const links = page.getByRole("banner").getByRole("link");
  await expect(links.nth(1)).toHaveText("Trips");
  await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await page.getByRole("link", { name: "Settings" }).click();
  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  // Below everything else on the page, Delete account included.
  const signOutTop = (await signOut.boundingBox())!.y;
  const deleteTop = (await page.getByRole("button", { name: "Delete account" }).boundingBox())!.y;
  expect(signOutTop).toBeGreaterThan(deleteTop);
  await signOut.click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});
