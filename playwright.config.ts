import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config. Runs the Vite dev server on port 5173, points
 * tests at it. SUPABASE_SERVICE_ROLE_KEY must be set in the shell
 * (not committed) — the test seeds a scratch customer+lead via
 * admin and injects a session into localStorage so no manual sign-in
 * is needed.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
