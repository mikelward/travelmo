import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readTripChecklist, readTripReminders, seedFlight, seedTrip, seedTripReminder, seedTripTicks } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// Airports named by code alone, as many emails give them: their countries
// come from the airport table.
const heathrow = { name: "London Heathrow", code: "LHR", city: "London" };
const lisbon = { name: "Lisbon", code: "LIS" };
const manchester = { name: "Manchester", code: "MAN", city: "Manchester" };

// A week in Lisbon from London, 12 to 19 December; the browser's day is 1 November.
async function seedTrips(uid: string) {
  await seedTrip(uid, "e2e-lisbon", {}, { title: "Lisbon", start: "2026-12-12", end: "2026-12-19" });
  await seedFlight("e2e-lisbon", { id: "out", title: "TP 1 LHR to LIS", start: "2026-12-12T08:00:00+00:00", end: "2026-12-12T10:45:00+00:00", origin: heathrow, destination: lisbon });
  await seedFlight("e2e-lisbon", { id: "back", title: "TP 2 LIS to LHR", start: "2026-12-19T12:30:00+00:00", end: "2026-12-19T15:10:00+00:00", origin: lisbon, destination: heathrow });
  await seedTrip(uid, "e2e-manchester", {}, { title: "Manchester", start: "2026-12-05", end: "2026-12-06" });
  await seedFlight("e2e-manchester", { id: "north", title: "BA 1 LHR to MAN", start: "2026-12-05T08:00:00+00:00", end: "2026-12-05T09:00:00+00:00", origin: heathrow, destination: manchester });
  await seedFlight("e2e-manchester", { id: "south", title: "BA 2 MAN to LHR", start: "2026-12-06T18:00:00+00:00", end: "2026-12-06T19:00:00+00:00", origin: manchester, destination: heathrow });
}

test("Settings keeps reminders before international trips: added, edited and removed", async ({ page }) => {
  const uid = await signIn(page, owner);
  await page.goto("/settings");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Before international trips" }) });
  await section.getByRole("textbox", { name: "Reminder" }).fill("Apply for a visa");
  await section.getByRole("button", { name: "Add a reminder" }).click();
  const mine = section.getByRole("list", { name: "Your reminders" });
  await expect(mine.getByRole("listitem")).toHaveText([/Apply for a visa\s*30 days before/]);

  await section.getByRole("textbox", { name: "Reminder" }).fill("Request prescriptions");
  await section.getByRole("spinbutton", { name: "How long before" }).fill("2");
  await section.getByRole("combobox", { name: "Before the trip" }).selectOption("weeks");
  await section.getByRole("button", { name: "Add a reminder" }).click();
  await expect(mine.getByRole("listitem")).toHaveText([/Apply for a visa\s*30 days before/, /Request prescriptions\s*2 weeks before/]);
  // A month can't be more than a year ahead.
  await section.getByRole("textbox", { name: "Reminder" }).fill("Renew passport");
  await section.getByRole("spinbutton", { name: "How long before" }).fill("13");
  await section.getByRole("combobox", { name: "Before the trip" }).selectOption("months");
  await section.getByRole("button", { name: "Add a reminder" }).click();
  await expect(section.getByText("Enter a number from 0 to 12.")).toBeVisible();

  await mine.getByRole("listitem").filter({ hasText: "Apply for a visa" }).getByRole("button", { name: "Edit" }).click();
  await mine.getByRole("spinbutton", { name: "How long before" }).fill("6");
  await mine.getByRole("combobox", { name: "Before the trip" }).selectOption("weeks");
  await mine.getByRole("button", { name: "Save" }).click();
  await expect(mine.getByRole("listitem")).toHaveText([/Apply for a visa\s*6 weeks before/, /Request prescriptions\s*2 weeks before/]);

  await mine.getByRole("listitem").filter({ hasText: "Request prescriptions" }).getByRole("button", { name: "Remove" }).click();
  await expect(mine.getByRole("listitem")).toHaveCount(1);
  await expect.poll(() => readTripReminders(uid)).toEqual({ s0: { text: "Apply for a visa", amount: 6, unit: "weeks" } });
});

test("a trip abroad lists the reminders before it, ticked off and added to for this trip alone", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedTrips(uid);
  await seedTripReminder(uid, "s0", { id: "visa", text: "Apply for a visa", amount: 30, unit: "days" });
  await seedTripReminder(uid, "s1", { id: "meds", text: "Request prescriptions", amount: 2, unit: "weeks" });

  await page.goto("/trips/e2e-lisbon");
  const list = page.getByRole("list", { name: "Before you go" });
  await expect(list.getByRole("listitem")).toHaveText([/Apply for a visa\s*By Thu 12 Nov/, /Request prescriptions\s*By Sat 28 Nov/]);
  await list.getByRole("checkbox", { name: "Apply for a visa" }).check();
  await expect.poll(async () => (await readTripChecklist(uid, "e2e-lisbon")).done).toEqual(["visa"]);
  await expect(list.getByRole("checkbox", { name: "Apply for a visa" })).toBeChecked();
  // Unticked on another device: this page follows.
  await seedTripTicks(uid, "e2e-lisbon", []);
  await expect(list.getByRole("checkbox", { name: "Apply for a visa" })).not.toBeChecked();

  await page.getByRole("button", { name: "Add a reminder" }).click();
  await page.getByRole("textbox", { name: "Reminder" }).fill("Pack the adapter");
  await page.getByRole("combobox", { name: "Before the trip" }).selectOption("date");
  await page.getByLabel("Date").fill("2026-12-10");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveText([/Apply for a visa/, /Request prescriptions/, /Pack the adapter\s*By Thu 10 Dec\s*Remove/]);
  await expect.poll(async () => (await readTripChecklist(uid, "e2e-lisbon")).added).toEqual([{ slot: "a0", text: "Pack the adapter", date: "2026-12-10" }]);

  // A trip at home has none of the standing reminders, and nothing ticked
  // off on the trip abroad.
  await page.goto("/trips/e2e-manchester");
  await expect(page.getByRole("heading", { name: "Before you go" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Before you go" })).toHaveCount(0);

  await page.goto("/trips/e2e-lisbon");
  await list.getByRole("button", { name: "Remove Pack the adapter" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect.poll(async () => (await readTripChecklist(uid, "e2e-lisbon")).added).toEqual([]);
});
