/* Recent locations: opt-in, capped at five, deduplicated, clearable with an
 * Undo, and never holding a device-geolocation fix. */
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
const RECENTS_KEY = "ws_recents";
const OPT_IN_KEY = "ws_recents_on";

const recents = (page) => page.locator("#mapRecents");
const rows = (page) => page.locator("#mapRecents .map-recent");

async function openMap(page, { at, zoom = 10 } = {}) {
  await installMocks(page);
  await page.goto(at ? `/#/map?c=${at.lat},${at.lon}&z=${zoom}` : "/#/map");
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
  /* the app re-writes the camera into the hash (percent-encoding the comma)
     once the map has actually arrived there — a settle signal, not a sleep */
  if (at) await expect.poll(() => page.url(), { timeout: MAP_TIMEOUT }).toContain(`c=${at.lat}%2C`);
}

async function enableRecents(page) {
  await page.locator('.side-item[data-view="settings"]').click();
  await page.locator(".switch[data-recents]").click();
  await expect(page.locator(".switch[data-recents]")).toHaveAttribute("aria-checked", "true");
  await page.locator('.side-item[data-view="map"]').click();
}

/* page.mouse works in viewport coordinates, and clicking a card below the map
   scrolls the page — so the map has to be brought back into view before its
   centre means anything. */
async function clickMapCentre(page, offset = { x: 0, y: 0 }) {
  await page.locator("#worldMap").scrollIntoViewIfNeeded();
  const box = await page.locator("#worldMap").boundingBox();
  await page.mouse.click(box.x + box.width / 2 + offset.x, box.y + box.height / 2 + offset.y);
}

const stored = (page) => page.evaluate((k) => localStorage.getItem(k), RECENTS_KEY);

test.describe("recent locations", () => {
  test("are off by default and record nothing", async ({ page }) => {
    await openMap(page);
    await expect(page.locator(".switch[data-recents]")).toHaveCount(1);

    /* the map page shows the disabled state, with a route into settings */
    await expect(recents(page).locator('[data-state="disabled"]')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    await page.locator("#mapPopular .map-popular-place").first().click();
    await page.waitForTimeout(400);
    expect(await stored(page)).toBeNull(); /* nothing written at all */
    expect(await page.evaluate((k) => localStorage.getItem(k), OPT_IN_KEY)).toBeNull();
  });

  test("the disabled state links to the setting that turns them on", async ({ page }) => {
    await openMap(page);
    await recents(page).locator("#mapRecentsSettings").click();
    await expect(page.locator("#view-settings")).toBeVisible();
    await expect(page.locator(".switch[data-recents]")).toBeVisible();
  });

  test("once enabled, a search, a map click and a popular card all record", async ({ page }) => {
    await openMap(page, { at: CLICK_CITY });
    await enableRecents(page);
    await expect(recents(page).locator('[data-state="empty"]')).toBeVisible();

    /* 1. popular-location card */
    await page.locator("#mapPopular .map-popular-place").first().click();
    await expect(rows(page)).toHaveCount(1);

    /* 2. search */
    await page.locator("#searchInput").fill("Austin");
    await page.locator("#searchResults .search-item").first().click();
    await page.locator('.side-item[data-view="map"]').click();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toContainText("Austin");

    /* 3. map click */
    await openMap(page, { at: CLICK_CITY });
    await clickMapCentre(page);
    await expect(rows(page).first()).toContainText("Tarbes");
    await expect(rows(page)).toHaveCount(3);
  });

  test("stores only the minimum — never a weather response", async ({ page }) => {
    await openMap(page);
    await enableRecents(page);
    await page.locator("#mapPopular .map-popular-place").first().click();
    await expect(rows(page)).toHaveCount(1);

    const entry = JSON.parse(await stored(page))[0];
    expect(Object.keys(entry).sort()).toEqual(
      ["cc", "country", "id", "kind", "lat", "lon", "name", "region", "regionCode"].sort(),
    );
    const raw = await stored(page);
    for (const forbidden of ["temp", "humidity", "wind", "hourly", "daily", "updatedAt"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  test("deduplicates and keeps the newest first", async ({ page }) => {
    await openMap(page);
    await enableRecents(page);
    const cards = page.locator("#mapPopular .map-popular-place");

    await cards.nth(0).click();
    await expect(rows(page)).toHaveCount(1);
    await cards.nth(1).click();
    await expect(rows(page)).toHaveCount(2);
    const secondName = await rows(page).first().innerText();

    await cards.nth(0).click(); /* the same place again */
    await expect(rows(page)).toHaveCount(2); /* not three */
    await expect(rows(page).first()).not.toHaveText(secondName); /* moved to the top */
  });

  test("keeps at most five, dropping the oldest", async ({ page }) => {
    await openMap(page);
    await enableRecents(page);
    const cards = page.locator("#mapPopular .map-popular-place");
    const count = await cards.count();
    for (let i = 0; i < count; i++) await cards.nth(i).click();
    await expect(rows(page)).toHaveCount(5);

    const oldest = JSON.parse(await stored(page)).at(-1).id;

    /* A sixth place, from a different source. Offset down-left on purpose: the
       last selection's marker sits at the map centre (and a click on the
       marker is not a map selection), while the details panel occupies the
       top-right. Wherever this lands, the reverse-geocoding mock names it
       after its own coordinate, so it is always a place the list has not seen. */
    await clickMapCentre(page, { x: -220, y: 150 });
    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).toHaveText(/Zone|°/);

    await expect(rows(page)).toHaveCount(5); /* still five, not six */
    const after = JSON.parse(await stored(page));
    expect(after).toHaveLength(5);
    expect(after.map((entry) => entry.id)).not.toContain(oldest);
  });

  test("selecting an entry restores the location and its weather", async ({ page }) => {
    await openMap(page);
    await enableRecents(page);
    await page.locator("#mapPopular .map-popular-place").first().click();
    await page.locator("#mapPopular .map-popular-place").nth(2).click();
    await expect(rows(page)).toHaveCount(2);

    const target = rows(page).nth(1);
    const name = (await target.locator(".map-recent-text b").innerText()).trim();
    await target.click();

    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).toHaveText(name);
    await expect(page.locator("#mapWeatherPanel .map-panel-current strong")).not.toBeEmpty();
  });

  test("clearing asks first, then offers Undo", async ({ page }) => {
    await openMap(page);
    await enableRecents(page);
    await page.locator("#mapPopular .map-popular-place").first().click();
    await page.locator("#mapPopular .map-popular-place").nth(1).click();
    await expect(rows(page)).toHaveCount(2);

    /* cancelling changes nothing */
    await recents(page).locator("#mapRecentsClear").click();
    await expect(page.locator("#confirmDialog")).toBeVisible();
    await page.locator("#confirmDialogCancel").click();
    await expect(rows(page)).toHaveCount(2);

    /* confirming clears, and the toast offers Undo */
    await recents(page).locator("#mapRecentsClear").click();
    await page.locator("#confirmDialogConfirm").click();
    await expect(rows(page)).toHaveCount(0);
    await expect(recents(page).locator('[data-state="empty"]')).toBeVisible();
    expect(JSON.parse(await stored(page))).toEqual([]);

    const toast = page.locator("#toast");
    await expect(toast).toBeVisible();
    await toast.locator(".toast-action").click();
    await expect(rows(page)).toHaveCount(2);
    expect(JSON.parse(await stored(page))).toHaveLength(2);
  });

  test("the Settings privacy tile clears the same list, with the same dialog", async ({ page }) => {
    await openMap(page);
    await enableRecents(page);
    await page.locator("#mapPopular .map-popular-place").first().click();
    await expect(rows(page)).toHaveCount(1);

    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator('.priv-tile[data-priv="recents"]').click();
    await page.locator("#confirmDialogConfirm").click();

    await page.locator('.side-item[data-view="map"]').click();
    await expect(rows(page)).toHaveCount(0);
  });

  test("turning the setting off stops new recordings but keeps the list intact", async ({
    page,
  }) => {
    await openMap(page);
    await enableRecents(page);
    await page.locator("#mapPopular .map-popular-place").first().click();
    await expect(rows(page)).toHaveCount(1);

    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator(".switch[data-recents]").click();
    await expect(page.locator(".switch[data-recents]")).toHaveAttribute("aria-checked", "false");
    await page.locator('.side-item[data-view="map"]').click();
    await expect(recents(page).locator('[data-state="disabled"]')).toBeVisible();

    await page.locator("#mapPopular .map-popular-place").nth(1).click();
    await page.waitForTimeout(300);
    expect(JSON.parse(await stored(page))).toHaveLength(1); /* unchanged */
  });

  test("a device-geolocation fix is never recorded", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 48.8566, longitude: 2.3522 });
    await openMap(page);
    await enableRecents(page);

    await page.locator("#sidePosBtn").click();
    await expect(page.locator("#sidePosName")).not.toBeEmpty();
    await page.waitForTimeout(1200);

    const raw = (await stored(page)) || "[]";
    expect(raw).not.toContain("geo-me-");
    expect(JSON.parse(raw)).toEqual([]);
  });

  test("entries survive a reload and follow the interface language", async ({ page }) => {
    await openMap(page, { at: CLICK_CITY });
    await enableRecents(page);
    await clickMapCentre(page);
    await expect(rows(page).first()).toContainText("Tarbes");

    await page.reload();
    await page.locator('.side-item[data-view="map"]').click();
    await expect(rows(page).first()).toContainText("Tarbes");

    /* the stored entry carries both languages, so switching relabels it */
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(recents(page).locator(".info-title")).toHaveText("Recent locations");
    await expect(rows(page).first()).toContainText("Occitania");
  });

  test("the list is keyboard reachable and each row is announced", async ({ page }) => {
    await openMap(page);
    await enableRecents(page);
    await page.locator("#mapPopular .map-popular-place").first().click();
    await expect(rows(page)).toHaveCount(1);

    const row = rows(page).first();
    await expect(row).toHaveAttribute("aria-label", /.+,.+/);
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).not.toBeEmpty();
  });
});
