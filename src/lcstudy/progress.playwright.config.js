const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testMatch: 'progress.spec.js', workers: 2, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:3110', screenshot: 'only-on-failure' },
  projects: [
    { name: 'Chrome desktop', use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 1440, height: 1000 } } },
    { name: 'Safari mobile', use: { ...devices['iPhone 14'], browserName: 'webkit' } }
  ],
  webServer: { command: 'npm run dev -- --port 3110 --hostname 127.0.0.1', url: 'http://127.0.0.1:3110/signin', reuseExistingServer: !process.env.CI, timeout: 120000 }
});
