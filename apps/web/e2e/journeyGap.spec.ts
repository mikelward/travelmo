import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readUser, seedFlight, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

const heathrow = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
const boston = { name: "Boston Logan", code: "BOS", city: "Boston", country: "US" };

test("a trip with no flight back says so, finds it in Gmail, and stops once it's one way", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedTrip(uid, "e2e-boston", {}, { title: "Boston", start: "2026-12-12", end: "2026-12-12" });
  await seedFlight("e2e-boston", { id: "out", title: "XX 11 LHR to BOS", confirmation: "AB12CD", start: "2026-12-12T17:20:00+00:00", end: "2026-12-12T20:15:00-05:00", origin: heathrow, destination: boston });
  await page.goto("/trips/e2e-boston");
  const notice = page.getByTestId("journey-gap");
  await expect(notice).toContainText("No flight back to London found");
  await expect(notice.getByRole("link", { name: "Find it in Gmail" })).toHaveAttribute("href", "https://mail.google.com/mail/u/0/#search/AB12CD");
  await notice.getByRole("button", { name: "Add it yourself" }).click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await notice.getByRole("button", { name: "This trip is one way" }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(async () => (await readUser(uid))?.oneWayTrips).toEqual(["e2e-boston"]);
});

test("a trip that comes back says nothing is missing", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedTrip(uid, "e2e-boston", {}, { title: "Boston", start: "2026-12-12", end: "2026-12-14" });
  await seedFlight("e2e-boston", { id: "out", start: "2026-12-12T17:20:00+00:00", end: "2026-12-12T20:15:00-05:00", origin: heathrow, destination: boston });
  await seedFlight("e2e-boston", { id: "back", start: "2026-12-14T19:00:00-05:00", end: "2026-12-15T07:00:00+00:00", origin: boston, destination: heathrow });
  await page.goto("/trips/e2e-boston");
  await expect(page.getByTestId("trip-dates")).toBeVisible();
  await expect(page.getByTestId("journey-gap")).toHaveCount(0);
});
