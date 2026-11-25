import { expect, test } from "@playwright/test";
import { contrastRatio, owner, signIn } from "./helpers";
import { clearData, seedLisbonTrip, seedTrip, updateUser } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("reports count days in each country, trips per year, and mark the map", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedLisbonTrip(ownerUid, "e2e-lisbon");
  await updateUser(ownerUid, { homes: [{ city: "London", country: "GB", from: "2020-01-01" }] });
  // Still ahead on the frozen date, so not counted.
  await seedTrip(ownerUid, "e2e-liverpool");

  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(page.getByTestId("summary")).toHaveText("1 trip · 5 days away · 2 countries");

  const countries = page.getByRole("table", { name: "Days in each country" });
  // From the first trip to the frozen date, home included; the days of
  // leaving and coming back count for both countries.
  await expect(countries.getByRole("row")).toHaveText(["CountryDays", "United Kingdom507", "Portugal5"]);
  // A country opens to its stays, each with the trip that took the user there.
  await countries.getByRole("button", { name: "Portugal" }).click();
  const inPortugal = page.getByRole("list", { name: "Stays in Portugal" });
  await expect(inPortugal.getByRole("listitem")).toHaveText(["10–14 Jun 2025 · 5 days · Lisbon"]);
  await countries.getByRole("button", { name: "United Kingdom" }).click();
  await expect(page.getByRole("list", { name: "Stays in United Kingdom" }).getByRole("listitem")).toHaveText([
    "14 Jun 2025 – 1 Nov 2026 · 506 days · Home",
    "10 Jun 2025 · 1 day · Home",
  ]);
  await countries.getByRole("button", { name: "Portugal" }).click();
  await page.getByRole("list", { name: "Stays in Portugal" }).getByRole("link", { name: "Lisbon" }).click();
  await expect(page).toHaveURL(/\/trips\/e2e-lisbon$/);
  await page.goBack();
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
  await expect(rule.getByText("Counted over 2 Nov 2021 – 1 Nov 2026")).toBeVisible();
  await expect(rule.getByText("Worst 12 months: 11 Jun 2025 – 10 Jun 2026 · Last 12 months: 0 days")).toBeVisible();
  await rule.getByText("Time away (1)").click();
  await expect(rule.getByRole("list", { name: "Time away" }).getByRole("listitem")).toHaveText(["11–13 Jun 2025 · 3 days · Portugal · Lisbon"]);
  await expect(section.getByText("It isn't legal advice.", { exact: false })).toBeVisible();

  await section.getByRole("combobox", { name: "Rules" }).selectOption("schengen");
  await section.getByLabel("On").fill("2025-06-30");
  // Entering and leaving both count as days in the area.
  await expect(rule.getByText("5 of 90 days · 85 days left")).toBeVisible();
  await expect(section.getByText("home has no country yet", { exact: false })).toHaveCount(0);
});

test("UK settlement counts from the move to the UK and lists the days it can't place", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await updateUser(ownerUid, { homes: [{ city: "London", country: "GB", from: "2024-03-03" }] });
  // A stay whose booking says nowhere a country can be found.
  await seedTrip(
    ownerUid,
    "e2e-mystery",
    { start: "2026-04-01T15:00:00+00:00", end: "2026-04-03T11:00:00+00:00", destination: { name: "Somewhere" } },
    { title: "Mystery", start: "2026-04-01", end: "2026-04-03" },
  );
  await page.goto("/reports");

  const rule = page.getByRole("region", { name: "Residence and visa days" }).getByTestId("residence-rule");
  await expect(rule.getByText("Since you moved to the UK on 3 Mar 2024")).toBeVisible();
  await expect(rule.getByText("Includes 3 days we can’t place in a country, counted as away to be safe.")).toBeVisible();
  await rule.getByText("Days we can't place (1)").click();
  const unplaced = rule.getByRole("list", { name: "Days we can't place" });
  await expect(unplaced.getByRole("listitem")).toHaveText([/Give these trips’ bookings a place/, "1–3 Apr 2026 · 3 days · Mystery"]);
  // Days in each country leaves them out until they have one.
  const countries = page.getByTestId("unplaced");
  await expect(countries).toContainText("3 days we can’t place aren’t counted.");
  await expect(countries.getByRole("listitem")).toHaveText(["1–3 Apr 2026 · 3 days · Mystery"]);
  await unplaced.getByRole("link", { name: "Mystery" }).click();
  await expect(page).toHaveURL(/\/trips\/e2e-mystery$/);
});

test("residence and visa days ask for home's country when nothing gives one", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedLisbonTrip(ownerUid, "e2e-lisbon");
  await page.goto("/reports");
  const section = page.getByRole("region", { name: "Residence and visa days" });
  await expect(section.getByText("Days with no trip count as at home, but home has no country yet.")).toBeVisible();
  await expect(section.getByRole("link", { name: "Add one on your Profile" })).toHaveAttribute("href", "/profile");
});

test("downloads a summary of trips as CSV, by trip or by place, optionally abroad only", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedLisbonTrip(ownerUid, "e2e-lisbon");
  // Still ahead on the frozen date: left out until a later day is chosen.
  await seedTrip(ownerUid, "e2e-liverpool");
  await updateUser(ownerUid, { homes: [{ city: "London", country: "GB", from: "2020-01-01" }] });
  await page.goto("/reports");
  const section = page.getByRole("region", { name: "Download trips" });

  const read = async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("button", { name: "Download CSV" }).click()]);
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk.toString();
    return { name: download.suggestedFilename(), lines: text.trim().split("\r\n") };
  };

  const byTrip = await read();
  expect(byTrip.name).toBe("travelmo-trips.csv");
  expect(byTrip.lines[0]).toBe("Trip,Start,End,Cities,Countries");
  expect(byTrip.lines.slice(1).join("\n")).toContain("Lisbon");
  expect(byTrip.lines.slice(1).join("\n")).toContain("Portugal");
  expect(byTrip.lines).toHaveLength(2);

  await section.getByLabel("Trips starting up to").fill("2030-12-31");
  expect((await read()).lines).toHaveLength(3);

  await section.getByLabel("One row per place").check();
  await section.getByLabel("Outside my home country only").check();
  const byPlace = await read();
  expect(byPlace.name).toBe("travelmo-places.csv");
  expect(byPlace.lines[0]).toBe("City,Country,Start,End,Trip");
  expect(byPlace.lines.slice(1).every((line) => line.includes("Portugal"))).toBe(true);
  expect(byPlace.lines.length).toBeGreaterThan(1);
});
