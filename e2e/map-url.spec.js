/* Shareable, bookmarkable map state: reload restores it, Back/Forward work,
 * invalid values fall back safely, and a device-geolocation coordinate is
 * never written to the URL without an explicit share. */
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

const MAP_TIMEOUT = 20000;
/* Restoring a weather layer from history is a full rebuild: map readiness,
   the weather manifest, a tile pyramid and a GPU upload. The module itself
   allows up to 12 s for the data source alone (WEATHER_SOURCE_TIMEOUT_MS), so
   the assertion has to allow more than that plus contention. */
const LAYER_TIMEOUT = 35000;
/* A history step re-selects a coordinate: reverse geocode + weather + render. */
const SETTLE = 20000;

const params = (page) => new URLSearchParams((page.url().split("?")[1] || "").split("#")[0]);
const panelName = (page) => page.locator("#mapWeatherPanel .map-panel-location h2");

async function open(page, hash = "/#/map") {
  await installMocks(page);
  await page.goto(hash);
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
  /* When the link carries a camera, wait for the map to report that camera
     back into the hash (the app's write percent-encodes the comma, this
     navigation's does not) — a precise settle signal rather than a sleep. */
  const centre = /[?&]c=(-?\d+(?:\.\d+)?),/.exec(hash);
  if (centre) {
    await expect.poll(() => page.url(), { timeout: MAP_TIMEOUT }).toContain(`c=${centre[1]}%2C`);
  }
}

async function clickMapCentre(page, offset = { x: 0, y: 0 }) {
  await page.locator("#worldMap").scrollIntoViewIfNeeded();
  const box = await page.locator("#worldMap").boundingBox();
  await page.mouse.click(box.x + box.width / 2 + offset.x, box.y + box.height / 2 + offset.y);
}

test.describe("shareable map state", () => {
  test("the URL records view, selection, camera, layer, time and panel", async ({ page }) => {
    await open(page);
    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveClass(/is-active/, {
      timeout: LAYER_TIMEOUT,
    });
    await page.locator('.map-time[data-map-time="6"]').click();
    await expect(page.locator('.map-time[data-map-time="6"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await expect.poll(() => params(page).get("layer")).toBe("rain");
    const p = params(page);
    expect(page.url()).toContain("#/map");
    expect(p.get("t")).toBe("6");
    expect(p.get("sel")).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    expect(p.get("panel")).toBe("1");
    await expect.poll(() => params(page).get("z")).not.toBeNull();
    expect(params(page).get("c")).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  });

  test("no API key or private value is ever put in the URL", async ({ page }) => {
    await open(page);
    await page.locator('.map-layer[data-map-layer="wind"]').click();
    await expect(page.locator('.map-layer[data-map-layer="wind"]')).toHaveClass(/is-active/, {
      timeout: LAYER_TIMEOUT,
    });
    const url = page.url();
    expect(url).not.toContain("e2e-placeholder-key");
    expect(url.toLowerCase()).not.toContain("key=");
    expect(url.toLowerCase()).not.toContain("token");
    expect(url.toLowerCase()).not.toContain("mtsid");
    /* only the documented parameters */
    for (const name of [...params(page).keys()]) {
      expect(["sel", "c", "z", "layer", "t", "panel"]).toContain(name);
    }
  });

  test("reloading restores the same map state", async ({ page }) => {
    await open(page);
    await page.locator('.map-layer[data-map-layer="temperature"]').click();
    await expect(page.locator('.map-layer[data-map-layer="temperature"]')).toHaveClass(
      /is-active/,
      { timeout: LAYER_TIMEOUT },
    );
    await page.locator('.map-time[data-map-time="3"]').click();
    await expect.poll(() => params(page).get("t")).toBe("3");
    const before = page.url();

    await page.reload();
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });

    await expect(page.locator("#view-map")).toBeVisible();
    await expect(page.locator('.map-layer[data-map-layer="temperature"]')).toHaveClass(
      /is-active/,
      { timeout: LAYER_TIMEOUT },
    );
    await expect(page.locator('.map-time[data-map-time="3"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect.poll(() => params(page).get("layer")).toBe("temperature");
    expect(params(page).get("sel")).toBe(new URLSearchParams(before.split("?")[1]).get("sel"));
  });

  test("a shared link opens on the shared place, not the previous session's", async ({ page }) => {
    await open(page);
    await clickMapCentre(page); /* remembers something in ws_lastLoc */
    await expect(panelName(page)).not.toBeEmpty();

    await page.goto(
      `/#/map?sel=${CLICK_CITY.lat},${CLICK_CITY.lon}&c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=9`,
    );
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
    await expect(panelName(page)).toHaveText("Tarbes");
  });

  test("Back and Forward move between selections", async ({ page }) => {
    /* zoom 6 so a 200 px offset is several degrees away — far enough to be a
       genuinely different place rather than the same one clicked twice */
    await open(page, `/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=6`);
    await clickMapCentre(page);
    await expect(panelName(page)).toHaveText("Tarbes", { timeout: SETTLE });

    /* left/up: the details panel occupies the map's top-right quadrant */
    await clickMapCentre(page, { x: -200, y: -130 });
    await expect(panelName(page)).toHaveText(/Zone/, { timeout: SETTLE });
    const second = await panelName(page).innerText();

    await page.goBack();
    await expect(panelName(page)).toHaveText("Tarbes", { timeout: SETTLE });
    await page.goForward();
    await expect(panelName(page)).toHaveText(second, { timeout: SETTLE });
  });

  test("Back returns to the previous weather layer", async ({ page }) => {
    await open(page);
    await page.locator('.map-layer[data-map-layer="rain"]').click();
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveClass(/is-active/, {
      timeout: LAYER_TIMEOUT,
    });
    await page.locator('.map-layer[data-map-layer="wind"]').click();
    await expect(page.locator('.map-layer[data-map-layer="wind"]')).toHaveClass(/is-active/, {
      timeout: LAYER_TIMEOUT,
    });

    await page.goBack();
    await expect(page.locator('.map-layer[data-map-layer="rain"]')).toHaveClass(/is-active/, {
      timeout: LAYER_TIMEOUT,
    });
    await expect(page.locator(".map-layer.is-active")).toHaveCount(1);
  });

  test("panning does not flood the history", async ({ page }) => {
    await open(page, `/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=8`);
    const depthBefore = await page.evaluate(() => history.length);

    const box = await page.locator("#worldMap").boundingBox();
    for (const dx of [-120, 100, -80, 140, -60]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(900); /* past the debounce */

    const depthAfter = await page.evaluate(() => history.length);
    expect(depthAfter).toBe(depthBefore); /* replaceState only */
    /* …and the camera really did end up in the URL */
    expect(params(page).get("c")).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  });

  test("view changes are recorded and Back returns to the map", async ({ page }) => {
    await open(page);
    await page.locator('.side-item[data-view="favorites"]').click();
    await expect.poll(() => page.url()).toContain("#/favorites");
    await page.goBack();
    await expect(page.locator("#view-map")).toBeVisible();
  });

  test.describe("invalid URL state falls back safely", () => {
    const cases = [
      ["#/map?z=9999", "absurd zoom"],
      ["#/map?sel=notacoord", "unparseable selection"],
      ["#/map?sel=91,400", "out-of-range coordinate"],
      ["#/map?layer=radioactivity&t=99", "unknown layer and offset"],
      ["#/map?panel=maybe", "non-boolean panel"],
      ["#/nowhere?layer=rain", "unknown view"],
      ["#///??&&==", "not a query string at all"],
    ];

    for (const [hash, label] of cases) {
      test(label, async ({ page }) => {
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await installMocks(page);
        await page.goto(`/${hash}`);

        /* the app still boots with a working location and no crash */
        await expect(page.locator("#heroCityName")).not.toBeEmpty();
        expect(errors).toEqual([]);

        const p = params(page);
        if (p.get("z")) expect(Number(p.get("z"))).toBeLessThanOrEqual(20);
        expect(["rain", "wind", "temperature", null]).toContain(p.get("layer"));
        expect(["0", "3", "6", null]).toContain(p.get("t"));
        expect(["0", "1", null]).toContain(p.get("panel"));
      });
    }
  });

  test("a device-geolocation fix is never written to the URL by itself", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 48.8566, longitude: 2.3522 });
    await open(page);

    await page.locator("#sidePosBtn").click();
    await expect(page.locator("#sidePosName")).not.toBeEmpty();
    /* tapping the card selects "my location" as the current place */
    await page.locator("#sidePosBtn").click();
    await page.waitForTimeout(1500);

    const p = params(page);
    expect(p.get("sel")).toBeNull();
    expect(p.get("c")).toBeNull();
    expect(page.url()).not.toContain("48.85");
  });

  test("Share is the explicit action that publishes the current view", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, `/#/map?c=${CLICK_CITY.lat},${CLICK_CITY.lon}&z=10`);
    await clickMapCentre(page);
    await expect(panelName(page)).toHaveText("Tarbes");

    await page.locator("#mapShareBtn").click();
    await expect(page.locator("#toast")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("#/map");
    expect(copied).toContain("sel=");
    expect(copied).toBe(page.url());
  });
});
