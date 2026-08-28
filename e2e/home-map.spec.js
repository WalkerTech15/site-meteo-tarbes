/* The homepage "Carte du monde" mini-map (#homeMap), distinct from the full
 * Carte page's #worldMap (see map-click.spec.js / map-url.spec.js for that).
 *
 * #homeMap used to be a flat 372px regardless of viewport or mode. In Simple
 * mode the insights column is hidden and the map becomes the only column in
 * .home-duo (full width) — a fixed 372px then read as a thin banner on
 * desktop. This file covers the responsive clamp() replacement: taller on
 * desktop, smoothly reduced through laptop/tablet, unchanged compact height
 * on mobile, no page overflow, and that MapLibre actually re-measures its
 * canvas after a Simple/Détaillé switch or a browser resize. */
import { test, expect, installMocks } from "./mocks.js";

const MAP_TIMEOUT = 20000;

function noOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function freshAt(page, viewport) {
  await page.setViewportSize(viewport);
  await installMocks(page);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
  await expect(page.locator("#homeMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
}

test.describe("home map: height in Simple mode across desktop widths", () => {
  const CASES = [
    { width: 1440, min: 425, max: 465 },
    { width: 1280, min: 375, max: 395 },
    { width: 1024, min: 355, max: 365 },
  ];
  for (const { width, min, max } of CASES) {
    test(`~${width}px lands in the expected band`, async ({ page }) => {
      await freshAt(page, { width, height: 900 });
      const box = await page.locator("#homeMap").boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(min);
      expect(box.height).toBeLessThanOrEqual(max);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("shrinks as the viewport narrows (responsive, not one fixed height)", async ({ page }) => {
    await freshAt(page, { width: 1440, height: 900 });
    const wide = (await page.locator("#homeMap").boundingBox()).height;

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(300);
    const narrow = (await page.locator("#homeMap").boundingBox()).height;

    expect(narrow).toBeLessThan(wide);
  });
});

test.describe("home map: tablet and mobile widths", () => {
  test("768px (tablet, stacked layout): full width, no overflow", async ({ page }) => {
    await freshAt(page, { width: 768, height: 900 });
    const box = await page.locator("#homeMap").boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(340);
    expect(box.height).toBeLessThanOrEqual(400);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });

  for (const width of [480, 360]) {
    test(`${width}px keeps the existing compact mobile height (280px)`, async ({ page }) => {
      await freshAt(page, { width, height: 800 });
      const box = await page.locator("#homeMap").boundingBox();
      expect(box.height).toBe(280);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("home map: Detailed mode", () => {
  test("is also taller than the old fixed 372px on desktop, and the map keeps rendering", async ({
    page,
  }) => {
    await freshAt(page, { width: 1440, height: 900 });
    await page.locator('#modeToggleSide button[data-mode="detailed"]').click();
    await page.waitForTimeout(300);

    await expect(page.locator("#homeMap canvas")).toBeVisible();
    const box = await page.locator("#homeMap").boundingBox();
    expect(box.height).toBeGreaterThan(372);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("400px narrower than Simple mode's map column (home-duo splits into two columns)", async ({
    page,
  }) => {
    await freshAt(page, { width: 1440, height: 900 });
    const simpleWidth = (await page.locator("#homeMap").boundingBox()).width;

    await page.locator('#modeToggleSide button[data-mode="detailed"]').click();
    await page.waitForTimeout(300);
    const detailedWidth = (await page.locator("#homeMap").boundingBox()).width;

    expect(detailedWidth).toBeLessThan(simpleWidth - 300);
  });
});

test.describe("home map: MapLibre re-measures after layout changes", () => {
  test("resizes correctly when switching Simple → Détaillé → Simple", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 900 });
    const canvas = page.locator("#homeMap canvas");

    const simpleCanvasWidth = (await canvas.boundingBox()).width;
    const containerWidthSimple = (await page.locator("#homeMap").boundingBox()).width;
    expect(Math.abs(simpleCanvasWidth - containerWidthSimple)).toBeLessThan(2);

    await page.locator('#modeToggleSide button[data-mode="detailed"]').click();
    await page.waitForTimeout(300);
    const detailedCanvasWidth = (await canvas.boundingBox()).width;
    const containerWidthDetailed = (await page.locator("#homeMap").boundingBox()).width;
    expect(Math.abs(detailedCanvasWidth - containerWidthDetailed)).toBeLessThan(2);
    expect(detailedCanvasWidth).toBeLessThan(simpleCanvasWidth);

    await page.locator('#modeToggleSide button[data-mode="simple"]').click();
    await page.waitForTimeout(300);
    const backToSimpleCanvasWidth = (await canvas.boundingBox()).width;
    expect(Math.abs(backToSimpleCanvasWidth - simpleCanvasWidth)).toBeLessThan(2);
  });

  test("resizes correctly after the browser window is resized", async ({ page }) => {
    await freshAt(page, { width: 1440, height: 900 });
    const canvas = page.locator("#homeMap canvas");
    const before = await canvas.boundingBox();

    await page.setViewportSize({ width: 1024, height: 900 });
    /* main.js debounces the resize→resizeMaps() call by 200ms */
    await page.waitForTimeout(400);

    const after = await canvas.boundingBox();
    const containerAfter = await page.locator("#homeMap").boundingBox();
    expect(after.width).toBeLessThan(before.width);
    expect(Math.abs(after.width - containerAfter.width)).toBeLessThan(2);
  });

  test("re-renders correctly when navigating away and back to the homepage", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 900 });
    await page.locator('.side-item[data-view="favorites"]').click();
    await expect(page.locator("#view-home")).toBeHidden();

    await page.locator('.side-item[data-view="home"]').click();
    await expect(page.locator("#homeMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
    const box = await page.locator("#homeMap").boundingBox();
    const canvasBox = await page.locator("#homeMap canvas").boundingBox();
    expect(Math.abs(canvasBox.width - box.width)).toBeLessThan(2);
  });
});

test.describe("home map: controls, marker, attribution and loading state are preserved", () => {
  test("zoom controls, the location marker and attribution are present", async ({ page }) => {
    await freshAt(page, { width: 1440, height: 900 });
    await expect(page.locator("#homeMap .maplibregl-ctrl-zoom-in")).toBeVisible();
    await expect(page.locator("#homeMap .maplibregl-ctrl-zoom-out")).toBeVisible();
    await expect(page.locator("#homeMap .maplibregl-marker")).toBeVisible();
    await expect(page.locator("#homeMap .maplibregl-ctrl-attrib")).toBeAttached();
  });

  test("the border radius and loading state are unchanged", async ({ page }) => {
    await freshAt(page, { width: 1440, height: 900 });
    await expect(page.locator("#homeMap")).not.toHaveClass(/is-loading/);
    const radius = await page
      .locator("#homeMap")
      .evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).not.toBe("0px");
  });
});
