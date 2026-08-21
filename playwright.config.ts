import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: { baseURL: "http://127.0.0.1:1420", trace: "retain-on-failure" },
  webServer: {
    command: "./node_modules/.bin/vite",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
