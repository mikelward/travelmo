import { defineConfig } from "@playwright/test";

const port = 3100;

// Runs under `firebase emulators:exec` (see the test:e2e script), which starts
// the Auth and Firestore emulators the dev server below is pointed at.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-travelmo.firebaseapp.com",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-travelmo",
      NEXT_PUBLIC_FIREBASE_APP_ID: "1:1:web:1",
      NEXT_PUBLIC_PARSER_URL: "http://localhost:8080",
      NEXT_PUBLIC_AUTH_EMULATOR_URL: "http://localhost:9099",
      NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "localhost:8081",
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
