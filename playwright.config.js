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
  /* Capped rather than left to Playwright's default of half the cores. Much of
     this suite drives a real MapLibre map, and several specs add a WebGL
     weather layer on top of it. Chromium keeps only a limited number of live
     WebGL contexts and silently drops the oldest when that ceiling is passed,
     which on a many-core machine turned into map-readiness timeouts and
     genuinely random failures. Four keeps the run parallel and the GPU sane;
     CI already serialises. */
  workers: process.env.CI ? 1 : 4,
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
     variables precedence over .env.local, and vite.config.js prefers
     process.env.PEXELS_API_KEY over the file — so the developer's REAL keys are
     overridden here and can never reach the test browser or the dev proxy.
     PEXELS_API_KEY is blanked rather than faked: with no key the dev middleware
     answers 503, so even a mock that somehow failed to intercept could not
     produce a live Pexels call. */
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_MAPTILER_KEY: "e2e-placeholder-key",
      PEXELS_API_KEY: "",
    },
  },
});
