/* Click-to-select on the weather map.
 *
 * Coordinates are addressed by opening the map at a known centre through the
 * URL (`#/map?c=<lat>,<lon>&z=…`) and then clicking the middle of the map
 * element — that is the only way to hit a chosen lat/lon without reaching into
 * the map instance from the test. The reverse-geocoding mock recognises four
 * designated points (see e2e/mocks.js). */
import {
  test,
  expect,
  installMocks,
  CLICK_CITY,
  CLICK_OCEAN,
  CLICK_REGION_POLY,
  CLICK_REGION_BBOX,
  CLICK_COUNTY,
  CLICK_COUNTRY,
  CLICK_SEA_NAMED,
} from "./mocks.js";

/* These specs drive REAL MapLibre + @maptiler/weather layers: every test
   builds a WebGL context, fetches a tile pyramid and uploads textures, and
   several reload the page and do it twice.

   mode "default": the file runs its tests one after another in a single
   worker instead of fanning them out. Chromium caps how many live WebGL
   contexts it will keep, and dropping the oldest one mid-test is what made
   these flaky under full parallelism — files still run in parallel with each
   other, so the suite stays fast. The timeout matches the real work done. */
test.describe.configure({ mode: "default", timeout: 90_000 });

/* Creating the map pulls the SDK chunk in on demand, which under a parallel
   run is comfortably slower than the 5 s default assertion timeout. */
const MAP_TIMEOUT = 20000;

/* Open the map already centred on `point`, so the centre pixel IS that point.
 *
 * The wait for the camera to settle is a signal, not a sleep: the app rewrites
 * the hash from the map's OWN centre after moveend (debounced), and that write
 * percent-encodes the comma. So the appearance of `c=<lat>%2C` — as opposed to
 * the plain `c=<lat>,` this navigation put there — means the map has actually
 * arrived at the requested coordinate and reported it. */
async function openMapAt(page, point, { zoom = 10, lang } = {}) {
  await page.goto(`/#/map?c=${point.lat},${point.lon}&z=${zoom}`);
  if (lang) {
    await page.locator("#langBtn").click();
    await page.locator(`#langMenu button[data-lang="${lang}"]`).click();
  }
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
  await expect.poll(() => page.url(), { timeout: MAP_TIMEOUT }).toContain(`c=${point.lat}%2C`);
  return page.locator("#worldMap");
}

/* page.mouse works in viewport coordinates, so the map has to be on screen
   before its centre means anything. */
async function clickMapCentre(page, offset = { x: 0, y: 0 }) {
  const map = page.locator("#worldMap");
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width / 2 + offset.x, box.y + box.height / 2 + offset.y);
}

const panelName = (page) => page.locator("#mapWeatherPanel .map-panel-location h2");

test.describe("clicking the map selects a location", () => {
  test("a click resolves the place, its region, country and weather", async ({ page }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_CITY);
    await clickMapCentre(page);

    await expect(panelName(page)).toHaveText("Tarbes");
    const panel = page.locator("#mapWeatherPanel");
    /* country + region chips, from the geo-identity box */
    await expect(panel.locator(".geo-chip")).toHaveCount(2);
    await expect(panel.locator(".geo-chip")).toContainText(["France", "Occitanie"]);
    /* the full weather set the panel is specified to show */
    await expect(panel.locator(".map-panel-current strong")).not.toBeEmpty();
    await expect(panel.locator(".map-panel-stats > div")).toHaveCount(4);
    await expect(panel.locator(".map-hour")).toHaveCount(4);
    await expect(panel.locator("#mapForecastBtn")).toBeVisible();
    /* and a country flag in the identity chip */
    await expect(panel.locator(".geo-chip .geo-chip-flag").first()).toBeVisible();
  });

  test("the marker moves to the clicked point before the weather arrives", async ({ page }) => {
    await installMocks(page, { reverseDelayMs: () => 700 });
    await openMapAt(page, CLICK_CITY);

    const before = await page.locator("#worldMap .maplibregl-marker").boundingBox();
    await clickMapCentre(page, { x: 90, y: -60 });

    /* loading state is up immediately, and the pin has already moved */
    await expect(page.locator("#mapWeatherPanel .map-panel-loading")).toBeVisible();
    const during = await page.locator("#worldMap .maplibregl-marker").boundingBox();
    expect(Math.abs(during.x - before.x) + Math.abs(during.y - before.y)).toBeGreaterThan(20);

    await expect(page.locator("#mapWeatherPanel .map-panel-loading")).toHaveCount(0);
    await expect(panelName(page)).not.toBeEmpty();
  });

  test("rapid clicks always end on the last one, even when it answers first", async ({ page }) => {
    /* the first click's lookup is deliberately the slow one */
    await installMocks(page, {
      reverseDelayMs: (lon) => (lon < -20 ? 900 : 0),
    });
    await openMapAt(page, CLICK_OCEAN, { zoom: 4 });

    await clickMapCentre(page); /* ocean — slow */
    await openMapAt(page, CLICK_CITY);
    await clickMapCentre(page); /* Tarbes — fast */

    await expect(panelName(page)).toHaveText("Tarbes");
    /* give the superseded ocean lookup time to land, and confirm it does not */
    await page.waitForTimeout(1200);
    await expect(panelName(page)).toHaveText("Tarbes");
  });

  test("open ocean names the actual ocean, never a nearby city or raw coordinates", async ({
    page,
  }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_OCEAN, { zoom: 5 });
    await clickMapCentre(page);

    /* CLICK_OCEAN (33.2, -41.5) — mid North Atlantic; the reverse-geocoding
       mock returns no feature there, so core/marine-regions.js identifies
       the ocean from the coordinate itself (default app language: French) */
    await expect(panelName(page)).toHaveText("Océan Atlantique");
    await expect(panelName(page)).not.toHaveText(CLICK_CITY.label);
    await expect(panelName(page)).not.toHaveText(/^-?\d+\.\d+°, -?\d+\.\d+°$/);
    /* the panel subtitle follows the new "ocean" kind, never the old default
       ("Ville" / City) a coordinate with no resolved kind used to fall back to */
    await expect(page.locator("#mapWeatherPanel .map-panel-location p")).toHaveText("Océan / Mer");
    /* weather still loads for the point */
    await expect(page.locator("#mapWeatherPanel .map-panel-current strong")).not.toBeEmpty();
  });

  /* The other half of the ocean case. CLICK_OCEAN returns no feature, so the
     coordinate alone identifies the water. Here the provider DOES answer —
     with a generic "place" carrying an Italian country context — which used
     to make a sea click inherit kind "city": the panel said "Ville", an
     Italian flag appeared beside it, and the photo pipeline went looking for
     a cityscape. */
  test("a sea the geocoder names is still a sea, not a city", async ({ page }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_SEA_NAMED, { zoom: 5 });
    await clickMapCentre(page);

    await expect(panelName(page)).toHaveText("Mer Méditerranée");
    const subtitle = page.locator("#mapWeatherPanel .map-panel-location p");
    await expect(subtitle).toHaveText("Océan / Mer");
    await expect(subtitle).not.toHaveText("Ville");
    /* no country owns a sea, so the territorial-waters flag must not show */
    await expect(page.locator("#mapWeatherPanel .location-flags")).toHaveCount(0);
    /* the weather for the point still loads */
    await expect(page.locator("#mapWeatherPanel .map-panel-current strong")).not.toBeEmpty();
  });

  test("dragging the map pans it and selects nothing", async ({ page }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_CITY);
    await clickMapCentre(page);
    await expect(panelName(page)).toHaveText("Tarbes");

    const box = await page.locator("#worldMap").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 - 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    await expect(page.locator("#mapWeatherPanel .map-panel-loading")).toHaveCount(0);
    await expect(panelName(page)).toHaveText("Tarbes"); /* unchanged by the drag */
  });

  test("map controls and the details panel are not map clicks", async ({ page }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_CITY);
    await clickMapCentre(page);
    await expect(panelName(page)).toHaveText("Tarbes");

    await page.locator("#worldMap .maplibregl-ctrl-zoom-in").click();
    await page.locator("#mapWeatherPanel .map-panel-current").click();
    await page.locator(".map-layer[data-map-layer='satellite']").click();
    await page.waitForTimeout(500);

    await expect(page.locator("#mapWeatherPanel .map-panel-loading")).toHaveCount(0);
    await expect(panelName(page)).toHaveText("Tarbes");
  });

  /* Which of a bbox / a polygon may be DRAWN is decided by core/selection-area.js
     and asserted exhaustively in its unit test. What is observable from here is
     the other half of the rule: an administrative area is FRAMED by its bbox,
     while an ordinary place leaves the camera where the user aimed it. */
  test("clicking an administrative area frames its full extent", async ({ page }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_REGION_BBOX, { zoom: 11 });
    const before = new URL(page.url()).hash;
    await clickMapCentre(page);

    await expect(panelName(page)).toHaveText("Texas");
    /* Texas' bbox is ~13° wide, so framing it must zoom well out of z11 */
    await expect
      .poll(() => Number(new URLSearchParams(page.url().split("?")[1]).get("z")), { timeout: 8000 })
      .toBeLessThan(8);
    expect(before).toContain("z=11");
  });

  test("clicking an ordinary place leaves the camera where the user aimed it", async ({ page }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_CITY, { zoom: 11 });
    await clickMapCentre(page, { x: 60, y: 40 });
    await expect(panelName(page)).toHaveText("Tarbes");
    await page.waitForTimeout(900);
    expect(page.url()).toContain("z=11");
  });

  /* Regression test for a real bug: MapTiler's "county" place_type (also
     "subregion" / "municipal_district") is bucketed onto the SAME internal
     kind ("region") as a province searched directly, so the panel used to
     assume a county selection WAS the subdivision and suppressed its parent
     province entirely — Camrose showed only the Canadian flag, never
     Alberta's. See core/geo-identity.js and core/geo-identity.test.js for
     the unit-level fix and coverage; this proves it end to end. */
  test("a Canadian county selection shows its parent province's flag (Camrose → Alberta)", async ({
    page,
  }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_COUNTY, { zoom: 7 });
    await clickMapCentre(page);

    await expect(panelName(page)).toHaveText("Camrose");
    const panel = page.locator("#mapWeatherPanel");
    /* country (Canada) + region (Alberta) chips, not just the country */
    await expect(panel.locator(".geo-chip")).toHaveCount(2);
    await expect(panel.locator(".geo-chip")).toContainText(["Canada", "Alberta"]);
    /* the Alberta chip carries the real province flag asset, not the
       neutral fallback icon a county used to get */
    await expect(panel.locator(".geo-chip-icon")).toHaveCount(0);
    const albertaFlag = panel.locator(".geo-chip .geo-chip-flag").last();
    await expect(albertaFlag).toBeVisible();
    await expect(albertaFlag).toHaveAttribute("src", /alberta\.svg/);
  });

  test("a direct country selection shows its own flag (Poland)", async ({ page }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_COUNTRY, { zoom: 5 });
    await clickMapCentre(page);

    await expect(panelName(page)).toHaveText("Pologne");
    const titleFlag = page.locator("#mapWeatherPanel h2 .location-flag-wrap img");
    await expect(titleFlag).toBeVisible();
    await expect(titleFlag).toHaveAttribute("src", /countries\/pl\.svg/);
  });

  /* The provider is asked for `language=fr,en`, so a feature carries both
     text_fr and text_en; switching language must swap the displayed name
     without re-fetching or losing the selection. */
  test("a region's name follows the interface language", async ({ page }) => {
    await installMocks(page);
    await openMapAt(page, CLICK_REGION_POLY, { zoom: 7 });
    await clickMapCentre(page);
    await expect(panelName(page)).toHaveText("Occitanie"); /* text_fr — app starts in French */

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(panelName(page)).toHaveText("Occitania"); /* text_en */

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="fr"]').click();
    await expect(panelName(page)).toHaveText("Occitanie"); /* and back, still selected */
  });
});
