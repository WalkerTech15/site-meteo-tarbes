/* Phone layout for the new map furniture: the legend and forecast-time
 * controls must not sit on top of the marker, the map controls or the weather
 * panel, and nothing may push the page sideways. Runs on the Pixel 5 profile
 * (see playwright.config.js). */
import { test, expect, installMocks, CLICK_CITY } from "./mocks.js";

/* These specs drive REAL MapLibre + @maptiler/weather layers: every test
   builds a WebGL context, fetches a tile pyramid and uploads textures, and
   several reload the page and do it twice.

   mode "default": the file runs its tests one after another in a single
   worker instead of fanning them out. Chromium caps how many live WebGL
   contexts it will keep, and dropping the oldest one mid-test is what made
   these flaky under full parallelism — files still run in parallel with each
   other, so the suite stays fast. The timeout matches the real work done. */
test.describe.configure({ mode: "default", timeout: 90_000 });

const MAP_TIMEOUT = 25000;

const controls = (page) => page.locator("#mapWeatherControls");
const legend = (page) => page.locator("#mapWeatherControls .map-legend");

async function openMap(page, hash = "/#/map") {
  await installMocks(page);
  await page.goto(hash);
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
}

async function chooseLayer(page, layer) {
  const button = page.locator(`.map-layer[data-map-layer="${layer}"]`);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(button).toHaveClass(/is-active/, { timeout: MAP_TIMEOUT });
}

const docOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("map overlay controls on a phone", () => {
  test("the legend and timeline sit below the map, clear of it", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "temperature");
    await expect(legend(page)).toBeVisible({ timeout: MAP_TIMEOUT });

    const mapBox = await page.locator("#worldMap").boundingBox();
    const controlsBox = await controls(page).boundingBox();
    const panelBox = await page.locator("#mapWeatherPanel").boundingBox();

    /* below the map, above the details panel — never covering either */
    expect(controlsBox.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height - 1);
    expect(panelBox.y).toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height - 1);
    expect(await docOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("the timeline buttons are touch-sized and fit one row", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "wind");

    const buttons = page.locator(".map-time");
    await expect(buttons).toHaveCount(3);
    const boxes = await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    boxes.forEach((box) => expect(box.height).toBeGreaterThanOrEqual(40));
    /* all three on the same row */
    expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1);
    expect(await docOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("the legend bar and its labels stay inside the card", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "rain");
    await expect(legend(page)).toBeVisible({ timeout: MAP_TIMEOUT });

    const overflow = await page.evaluate(() => {
      const host = document.querySelector("#mapWeatherControls");
      const hostBox = host.getBoundingClientRect();
      const ticks = [...host.querySelectorAll(".map-legend-ticks li")];
      return {
        host: host.scrollWidth - host.clientWidth,
        left: Math.min(...ticks.map((li) => li.getBoundingClientRect().left)) - hostBox.left,
        right: hostBox.right - Math.max(...ticks.map((li) => li.getBoundingClientRect().right)),
      };
    });
    expect(overflow.host).toBeLessThanOrEqual(1);
    expect(overflow.left).toBeGreaterThanOrEqual(-1); /* first label not clipped left */
    expect(overflow.right).toBeGreaterThanOrEqual(-1); /* last label not clipped right */
    expect(await docOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("tapping the map selects a place without horizontal overflow", async ({ page }) => {
    await openMap(page, `/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=10`);
    await expect
      .poll(() => page.url(), { timeout: MAP_TIMEOUT })
      .toContain(`c=${CLICK_CITY.lat}%2C`);
    const map = page.locator("#worldMap");
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).toHaveText("Tarbes");
    expect(await docOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("recent locations stack in one readable column", async ({ page }) => {
    await openMap(page);
    /* at this width the sidebar is an off-canvas drawer */
    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator(".switch[data-recents]").scrollIntoViewIfNeeded();
    await page.locator(".switch[data-recents]").click();
    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="map"]').click();

    const card = page.locator("#mapPopular .map-popular-place").first();
    await card.scrollIntoViewIfNeeded();
    await card.click();

    const rows = page.locator("#mapRecents .map-recent");
    await expect(rows).toHaveCount(1);
    const rowBox = await rows.first().boundingBox();
    const cardBox = await page.locator("#mapRecents").boundingBox();
    expect(rowBox.width).toBeLessThanOrEqual(cardBox.width + 1);
    expect(rowBox.height).toBeGreaterThanOrEqual(44); /* touch target */
    expect(await docOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("dark theme keeps the legend and timeline readable", async ({ page }) => {
    await openMap(page);
    await chooseLayer(page, "temperature");
    await expect(legend(page)).toBeVisible({ timeout: MAP_TIMEOUT });

    await page.locator("#themeBtn").click();
    await page.locator('#themeMenu [data-theme="dark"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");

    /* the block genuinely repaints for the dark palette rather than staying
       a white card on a dark page */
    const background = await controls(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = background.match(/\d+/g).map(Number);
    expect((r + g + b) / 3).toBeLessThan(120);
    await expect(legend(page).locator(".map-legend-bar")).toBeVisible();
  });
});
