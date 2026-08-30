/* Location-photo relevance: a searched city only shows a Pexels photo whose
 * metadata actually matches it, an ocean/sea click searches for the body of
 * water itself, and attribution/server-side key protection hold in both
 * cases. See src/js/services/photo-api.js (pexelsQuery, relevanceKeywords,
 * isRelevantPhoto) and src/js/core/marine-regions.js. */
import {
  test,
  expect,
  installMocks,
  json,
  GEOCODE_LABEL,
  CLICK_OCEAN,
  wikimediaPhotoPage,
  WIKIMEDIA_THUMB_URL,
} from "./mocks.js";

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

  test("Wikimedia is also searched for the ocean itself when Pexels has nothing — never a city", async ({
    page,
  }) => {
    const { photoProxy } = queryAwarePhotoProxy(() => null);
    const wikimediaQueries = [];
    const wikimediaProxy = (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("generator") === "search") {
        wikimediaQueries.push(url.searchParams.get("gsrsearch"));
      }
      return route.fulfill(json({ query: { pages: [] } }));
    };
    await installMocks(page, { photoProxy, wikimediaProxy });
    await openMapAtOcean(page);
    await clickMapCentre(page);

    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).toHaveText(
      "Océan Atlantique",
    );
    await expect
      .poll(() => wikimediaQueries.some((q) => q && q.includes("Atlantic Ocean")))
      .toBe(true);
    expect(wikimediaQueries.some((q) => q && q.toLowerCase().includes("cityscape"))).toBe(false);
    /* still a graceful gradient/emoji fallback, never a false city photo */
    const photo = page.locator("#mapWeatherPanel .map-panel-photo");
    await expect(photo.locator("img.loc-photo-img")).toHaveCount(0);
  });
});

/* A Wikimedia route mock that answers differently by `generator=` — geosearch
   vs. text search — mirroring how resolveWikimediaPhoto (photo-api.js) tries
   coordinate geosearch first for a granular place, then falls back to text
   search. `geo` defaults to empty so a test only has to describe the branch
   it cares about. */
function splitWikimediaProxy({ geo = null, search = null } = {}) {
  const calls = { geo: 0, search: 0 };
  const wikimediaProxy = (route) => {
    const generator = new URL(route.request().url()).searchParams.get("generator");
    if (generator === "geosearch") {
      calls.geo++;
      return route.fulfill(json(geo || { query: { pages: [] } }));
    }
    calls.search++;
    return route.fulfill(json(search || { query: { pages: [] } }));
  };
  return { wikimediaProxy, calls };
}

test.describe("location photos — hybrid strategy: Wikimedia fallback, attribution, licensing", () => {
  test("Wikimedia supplies the photo when Pexels has nothing relevant, with license and attribution shown", async ({
    page,
  }) => {
    const { photoProxy } = queryAwarePhotoProxy(() => null); // Pexels: nothing, ever
    const { wikimediaProxy } = splitWikimediaProxy({
      search: wikimediaPhotoPage({
        title: "Reykjavik-harbour",
        alt: `A view of ${GEOCODE_LABEL}, Iceland at dusk`,
        photographer: "A Commons Contributor",
        license: "CC BY-SA 4.0",
      }),
    });
    await installMocks(page, { photoProxy, wikimediaProxy });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);
    await expect(page.locator("#heroLandmark img.loc-photo-img")).toHaveAttribute(
      "src",
      WIKIMEDIA_THUMB_URL,
    );
    const credit = page.locator("#heroInner .loc-credit");
    await expect(credit).toBeVisible();
    await expect(credit).toHaveText("Wikimedia Commons ↗");
    /* the license travels with the credit, and the description page — never
       the raw upload.wikimedia.org thumbnail — is what the link opens */
    await expect(credit).toHaveAttribute("title", /CC BY-SA 4\.0/);
    await expect(credit).toHaveAttribute("href", /commons\.wikimedia\.org\/wiki\/File:/);
  });

  test("tries coordinate geosearch before falling back to text search, for a granular place", async ({
    page,
  }) => {
    const { photoProxy } = queryAwarePhotoProxy(() => null);
    const { wikimediaProxy, calls } = splitWikimediaProxy({
      search: wikimediaPhotoPage({ title: "found-by-text", alt: `${GEOCODE_LABEL} Iceland` }),
    });
    await installMocks(page, { photoProxy, wikimediaProxy });
    await page.goto("/");
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    expect(calls.geo).toBeGreaterThan(0); // geosearch was tried first…
    expect(calls.search).toBeGreaterThan(0); // …and text search only because it came up empty
  });

  test("rejects a Wikimedia text-search result that doesn't name the place either", async ({
    page,
  }) => {
    const { photoProxy } = queryAwarePhotoProxy(() => null);
    const { wikimediaProxy } = splitWikimediaProxy({
      search: wikimediaPhotoPage({ title: "unrelated", alt: "A parked bicycle on a wet street" }),
    });
    await installMocks(page, { photoProxy, wikimediaProxy });
    await page.goto("/");
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
    await expect(page.locator("#heroInner .loc-credit")).toHaveCount(0);
  });

  test("rejects a Wikimedia candidate with an unclear/unrecognised license", async ({ page }) => {
    const { photoProxy } = queryAwarePhotoProxy(() => null);
    const { wikimediaProxy } = splitWikimediaProxy({
      search: wikimediaPhotoPage({
        title: "unclear-license",
        alt: `${GEOCODE_LABEL} Iceland`,
        license: "All rights reserved",
      }),
    });
    await installMocks(page, { photoProxy, wikimediaProxy });
    await page.goto("/");
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
  });

  test("both Pexels and Wikimedia failing outright still degrades to the gradient/emoji fallback", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await installMocks(page, {
      photoProxy: (route) =>
        route.fulfill({ status: 502, contentType: "application/json", body: "{}" }),
      wikimediaProxy: (route) =>
        route.fulfill({ status: 502, contentType: "application/json", body: "{}" }),
    });
    await page.goto("/");
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .loc-photo-fallback")).toBeVisible();
    await expect(page.locator("#heroInner .loc-credit")).toHaveCount(0);
    /* no unhandled rejection / console error from either failed lookup */
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test("Pexels ranks a candidate that names the city over one that only matches generically", async ({
    page,
  }) => {
    const weak = {
      src: { medium: PIXEL, large: PIXEL },
      photographer: "Weak Match",
      link: "https://www.pexels.com/photo/weak/",
      alt: "A generic landscape somewhere in Iceland",
    };
    const strong = {
      src: { medium: PIXEL, large: PIXEL },
      photographer: "Strong Match",
      link: "https://www.pexels.com/photo/strong/",
      alt: `${GEOCODE_LABEL} harbour at sunrise`,
    };
    const photoProxy = (route) => route.fulfill(json({ photo: weak, photos: [weak, strong] }));
    await installMocks(page, { photoProxy });
    await page.goto("/");
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    const credit = page.locator("#heroInner .loc-credit");
    await expect(credit).toHaveAttribute("href", "https://www.pexels.com/photo/strong/");
  });
});

/* ── Fallback order, honest area labelling, attribution and staleness ─────
   The service-level rules are unit-tested (photo-api.test.js); these cover
   the parts that only exist in a real browser: which element ends up
   showing what, the credit's visible text and accessible name, and the
   photoToken guard that stops a superseded lookup repainting the hero. */

/* Reykjavik, as the geocoding fixture returns it (see e2e/mocks.js):
   Capital Region, Iceland. */
const AREA_REGION = "Capital Region";

test.describe("location photos — fallback order and honest labelling", () => {
  test("a coordinate-verified Wikimedia photo is preferred over a Pexels one", async ({ page }) => {
    const pexelsQueries = [];
    const { photoProxy } = (() => ({
      photoProxy: (route) => {
        const q = new URL(route.request().url()).searchParams.get("query");
        if (q) pexelsQueries.push(q);
        return route.fulfill(
          json({ photo: pexelsPhoto({ alt: `${GEOCODE_LABEL} Iceland cityscape`, id: "px" }) }),
        );
      },
    }))();
    await installMocks(page, {
      photoProxy,
      /* geosearch answers with a real, licensed, coordinate-tagged file */
      wikimediaProxy: (route) => {
        const generator = new URL(route.request().url()).searchParams.get("generator");
        return route.fulfill(
          json(
            generator === "geosearch"
              ? wikimediaPhotoPage({
                  title: `${GEOCODE_LABEL} harbour`,
                  license: "CC BY-SA 4.0",
                  lat: 64.1355,
                  lon: -21.8954,
                })
              : { query: { pages: [] } },
          ),
        );
      },
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);
    const credit = page.locator("#heroInner .loc-credit");
    await expect(credit).toHaveText("Wikimedia Commons ↗");
    /* Commons requires the licence to travel with the credit */
    await expect(credit).toHaveAttribute("aria-label", /CC BY-SA/i);
    /* Pexels was never consulted — geosearch already answered accurately */
    expect(pexelsQueries).toHaveLength(0);
  });

  test("an area fallback is labelled as the area's photo, never the town's", async ({ page }) => {
    /* nothing for the city itself; only the region query is answered */
    const { photoProxy } = queryAwarePhotoProxy((query) =>
      query && query.startsWith(AREA_REGION)
        ? pexelsPhoto({ alt: `${AREA_REGION} landscape`, id: "area" })
        : null,
    );
    await installMocks(page, { photoProxy });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);
    const credit = page.locator("#heroInner .loc-credit");
    /* the visible credit names the area, so the image never reads as the
       city's own; the accessible name spells the caveat out in full */
    await expect(credit).toHaveText(`${AREA_REGION} · Pexels ↗`);
    await expect(credit).toHaveAttribute("data-approximate", "true");
    await expect(credit).toHaveAttribute("aria-label", new RegExp(AREA_REGION));
    /* default interface language is French (see e2e/mocks.js) */
    await expect(credit).toHaveAttribute("aria-label", /et non du lieu lui-m/i);
  });

  test("attribution stays a real, safe outbound link", async ({ page }) => {
    const { photoProxy } = queryAwarePhotoProxy((query) =>
      query ? pexelsPhoto({ alt: `${GEOCODE_LABEL} Iceland cityscape`, id: "lnk" }) : null,
    );
    await installMocks(page, { photoProxy });
    await page.goto("/");
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    const credit = page.locator("#heroInner .loc-credit");
    await expect(credit).toHaveAttribute("href", /^https:\/\/www\.pexels\.com\//);
    await expect(credit).toHaveAttribute("rel", /noopener/);
    await expect(credit).toHaveAttribute("target", "_blank");
    /* the photo carries the provider's own description as its alt text */
    await expect(page.locator("#heroLandmark img.loc-photo-img")).toHaveAttribute(
      "alt",
      new RegExp(GEOCODE_LABEL),
    );
  });

  test("rapid location changes never leave the previous location's photo on screen", async ({
    page,
  }) => {
    /* each city resolves to a photo naming only itself, so a stale swap is
       immediately visible in the alt text */
    const { photoProxy } = queryAwarePhotoProxy((query) => {
      if (!query) return null;
      if (query.includes(GEOCODE_LABEL))
        return pexelsPhoto({ alt: `${GEOCODE_LABEL} view`, id: "a" });
      if (query.includes("Paris")) return pexelsPhoto({ alt: "Paris view", id: "b" });
      return null;
    });
    await installMocks(page, { photoProxy });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    /* switch straight to a curated city and let it settle */
    await page.locator("#searchInput").fill("Paris");
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText("Paris");

    /* Paris may legitimately end up with no photo (a curated landmark with no
       reviewed image stays on the gradient), so what matters is that nothing
       from the PREVIOUS city survived the switch — neither its image nor its
       credit. */
    await expect(page.locator("#heroLandmark img.loc-photo-img")).toHaveCount(0);
    await expect(page.locator("#heroInner .loc-credit")).toHaveCount(0);
    await expect(page.locator("#heroLandmark")).not.toContainText(GEOCODE_LABEL);
  });

  test("the photo and its credit render without overflow at a 390px viewport", async ({ page }) => {
    const { photoProxy } = queryAwarePhotoProxy((query) =>
      query ? pexelsPhoto({ alt: `${GEOCODE_LABEL} Iceland cityscape`, id: "m" }) : null,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await installMocks(page, { photoProxy });
    await page.goto("/");
    /* at this width the inline search bar is replaced by a button */
    await page.locator("#mobileSearchBtn").click();
    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    await expect(page.locator("#heroInner .loc-credit")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
