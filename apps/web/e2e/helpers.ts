import { expect, type Page } from "@playwright/test";

export const owner = "owner@example.com";
export const partner = "partner@example.com";

// The fixture's dates are fixed, so the browser's clock starts at a fixed
// time too: before the stay's check-in, so "next up" is the check-in
// whenever the test runs. The clock then runs on rather than staying
// frozen: Firestore's offline cache hands its storage from one page to the
// next by lease timestamps, and under a frozen Date.now a lease left by a
// page that navigated away mid-start never expires, so the next page never
// hears from the server.
export const frozenNow = new Date("2026-11-01T12:00:00Z");

export async function signIn(page: Page, email: string): Promise<string> {
  await page.clock.setSystemTime(frozenNow);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.travelmoTestSignIn === "function");
  return page.evaluate((address) => window.travelmoTestSignIn!(address), email);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
}

/** WCAG contrast ratio of two computed `rgb(...)` colors; 1 when either is see-through. */
export function contrastRatio(a: string, b: string): number {
  const channels = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
  const [ca, cb] = [channels(a), channels(b)];
  if (ca.length < 3 || cb.length < 3 || (ca[3] ?? 1) < 1 || (cb[3] ?? 1) < 1) return 1;
  const luminance = ([r, g, b]: number[]) => {
    const linear = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [high, low] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
