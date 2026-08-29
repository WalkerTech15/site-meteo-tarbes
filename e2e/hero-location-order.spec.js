/* Home hero location display:
 *   1. Country flag + country name always come before the region/state/
 *      province flag + name (never the reverse) — see core/location.js
 *      (locCountryFlagHtml/locRegionFlagHtml) and ui/render-home.js's
 *      renderHero().
 *   2. An ocean/sea, or a coordinate the geocoder could not name at all,
 *      has no country: it must show the "Ocean / Sea" kind (never "City")
 *      and no flag at all (never the old "?" placeholder). */
import { test, expect, installMocks, CLICK_OCEAN } from "./mocks.js";

const MAP_TIMEOUT = 20000;

async function selectByExploreCard(app, dataLoc) {
  await app.locator(`.explore-card[data-loc="${dataLoc}"] .explore-open`).click();
  await expect(app.locator("#heroCityName")).not.toBeEmpty();
}

async function selectBySearch(app, query) {
  /* Below the 520px search-bar breakpoint (styles/utilities/responsive.css)
     #searchInput is display:none and a tap on #mobileSearchBtn opens it as
     a full-width overlay instead — see features/search.js's
     openMobileSearch(). Wider layouts show the input directly, so the
     button stays hidden and this is a no-op. */
  const mobileBtn = app.locator("#mobileSearchBtn");
  if (await mobileBtn.isVisible()) await mobileBtn.click();
  await app.locator("#searchInput").fill(query);
  await app.locator("#searchResults .search-item").first().click();
  await expect(app.locator("#heroCityName")).not.toBeEmpty();
}

async function setLang(app, lang) {
  await app.locator("#langBtn").click();
  await app.locator(`#langMenu button[data-lang="${lang}"]`).click();
}

const heroRegionFlags = (app) => app.locator(".hero-region .location-flag-wrap");

/* Opens the map centred on `point`, clicks its middle pixel, waits for the
   panel to resolve, then switches to the Home view so the hero (rebuilt by
   every selectLocation() call regardless of which view is showing) can be
   inspected. Mirrors e2e/map-click.spec.js's own openMapAt/clickMapCentre. */
async function selectByMapClick(page, point) {
  await page.goto(`/#/map?c=${point.lat},${point.lon}&z=6`);
  await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
  await expect.poll(() => page.url(), { timeout: MAP_TIMEOUT }).toContain(`c=${point.lat}%2C`);
  const map = page.locator("#worldMap");
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).not.toBeEmpty();
  await page.locator('.side-item[data-view="home"]').click();
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

test.describe("home hero: country appears before region", () => {
  test("a normal (non-US/CA) city shows only its own country, with the country flag", async ({
    app,
  }) => {
    await selectByExploreCard(app, "paris"); // Paris, France
    await expect(app.locator("#heroCityName")).toContainText("Paris");
    await expect(app.locator(".hero-region")).toContainText("France");
    await expect(heroRegionFlags(app)).toHaveCount(1);
  });

  test("a U.S. city with a state: country flag+name first, then the state flag+name", async ({
    app,
  }) => {
    await setLang(app, "en"); // default app language is French — see e2e/mocks.js
    await selectBySearch(app, "Paris, Texas");
    await expect(app.locator("#heroCityName")).toContainText("Paris");
    const text = await app.locator(".hero-region").innerText();
    expect(text.indexOf("United States")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Texas")).toBeGreaterThan(text.indexOf("United States"));
    /* country flag (US) first in the DOM, state flag (Texas) second */
    await expect(heroRegionFlags(app)).toHaveCount(2);
  });

  test("a Canadian city with a province: country flag+name first, then the province flag+name", async ({
    app,
  }) => {
    await selectBySearch(app, "Paris, Ontario");
    await expect(app.locator("#heroCityName")).toContainText("Paris");
    const text = await app.locator(".hero-region").innerText();
    expect(text.indexOf("Canada")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Ontario")).toBeGreaterThan(text.indexOf("Canada"));
    await expect(heroRegionFlags(app)).toHaveCount(2);
  });

  test("a country selection is unaffected by the reordering — its own name only, no flag", async ({
    app,
  }) => {
    await selectByExploreCard(app, "france");
    await expect(app.locator("#heroCityName")).toContainText("France");
    await expect(heroRegionFlags(app)).toHaveCount(0);
  });

  test("holds in French too", async ({ app }) => {
    await setLang(app, "fr");
    await selectBySearch(app, "Paris, Texas");
    const text = await app.locator(".hero-region").innerText();
    expect(text.indexOf("États-Unis")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Texas")).toBeGreaterThan(text.indexOf("États-Unis"));
  });

  test("holds on a narrow (mobile) viewport, with no page overflow", async ({ app }) => {
    await app.setViewportSize({ width: 375, height: 800 });
    await selectBySearch(app, "Paris, Ontario");
    const text = await app.locator(".hero-region").innerText();
    expect(text.indexOf("Canada")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Ontario")).toBeGreaterThan(text.indexOf("Canada"));
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("switching between locations with different flag counts never leaves stale flags or text", async ({
    app,
  }) => {
    await selectBySearch(app, "Paris, Texas");
    await expect(heroRegionFlags(app)).toHaveCount(2);

    await selectByExploreCard(app, "france"); // country: 0 flags
    await expect(heroRegionFlags(app)).toHaveCount(0);
    await expect(app.locator(".hero-region")).not.toContainText("Texas");
    await expect(app.locator(".hero-region")).not.toContainText("United States");

    await selectByExploreCard(app, "paris"); // French city: 1 flag
    await expect(heroRegionFlags(app)).toHaveCount(1);
    await expect(app.locator(".hero-region")).not.toContainText("France, France");
  });
});

test.describe("home hero: ocean/sea selections", () => {
  test("shows the ocean name and the 'Ocean / Sea' kind, never 'City' or a '?' flag", async ({
    page,
  }) => {
    await installMocks(page);
    await selectByMapClick(page, CLICK_OCEAN);

    /* default app language is French — see e2e/mocks.js */
    await expect(page.locator("#heroCityName")).toContainText("Océan Atlantique");
    await expect(page.locator(".hero-loc-kicker")).toContainText("Océan / Mer");
    await expect(page.locator(".hero-loc-kicker")).not.toContainText("Ville");
    await expect(page.locator(".hero-region .location-flag-wrap")).toHaveCount(0);
    await expect(page.locator(".hero-region .flag-txt")).toHaveCount(0);
  });

  test("holds in English too", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();

    await selectByMapClick(page, CLICK_OCEAN);

    await expect(page.locator("#heroCityName")).toContainText("Atlantic Ocean");
    await expect(page.locator(".hero-loc-kicker")).toContainText("Ocean / Sea");
    await expect(page.locator(".hero-region .location-flag-wrap")).toHaveCount(0);
  });
});

test.describe("home hero: unresolvable coordinate fallback", () => {
  test("shows the raw coordinate with no country/region text and no flag", async ({ page }) => {
    await installMocks(page);
    /* Override just the reverse-geocode lookup so it finds literally
       nothing — forward (autocomplete) search calls hit the same host but
       never carry two comma-separated numbers, so they fall through
       untouched to installMocks' own handler. (47, 3) is inland France:
       comfortably outside every named-sea box (the Mediterranean box tops
       out at latitude 46) and inside the Europe landmass box in
       core/marine-regions.js, so it is not guessed as ocean either — see
       core/coord-location.test.js's identical reasoning. It also isn't the
       default Paris location's own coordinates (48.8566, 2.3522), which
       would put the click on Paris's own map marker instead of open map
       canvas. */
    await page.route("**://api.maptiler.com/geocoding/**", (route, request) => {
      const url = decodeURIComponent(request.url());
      if (!/\/geocoding\/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?\.json/.test(url)) {
        return route.fallback();
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ features: [] }),
      });
    });

    await selectByMapClick(page, { lat: 47, lon: 3 });

    await expect(page.locator("#heroCityName")).toContainText(/-?\d+\.\d+°, -?\d+\.\d+°/);
    await expect(page.locator(".hero-region .location-flag-wrap")).toHaveCount(0);
    await expect(page.locator(".hero-region .flag-txt")).toHaveCount(0);
  });
});
