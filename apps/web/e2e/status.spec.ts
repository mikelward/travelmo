import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedFlight, seedFlightStatus, seedTrip } from "./seed";

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
  await expect(card.getByTestId("trip-next-title")).toHaveText("XX 100 MAN to DXB");
  await expect(card.getByTestId("trip-next-when")).toHaveText("Departs in 8 h · Sun 13 Dec 09:00");
  await expect(card.getByTestId("trip-next-step")).toHaveCount(0);
  await expect(card.getByTestId("trip-checkin")).toHaveText("Online check-in open, usually until departure · Ref XX1234");
});

test("the card gives the flight's gate before takeoff, then its arrival and carousel", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-status");
  await seedFlight("e2e-status");
  await seedFlightStatus("XX100_2026-12-13_MAN", { departureTerminal: "1", departureGate: "8", arrivalTerminal: "3", baggageClaim: "5" });
  await page.clock.setSystemTime(new Date("2026-12-12T20:00:00Z"));
  await page.goto("/");
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card.getByTestId("trip-next-when")).toHaveText("Departs in 8 h · Sun 13 Dec 09:00");
  await expect(card.getByTestId("trip-next-step")).toHaveText("Terminal 1 · Gate 8");
  // Two hours after takeoff the card turns to the arrival.
  await seedFlightStatus("XX100_2026-12-13_MAN", { departureGate: "8", actualOut: "2026-12-13T04:05:00Z", arrivalTerminal: "3", baggageClaim: "5" });
  await page.clock.setSystemTime(new Date("2026-12-13T06:00:00Z"));
  await page.goto("/");
  await expect(card.getByTestId("trip-next-title")).toHaveText("XX 100 MAN to DXB");
  await expect(card.getByTestId("trip-next-when")).toHaveText("Arrives in 9 h · Sun 13 Dec 19:00");
  await expect(card.getByTestId("trip-next-step")).toHaveText("Terminal 3 · Bags on carousel 5");
});

test("before the window, the card says when online check-in opens; an upcoming trip's card says nothing of what comes next", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-status");
  await seedFlight("e2e-status");
  // The trip's first morning, before the stay's check-in and before the flight's window opens.
  await page.clock.setSystemTime(new Date("2026-12-12T02:00:00Z"));
  await page.goto("/");
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card.getByTestId("trip-next-title")).toHaveText("Cove Liverpool");
  await expect(card.getByTestId("trip-next-when")).toHaveText("Check-in in 13 h · Sat 12 Dec 15:00");
  await expect(card.getByTestId("trip-checkin")).toHaveText("Online check-in usually opens Sat 12 Dec 09:00");
  await expect(card.getByTestId("trip-stay")).toHaveCount(0);
  // Upcoming: the card is the title and the dates alone.
  await page.clock.setSystemTime(new Date("2026-12-11T12:00:00Z"));
  await page.goto("/");
  await expect(card).toContainText("12–14 Dec 2026");
  await expect(card.getByTestId("trip-next")).toHaveCount(0);
  await expect(card.getByTestId("trip-checkin")).toHaveCount(0);
});

test("the card uses the airline's own check-in window", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-status");
  // Emirates opens check-in two days before departure, at 09:00 Dubai time on the 11th.
  await seedFlight("e2e-status", { title: "EK 18 MAN to DXB" });
  await page.clock.setSystemTime(new Date("2026-12-12T02:00:00Z"));
  await page.goto("/");
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card.getByTestId("trip-checkin")).toHaveText("Online check-in open, usually until departure");
});

test("an upcoming trip's card says when every booking was cancelled", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  const cancelled = { cancelledAt: "2026-12-01T09:00:00Z", cancelledBy: "m-cancel" };
  await seedTrip(ownerUid, "e2e-status", cancelled);
  await seedFlight("e2e-status", cancelled);
  await page.clock.setSystemTime(new Date("2026-12-11T12:00:00Z"));
  await page.goto("/");
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card.getByTestId("trip-cancelled")).toHaveText("Every booking cancelled");
  await expect(card.getByTestId("trip-next")).toHaveCount(0);
});
