import { expect, type Page } from "@playwright/test";

export const owner = "owner@example.com";
export const partner = "partner@example.com";

// The fixture's dates are fixed, so the browser's clock is too: before the
// stay's check-in, so "next up" is the check-in whenever the test runs.
// Only Date is pinned; timers keep running for Firestore and Auth.
export const frozenNow = new Date("2026-11-01T12:00:00Z");

export async function signIn(page: Page, email: string): Promise<string> {
  await page.clock.setFixedTime(frozenNow);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.travelmoTestSignIn === "function");
  return page.evaluate((address) => window.travelmoTestSignIn!(address), email);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
}
