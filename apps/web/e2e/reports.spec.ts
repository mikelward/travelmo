import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedLisbonTrip, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("reports count days in each country, trips per year, and mark the map", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedLisbonTrip(ownerUid, "e2e-lisbon");
  // Still ahead on the frozen date, so not counted.
  await seedTrip(ownerUid, "e2e-liverpool");

  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(page.getByTestId("summary")).toHaveText("1 trip · 5 days away · 2 countries");

  const countries = page.getByRole("table", { name: "Days in each country" });
  await expect(countries.getByRole("row")).toHaveText(["CountryDaysTrips", "Portugal51", "United Kingdom21"]);
  const years = page.getByRole("table", { name: "Trips per year" });
  await expect(years.getByRole("row")).toHaveText(["YearTripsDaysCountries", "2025152"]);
  await expect(page.getByText("1 trip still ahead isn't counted.")).toBeVisible();

  const map = page.getByTestId("world-map");
  await expect(map.locator("[data-visited]")).toHaveCount(2);
  await expect(map.locator('[data-country="PT"]')).toHaveAttribute("data-visited", "true");
  await expect(map.locator('[data-country="GB"]')).toHaveAttribute("data-visited", "true");
  await expect(map.locator("[data-airport]")).toHaveCount(2);
  const guesthouse = map.locator('[data-place="Example Guesthouse"]');
  await expect(guesthouse).toHaveCount(1);
  await expect(guesthouse.locator("title")).toHaveText("Example Guesthouse, Lisbon, Portugal");

  await page.getByRole("combobox", { name: "Year" }).selectOption("2025");
  await expect(page.getByTestId("summary")).toHaveText("1 trip · 5 days away · 2 countries");
  await page.getByRole("button", { name: "2025" }).click();
  await expect(page.getByRole("combobox", { name: "Year" })).toHaveValue("2025");
});

test("with no trips, nothing is counted", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/reports");
  await expect(page.getByText("No trips yet.")).toBeVisible();
  await expect(page.getByTestId("summary")).toHaveText("0 trips · 0 days away · 0 countries");
  await expect(page.getByTestId("world-map").locator("[data-visited]")).toHaveCount(0);
});
