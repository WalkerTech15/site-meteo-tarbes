/* Weather-layer legends and the forecast-time control.
 *
 * The real @maptiler/weather layers run here: the mocked `weather/latest.json`
 * and tile pyramid let the SDK build a genuine time-frame animation, so the
 * legend really is read from the layer's own getColorRamp() and the timeline
 * really does move setAnimationTime(). Nothing about the layer is stubbed. */
import { test, expect, installMocks } from "./mocks.js";

/* These specs drive REAL MapLibre + @maptiler/weather layers: every test
   builds a WebGL context, fetches a tile pyramid and uploads textures, and
   several reload the page and do it twice.

   mode "default": the file runs its tests one after another in a single
   worker instead of fanning them out. Chromium caps how many live WebGL
   contexts it will keep, and dropping the oldest one mid-test is what made
   these flaky under full parallelism — files still run in parallel with each
   other, so the suite stays fast. The timeout matches the real work done. */
test.describe.configure({ mode: "default", timeout: 90_000 });

const LAYERS = ["temperature", "rain", "wind"];

/* Building a real WebGL weather layer (manifest → tile pyramid → GPU upload)
   takes noticeably longer than a DOM assertion, especially with the suite's
   workers competing for the GPU, so layer-dependent waits get their own
   generous timeout rather than the 5 s default. */
const LAYER_TIMEOUT = 20000;

async function openMap(page) {
  await installMocks(page);
  await page.goto("/#/map");
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: LAYER_TIMEOUT });
}

async function chooseLayer(page, layer) {
  await page.locator(`.map-layer[data-map-layer="${layer}"]`).click();
  await expect(page.locator(`.map-layer[data-map-layer="${layer}"]`)).toHaveClass(/is-active/, {
    timeout: LAYER_TIMEOUT,
  });
}

const controls = (page) => page.locator("#mapWeatherControls");
const legend = (page) => page.locator("#mapWeatherControls .map-legend");

test.describe("weather layer legends", () => {
  test("satellite shows no legend and no timeline at all", async ({ page }) => {
    await openMap(page);
    await expect(controls(page)).toBeHidden();
    await expect(legend(page)).toHaveCount(0);
    await expect(page.locator(".map-time")).toHaveCount(0);
  });

  for (const layer of LAYERS) {
    test(`the ${layer} layer gets a gradient legend with real values and units`, async ({
      page,
    }) => {
      await openMap(page);
      await chooseLayer(page, layer);

      await expect(legend(page)).toBeVisible({ timeout: LAYER_TIMEOUT });
      await expect(legend(page)).toHaveAttribute("data-legend", layer);

      /* the gradient is applied from the layer's own colour ramp */
      const gradient = await legend(page)
        .locator(".map-legend-bar")
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(gradient).toContain("linear-gradient");
      expect(gradient.match(/rgba?\(/g).length).toBeGreaterThan(3);

      /* ticks are numeric and ordered low → high */
      const ticks = await legend(page).locator(".map-legend-ticks li").allTextContents();
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      const numbers = ticks.map(Number);
      numbers.forEach((n) => expect(Number.isFinite(n)).toBe(true));
      expect(numbers[numbers.length - 1]).toBeGreaterThan(numbers[0]);

      /* accessible: a labelled image for the bar, inside a titled figure */
      await expect(legend(page).locator(".map-legend-bar")).toHaveAttribute("role", "img");
      await expect(legend(page).locator(".map-legend-bar")).toHaveAttribute("aria-label", /\d/);
      await expect(legend(page).locator("figcaption")).not.toBeEmpty();
    });
  }

  test("each layer's legend states its own unit, and only one legend exists", async ({ page }) => {
    await openMap(page);
    const caption = legend(page).locator("figcaption");

    await chooseLayer(page, "temperature");
    await expect(caption).toContainText("°C");
    await chooseLayer(page, "rain");
    await expect(caption).toContainText("mm/h");
    await chooseLayer(page, "wind");
    await expect(caption).toContainText("km/h");
    await expect(legend(page)).toHaveCount(1);
  });

  test("changing units updates the legend immediately", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "temperature");
    const caption = legend(page).locator("figcaption");
    await expect(caption).toContainText("°C");
    const celsius = await legend(page).locator(".map-legend-ticks li").allTextContents();

    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator('#chipTemp button[data-ut="f"]').click();
    await page.locator('.side-item[data-view="map"]').click();

    await expect(caption).toContainText("°F");
    const fahrenheit = await legend(page).locator(".map-legend-ticks li").allTextContents();
    expect(fahrenheit).not.toEqual(celsius);
  });

  test("changing units updates the wind legend too", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "wind");
    await expect(legend(page).locator("figcaption")).toContainText("km/h");

    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator('#chipWind button[data-uw="mph"]').click();
    await page.locator('.side-item[data-view="map"]').click();

    await expect(legend(page).locator("figcaption")).toContainText("mph");
  });

  test("changing language translates the legend title and the timeline", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await expect(legend(page).locator("figcaption")).toContainText("Précipitations");
    await expect(page.locator('.map-time[data-map-time="0"]')).toHaveText("Maintenant");

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();

    await expect(legend(page).locator("figcaption")).toContainText("Precipitation");
    await expect(page.locator('.map-time[data-map-time="0"]')).toHaveText("Now");
    /* still exactly one legend and one timeline after the re-render */
    await expect(legend(page)).toHaveCount(1);
    await expect(page.locator(".map-time-row")).toHaveCount(1);
  });

  test("the legend never pushes the page sideways", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "temperature");
    await expect(legend(page)).toBeVisible();
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      box: (() => {
        const el = document.querySelector("#mapWeatherControls");
        return el.scrollWidth - el.clientWidth;
      })(),
    }));
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.box).toBeLessThanOrEqual(1);
  });
});

/* The 820px breakpoint is where the overlay controls leave the map surface and
   flow beneath it. Tablets sit on both sides of it depending on orientation,
   so both are checked. */
test.describe("tablet layout", () => {
  const overlaps = (a, b) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  test("landscape (above the breakpoint): controls float over the map, clear of the panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openMap(page);
    await chooseLayer(page, "temperature");
    await expect(legend(page)).toBeVisible({ timeout: LAYER_TIMEOUT });

    const map = await page.locator("#worldMap").boundingBox();
    const card = await page.locator("#mapCard").boundingBox();
    const box = await controls(page).boundingBox();
    const panel = await page.locator("#mapWeatherPanel").boundingBox();

    /* floating over the map surface, not stacked beneath it, and contained by
       the map card (it may sit a few px into the card's padding, the same way
       the "show details" button does) */
    expect(box.y).toBeGreaterThan(map.y);
    expect(box.y).toBeLessThan(map.y + map.height);
    expect(box.y + box.height).toBeLessThanOrEqual(card.y + card.height + 1);
    expect(overlaps(box, panel)).toBe(false); /* never covering the details panel */
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("portrait (below the breakpoint): controls flow beneath the map", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openMap(page);
    await chooseLayer(page, "rain");
    await expect(legend(page)).toBeVisible({ timeout: LAYER_TIMEOUT });

    const map = await page.locator("#worldMap").boundingBox();
    const box = await controls(page).boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(map.y + map.height - 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("forecast timeline", () => {
  test("offers Now, +3 h and +6 h as an accessible radio group", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "temperature");

    const row = page.locator(".map-time-row");
    await expect(row).toHaveAttribute("role", "radiogroup");
    await expect(row).toHaveAttribute("aria-label", /.+/);
    await expect(page.locator(".map-time")).toHaveCount(3);
    await expect(page.locator('.map-time[data-map-time="0"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("each button moves the layer to a later real time", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "temperature");
    const status = page.locator(".map-time-status");
    await expect(status).toContainText("Affichage");
    const atNow = await status.textContent();

    await page.locator('.map-time[data-map-time="3"]').click();
    await expect(page.locator('.map-time[data-map-time="3"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator('.map-time[data-map-time="0"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(status).not.toHaveText(atNow);
    const atPlus3 = await status.textContent();

    await page.locator('.map-time[data-map-time="6"]').click();
    await expect(status).not.toHaveText(atPlus3);
    await expect(status).toContainText(/\d/); /* a real localized date + clock */
  });

  test("keyboard: arrow keys move and select within the group", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "wind");

    await page.locator('.map-time[data-map-time="0"]').focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('.map-time[data-map-time="3"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator('.map-time[data-map-time="3"]')).toBeFocused();

    await page.keyboard.press("End");
    await expect(page.locator('.map-time[data-map-time="6"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.keyboard.press("Home");
    await expect(page.locator('.map-time[data-map-time="0"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("switching back to satellite removes the timeline and resets the time", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await page.locator('.map-time[data-map-time="6"]').click();
    await expect(page.locator('.map-time[data-map-time="6"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await chooseLayer(page, "satellite");
    await expect(controls(page)).toBeHidden();
    await expect(page.locator(".map-time")).toHaveCount(0);

    /* re-enabling a layer starts from "now", not from the forgotten +6 h */
    await chooseLayer(page, "rain");
    await expect(page.locator('.map-time[data-map-time="0"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("rapid layer and time switching resolves to the final choice", async ({ page }) => {
    await openMap(page);
    const click = (sel) => page.locator(sel).click({ force: true });

    await click('.map-layer[data-map-layer="temperature"]');
    await click('.map-layer[data-map-layer="rain"]');
    await click('.map-layer[data-map-layer="wind"]');
    await click('.map-layer[data-map-layer="temperature"]');

    await expect(page.locator('.map-layer[data-map-layer="temperature"]')).toHaveClass(
      /is-active/,
      { timeout: LAYER_TIMEOUT },
    );
    await expect(legend(page)).toHaveAttribute("data-legend", "temperature");
    /* exactly one layer button is active, and exactly one legend exists */
    await expect(page.locator(".map-layer.is-active")).toHaveCount(1);
    await expect(page.locator(".map-layer.is-loading")).toHaveCount(0);
    await expect(legend(page)).toHaveCount(1);

    await click('.map-time[data-map-time="3"]');
    await click('.map-time[data-map-time="6"]');
    await click('.map-time[data-map-time="3"]');
    await expect(page.locator('.map-time[aria-checked="true"]')).toHaveCount(1);
    await expect(page.locator('.map-time[data-map-time="3"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("no console errors while switching layers and times", async ({ page }) => {
    const errors = [];
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    page.on("pageerror", (error) => errors.push(String(error)));

    await openMap(page);
    for (const layer of LAYERS) {
      await chooseLayer(page, layer);
      await page.locator('.map-time[data-map-time="3"]').click();
    }
    await chooseLayer(page, "satellite");
    expect(errors).toEqual([]);
  });
});
