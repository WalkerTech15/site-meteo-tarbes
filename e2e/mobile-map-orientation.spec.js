/* Phone-profile checks for the flat/north-up map fix (see map-orientation.spec.js
 * for the desktop-side coverage of the same feature). Runs on the Pixel 5
 * profile (`hasTouch: true`), which is what actually attaches MapLibre's
 * touch handlers — the desktop Chrome profile never does, so touch-specific
 * state can only be verified here. */
import { test, expect } from "./mocks.js";

test.describe.configure({ timeout: 60_000 });
const MAP_TIMEOUT = 20000;

async function openMobileMap(app) {
  await app.locator("#burgerBtn").click();
  await app.locator('.side-item[data-view="map"]').click();
  await expect(app.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
}

function orientation(app, id = "worldMap") {
  return app.evaluate((mapId) => window.__mapOrientationForTests.get(mapId), id);
}

test.describe("map orientation on a phone", () => {
  test("starts flat, and touch pitch/rotate are off while pinch-zoom stays configured", async ({
    app,
  }) => {
    await openMobileMap(app);
    const o = await orientation(app);
    expect(o.bearing).toBe(0);
    expect(o.pitch).toBe(0);
    expect(o.touchPitchEnabled).toBe(false);
    expect(o.touchRotateDisabled).toBe(true);
  });

  test("normal touch pan and pinch-zoom (dragPan/scrollZoom/touchZoomRotate) stay enabled", async ({
    app,
  }) => {
    await openMobileMap(app);
    /* dragPan/scrollZoom/pinch-zoom aren't part of the rotate/pitch cleanup
       and were never touched — confirm they're still on, so a future edit
       near this code can't silently take them out too. */
    const o = await orientation(app);
    expect(o.dragPanEnabled).toBe(true);
    expect(o.scrollZoomEnabled).toBe(true);
    expect(o.touchZoomRotateEnabled).toBe(true);
  });

  test("the reset-view button meets the 44×44 touch target and is reachable", async ({ app }) => {
    await openMobileMap(app);
    /* #homeMap (hidden behind the home view) has its own copy of this
       control too — scope to the map page's, same as every other MapLibre
       control selector in this suite (e.g. #worldMap .maplibregl-ctrl-zoom-in). */
    const btn = app.locator("#worldMap .map-reset-btn");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    /* MapLibre's own control buttons are a native 29px box; utilities/
       accessibility.css bumps every `.maplibregl-ctrl-group button` to
       44×44 at pointer:coarse widths — confirm the reset button gets that
       same treatment rather than staying at the library's smaller default. */
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  });

  test("the zoom in/out buttons also meet the 44×44 touch target", async ({ app }) => {
    await openMobileMap(app);
    /* @maptiler/sdk's own bundled CSS ships a same-specificity `33px`
       override for `.maplibregl-ctrl-group button` that loaded after (and so
       beat) this app's accessibility.css rule — the zoom buttons stayed
       33×33 on a phone even after the reset button above was fixed. See the
       higher-specificity selector in styles/views/map.css. */
    const zoomIn = await app.locator("#worldMap .maplibregl-ctrl-zoom-in").boundingBox();
    const zoomOut = await app.locator("#worldMap .maplibregl-ctrl-zoom-out").boundingBox();
    for (const box of [zoomIn, zoomOut]) {
      expect(box.width).toBeGreaterThanOrEqual(43.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    /* consistent sizing with the reset button right below them, within a
       sub-pixel tolerance for browser layout rounding */
    const reset = await app.locator("#worldMap .map-reset-btn").boundingBox();
    expect(Math.abs(zoomIn.width - reset.width)).toBeLessThan(1);
    expect(Math.abs(zoomIn.height - reset.height)).toBeLessThan(1);

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("tapping reset flattens a forced tilt without losing the selection", async ({ app }) => {
    await openMobileMap(app);
    await app.evaluate(() => window.__mapOrientationForTests.set("worldMap", 90, 40));
    expect((await orientation(app)).bearing).not.toBe(0);

    await app.locator("#worldMap .map-reset-btn").tap();
    await expect.poll(async () => (await orientation(app)).bearing).toBe(0);
    await expect.poll(async () => (await orientation(app)).pitch).toBe(0);

    /* still on the map view, still showing the details panel for the same
       selection — resetting orientation didn't reset anything else */
    await expect(app.locator("#worldMap")).toBeVisible();
    await expect(app.locator("#mapWeatherPanel")).toBeVisible();
  });

  test("no horizontal overflow on the map view at phone width", async ({ app }) => {
    await openMobileMap(app);
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("map clicks still select a location on a phone (basics unaffected)", async ({ app }) => {
    await openMobileMap(app);
    const map = app.locator("#worldMap");
    const box = await map.boundingBox();
    await app.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(app.locator("#mapWeatherPanel")).toBeVisible();
  });
});
