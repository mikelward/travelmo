import { defineConfig } from "vitest/config";

// The store and connection tests run against the Firestore emulator, whose
// contended transactions take a few seconds to resolve (one waits on the
// other's lock, then retries with the SDK's backoff), so they get the same
// allowance as the web app's emulator-backed tests.
export default defineConfig({
  test: { globals: true, testTimeout: 20_000, hookTimeout: 60_000 },
});
