import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, forgetTripFlags, readTrip, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("the trip list hides cancelled trips and local events when asked, and remembers it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  // A stay away, a show in town, and a trip its owner cancelled.
  await seedTrip(ownerUid, "e2e-away");
  await seedTrip(ownerUid, "e2e-show", { type: "activity", title: "Example Theatre", destination: { name: "Example Theatre", city: "London", country: "GB" } }, { title: "Example Theatre" });
  await seedTrip(ownerUid, "e2e-off", {}, { title: "Called off", cancelledAt: "2026-11-01T00:00:00Z" });
  const cards = page.getByTestId("trip-card");
  await expect(cards).toHaveCount(3);

  await page.getByRole("checkbox", { name: "Hide cancelled" }).check();
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("Called off")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Hide local events" }).check();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Liverpool");

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Hide local events" })).toBeChecked();
  await expect(cards).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Hide cancelled" }).uncheck();
  await page.getByRole("checkbox", { name: "Hide local events" }).uncheck();
  await expect(cards).toHaveCount(3);
  // The trips' bookings, once read, are recorded on them, so the filters needn't read them again.
  await expect.poll(async () => (await readTrip("e2e-show"))?.localOnly).toBe(true);
  await expect.poll(async () => (await readTrip("e2e-away"))?.localOnly).toBe(false);
  await expect.poll(async () => (await readTrip("e2e-away"))?.allCancelled).toBe(false);
});

test("the filters go by a trip's own flags without reading its bookings", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-away", {}, { allCancelled: false, localOnly: false });
  // Flags its bookings don't bear out: only the flags can hide it.
  await seedTrip(ownerUid, "e2e-flagged", {}, { title: "Flagged off", allCancelled: true, localOnly: false });
  const cards = page.getByTestId("trip-card");
  await expect(cards).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Hide cancelled" }).check();
  await expect(cards).toHaveCount(1);
  await expect(page.getByText("Flagged off")).toHaveCount(0);
});

test("a trip whose flags are taken off while the list is open is read and filtered again", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-away", {}, { allCancelled: false, localOnly: false });
  // Its booking is cancelled, but its flags, as yet, say otherwise.
  await seedTrip(ownerUid, "e2e-off", { cancelledAt: "2026-11-01T00:00:00Z" }, { title: "Called off", allCancelled: false, localOnly: false });
  const cards = page.getByTestId("trip-card");
  await page.getByRole("checkbox", { name: "Hide cancelled" }).check();
  await expect(cards).toHaveCount(2);
  await forgetTripFlags("e2e-off");
  await expect(cards).toHaveCount(1);
  await expect(page.getByText("Called off")).toHaveCount(0);
  await expect.poll(async () => (await readTrip("e2e-off"))?.allCancelled).toBe(true);
});
