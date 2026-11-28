import { expect, test } from "@playwright/test";
import { openSettingsSection, owner, signIn } from "./helpers";
import { clearData, readUser, seedFlight, seedTrip, updateUser } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

const heathrow = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
const boston = { name: "Boston Logan", code: "BOS", city: "Boston", country: "US" };

// A week in Boston from London: flights there and back, nothing booked on the ground.
async function seedBoston(uid: string) {
  await seedTrip(uid, "e2e-boston", {}, { title: "Boston", start: "2026-12-12", end: "2026-12-14" });
  await seedFlight("e2e-boston", { id: "out", title: "VS 11 LHR to BOS", start: "2026-12-12T17:20:00+00:00", end: "2026-12-12T20:15:00-05:00", origin: heathrow, destination: boston });
  await seedFlight("e2e-boston", { id: "back", title: "VS 12 BOS to LHR", start: "2026-12-14T19:00:00-05:00", end: "2026-12-15T07:00:00+00:00", origin: boston, destination: heathrow });
}

const seedHidden = (uid: string, hiddenRideNeeds: string[]) => updateUser(uid, { hiddenRideNeeds });

test("a flight with no car booked suggests rental companies, until hidden", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedBoston(uid);
  await page.getByRole("link", { name: /^Boston/ }).click();
  const card = page.getByTestId("ride-suggestion");
  // Only the car: rides at home wait for a company near home.
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Need a car in Boston?");
  await expect(card.getByRole("link", { name: "Avis" })).toHaveAttribute("href", "https://www.avis.com/");
  await expect(card.getByRole("link", { name: "Enterprise" })).toBeVisible();

  // Hidden alongside one another tab hid since this page last heard.
  await seedHidden(uid, ["elsewhere/car"]);
  await card.getByRole("button", { name: "Hide" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await readUser(uid))?.hiddenRideNeeds).toEqual(["elsewhere/car", "out/car"]);
});

test("a company added in Settings is offered for rides to and from the airport at home", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedBoston(uid);
  await page.goto("/settings");
  await openSettingsSection(page, "Reminders & rides");
  await page.getByRole("textbox", { name: "Company name" }).fill("Example Cars");
  await page.getByRole("textbox", { name: "Booking page" }).fill("http://cars.example.com/book");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Use a link that starts with https://.")).toBeVisible();
  await page.getByRole("textbox", { name: "Booking page" }).fill("https://cars.example.com/book");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const mine = page.getByRole("list", { name: "Your companies" });
  await expect(mine.getByRole("link", { name: "Example Cars" })).toBeVisible();
  await expect(mine).toContainText("Rides to and from home");

  await page.goto("/trips/e2e-boston");
  const cards = page.getByTestId("ride-suggestion");
  await expect(cards).toHaveText([
    /Need a ride to London Heathrow\?.*Example Cars/,
    /Need a car in Boston\?/,
    /Need a ride home from London Heathrow\?.*Example Cars/,
  ]);
  await expect(cards.first().getByRole("link", { name: "Example Cars" })).toHaveAttribute("href", "https://cars.example.com/book");
  // A ride company near home is not offered for a car away.
  await expect(cards.nth(1).getByRole("link", { name: "Example Cars" })).toHaveCount(0);

  // Removing keeps a company another tab added in the meantime.
  await page.goto("/settings");
  await openSettingsSection(page, "Reminders & rides");
  const other = { name: "Example Rentals", url: "https://rentals.example.com/", near: "anywhere" as const };
  await updateUser(uid, { rideCompanies: [{ name: "Example Cars", url: "https://cars.example.com/book", near: "home" }, other] });
  await expect(mine.getByRole("link")).toHaveCount(2);
  await mine.getByRole("listitem").filter({ hasText: "Example Cars" }).getByRole("button", { name: "Remove" }).click();
  await expect.poll(async () => (await readUser(uid))?.rideCompanies).toEqual([other]);
});

test("a company limited to some countries is offered only there", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedBoston(uid);
  await page.goto("/settings");
  await openSettingsSection(page, "Reminders & rides");
  await page.getByRole("textbox", { name: "Company name" }).fill("Cretan Cars");
  await page.getByRole("textbox", { name: "Booking page" }).fill("https://cretan.example/");
  await page.getByRole("combobox", { name: "Suggest for" }).selectOption("anywhere");
  await page.getByRole("textbox", { name: "Countries" }).fill("Greece, Narnia");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Narnia isn't a country.")).toBeVisible();
  await page.getByRole("textbox", { name: "Countries" }).fill("Greece");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const mine = page.getByRole("list", { name: "Your companies" });
  await expect(mine).toContainText("Cars wherever I land · Greece");
  await expect.poll(async () => (await readUser(uid))?.rideCompanies).toEqual([
    { name: "Cretan Cars", url: "https://cretan.example/", near: "anywhere", countries: ["GR"] },
  ]);

  // Not offered for a car in Boston; offered once it also covers the US.
  await page.goto("/trips/e2e-boston");
  const car = page.getByTestId("ride-suggestion").filter({ hasText: "Need a car in Boston?" });
  await expect(car.getByRole("link", { name: "Avis" })).toBeVisible();
  await expect(car.getByRole("link", { name: "Cretan Cars" })).toHaveCount(0);
  await updateUser(uid, { rideCompanies: [{ name: "Cretan Cars", url: "https://cretan.example/", near: "anywhere", countries: ["GR", "US"] }] });
  await expect(car.getByRole("link", { name: "Cretan Cars" })).toBeVisible();
});
