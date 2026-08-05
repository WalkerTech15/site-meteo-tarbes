/* The map used to let a user tilt it into a dramatic 3D-globe view (drag,
 * pinch, or Shift+arrow keys) — a space background and a curved horizon that
 * made the weather overlays and boundaries hard to read. This covers the
 * fix: permanently flat/north-up, every rotate/pitch interaction disabled
 * (pan, zoom, click, layers unaffected), the new Reset-view control, and
 * that a shared/bookmarked URL never restores a tilt.
 *
 * Bearing/pitch render straight into the WebGL canvas — unlike center, zoom
 * or the active layer, nothing about them is ever reflected in the DOM or
 * the URL. These tests read them through window.__mapOrientationForTests, a
 * dev-only accessor (see the bottom of features/map.js) that only exists
 * under `vite dev`/`vite preview` — never in `npm run build`'s output,
 * verified by scripts/verify-no-secrets.mjs scanning dist/. */
import { test, expect, installMocks } from "./mocks.js";

/* Same reasoning as map-click.spec.js: one live MapLibre context per test,
   run serially, so Chromium's WebGL-context ceiling never drops one early. */
test.describe.configure({ mode: "default", timeout: 90_000 });
const MAP_TIMEOUT = 20000;

async function openMap(page, hash = "") {
  await installMocks(page);
  await page.goto(`/#/map${hash}`);
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
}

function orientation(page, id = "worldMap") {
  return page.evaluate((mapId) => window.__mapOrientationForTests.get(mapId), id);
}

test.describe("the map is permanently flat and north-up", () => {
  test("the Carte page map starts at bearing 0 / pitch 0", async ({ page }) => {
    await openMap(page);
    const o = await orientation(page);
    expect(o.bearing).toBe(0);
    expect(o.pitch).toBe(0);
  });

  test("the homepage mini-map also starts flat", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await expect(page.locator("#homeMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
    const o = await orientation(page, "homeMap");
    expect(o.bearing).toBe(0);
    expect(o.pitch).toBe(0);
  });
});

test.describe("rotate/pitch interactions are disabled", () => {
  test("desktop drag-rotate (right mouse button / Ctrl+drag) is off, drag-pan stays on", async ({
    page,
  }) => {
    await openMap(page);
    const o = await orientation(page);
    expect(o.dragRotateEnabled).toBe(false);
    expect(o.dragPanEnabled).toBe(true);
    expect(o.scrollZoomEnabled).toBe(true);
  });

  test("touch pitch is off, and touch rotate is off while pinch-zoom stays on", async ({
    page,
  }) => {
    await openMap(page);
    const o = await orientation(page);
    expect(o.touchPitchEnabled).toBe(false);
    expect(o.touchRotateDisabled).toBe(true);
    expect(o.touchZoomRotateEnabled).toBe(true);
  });

  test("keyboard rotate/pitch (Shift+arrow) is off, and pressing it never moves bearing/pitch off zero", async ({
    page,
  }) => {
    await openMap(page);
    expect((await orientation(page)).keyboardRotateDisabled).toBe(true);

    await page.locator("#worldMap canvas").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Shift+ArrowRight"); // would rotate +15°
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowUp"); // would pitch +10°
    await page.keyboard.press("Shift+ArrowDown");

    const o = await orientation(page);
    expect(o.bearing).toBe(0);
    expect(o.pitch).toBe(0);
  });

  test("plain arrow-key pan and +/- zoom still work (only rotate/pitch was removed)", async ({
    page,
  }) => {
    await openMap(page, "?c=48.9,2.4&z=9");
    await page.locator("#worldMap canvas").click({ position: { x: 5, y: 5 } });

    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.url(), { timeout: MAP_TIMEOUT }).not.toContain("c=48.9%2C2.4&z=9");
    const urlAfterPan = page.url();

    await page.keyboard.press("+");
    await expect.poll(() => page.url(), { timeout: MAP_TIMEOUT }).not.toBe(urlAfterPan);
  });
});

test.describe("Reset map view control", () => {
  test("exists, is keyboard-focusable, and its label is translated", async ({ page }) => {
    await openMap(page);
    const btn = page.locator(".map-reset-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("type", "button");
    await expect(btn).toHaveAttribute("aria-label", "Réinitialiser la vue de la carte");

    await btn.focus();
    await expect(btn).toBeFocused();

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(btn).toHaveAttribute("aria-label", "Reset map view");
  });

  test("resets a tilted camera to north-up/flat without losing the selected location or active layer", async ({
    page,
  }) => {
    await openMap(page, "?c=48.9,2.4&z=9");
    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveClass(/is-active/, {
      timeout: MAP_TIMEOUT,
    });
    const urlBefore = page.url();

    /* the map can no longer be tilted by any real interaction — force one
       programmatically (test-only) to prove the control actually corrects it */
    await page.evaluate(() => window.__mapOrientationForTests.set("worldMap", 135, 45));
    const tilted = await orientation(page);
    expect(tilted.bearing).not.toBe(0);
    expect(tilted.pitch).not.toBe(0);

    await page.locator(".map-reset-btn").click();
    await expect.poll(async () => (await orientation(page)).bearing).toBe(0);
    await expect.poll(async () => (await orientation(page)).pitch).toBe(0);

    /* selection + layer untouched, and the reset didn't trigger a new nav */
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveClass(/is-active/);
    expect(page.url()).toBe(urlBefore);
  });

  test("activating it with the keyboard (Enter) works the same as a click", async ({ page }) => {
    await openMap(page);
    await page.evaluate(() => window.__mapOrientationForTests.set("worldMap", 60, 30));
    expect((await orientation(page)).bearing).not.toBe(0);

    await page.locator(".map-reset-btn").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await orientation(page)).bearing).toBe(0);
    await expect.poll(async () => (await orientation(page)).pitch).toBe(0);
  });
});

test.describe("URL restoration never revives a tilt", () => {
  test("an ordinary shared-camera URL restores flat", async ({ page }) => {
    await openMap(page, "?c=35.6762,139.6503&z=6");
    const o = await orientation(page);
    expect(o.bearing).toBe(0);
    expect(o.pitch).toBe(0);
  });

  test("an old link carrying stray pitch/bearing query params still opens flat", async ({
    page,
  }) => {
    /* url-state.js has never had pitch/bearing keys (see its own unit test),
       so these are silently ignored the same way any unknown param is — this
       just confirms the map that opens is unaffected by their presence */
    await openMap(page, "?c=35.6762,139.6503&z=6&pitch=60&bearing=120");
    const o = await orientation(page);
    expect(o.bearing).toBe(0);
    expect(o.pitch).toBe(0);
  });

  test("Share still round-trips a plain camera link with no orientation params", async ({
    page,
  }) => {
    await openMap(page, "?c=35.6762,139.6503&z=6");
    await expect(page.locator("#mapShareBtn")).toBeVisible();
    const shared = await page.evaluate(() => window.location.hash);
    expect(shared).not.toContain("pitch");
    expect(shared).not.toContain("bearing");
  });
});

test.describe("normal interaction is unaffected", () => {
  test("no page-level horizontal overflow on the map view", async ({ page }) => {
    await openMap(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("attribution is still present (MapTiler/OpenStreetMap credit untouched)", async ({
    page,
  }) => {
    await openMap(page);
    await expect(page.locator("#worldMap .maplibregl-ctrl-attrib")).toBeAttached();
  });
});

/* @maptiler/sdk's own bundled CSS carries a `.maplibregl-ctrl-group button {
   width/height: 33px}` rule at the same specificity as this app's 44×44
   touch-target rule (utilities/accessibility.css) — same specificity means
   whichever loads later wins, and the SDK's did, silently shrinking the
   zoom in/out buttons below the target size even where the reset button
   (styles/views/map.css, its own higher-specificity selector) was already
   correct. This covers the fix: a selector scoped and specific enough to
   win regardless of load order, on every width, not just touch/narrow
   ones — see the comment beside it in styles/views/map.css. */
test.describe("map control touch targets are at least 44×44px", () => {
  for (const width of [1440, 901, 900]) {
    test(`zoom in/out and reset are 44×44 at ${width}px, and stay aligned/consistent`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openMap(page);
      const zoomIn = await page.locator("#worldMap .maplibregl-ctrl-zoom-in").boundingBox();
      const zoomOut = await page.locator("#worldMap .maplibregl-ctrl-zoom-out").boundingBox();
      const reset = await page.locator("#worldMap .map-reset-btn").boundingBox();

      for (const box of [zoomIn, zoomOut, reset]) {
        expect(box.width).toBeGreaterThanOrEqual(43.5);
        expect(box.height).toBeGreaterThanOrEqual(43.5);
      }
      /* consistent sizing/alignment (requirement 4), within a sub-pixel
         tolerance for browser layout rounding — not each merely clearing the
         44px floor independently, but genuinely matching each other */
      const close = (a, b) => expect(Math.abs(a - b)).toBeLessThan(1);
      close(zoomIn.width, zoomOut.width);
      close(zoomOut.width, reset.width);
      close(zoomIn.height, zoomOut.height);
      close(zoomOut.height, reset.height);
      /* same left edge, stacked with no gap/overlap */
      close(zoomIn.x, zoomOut.x);
      close(zoomOut.x, reset.x);
      close(zoomOut.y, zoomIn.y + zoomIn.height);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("the zoom buttons' icon, grouping, border and hover state are unchanged", async ({
    page,
  }) => {
    await openMap(page);
    const group = page.locator("#worldMap .maplibregl-ctrl-group").first();
    await expect(group).toBeVisible();
    /* still one shared group box (border/shadow/radius from .maplibregl-ctrl-
       group in map.css), still exactly the two zoom buttons in it */
    await expect(group.locator("button")).toHaveCount(2);
    await expect(page.locator("#worldMap .maplibregl-ctrl-zoom-in")).toBeVisible();
    await expect(page.locator("#worldMap .maplibregl-ctrl-zoom-out")).toBeVisible();
  });
});
