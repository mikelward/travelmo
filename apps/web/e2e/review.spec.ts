import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedParsedMessage } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("Settings links to the import review page, which lists what was not imported", async ({ page }) => {
  const uid = await signIn(page, owner);
  const base = { uid, segmentIds: [], processedAt: "2026-10-30T09:00:00Z" };
  await seedParsedMessage({ ...base, messageId: "skipped", source: "gmail", outcome: "not_booking", from: "News <news@cove.example>", subject: "Our summer sale" });
  await seedParsedMessage({ ...base, messageId: "booked", source: "gmail", outcome: "imported", from: "Bookings <hi@stay.example>", subject: "Your stay is confirmed" });

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Our summer sale")).toBeHidden();
  await page.getByRole("link", { name: "Review them" }).click();

  await expect(page).toHaveURL(/\/settings\/review$/);
  await expect(page.getByRole("heading", { level: 1, name: "Import review" })).toBeVisible();
  await expect(page.getByText("Our summer sale")).toBeVisible();
  await expect(page.getByText("News <news@cove.example> · Read, not a booking")).toBeVisible();
  await expect(page.getByRole("button", { name: "Always import cove.example" })).toBeVisible();
  await expect(page.getByText("Your stay is confirmed")).toBeHidden();

  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
});

test("the review list is searched by keyword and by dates", async ({ page }) => {
  const uid = await signIn(page, owner);
  const base = { uid, segmentIds: [], source: "gmail" as const, outcome: "not_booking" as const };
  await seedParsedMessage({ ...base, messageId: "sale", from: "News <news@cove.example>", subject: "Our summer sale", processedAt: "2026-10-30T12:00:00Z" });
  await seedParsedMessage({ ...base, messageId: "survey", from: "Rail <hello@rail.example>", subject: "How was your trip?", processedAt: "2026-09-15T12:00:00Z" });

  await page.goto("/settings/review");
  await expect(page.getByText("Our summer sale")).toBeVisible();
  await expect(page.getByText("How was your trip?")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("rail");
  await expect(page.getByText("Our summer sale")).toBeHidden();
  await expect(page.getByText("How was your trip?")).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByLabel("From").fill("2026-10-01");
  await expect(page.getByText("How was your trip?")).toBeHidden();
  await expect(page.getByText("Our summer sale")).toBeVisible();

  await page.getByLabel("To").fill("2026-10-15");
  await expect(page.getByText("Nothing matches.")).toBeVisible();
});

test("a search finds an email whatever it was read among, by name or by when it was sent", async ({ page }) => {
  const uid = await signIn(page, owner);
  const base = { uid, segmentIds: [], source: "gmail" as const, outcome: "not_booking" as const };
  // Read early in an import of more emails than the list shows.
  await seedParsedMessage({ ...base, messageId: "ticket", from: "Example Air <tickets@air.example>", subject: "Example Air e-Ticket XY12AB", processedAt: "2026-11-23T10:00:00Z", sentAt: "2026-05-23T07:22:58Z" });
  await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      seedParsedMessage({ ...base, messageId: `news-${i}`, from: "News <news@cove.example>", subject: `Newsletter ${i}`, processedAt: `2026-11-23T11:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` }),
    ),
  );

  await page.goto("/settings/review");
  await expect(page.getByText("Showing the 100 most recent.", { exact: false })).toBeVisible();
  await expect(page.getByText("Example Air e-Ticket XY12AB")).toBeHidden();

  await page.getByRole("searchbox", { name: "Search" }).fill("example air");
  await expect(page.getByText("Example Air e-Ticket XY12AB")).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByLabel("From").fill("2026-05-01");
  await page.getByLabel("To").fill("2026-08-01");
  await expect(page.getByText("Example Air e-Ticket XY12AB")).toBeVisible();
  await expect(page.getByText("Newsletter 1", { exact: true })).toBeHidden();
});
