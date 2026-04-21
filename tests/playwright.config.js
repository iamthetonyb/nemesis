const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  testMatch: "*.spec.cjs",
  timeout: 45000,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8091",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
