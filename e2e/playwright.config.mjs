// Playwright config for the platform e2e suite. Auth is injected via storageState
// (see global-setup + lib/auth.mjs) so every project starts signed-in as a demo
// user — no UI login, no OTP.
//
// Dev servers are NOT auto-started (the monorepo has 8 apps on different ports).
// Start the app(s) you want to test, then run a project:
//   cd apps/venue && npm run dev      # then in repo root:
//   npx playwright test --config e2e/playwright.config.js --project=venue-alex
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGINS } from './lib/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const auth = (u) => path.join(__dirname, '.auth', `${u}.json`);

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.mjs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, 'report') }]],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'venue-alex', use: { baseURL: ORIGINS.venue, storageState: auth('alex') }, testMatch: /venue\.(?!sam).*\.spec\.js/ },
    { name: 'venue-sam', use: { baseURL: ORIGINS.venue, storageState: auth('sam') }, testMatch: /venue\.sam\..*\.spec\.js/ },
    { name: 'hq-alex', use: { baseURL: ORIGINS.hq, storageState: auth('alex') }, testMatch: /hq\..*\.spec\.js/ },
    { name: 'superadmin-alex', use: { baseURL: ORIGINS.superadmin, storageState: auth('alex') }, testMatch: /superadmin\..*\.spec\.js/ },
    { name: 'inorout-alex', use: { baseURL: ORIGINS.inorout, storageState: auth('alex') }, testMatch: /inorout\..*\.spec\.js/ },
    { name: 'inorout-sam', use: { baseURL: ORIGINS.inorout, storageState: auth('sam') }, testMatch: /(guardian|inorout-sam)\..*\.spec\.js/ },
    { name: 'display-token', use: { baseURL: ORIGINS.display }, testMatch: /display\..*\.spec\.js/ },
    { name: 'ref-token', use: { baseURL: ORIGINS.ref }, testMatch: /ref\..*\.spec\.js/ },
    { name: 'tokens', use: { baseURL: ORIGINS.inorout }, testMatch: /tokens\..*\.spec\.js/ },
  ],
});
