import { expect, test } from "@playwright/test";
import { owner, partner, signIn, signOut } from "./helpers";
import { clearData, seedTravelProfile, seedTrip } from "./seed";

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
    loyalty: [
      {
        title: "Example Air Miles",
        fields: [
          { label: "Account number", value: "EA123" },
          { label: "Balance", value: "12000" },
          { label: "Elite status", value: "Gold" },
        ],
      },
    ],
    travelers: [{ title: "Ann Example", fields: [{ label: "Meal preference", value: "Vegetarian" }] }],
  });
  await page.goto("/profile");
  // Programs at a glance; the full entry folds below.
  await expect(page.getByRole("table", { name: "Loyalty programs" }).getByRole("row")).toHaveText(["ProgramAccountBalanceStatus", "Example Air MilesEA12312,000Gold"]);
  await expect(page.getByText("Elite status")).toBeHidden();
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
  await expect(page.getByRole("table", { name: "Loyalty programs" }).getByText("EA123")).toBeVisible();
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

test("a booking shows the viewer's program its provider belongs to, with the number and status", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-loyalty", { provider: "Example Air" });
  await seedTravelProfile(ownerUid, {
    ownerEmail: owner,
    trustedEmails: [],
    documents: [],
    loyalty: [
      { title: "Example Air Miles", fields: [{ label: "Account number", value: "EA123" }, { label: "Elite status", value: "Gold" }] },
      { title: "Sample Hotels Honors", fields: [{ label: "Account number", value: "SH-9" }] },
    ],
    travelers: [],
  });
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByTestId("segment-loyalty")).toHaveText("Example Air Miles · EA123 · Gold");
});
