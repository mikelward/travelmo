import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedFlight, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The seeded Liverpool trip: a stay from the 12th, a flight out at 09:00
// Dubai time on the 13th (04:00Z). The browser's clock is moved into the
// trip's second evening, so the card shows what a traveler there would see.
test("a trip under way says where you are staying, how soon the flight is, and that check-in is open", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-status");
  await seedFlight("e2e-status", { confirmation: "XX1234" });
  await page.clock.setSystemTime(new Date("2026-12-12T20:00:00Z"));
  await page.goto("/");
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card.getByTestId("trip-stay")).toHaveText("Staying at Cove Liverpool · until Mon 14 Dec 11:00");
  await expect(card.getByTestId("trip-next")).toHaveText("Departs XX 100 MAN to DXB · Sun 13 Dec 09:00 · in 8 h");
  await expect(card.getByTestId("trip-checkin")).toHaveText("Online check-in open, usually until departure · Ref XX1234");
});

test("before the window, the card says when online check-in opens; an upcoming trip's card says nothing of what comes next", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-status");
  await seedFlight("e2e-status");
  // The trip's first morning, before the stay's check-in and before the flight's window opens.
  await page.clock.setSystemTime(new Date("2026-12-12T02:00:00Z"));
  await page.goto("/");
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card.getByTestId("trip-next")).toHaveText("Check-in Cove Liverpool · Sat 12 Dec 15:00 · in 13 h");
  await expect(card.getByTestId("trip-checkin")).toHaveText("Online check-in usually opens Sat 12 Dec 09:00");
  await expect(card.getByTestId("trip-stay")).toHaveCount(0);
  // Upcoming: the card is the title and the dates alone.
  await page.clock.setSystemTime(new Date("2026-12-11T12:00:00Z"));
  await page.goto("/");
  await expect(card).toContainText("12–14 Dec 2026");
  await expect(card.getByTestId("trip-next")).toHaveCount(0);
  await expect(card.getByTestId("trip-checkin")).toHaveCount(0);
});
