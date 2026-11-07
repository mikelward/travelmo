import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readSegments, seedFlight, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("editing an imported booking keeps its offsets although its airports have zones", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-edit");
  await seedFlight("e2e-edit");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByText("XX 100 MAN to DXB", { exact: true })).toBeVisible();

  // Make sure the airport table is loaded in this page before the edit form
  // opens: a code typed into a new booking's form changes its zone.
  await page.getByRole("button", { name: "Add a booking" }).click();
  await page.getByPlaceholder("LHR", { exact: true }).fill("MAN");
  await expect(page.getByTitle("Time zone").first()).toHaveValue("Europe/London");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  const zone = page.getByTitle("Time zone");
  await expect(zone.first()).toHaveValue("offset:+05:00");
  await expect(zone.nth(1)).toHaveValue("offset:+04:00");
  // The stored instants survive an edit that touches neither code nor zone.
  await page.getByRole("textbox", { name: "Notes" }).fill("Seat 14A");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Seat 14A", { exact: false })).toBeVisible();
  await expect(zone).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  await expect(zone.first()).toHaveValue("offset:+05:00");
  await expect(zone.nth(1)).toHaveValue("offset:+04:00");
});

test("a place's country can be chosen, but is never asked for, and a flight shows none", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-country");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();

  // An imported stay shows the country it came with.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("combobox", { name: "Country" })).toHaveValue("GB");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Add a booking" }).click();
  // A flight's airport codes say where it is.
  await expect(page.getByRole("combobox", { name: /country/i })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Type" }).selectOption("activity");
  await page.getByPlaceholder("BA 117 LHR to JFK").fill("Example walking tour");
  await page.locator('input[type="date"]').first().fill("2026-12-13");
  // Saved without a country: nothing insists on one.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Example walking tour", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  const country = page.getByRole("combobox", { name: "Country" });
  await expect(country).toHaveValue("");
  // A country with no place name is kept, the place named by the country.
  await country.selectOption({ label: "Ireland" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  await expect(page.getByRole("combobox", { name: "Country" })).toHaveValue("IE");
  await expect(page.getByRole("combobox", { name: "Where" })).toHaveValue("Ireland");
});

test("typing the start of an address offers places, and picking one fills city, country and address", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-address");
  // Invented places; Google is stubbed.
  const asked: unknown[] = [];
  await page.route("https://places.googleapis.com/v1/places:autocomplete", async (route) => {
    asked.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    await route.fulfill({
      json: {
        suggestions: [
          { placePrediction: { placeId: "p1", text: { text: "10 Example Street, Exampleville" }, structuredFormat: { mainText: { text: "10 Example Street" }, secondaryText: { text: "Exampleville, UK" } } } },
          { placePrediction: { placeId: "p2", text: { text: "10 Example Square, Sampleton" }, structuredFormat: { mainText: { text: "10 Example Square" }, secondaryText: { text: "Sampleton, UK" } } } },
        ],
      },
    });
  });
  const detailed: string[] = [];
  await page.route(/https:\/\/places\.googleapis\.com\/v1\/places\/.+/, async (route) => {
    detailed.push(route.request().url());
    await route.fulfill({
      json: {
        formattedAddress: "10 Example Street, Exampleville EX1 2MP, UK",
        addressComponents: [
          { longText: "Exampleville", shortText: "Exampleville", types: ["postal_town"] },
          { longText: "United Kingdom", shortText: "GB", types: ["country", "political"] },
        ],
        location: { latitude: 53.41, longitude: -2.98 },
      },
    });
  });
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await page.getByRole("button", { name: "Add a booking" }).click();
  await page.getByRole("combobox", { name: "Type" }).selectOption("lodging");
  await page.getByPlaceholder("BA 117 LHR to JFK").fill("Example stay");
  await page.locator('input[type="date"]').first().fill("2026-12-13");
  const where = page.getByRole("combobox", { name: "Where" });
  await where.fill("10 Exa");
  await expect(page.getByRole("option", { name: /10 Example Square/ })).toBeVisible();
  await page.getByRole("option", { name: /10 Example Street/ }).click();
  await expect(where).toHaveValue("10 Example Street");
  await expect(page.getByRole("combobox", { name: "Country" })).toHaveValue("GB");
  // Every request of the lookup carried the key and one session token.
  const first = asked[0] as { headers: Record<string, string>; body: { sessionToken: string } };
  expect(first.headers["x-goog-api-key"]).toBe("fake-maps-key");
  expect(detailed).toEqual([`https://places.googleapis.com/v1/places/p1?sessionToken=${first.body.sessionToken}`]);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("10 Example Street, Exampleville EX1 2MP, UK")).toBeVisible();
  // The pick's spot is stored with the place, for the map.
  const stored = (await readSegments("e2e-address")).find((s) => s.title === "Example stay");
  expect(stored?.destination).toMatchObject({ name: "10 Example Street", city: "Exampleville", country: "GB", lat: 53.41, lon: -2.98 });
  // Keyboard: arrow to the second suggestion and pick it with Enter.
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  const edit = page.getByRole("combobox", { name: "Where" });
  await edit.fill("10 Exa");
  await expect(page.getByRole("option", { name: /10 Example Square/ })).toBeVisible();
  await edit.press("ArrowDown");
  await edit.press("ArrowDown");
  await edit.press("Enter");
  await expect(edit).toHaveValue("10 Example Square");
});

test("a slow lookup never overwrites what was typed after it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-address-race");
  // Invented places; Google is stubbed, and each answer waits for the test
  // to release it, so the order of events is the test's, not the clock's.
  const prediction = (id: string, name: string) => ({
    placePrediction: { placeId: id, text: { text: `${name}, Exampleville` }, structuredFormat: { mainText: { text: name }, secondaryText: { text: "Exampleville, UK" } } },
  });
  const gates: (() => void)[] = [];
  const held = () => new Promise<void>((release) => gates.push(release));
  let hold = false;
  await page.route("https://places.googleapis.com/v1/places:autocomplete", async (route) => {
    const input = (route.request().postDataJSON() as { input: string }).input;
    if (hold) await held();
    const json = input.startsWith("Sample")
      ? { suggestions: [prediction("p2", "Sample Place")] }
      : { suggestions: [prediction("p1", "10 Example Street")] };
    await route.fulfill({ json }).catch(() => undefined);
  });
  await page.route(/https:\/\/places\.googleapis\.com\/v1\/places\/.+/, async (route) => {
    await held();
    await route
      .fulfill({
        json: {
          formattedAddress: "10 Example Street, Exampleville EX1 2MP, UK",
          addressComponents: [{ longText: "United Kingdom", shortText: "GB", types: ["country", "political"] }],
        },
      })
      .catch(() => undefined);
  });
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await page.getByRole("button", { name: "Add a booking" }).click();
  await page.getByRole("combobox", { name: "Type" }).selectOption("lodging");
  await page.getByPlaceholder("BA 117 LHR to JFK").fill("Example stay");
  await page.locator('input[type="date"]').first().fill("2026-12-13");
  const where = page.getByRole("combobox", { name: "Where" });
  const add = page.getByRole("button", { name: "Add", exact: true });

  // Picked, then typed over before the details arrive: the typing wins, the
  // form cannot be submitted while the details are on their way, and typing
  // over the pick ends that wait at once rather than when Google answers.
  await where.fill("10 Exa");
  const detailsRequest = page.waitForRequest(/\/v1\/places\/p1/);
  await page.getByRole("option", { name: /10 Example Street/ }).click();
  await detailsRequest;
  await expect(where).toHaveValue("10 Example Street");
  await expect(add).toBeDisabled();
  await where.fill("Somewhere else");
  await expect(add).toBeEnabled();
  gates.shift()!();
  await expect(where).toHaveValue("Somewhere else");
  await expect(page.getByRole("combobox", { name: "Country" })).toHaveValue("");

  // Picked, then the field itself replaced (a type change swaps Where for
  // From and To) and the new field typed into: the old answer lands nowhere.
  await where.fill("10 Exa");
  const swappedDetails = page.waitForRequest(/\/v1\/places\/p1/);
  await page.getByRole("option", { name: /10 Example Street/ }).click();
  await swappedDetails;
  await page.getByRole("combobox", { name: "Type" }).selectOption("train");
  const to = page.getByRole("combobox", { name: "To", exact: true });
  await to.fill("Sampleton station");
  gates.shift()!();
  await expect(add).toBeEnabled();
  await expect(to).toHaveValue("Sampleton station");
  await expect(page.getByRole("combobox", { name: "To country" })).toHaveValue("");
  await page.getByRole("combobox", { name: "Type" }).selectOption("lodging");
  await expect(where).toHaveValue("Sampleton station");

  // Cleared while a lookup is in flight: its late answer must not reopen the
  // list, and the next lookup shows only its own answer.
  hold = true;
  const staleRequest = page.waitForRequest((r) => r.url().endsWith("places:autocomplete") && (r.postDataJSON() as { input: string }).input === "10 Exa");
  await where.fill("10 Exa");
  await staleRequest;
  await where.fill("");
  gates.shift()!();
  hold = false;
  await where.fill("Sample");
  await expect(page.getByRole("option", { name: /Sample Place/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /10 Example Street/ })).toHaveCount(0);
  // Long after the stale details could have landed, the typed text still stands.
  await expect(where).toHaveValue("Sample");

  // Typing on closes the list at once: the old answer is not offered for the
  // new text while its own answer is still on its way.
  hold = true;
  const nextRequest = page.waitForRequest((r) => r.url().endsWith("places:autocomplete") && (r.postDataJSON() as { input: string }).input === "Sample Pl");
  await where.fill("Sample Pl");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await nextRequest;
  await expect(page.getByRole("listbox")).toHaveCount(0);
  gates.shift()!();
  await expect(page.getByRole("option", { name: /Sample Place/ })).toBeVisible();
});
