import { expect, test } from "@playwright/test";
import { owner, partner, signIn, signOut } from "./helpers";
import { clearData, seedTravelProfile } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// Invented details in the shape an import leaves them.
test("the owner sees their imported profile, shares it with a partner, and the partner can read it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTravelProfile(ownerUid, {
    ownerEmail: owner,
    trustedEmails: [],
    documents: [{ title: "Travel document: Passport", fields: [{ label: "Number", value: "X1234567" }] }],
    loyalty: [{ title: "Example Air Miles", fields: [{ label: "Account number", value: "EA123" }] }],
    travelers: [{ title: "Ann Example", fields: [{ label: "Meal preference", value: "Vegetarian" }] }],
  });
  await page.goto("/profile");
  await expect(page.getByText("EA123")).toBeVisible();
  // Documents stay folded until asked for.
  await expect(page.getByText("X1234567")).toBeHidden();
  await page.getByText("Travel document: Passport").click();
  await expect(page.getByText("X1234567")).toBeVisible();

  await page.getByLabel("Email address to share with").fill(partner.toUpperCase());
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(partner, { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, partner);
  await page.goto("/profile");
  await expect(page.getByText(`From ${owner}`)).toBeVisible();
  await expect(page.getByText("EA123")).toBeVisible();
  await page.getByText("Travel document: Passport").click();
  await expect(page.getByText("X1234567")).toBeVisible();
  // The partner reads it but has nothing to change it with.
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("someone not trusted sees no profile but their own", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTravelProfile(ownerUid, { ownerEmail: owner, trustedEmails: [], documents: [{ title: "Passport", fields: [{ label: "Number", value: "X1234567" }] }], loyalty: [], travelers: [] });
  await signOut(page);
  await signIn(page, partner);
  await page.goto("/profile");
  await expect(page.getByText("Nothing imported yet.", { exact: false })).toBeVisible();
  await expect(page.getByText("Shared with you")).toHaveCount(0);
});
