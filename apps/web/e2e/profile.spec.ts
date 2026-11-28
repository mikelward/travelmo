import { expect, test } from "@playwright/test";
import { openBooking, openSettingsSection, owner, partner, signIn, signOut } from "./helpers";
import { clearData, readPerson, readTravelProfile, readUser, seedFlight, seedPerson, seedTravelProfile, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("the owner adds a document and loyalty program manually without a TripIt import", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await page.goto("/wallet");

  await expect(page.getByText("No documents yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Google Wallet" })).toHaveAttribute("href", "https://wallet.google.com");

  await page.getByRole("button", { name: "Add document", exact: true }).click();
  await page.getByLabel("Nationality / Country").fill("United States");
  await page.getByLabel("Number").fill("P99887766");
  await page.getByLabel("Expiry date").fill("2032-06-15");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("United States Passport")).toBeVisible();
  await expect(page.getByText("P99887766")).toBeHidden();
  await page.getByText("United States Passport").click();
  await expect(page.getByText("P99887766")).toBeVisible();

  await page.getByRole("button", { name: "Add loyalty program", exact: true }).click();
  await page.getByLabel("Program", { exact: true }).fill("Qatar Airways Privilege Club");
  await page.getByLabel("Account number").fill("820342520");
  await page.getByLabel("Status / tier").fill("Gold");
  await page.getByRole("button", { name: "Save" }).click();

  const loyaltyList = page.getByRole("list", { name: "Loyalty programs" });
  await expect(loyaltyList).toContainText("Qatar Airways Privilege Club");
  await expect(loyaltyList).toContainText("820342520");
  await expect(loyaltyList).toContainText("Gold");
  await expect.poll(async () => (await readTravelProfile(ownerUid))?.documents.length).toBe(1);
  await expect.poll(async () => (await readTravelProfile(ownerUid))?.loyalty.length).toBe(1);
});

// Invented details in the shape an import leaves them.
test("the owner sees their wallet, shares it in Settings, and the partner can read it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTravelProfile(ownerUid, {
    ownerEmail: owner,
    trustedEmails: [],
    documents: [{ title: "Travel document: Passport", fields: [{ label: "Number", value: "X1234567" }] }],
    loyalty: [
      {
        title: "Example Air Miles",
        fields: [
          { label: "Account number", value: "EA123" },
          { label: "Balance", value: "12000" },
          { label: "Elite status", value: "Gold" },
        ],
      },
    ],
    travelers: [{ title: "Ann Example", fields: [{ label: "Meal preference", value: "Vegetarian" }] }],
  });
  await page.goto("/wallet");

  // Documents stay folded until asked for.
  await expect(page.getByText("X1234567")).toBeHidden();
  await page.getByText("Travel document: Passport").click();
  await expect(page.getByText("X1234567")).toBeVisible();

  // Loyalty programs unify summary and full details on the same Wallet screen.
  const list = page.getByRole("list", { name: "Loyalty programs" });
  await expect(list).toContainText("Example Air Miles");
  await expect(list).toContainText("EA123");
  await expect(list).toContainText("12,000");
  await expect(list).toContainText("Gold");
  await expect(page.getByText("Elite status")).toBeHidden();
  await list.getByText("Example Air Miles").click();
  await expect(page.getByText("Elite status")).toBeVisible();

  // Wallet sharing lives in Settings.
  await page.goto("/settings");
  await openSettingsSection(page, "Wallet sharing");
  await page.getByRole("button", { name: "Share with someone" }).click();
  await page.getByLabel("Email address to share with").fill(partner.toUpperCase());
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(partner, { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, partner);
  await page.goto("/wallet");
  await page.getByRole("group", { name: "Wallet person" }).getByRole("button", { name: new RegExp(owner) }).click();
  await expect(page.getByText(`Shared by ${owner}`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Loyalty programs" })).toContainText("EA123");
  await page.getByText("Travel document: Passport").click();
  await expect(page.getByText("X1234567")).toBeVisible();
  // The partner reads it but has nothing to change it with.
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("someone not trusted sees no shared wallet", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTravelProfile(ownerUid, { ownerEmail: owner, trustedEmails: [], documents: [{ title: "Passport", fields: [{ label: "Number", value: "X1234567" }] }], loyalty: [], travelers: [] });
  await signOut(page);
  await signIn(page, partner);
  await page.goto("/wallet");
  await expect(page.getByText("No documents yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("group", { name: "Wallet person" })).toHaveCount(0);
});

test("a booking shows the viewer's program its provider belongs to, with the number and status", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-loyalty", { provider: "Example Air" });
  await seedTravelProfile(ownerUid, {
    ownerEmail: owner,
    trustedEmails: [],
    documents: [],
    loyalty: [
      { title: "Example Air Miles", fields: [{ label: "Account number", value: "EA123" }, { label: "Elite status", value: "Gold" }] },
      { title: "Sample Hotels Honors", fields: [{ label: "Account number", value: "SH-9" }] },
    ],
    travelers: [],
  });
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect((await openBooking(page, "Cove Liverpool")).getByTestId("segment-loyalty")).toHaveText("Example Air Miles · EA123 · Gold");
});

test("loyalty numbers found in booking emails join the list and the booking line, and the owner can remove them", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-loyalty", { provider: "Cove Hotels" });
  const found = { program: "Cove Club", number: "CC 4455", status: "Member", messageId: "m1", label: "Your stay at Cove", at: "2026-11-01T00:00:00Z" };
  const air = { program: "Example Air Club", number: "EA 999", messageId: "m2", label: "Your flight", at: "2026-11-02T00:00:00Z" };
  await seedTravelProfile(ownerUid, { ownerEmail: owner, trustedEmails: [], documents: [], loyalty: [], travelers: [], foundLoyalty: [found, air] });

  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect((await openBooking(page, "Cove Liverpool")).getByTestId("segment-loyalty")).toHaveText("Cove Club · CC 4455 · Member");

  await page.goto("/wallet");
  const list = page.getByRole("list", { name: "Loyalty programs" });
  await expect(list).toContainText("Cove Club");
  await expect(list).toContainText("CC 4455");
  await expect(list).toContainText("Example Air Club");
  await list.getByText("Cove Club").click();
  await expect(list).toContainText("Your stay at Cove");
  await list.getByText("Example Air Club").click();
  await page.getByRole("button", { name: "Remove Example Air Club" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect.poll(async () => (await readTravelProfile(ownerUid))?.foundLoyalty).toEqual([found]);
});

test("each loyalty number is shown under whose it is, in the wallet switcher and on a booking", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-loyalty", { provider: "Example Air" });
  const theirs = { program: "Example Air Club", number: "EA 999", person: "Alex Sample", messageId: "m1", label: "Your flight", at: "2026-11-01T00:00:00Z" };
  const mine = { program: "Example Air Club", number: "EA 123", messageId: "m2", label: "Your flight", at: "2026-11-02T00:00:00Z" };
  await seedTravelProfile(ownerUid, { ownerEmail: owner, trustedEmails: [], documents: [], loyalty: [], travelers: [], foundLoyalty: [theirs, mine] });

  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect((await openBooking(page, "Cove Liverpool")).getByTestId("segment-loyalty").getByRole("listitem")).toHaveText(["Example Air Club · EA 123", "Example Air Club · EA 999 · Alex Sample"]);

  await page.goto("/wallet");
  const switcher = page.getByRole("group", { name: "Wallet person" });
  await expect(page.getByRole("list", { name: "Loyalty programs" })).toContainText("EA 123");
  await switcher.getByRole("button", { name: "Alex Sample" }).click();
  await expect(page.getByRole("list", { name: "Loyalty programs" })).toContainText("EA 999");

  // Mine was someone else's all along.
  await switcher.getByRole("button", { name: "You" }).click();
  await page.getByRole("list", { name: "Loyalty programs" }).locator("summary", { hasText: "EA 123" }).click();
  await page.getByRole("button", { name: "Whose is Example Air Club EA 123?" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Alex Sample" }).click();
  await switcher.getByRole("button", { name: "Alex Sample" }).click();
  await expect(page.getByRole("list", { name: "Loyalty programs" })).toContainText("EA 123");
  await expect.poll(async () => (await readTravelProfile(ownerUid))?.loyaltyPeople).toEqual([{ program: "Example Air Club", number: "EA 123", person: "Alex Sample" }]);

  // And this one is someone new's.
  await page.getByRole("list", { name: "Loyalty programs" }).locator("summary", { hasText: "EA 999" }).click();
  await page.getByRole("button", { name: "Whose is Example Air Club EA 999?" }).click();
  await page.getByLabel("Someone else's name").fill("Sam Sample");
  await page.getByRole("button", { name: "Save" }).click();
  await switcher.getByRole("button", { name: "Sam Sample" }).click();
  await expect(page.getByRole("list", { name: "Loyalty programs" })).toContainText("EA 999");
});

test("a loyalty holder's name that is the owner's, however written, is theirs, and Same person as… says so", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedPerson(ownerUid, { id: "me", name: "Sam Example", aliases: ["Sam Lee Example"], bookings: 4, direct: 4 });
  const found = (number: string, person: string) => ({ program: "Example Air Club", number, person, messageId: `m${number}`, label: "Your flight", at: "2026-11-01T00:00:00Z" });
  await seedTravelProfile(ownerUid, { ownerEmail: owner, trustedEmails: [], documents: [], loyalty: [], travelers: [], foundLoyalty: [found("EA 1", "Samlee Example"), found("EA 2", "Samuel Example")] });
  await page.goto("/wallet");
  // A first and middle name run together is the owner's.
  await expect(page.getByRole("list", { name: "Loyalty programs" })).toContainText("EA 1");
  // A misspelling is someone else until the owner says otherwise.
  await page.getByRole("group", { name: "Wallet person" }).getByRole("button", { name: "Samuel Example" }).click();
  await expect(page.getByRole("list", { name: "Loyalty programs" })).toContainText("EA 2");
  await page.getByRole("button", { name: "Same person as…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Sam Example/ }).click();
  await expect.poll(async () => (await readPerson(ownerUid, "me"))?.aliases).toEqual(["Sam Lee Example", "Samuel Example"]);
  await expect(page.getByRole("list", { name: "Loyalty programs" })).toContainText("EA 2");
});

test("home is set by city and a country written as a name, saved as its code", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTravelProfile(ownerUid, { ownerEmail: owner, trustedEmails: [], documents: [], loyalty: [], travelers: [] });
  await page.goto("/settings");
  await openSettingsSection(page, "Home");
  await page.getByRole("button", { name: "Add home" }).click();
  await page.getByLabel("City").fill("London");
  await page.getByLabel("Country").fill("United Kingdom");
  await page.locator('input[type="date"]').fill("2022-01-15");
  await page.getByRole("button", { name: "Set" }).click();
  await expect(page.getByText("London, GB from 15 Jan 2022")).toBeVisible();
});

// A journey back into one of home's airports ends a trip (SPEC "Home").
test("home's airports are worked out from the trips that leave from them, and can be chosen", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  const man = { name: "Manchester", code: "MAN", country: "GB" };
  const dxb = { name: "Dubai", code: "DXB", country: "AE" };
  for (const [id, out, back] of [
    ["e2e-dubai-1", "2026-03-01", "2026-03-08"],
    ["e2e-dubai-2", "2026-05-01", "2026-05-08"],
  ] as const) {
    await seedTrip(ownerUid, id, {}, { title: "Dubai", start: out, end: back });
    await seedFlight(id, { id: `${id}-out`, start: `${out}T09:00:00+00:00`, end: `${out}T19:00:00+04:00`, origin: man, destination: dxb });
    await seedFlight(id, { id: `${id}-back`, start: `${back}T09:00:00+04:00`, end: `${back}T14:00:00+00:00`, origin: dxb, destination: man });
  }
  await page.goto("/settings");
  await openSettingsSection(page, "Home");
  const airports = page.getByRole("list", { name: "Home airports" });
  await expect(airports).toContainText("Manchester airports: MAN");

  await airports.getByRole("button", { name: "Edit Manchester airports" }).click();
  await page.getByLabel("Manchester airports").fill("man, lpl");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(airports).toContainText("Manchester airports: MAN, LPL");
  await expect.poll(async () => (await readUser(ownerUid))?.homeAirports).toEqual([{ city: "Manchester", country: "GB", airports: ["MAN", "LPL"] }]);

  await airports.getByRole("button", { name: "Edit Manchester airports" }).click();
  await page.getByLabel("Manchester airports").fill("Manchester Airport");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText('"Manchester" isn\'t an airport or station code.')).toBeVisible();
});

// Four weeks or more in one town count as living there (SPEC "Home").
test("a month of stays is listed as home, and Not home turns it back into a trip", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  const flat = (start: string, end: string) => ({
    title: "Example Mews Flat",
    start: `${start}T15:00:00+00:00`,
    end: `${end}T11:00:00+00:00`,
    destination: { name: "Example Mews Flat", city: "London", country: "GB" },
  });
  await seedTrip(ownerUid, "e2e-winter-1", { id: "e2e-flat-1", ...flat("2022-02-13", "2022-02-27") }, { title: "London", start: "2022-02-13", end: "2022-02-27" });
  await seedTrip(ownerUid, "e2e-winter-2", { id: "e2e-flat-2", ...flat("2022-02-27", "2022-03-20") }, { title: "London", start: "2022-02-27", end: "2022-03-20" });
  let regrouped = 0;
  await page.route("http://localhost:8080/trips/regroup", async (route) => {
    regrouped += 1;
    await route.fulfill({ json: { changed: 1, deleted: 1 } });
  });
  await page.goto("/settings");
  await openSettingsSection(page, "Home");
  const stays = page.getByTestId("long-stays");
  await expect(stays).toContainText("London, 13 Feb – 20 Mar 2022 · from your stays");
  await stays.getByRole("button", { name: "Not home" }).click();
  await expect.poll(async () => (await readUser(ownerUid))?.notHome).toEqual([{ city: "London", country: "GB", from: "2022-02-13" }]);
  await expect(stays).toBeHidden();
  expect(regrouped).toBe(1);
});

test("Not home says so when the trips couldn't be regrouped", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  const flat = (start: string, end: string) => ({
    title: "Example Mews Flat",
    start: `${start}T15:00:00+00:00`,
    end: `${end}T11:00:00+00:00`,
    destination: { name: "Example Mews Flat", city: "London", country: "GB" },
  });
  await seedTrip(ownerUid, "e2e-winter-1", { id: "e2e-flat-1", ...flat("2022-02-13", "2022-02-27") }, { title: "London", start: "2022-02-13", end: "2022-02-27" });
  await seedTrip(ownerUid, "e2e-winter-2", { id: "e2e-flat-2", ...flat("2022-02-27", "2022-03-20") }, { title: "London", start: "2022-02-27", end: "2022-03-20" });
  await page.route("http://localhost:8080/trips/regroup", (route) => route.fulfill({ status: 500, json: { error: "unavailable" } }));
  await page.goto("/settings");
  await openSettingsSection(page, "Home");
  await page.getByTestId("long-stays").getByRole("button", { name: "Not home" }).click();
  await expect(page.getByText("Saved, but your trips weren't regrouped. Use Regroup trips in Settings.")).toBeVisible();
  await expect(page.getByTestId("long-stays")).toBeHidden();
});
