import { expect, test, type Page } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readTrip, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The rest of what a trip keeps of its bookings, so the list need not read them.
const known = { allCancelled: false, localOnly: false, travelers: [] };

const landmark = (page: Page, title: string) => page.getByTestId("trip-card").filter({ hasText: title }).locator("[data-landmark]");

// A trip that is just an event shows its booking's icon; any other the
// landmark of the city its title names, else a picture of the kind of place
// it goes to, else a suitcase.
test("each trip in the list shows its city's landmark, else the kind of place it goes to", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-liverpool");
  await seedTrip(ownerUid, "e2e-sydney", {}, { title: "Sydney", start: "2027-02-01", end: "2027-02-05" });
  // From before trips kept their setting: the list reads its bookings and keeps it.
  await seedTrip(ownerUid, "e2e-woburn", { title: "Woburn Inn", destination: { name: "Woburn Inn", city: "Woburn", country: "US" } }, { title: "Woburn", start: "2027-01-08", end: "2027-01-10" });
  // Trips that already say what kind of place they go to: the list goes by that, not reading their bookings.
  await seedTrip(ownerUid, "e2e-cornwall", {}, { title: "Cornwall", start: "2025-07-01", end: "2025-07-08", setting: "beach", ...known });
  await seedTrip(ownerUid, "e2e-unknown", {}, { title: "Somewhere", start: "2025-05-01", end: "2025-05-02", setting: "none", ...known });
  // Just an event, though its title names a city and it kept a town before events took their booking's icon.
  await seedTrip(
    ownerUid,
    "e2e-show",
    { type: "activity", title: "Tower of London tour", destination: { name: "Tower of London", city: "London", country: "GB" } },
    { title: "Tower of London", start: "2025-03-01", end: "2025-03-01", allCancelled: false, localOnly: true, travelers: [], setting: "city" },
  );
  await seedTrip(
    ownerUid,
    "e2e-meal",
    { type: "meal", title: "Example Bistro", destination: { name: "Example Bistro", city: "London", country: "GB" } },
    { title: "Example Bistro", start: "2025-02-01", end: "2025-02-01" },
  );
  await page.goto("/");
  await expect(landmark(page, "Liverpool")).toHaveAttribute("data-landmark", "liverpool");
  await expect(landmark(page, "Sydney")).toHaveAttribute("data-landmark", "sydney");
  await expect(landmark(page, "Woburn")).toHaveAttribute("data-landmark", "town");
  await expect(landmark(page, "Cornwall")).toHaveAttribute("data-landmark", "beach");
  await expect(landmark(page, "Somewhere")).toHaveAttribute("data-landmark", "trip");
  await expect(landmark(page, "Tower of London")).toHaveAttribute("data-landmark", "activity");
  await expect(landmark(page, "Example Bistro")).toHaveAttribute("data-landmark", "meal");
  await expect.poll(async () => (await readTrip("e2e-show"))?.setting).toBe("activity");
  await expect.poll(async () => (await readTrip("e2e-meal"))?.setting).toBe("meal");
  await expect.poll(async () => (await readTrip("e2e-woburn"))?.setting).toBe("town");
});
