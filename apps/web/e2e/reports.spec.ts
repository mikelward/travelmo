import { expect, test } from "@playwright/test";
import { contrastRatio, owner, signIn } from "./helpers";
import { clearData, seedLisbonTrip, seedTrip, updateUser } from "./seed";

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

test("in dark mode, the year dropdown is drawn dark with readable text", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page, owner);
  await page.goto("/reports");
  const select = page.getByRole("combobox", { name: "Year" });
  await expect(select).toBeVisible();

  const style = await select.evaluate((el) => {
    const s = getComputedStyle(el);
    return { colorScheme: s.colorScheme, color: s.color, background: s.backgroundColor };
  });
  // Without a dark color scheme the option popup is drawn light under light text.
  expect(style.colorScheme).toContain("dark");
  expect(contrastRatio(style.color, style.background)).toBeGreaterThanOrEqual(4.5);
});

test("residence and visa days count time away and in the Schengen area, from home and the trips", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedLisbonTrip(ownerUid, "e2e-lisbon");
  await updateUser(ownerUid, { homes: [{ city: "London", country: "GB", from: "2020-01-01" }] });
  await page.goto("/reports");

  const section = page.getByRole("region", { name: "Residence and visa days" });
  await expect(section.getByRole("combobox", { name: "Rules" })).toHaveValue("uk-settlement");
  const rule = section.getByTestId("residence-rule");
  // The days of leaving and coming back are not absences.
  await expect(rule.getByText("3 of 180 days · 177 days left")).toBeVisible();
  await expect(rule.getByText("Within the limit")).toBeVisible();
  await rule.getByText("Time away (1)").click();
  await expect(rule.getByRole("list", { name: "Time away" }).getByRole("listitem")).toHaveText(["11–13 Jun 2025 · 3 days · Portugal · Lisbon"]);
  await expect(section.getByText("It isn't legal advice.", { exact: false })).toBeVisible();

  await section.getByRole("combobox", { name: "Rules" }).selectOption("schengen");
  await section.getByLabel("On").fill("2025-06-30");
  // Entering and leaving both count as days in the area.
  await expect(rule.getByText("5 of 90 days · 85 days left")).toBeVisible();
  await expect(section.getByText("home has no country yet", { exact: false })).toHaveCount(0);
});

test("residence and visa days ask for home's country when nothing gives one", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedLisbonTrip(ownerUid, "e2e-lisbon");
  await page.goto("/reports");
  const section = page.getByRole("region", { name: "Residence and visa days" });
  await expect(section.getByText("Days with no trip count as at home, but home has no country yet.")).toBeVisible();
  await expect(section.getByRole("link", { name: "Add one on your Profile" })).toHaveAttribute("href", "/profile");
});
