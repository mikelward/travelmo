import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The PNG's own header gives its size: what installing reads is checked as
// served, not as written in the manifest.
function pngSize(body: Buffer): string {
  expect(body.subarray(1, 4).toString("latin1")).toBe("PNG");
  return `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`;
}

test("the manifest names installable icons that are served at their stated sizes", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { display: string; start_url: string; icons: { src: string; sizes: string; type: string; purpose?: string }[] };
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
  const pngs = manifest.icons.filter((icon) => icon.type === "image/png");
  expect(pngs.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of pngs) {
    const served = await request.get(icon.src);
    expect(served.ok()).toBe(true);
    expect(pngSize(await served.body())).toBe(icon.sizes);
  }
});

test("iPhones get a Home Screen icon and a title, and open without Safari's bars", async ({ page, request }) => {
  await page.goto("/");
  const appleIcon = page.locator('link[rel="apple-touch-icon"]');
  await expect(appleIcon).toHaveCount(1);
  const served = await request.get((await appleIcon.getAttribute("href"))!);
  expect(pngSize(await served.body())).toBe("180x180");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Travelmo");
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
});

test("Settings offers to install when the browser did, on any page, and opens its prompt", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Install Travelmo" })).toHaveCount(0);
  // The browser's install offer, as Chrome sends it, arriving on the home
  // page; Settings is then reached without a reload.
  await page.getByRole("link", { name: "Travelmo" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.evaluate(() => {
    const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => void ((window as unknown as { prompted: boolean }).prompted = true),
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(offer);
  });
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Install" }).click();
  // Once the prompt is answered the offer is spent and the section goes.
  await expect(page.getByRole("heading", { name: "Install Travelmo" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
});
