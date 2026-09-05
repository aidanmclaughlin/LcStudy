const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testMatch: 'board.spec.js',
  workers: 2,
  reporter: 'line',
  use: { screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'Chrome desktop',
      use: { browserName: 'chromium', channel: 'chrome' },
    },
    {
      name: 'Safari mobile',
      use: { ...devices['iPhone 14'], browserName: 'webkit' },
    },
  ],
});
