import { expect, test } from "@playwright/test";
import { bookingAction, owner, signIn } from "./helpers";
import { clearData, readSegments, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("a booking and a whole trip can be marked cancelled, and restored", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-cancel");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();

  await bookingAction(page, "Mark cancelled");
  await expect(page.getByTestId("segment-cancelled")).toBeVisible();
  await expect.poll(async () => (await readSegments("e2e-cancel"))[0]?.userCancelled).toBe("booking");
  await bookingAction(page, "Restore");
  await expect(page.getByTestId("segment-cancelled")).toHaveCount(0);

  await page.getByRole("button", { name: "Mark trip cancelled" }).click();
  await expect(page.getByTestId("trip-cancelled-banner")).toContainText("Trip cancelled");
  await expect(page.getByTestId("segment-cancelled")).toBeVisible();
  // Its bookings come back with the trip.
  await page.getByRole("button", { name: "Booking actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Restore" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "← All trips" }).click();
  await expect(page.getByTestId("trip-cancelled")).toHaveText("(cancelled)");

  await page.getByRole("link", { name: /Liverpool/ }).click();
  await page.getByTestId("trip-cancelled-banner").getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId("trip-cancelled-banner")).toHaveCount(0);
  await expect(page.getByTestId("segment-cancelled")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark trip cancelled" })).toBeVisible();
});
