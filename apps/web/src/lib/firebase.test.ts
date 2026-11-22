import { doc, getDocFromCache } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Clearing fails in the browser when IndexedDB is present but unusable (a
// private window) or another tab holds it; here it is made to fail outright.
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  clearIndexedDbPersistence: vi.fn().mockRejectedValue(new Error("IndexedDB is unavailable")),
}));

const fakeWindow = { indexedDB: {} } as unknown as Window & typeof globalThis;
const storage = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
} as unknown as Storage;

beforeAll(() => {
  Object.assign(globalThis, { window: fakeWindow, localStorage: fakeStorage });
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "fake-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "demo-travelmo.firebaseapp.com";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-travelmo";
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "1:1:web:1";
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("adoptFirestoreCache", () => {
  it("leaves a working Firestore behind when the cache cannot be cleared", async () => {
    const { adoptFirestoreCache, firestore } = await import("./firebase");
    const before = firestore();

    await expect(adoptFirestoreCache("user-1")).rejects.toThrow("IndexedDB is unavailable");

    const after = firestore();
    expect(after).not.toBe(before);
    // A terminated instance refuses every call; a fresh one answers from its
    // (empty) cache that the document is not there.
    await expect(getDocFromCache(doc(after, "trips/none"))).rejects.toMatchObject({ code: "unavailable" });
    // Not recorded as this account's cache, so the next load tries again.
    expect(storage.has("travelmo.cacheOwner")).toBe(false);
  });
});

describe("forgetFirestoreCache", () => {
  it("clears the deleted account's cache and no longer names it as the owner", async () => {
    const { forgetFirestoreCache, firestore } = await import("./firebase");
    const { clearIndexedDbPersistence } = await import("firebase/firestore");
    vi.mocked(clearIndexedDbPersistence).mockResolvedValueOnce(undefined);
    storage.set("travelmo.cacheOwner", "deleted-user");
    const before = firestore();

    await forgetFirestoreCache();

    expect(clearIndexedDbPersistence).toHaveBeenLastCalledWith(before);
    expect(storage.has("travelmo.cacheOwner")).toBe(false);
    expect(firestore()).not.toBe(before);
  });

  it("keeps naming the deleted account when clearing fails, so the next sign-in clears it", async () => {
    const { forgetFirestoreCache, firestore } = await import("./firebase");
    storage.set("travelmo.cacheOwner", "deleted-user");
    const before = firestore();

    await expect(forgetFirestoreCache()).rejects.toThrow("IndexedDB is unavailable");

    expect(storage.get("travelmo.cacheOwner")).toBe("deleted-user");
    expect(firestore()).not.toBe(before);
  });
});
