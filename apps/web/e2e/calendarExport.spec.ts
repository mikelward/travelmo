import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedCalendarExport } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The parser is stubbed: what it would write, the stub writes to the emulator.
test("a calendar link is created, offered for Google and Apple Calendar, and turned off", async ({ page }) => {
  const uid = await signIn(page, owner);
  const token = "exampletoken0123456789abcdef";
  const calls: string[] = [];
  await page.route("http://localhost:8080/export/calendar", async (route) => {
    calls.push("issue");
    await seedCalendarExport(uid, token);
    await route.fulfill({ json: { token, createdAt: "2026-11-01T00:00:00Z" } });
  });
  await page.route("http://localhost:8080/export/calendar/stop", async (route) => {
    calls.push("stop");
    await seedCalendarExport(uid, undefined);
    await route.fulfill({ status: 204 });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Create calendar link" }).click();
  const link = `http://localhost:8080/cal/${token}.ics`;
  await expect(page.getByLabel("Calendar link")).toHaveValue(link);
  await expect(page.getByRole("link", { name: "Open in Apple Calendar" })).toHaveAttribute("href", `webcal://localhost:8080/cal/${token}.ics`);
  await expect(page.getByRole("link", { name: "Add to Google Calendar" })).toHaveAttribute(
    "href",
    `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://localhost:8080/cal/${token}.ics`)}`,
  );

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("button", { name: "Create calendar link" })).toBeVisible();
  expect(calls).toEqual(["issue", "stop"]);
});
