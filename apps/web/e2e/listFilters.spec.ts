import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, forgetTripFlags, readTrip, seedFlight, seedPerson, seedTrip } from "./seed";

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

  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("checkbox", { name: "Hide cancelled" }).check();
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("Called off")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Hide local events" }).check();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Liverpool");

  // A click elsewhere closes the menu; the choice stays.
  await page.getByRole("heading", { name: "Trips" }).click();
  await expect(page.getByRole("checkbox", { name: "Hide cancelled" })).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: "Filters" }).click();
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
  await page.getByRole("button", { name: "Filters" }).click();
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
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("checkbox", { name: "Hide cancelled" }).check();
  await expect(cards).toHaveCount(2);
  await forgetTripFlags("e2e-off");
  await expect(cards).toHaveCount(1);
  await expect(page.getByText("Called off")).toHaveCount(0);
  await expect.poll(async () => (await readTrip("e2e-off"))?.allCancelled).toBe(true);
});

test("search opens in place of the title, and closes with Back, Escape, or a click away when empty", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-away");
  const title = page.getByRole("heading", { name: "Trips" });
  const search = page.getByRole("searchbox", { name: "Search trips" });
  await page.getByRole("button", { name: "Search trips" }).click();
  await expect(search).toBeFocused();
  await expect(title).toHaveCount(0);

  // A click away leaves a search as it is, unfocused.
  await search.fill("liverpool");
  await page.locator("main").click({ position: { x: 1, y: 1 } });
  await expect(search).not.toBeFocused();
  await expect(search).toHaveValue("liverpool");

  // Back clears it.
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(title).toBeVisible();
  await page.getByRole("button", { name: "Search trips" }).click();
  await expect(search).toHaveValue("");

  // Escape, too; and an empty search closes once the focus leaves it.
  await search.press("Escape");
  await expect(title).toBeVisible();
  await page.getByRole("button", { name: "Search trips" }).click();
  await page.locator("main").click({ position: { x: 1, y: 1 } });
  await expect(title).toBeVisible();
});

test("Add a trip plans one by name and dates and opens it", async ({ page }) => {
  await signIn(page, owner);
  // With no trips yet, the empty list offers it too.
  await page.getByRole("button", { name: "add a trip", exact: true }).click();
  const form = page.getByRole("form", { name: "Add a trip" });
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form.getByText("Give the trip a name")).toBeVisible();
  await form.getByRole("textbox", { name: "Name" }).fill("Weekend away");
  await form.getByLabel("From").fill("2026-12-05");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Weekend away" })).toBeVisible();
  await expect(page.getByTestId("trip-dates")).toHaveText(/5 Dec 2026/);
  await expect(page.getByText("No bookings in this trip yet.")).toBeVisible();
});

test("the first trip added keeps its form, filled in and busy, until its write is confirmed", async ({ page }) => {
  await signIn(page, owner);
  // Writes wait, as on a slow connection: the trip shows from the cache first.
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/google\.firestore\.v1\.Firestore\/Write/, async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "add a trip", exact: true }).click();
  const form = page.getByRole("form", { name: "Add a trip" });
  await form.getByRole("textbox", { name: "Name" }).fill("Weekend away");
  await form.getByLabel("From").fill("2026-12-05");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("trip-card")).toHaveCount(1);
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Weekend away");
  await expect(form.getByRole("button", { name: "Adding…" })).toBeDisabled();
  // Nor can it be left while the trip is being saved.
  await expect(form.getByRole("button", { name: "Cancel" })).toBeDisabled();
  release!();
  await expect(page.getByRole("heading", { name: "Weekend away" })).toBeVisible();
});

test("a trip none of whose travelers is the user says Watching, and the filter hides it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  // The user, named on mail sent straight to them, and their mum.
  await seedPerson(ownerUid, { id: "me", name: "Sam Example", bookings: 4, direct: 4 });
  await seedPerson(ownerUid, { id: "mum", name: "Pat Example", bookings: 1, direct: 0 });
  await seedTrip(ownerUid, "e2e-mine", { travelers: ["Sam Example", "Pat Example"] }, { title: "Our trip" });
  await seedTrip(ownerUid, "e2e-mum", { travelers: ["Pat Example"] }, { title: "Mum's trip" });
  const cards = page.getByTestId("trip-card");
  await expect(cards.filter({ hasText: "Mum's trip" })).toContainText("Watching");
  await expect(cards.filter({ hasText: "Our trip" })).not.toContainText("Watching");
  // Whom each trip's bookings are for is recorded on it, once read.
  await expect.poll(async () => (await readTrip("e2e-mum"))?.travelers).toEqual(["Pat Example"]);

  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("checkbox", { name: "Hide trips I'm not on" }).check();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Our trip");

  await page.goto("/trips/e2e-mum");
  await expect(page.getByTestId("trip-watching")).toHaveText("Watching: you're not on this trip");
  // What is the user's own leaves it out: no reminders before it, as their own trip has.
  await expect(page.getByRole("heading", { name: "Before you go" })).toHaveCount(0);
  await page.goto("/trips/e2e-mine");
  await expect(page.getByRole("heading", { name: "Before you go" })).toBeVisible();
});

test("Travelers… takes the user off a trip a printout named them on, so they're only watching it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedPerson(ownerUid, { id: "me", name: "Sam Example", bookings: 4, direct: 4 });
  await seedPerson(ownerUid, { id: "dad", name: "Pat Example", bookings: 1, direct: 0 });
  // A relative's itinerary that names the user too.
  await seedTrip(ownerUid, "e2e-dad", { travelers: ["Sam Example", "Pat Example"] }, { title: "Dad's trip" });
  // A cancelled booking for someone else: still on the trip, so ticked.
  await seedFlight("e2e-dad", { travelers: ["Alex Other"], cancelledAt: "2026-11-01T00:00:00Z" });
  await page.goto("/trips/e2e-dad");
  await expect(page.getByRole("heading", { name: "Before you go" })).toBeVisible();
  await expect(page.getByTestId("trip-watching")).toHaveCount(0);

  await page.getByRole("button", { name: "Trip actions" }).click();
  await page.getByRole("menuitem", { name: "Travelers…" }).click();
  const dialog = page.getByRole("dialog", { name: "Travelers" });
  await expect(dialog.getByRole("checkbox", { name: "Alex Other" })).toBeChecked();
  await dialog.getByRole("checkbox", { name: "Sam Example" }).uncheck();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("trip-watching")).toHaveText("Watching: you're not on this trip");
  await expect(page.getByRole("heading", { name: "Before you go" })).toHaveCount(0);
  // The booking still says whom the email named; the trip keeps who isn't on it.
  await expect.poll(async () => (await readTrip("e2e-dad"))?.removedTravelers).toEqual(["Sam Example"]);
  // The list says so too, and records whom the trip is now for.
  await page.goto("/");
  await expect(page.getByTestId("trip-card").filter({ hasText: "Dad's trip" })).toContainText("Watching");
  await expect.poll(async () => (await readTrip("e2e-dad"))?.travelers).toEqual(["Pat Example"]);
  await page.goto("/trips/e2e-dad");

  // Ticked again, the user is back on it.
  await page.getByRole("button", { name: "Trip actions" }).click();
  await page.getByRole("menuitem", { name: "Travelers…" }).click();
  await dialog.getByRole("checkbox", { name: "Sam Example" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("trip-watching")).toHaveCount(0);
  await expect.poll(async () => (await readTrip("e2e-dad"))?.removedTravelers).toBeUndefined();
});
