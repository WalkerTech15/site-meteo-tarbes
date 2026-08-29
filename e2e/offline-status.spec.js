/* Offline behaviour as the visitor experiences it.
 *
 * The service worker itself is production-only (see services/offline.js) —
 * registering it in front of `vite dev` would fight HMR and make the rest
 * of this suite depend on cache state. Its caching POLICY is unit-tested
 * against the real public/sw.js in services/sw-policy.test.js; what matters
 * here is the half the visitor actually sees: losing connectivity must be
 * labelled, and the "Updated · N min ago" line must stay visible so cached
 * weather is never presented as current. */
import { test, expect, installMocks } from "./mocks.js";

const livePill = (page) => page.locator("#heroLive");

async function goOffline(page) {
  await page.context().setOffline(true);
  /* setOffline emulates the connection drop; the `offline` event is what
     the app listens for (services/offline.js) */
  await expect(livePill(page)).toHaveClass(/is-offline/);
}

async function goOnline(page) {
  await page.context().setOffline(false);
  await expect(livePill(page)).not.toHaveClass(/is-offline/);
}

test.describe("offline status indicator", () => {
  test("the hero reports Live while connected, and never claims to be offline", async ({ app }) => {
    await expect(livePill(app)).toBeVisible();
    await expect(livePill(app)).not.toHaveClass(/is-offline/);
    await expect(livePill(app)).not.toContainText("Hors ligne");
  });

  test("losing the connection relabels the pill instead of leaving it on Live", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await goOffline(page);
    /* default app language is French — see e2e/mocks.js */
    await expect(livePill(page)).toContainText("Hors ligne");
    await expect(livePill(page)).not.toContainText("En direct");
  });

  test("the last-updated line stays visible offline, so stale data is dated", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await goOffline(page);

    /* "Mis à jour · à l'instant" / "il y a N min" — the timestamp is what
       tells the visitor HOW old the reading is; the pill says why */
    await expect(page.locator(".hero-updated")).toBeVisible();
    await expect(page.locator(".hero-updated")).toContainText(/Mis à jour/i);
  });

  test("reconnecting restores the live label without a reload", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await goOffline(page);
    await goOnline(page);
    await expect(livePill(page)).toContainText("En direct");
  });

  test("going offline never blanks the hero, the forecast or the photo", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    const cityBefore = await page.locator("#heroCityName").innerText();

    await goOffline(page);

    /* the whole card must survive a connectivity blip — the pill repaints
       on its own rather than re-rendering (and re-fetching) the hero */
    await expect(page.locator("#heroCityName")).toHaveText(cityBefore);
    await expect(page.locator(".hero-temp")).not.toBeEmpty();
    await expect(page.locator("#forecastRow .forecast-card").first()).toBeVisible();
  });

  test("the indicator works in English too", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();

    await goOffline(page);
    await expect(livePill(page)).toContainText("Offline");
  });

  test("the indicator is readable on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await goOffline(page);

    await expect(livePill(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("service worker registration", () => {
  test("is not registered against the dev server, so the suite stays deterministic", async ({
    app,
  }) => {
    const registrations = await app.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return [];
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.map((r) => r.scope);
    });
    expect(registrations).toEqual([]);
  });
});
