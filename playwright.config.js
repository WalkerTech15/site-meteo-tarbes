import { defineConfig, devices } from "@playwright/test";

/* End-to-end browser tests. These are deliberately separate from the Vitest
   unit suite (`npm test`), which covers pure logic only.

   Determinism rules for this suite:
   - No test ever reaches a live API. e2e/mocks.js intercepts every external
     origin the app talks to and serves fixed fixtures; anything unexpected is
     aborted, so a forgotten endpoint fails loudly instead of flaking.
   - The dev server is started by Playwright itself and reused locally. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
    /* the app renders local times; pin the zone so snapshots of clocks and
       "today" labels can't drift with the machine running the suite */
    timezoneId: "Europe/Paris",
    locale: "fr-FR",
  },
  /* `mobile-*.spec.js` covers behaviour that only exists below the 900px
     drawer breakpoint, so it runs on the phone profile and nowhere else. */
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile-.*\.spec\.js/,
    },
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: /mobile-.*\.spec\.js/ },
  ],
  /* Dedicated port + a server of our own (never reused), because the suite
     depends on the placeholder keys below. Vite gives prefixed process.env
     variables precedence over .env.local, so the developer's REAL MapTiler and
     Pexels keys are overridden here and can never reach the test browser —
     which also guarantees the mocked routes are the only thing answering. */
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_MAPTILER_KEY: "e2e-placeholder-key",
      VITE_PEXELS_KEY: "e2e-placeholder-key",
    },
  },
});
