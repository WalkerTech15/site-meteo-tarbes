/* Location-photo relevance: a searched city only shows a Pexels photo whose
 * metadata actually matches it, an ocean/sea click searches for the body of
 * water itself, and attribution/server-side key protection hold in both
 * cases. See src/js/services/photo-api.js (pexelsQuery, relevanceKeywords,
 * isRelevantPhoto) and src/js/core/marine-regions.js. */
import { test, expect, installMocks, json, GEOCODE_LABEL, CLICK_OCEAN } from "./mocks.js";

/* A query-aware stand-in for the proxy: unlike the fixed installMocks()
 * default, this answers differently depending on the `query=` the app sent,
 * which is what lets one test show a relevant photo and reject an
 * irrelevant one without changing the location being searched. */
function queryAwarePhotoProxy(answer) {
  const queries = [];
  const photoProxy = (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("query");
    if (query) queries.push(query);
    return route.fulfill(json({ photo: answer(query) }));
  };
  return { photoProxy, queries };
}

/* A real, instantly-decodable image (not a fake images.pexels.com URL, which
   installMocks()'s catch-all would abort as an unmocked external request) —
   same technique as mocks.js's own PIXEL constant. */
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function pexelsPhoto({ alt, photographer = "X", id = "1" }) {
  return {
    src: { medium: PIXEL, large: PIXEL },
    photographer,
    link: `https://www.pexels.com/photo/${id}/`,
    alt,
  };
}

test.describe("location photos — relevance filtering", () => {
  test("a Pexels result unrelated to the searched city falls back to the gradient/emoji", async ({
    page,
  }) => {
    const { photoProxy } = queryAwarePhotoProxy((query) =>
      query
        ? pexelsPhoto({ alt: "A cup of coffee on a wooden table", photographer: "Nobody" })
        : null,
    );
    await installMocks(page, { photoProxy });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .loc-photo.loading")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
    await expect(page.locator("#heroInner .loc-credit")).toHaveCount(0);
  });

  test("a Pexels result that names the searched city is shown, with attribution kept", async ({
    page,
  }) => {
    const { photoProxy } = queryAwarePhotoProxy((query) =>
      query && query.includes("Iceland")
        ? pexelsPhoto({ alt: `Aerial view of ${GEOCODE_LABEL}, Iceland at sunset`, id: "rk" })
        : null,
    );
    await installMocks(page, { photoProxy });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);
    await expect(page.locator("#heroInner .loc-credit")).toBeVisible();
    await expect(page.locator("#heroInner .loc-credit")).toHaveText("Pexels ↗");
  });

  test("the browser never sends the Pexels key — only the same-origin proxy is called", async ({
    page,
  }) => {
    const { photoProxy } = queryAwarePhotoProxy((query) =>
      query ? pexelsPhoto({ alt: `${GEOCODE_LABEL} Iceland cityscape`, id: "rk2" }) : null,
    );
    const requestHeaders = [];
    await installMocks(page, { photoProxy });
    page.on("request", (r) => {
      if (r.url().includes("/api/pexels")) requestHeaders.push(r.headers());
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    expect(requestHeaders.length).toBeGreaterThan(0);
    for (const headers of requestHeaders) {
      expect(Object.keys(headers).some((h) => /authorization/i.test(h))).toBe(false);
    }
  });
});

/* Real MapLibre + WebGL, same caveat as e2e/map-click.spec.js: serialised
   within this file (mode "default") and given the same generous timeout, so
   a parallel run's WebGL-context churn can't turn this into a flake. */
test.describe("location photos — oceans and seas", () => {
  test.describe.configure({ mode: "default", timeout: 90_000 });
  const MAP_TIMEOUT = 20000;

  async function openMapAtOcean(page) {
    await page.goto(`/#/map?c=${CLICK_OCEAN.lat},${CLICK_OCEAN.lon}&z=5`);
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
    await expect
      .poll(() => page.url(), { timeout: MAP_TIMEOUT })
      .toContain(`c=${CLICK_OCEAN.lat}%2C`);
  }

  async function clickMapCentre(page) {
    const map = page.locator("#worldMap");
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  test("an ocean click searches for the ocean itself, never a city-style query", async ({
    page,
  }) => {
    const { photoProxy, queries } = queryAwarePhotoProxy(() => null);
    await installMocks(page, { photoProxy });
    await openMapAtOcean(page);
    await clickMapCentre(page);

    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).toHaveText(
      "Océan Atlantique",
    );
    await expect.poll(() => queries.some((q) => q.includes("Atlantic Ocean"))).toBe(true);
    expect(queries.some((q) => q.toLowerCase().includes("cityscape"))).toBe(false);
    expect(queries.some((q) => /\d/.test(q))).toBe(false); // never a coordinate-shaped query
  });

  test("no photo for the ocean still falls back cleanly, with no false attribution", async ({
    page,
  }) => {
    await installMocks(page, { photoProxy: (route) => route.fulfill(json({ photo: null })) });
    await openMapAtOcean(page);
    await clickMapCentre(page);

    const photo = page.locator("#mapWeatherPanel .map-panel-photo");
    await expect(photo.locator("img.loc-photo-img")).toHaveCount(0);
    await expect(photo.locator("a.loc-credit")).toHaveCount(0);
  });
});
