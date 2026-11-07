import { expect, test } from "@playwright/test";
import { owner, partner, signIn, signOut } from "./helpers";
import { clearData, readPushSubscriptions, readUser } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// Headless Chromium has no push service to subscribe with, so the page's
// push manager is stood in for: it hands out one invented subscription,
// remembered across page loads as a browser's would be, and forgets it on
// unsubscribe. Everything from the switch to Firestore is real.
const fakeEndpoint = "https://push.example/s/e2e";
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["notifications"]);
  await context.addInitScript((endpoint) => {
    const key = "e2e-push-subscribed";
    const fake = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: "fake-p256dh", auth: "fake-auth" } }),
      unsubscribe: async () => {
        localStorage.removeItem(key);
        return true;
      },
    } as unknown as PushSubscription;
    PushManager.prototype.subscribe = async () => {
      localStorage.setItem(key, "1");
      return fake;
    };
    PushManager.prototype.getSubscription = async () => (localStorage.getItem(key) ? fake : null);
  }, fakeEndpoint);
});

test("notifications in this browser are off until asked for, keep the subscription, and go with it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await page.goto("/settings");
  const box = page.getByRole("checkbox", { name: "Notify me in this browser" });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();
  await expect.poll(() => readPushSubscriptions(ownerUid)).toEqual([{ endpoint: fakeEndpoint, keys: { p256dh: "fake-p256dh", auth: "fake-auth" }, createdAt: expect.any(String) }]);
  await expect.poll(async () => (await readUser(ownerUid))?.reminders?.push).toBe(true);
  // The browser's subscription is the owner's; another account on the same
  // browser starts off.
  await signOut(page);
  await signIn(page, partner);
  await page.goto("/settings");
  await expect(page.getByRole("checkbox", { name: "Notify me in this browser" })).not.toBeChecked();
  await signOut(page);
  await signIn(page, owner);
  await page.goto("/settings");
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(box).not.toBeChecked();
  await expect.poll(() => readPushSubscriptions(ownerUid)).toEqual([]);
  await expect.poll(async () => (await readUser(ownerUid))?.reminders?.push).toBe(false);
  // The browser's subscription outlives one account's choice.
  expect(await page.evaluate(() => localStorage.getItem("e2e-push-subscribed"))).toBe("1");
});
