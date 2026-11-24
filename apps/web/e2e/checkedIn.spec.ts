import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readCheckedIn, seedFlight, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The seeded Liverpool trip's flight leaves at 04:00Z on the 13th; its
// check-in usually opens a day before. The clock is in the trip's second
// evening, with check-in open.
test("I've checked in on the card hides its check-in line, and the trip page can undo it", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedTrip(uid, "e2e-checkin");
  await seedFlight("e2e-checkin", { confirmation: "XX1234" });
  await page.clock.setSystemTime(new Date("2026-12-12T20:00:00Z"));
  await page.goto("/");
  const card = page.getByTestId("trip-card").filter({ hasText: "Liverpool" });
  await expect(card.getByTestId("trip-checkin")).toHaveText("Online check-in open, usually until departure · Ref XX1234");
  await card.getByRole("button", { name: "I’ve checked in" }).click();
  await expect(card.getByTestId("trip-checkin")).toHaveCount(0);
  await expect.poll(() => readCheckedIn(uid, "e2e-checkin")).toEqual(["e2e-checkin-flight"]);

  await card.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByTestId("segment-checked-in")).toContainText("Checked in");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("segment-checked-in")).toHaveCount(0);
  await expect.poll(() => readCheckedIn(uid, "e2e-checkin")).toEqual([]);
  await expect(page.getByRole("button", { name: "I’ve checked in" })).toBeVisible();
});

test("the trip page saves the mark a notification's action opened it with", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedTrip(uid, "e2e-checkin");
  await seedFlight("e2e-checkin");
  await page.clock.setSystemTime(new Date("2026-12-12T20:00:00Z"));
  await page.goto("/trips/e2e-checkin?checkedIn=e2e-checkin-flight");
  await expect(page.getByTestId("segment-checked-in")).toContainText("Checked in");
  await expect(page).toHaveURL(/\/trips\/e2e-checkin$/);
  await expect.poll(() => readCheckedIn(uid, "e2e-checkin")).toEqual(["e2e-checkin-flight"]);
  // Only a flight of the trip: the stay is not one.
  await page.goto("/trips/e2e-checkin?checkedIn=e2e-checkin-stay");
  await expect(page).toHaveURL(/\/trips\/e2e-checkin$/);
  await expect.poll(() => readCheckedIn(uid, "e2e-checkin")).toEqual(["e2e-checkin-flight"]);
});
