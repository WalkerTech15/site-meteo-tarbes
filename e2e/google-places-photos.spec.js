/* Google Places photos, as the visitor and the network actually see them.
 *
 * Three things this proves that a unit test cannot:
 *   - the KEY never leaves the server: the browser only ever calls the
 *     same-origin /api/places, with no credential header, and never
 *     places.googleapis.com;
 *   - Google's REQUIRED attribution is rendered visibly next to the photo,
 *     in both interface languages;
 *   - the provider priority holds end to end — Google first, and the older
 *     providers still work untouched when it answers nothing.
 *
 * See src/js/services/places-api.js and the chain in
 * src/js/services/photo-api.js (fetchBestPhoto). */
import {
  test,
  expect,
  installMocks,
  json,
  googlePlacesPayload,
  GEOCODE_LABEL,
  GOOGLE_PHOTO_URL,
  GOOGLE_CONTRIBUTOR,
  CLICK_OCEAN,
  wikimediaPhotoPage,
  WIKIMEDIA_THUMB_URL,
} from "./mocks.js";

/* A stand-in for the two-operation proxy that records what was asked. The
   candidate answer is derived from the request itself (see
   googlePlacesPayload), so the place it describes really is the place the app
   asked about rather than a fixture that would match anything. */
function placesRecorder({ places = googlePlacesPayload, photoSrc = GOOGLE_PHOTO_URL } = {}) {
  const queries = [];
  const photoRefs = [];
  const placesProxy = (route) => {
    const url = route.request().url();
    const params = new URL(url).searchParams;
    const ref = params.get("photo");
    if (ref) {
      photoRefs.push(ref);
      return route.fulfill(
        json(photoSrc ? { photo: { src: photoSrc, width: 1280 } } : { photo: null }),
      );
    }
    queries.push(params.get("query"));
    return route.fulfill(json(typeof places === "function" ? places(url) : places));
  };
  return { placesProxy, queries, photoRefs };
}

async function searchFor(page, label) {
  await page.locator("#searchInput").fill(label);
  await page.locator("#searchResults .search-item").first().click();
  await expect(page.locator("#heroCityName")).toContainText(label);
}

async function openHome(page, overrides) {
  await installMocks(page, overrides);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

test.describe("google places — the key stays on the server", () => {
  test("the browser calls only the same-origin proxy, never Google", async ({ page }) => {
    const { placesProxy } = placesRecorder();
    const proxyRequests = [];
    const googleRequests = [];
    await installMocks(page, { placesProxy });
    page.on("request", (r) => {
      const url = r.url();
      if (url.includes("/api/places")) proxyRequests.push(r.headers());
      if (url.includes("googleapis.com")) googleRequests.push(url);
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    expect(googleRequests).toEqual([]);
    expect(proxyRequests.length).toBeGreaterThan(0);
    for (const headers of proxyRequests) {
      /* No X-Goog-Api-Key, no Authorization, no `key=` anywhere. */
      expect(Object.keys(headers).some((h) => /goog|authorization/i.test(h))).toBe(false);
    }
  });

  test("no request URL anywhere in the page carries a Google-shaped key", async ({ page }) => {
    const { placesProxy } = placesRecorder();
    const urls = [];
    await installMocks(page, { placesProxy });
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      /* No Google-shaped key anywhere at all. */
      expect(url).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
      /* And no `key=` on any photo-pipeline request. MapTiler is excluded on
         purpose: its key IS public by design and origin-restricted (see
         core/config.js), which is exactly the property Pexels and Google
         lack and the reason both sit behind a proxy. */
      if (!url.includes("api.maptiler.com")) expect(url).not.toMatch(/[?&]key=/);
    }
  });
});

test.describe("google places — attribution is displayed, not merely available", () => {
  test("the contributor's name and Google are both visible on the photo", async ({ page }) => {
    const { placesProxy } = placesRecorder();
    await openHome(page, { placesProxy });
    await searchFor(page, GEOCODE_LABEL);

    const credit = page.locator("#heroInner .loc-credit");
    await expect(credit).toBeVisible();
    /* Google's policy requires the author attribution to be shown WITH the
       photo — the tooltip is where the other providers put the photographer,
       and that is not enough here. */
    await expect(credit).toContainText(GOOGLE_CONTRIBUTOR);
    await expect(credit).toContainText("Google");
    await expect(credit).toHaveAttribute("data-provider", "google");
  });

  test("the credit links back to Google over https, in a safe new tab", async ({ page }) => {
    const { placesProxy } = placesRecorder();
    await openHome(page, { placesProxy });
    await searchFor(page, GEOCODE_LABEL);

    const credit = page.locator("#heroInner .loc-credit");
    await expect(credit).toHaveAttribute("href", /^https:\/\/maps\.google\.com\//);
    await expect(credit).toHaveAttribute("rel", /noopener/);
  });

  test("the accessible name spells the attribution out in full", async ({ page }) => {
    const { placesProxy } = placesRecorder();
    await openHome(page, { placesProxy });
    await searchFor(page, GEOCODE_LABEL);

    const credit = page.locator("#heroInner .loc-credit");
    /* Default interface language is French — see e2e/mocks.js. */
    await expect(credit).toHaveAttribute(
      "aria-label",
      new RegExp(`Photo de ${GOOGLE_CONTRIBUTOR} via Google`),
    );
  });

  test("the attribution is translated with the interface", async ({ page }) => {
    const { placesProxy } = placesRecorder();
    await openHome(page, { placesProxy });
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await searchFor(page, GEOCODE_LABEL);

    await expect(page.locator("#heroInner .loc-credit")).toHaveAttribute(
      "aria-label",
      new RegExp(`Photo by ${GOOGLE_CONTRIBUTOR} via Google`),
    );
  });

  test("a photo that cannot be attributed is not shown at all", async ({ page }) => {
    /* Showing it uncredited would breach Google's terms, so the chain moves
       on and the gradient/emoji fallback stays. */
    const { placesProxy } = placesRecorder({
      places: (url) => {
        const payload = googlePlacesPayload(url);
        payload.places[0].photo.attributions = [];
        payload.places[0].mapsUri = "";
        return payload;
      },
    });
    /* Pexels silenced too, so what this asserts is Google's refusal rather
       than the next provider quietly supplying a photo instead. */
    await openHome(page, {
      placesProxy,
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
    });
    await searchFor(page, GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .loc-photo.loading")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
    await expect(page.locator("#heroInner .loc-credit")).toHaveCount(0);
  });
});

test.describe("google places — accessibility and layout", () => {
  test("the photo carries alt text naming the place, not an empty string", async ({ page }) => {
    const { placesProxy } = placesRecorder();
    await openHome(page, { placesProxy });
    await searchFor(page, GEOCODE_LABEL);

    const img = page.locator("#heroLandmark img.loc-photo-img");
    await expect(img).toHaveAttribute("alt", new RegExp(GEOCODE_LABEL, "i"));
  });

  test("a single-rendition Google photo gets no fabricated srcset", async ({ page }) => {
    /* Google's media endpoint returns ONE width. Claiming "940w, 1880w" for
       it would mislabel the file and let the browser pick a size that does
       not exist — the same reason Wikimedia skips a srcset. */
    const { placesProxy } = placesRecorder();
    await openHome(page, { placesProxy });
    await searchFor(page, GEOCODE_LABEL);

    const img = page.locator("#heroLandmark img.loc-photo-img");
    await expect(img).toHaveCount(1);
    expect(await img.getAttribute("srcset")).toBeNull();
  });

  test("the hero photo loads at high priority and the page does not scroll sideways", async ({
    page,
  }) => {
    const { placesProxy } = placesRecorder();
    await openHome(page, { placesProxy });
    await searchFor(page, GEOCODE_LABEL);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    await expect(page.locator("#heroLandmark img.loc-photo-img")).toHaveAttribute(
      "fetchpriority",
      "high",
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const [name, width, height] of [
    ["tablet", 820, 1180],
    ["mobile", 375, 800],
  ]) {
    test(`the credit stays visible and within the viewport on ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const { placesProxy } = placesRecorder();
      await openHome(page, { placesProxy });
      /* Below 520px the search field hides behind a button. */
      const mobileBtn = page.locator("#mobileSearchBtn");
      if (await mobileBtn.isVisible()) await mobileBtn.click();
      await searchFor(page, GEOCODE_LABEL);

      await expect(page.locator("#heroInner .loc-credit")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("google places — provider priority and matching", () => {
  test("Google wins over Wikimedia and Pexels when it has an answer", async ({ page }) => {
    const { placesProxy } = placesRecorder();
    let pexelsAsked = 0;
    await installMocks(page, {
      placesProxy,
      photoProxy: (route) => {
        pexelsAsked += 1;
        return route.fulfill(json({ photo: null, photos: [] }));
      },
      wikimediaProxy: (route) =>
        route.fulfill(
          json(
            wikimediaPhotoPage({ title: GEOCODE_LABEL, alt: GEOCODE_LABEL, lat: 64.1, lon: -21.9 }),
          ),
        ),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    const before = pexelsAsked;
    await searchFor(page, GEOCODE_LABEL);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);

    const src = await page.locator("#heroLandmark img.loc-photo-img").getAttribute("src");
    expect(src).toContain("googleusercontent.com");
    expect(src).not.toContain(WIKIMEDIA_THUMB_URL);
    /* Nothing below Google was asked for this location. */
    expect(pexelsAsked).toBe(before);
  });

  test("with Google silent, Wikimedia still answers exactly as before", async ({ page }) => {
    await installMocks(page, {
      /* the installMocks default: {"places": []} */
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
      wikimediaProxy: (route) =>
        route.fulfill(
          json(
            wikimediaPhotoPage({ title: GEOCODE_LABEL, alt: GEOCODE_LABEL, lat: 64.1, lon: -21.9 }),
          ),
        ),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);
    await expect(page.locator("#heroInner .loc-credit")).toContainText("Wikimedia Commons");
  });

  test("a business returned for a town is rejected, not displayed", async ({ page }) => {
    /* Google answers a settlement query with a hotel of that name. It is not
       a worse match for the town — it is a different subject — so the photo
       must be refused and the chain must continue. */
    const { placesProxy } = placesRecorder({
      places: (url) => {
        const payload = googlePlacesPayload(url);
        payload.places[0].types = ["lodging", "point_of_interest", "establishment"];
        payload.places[0].name = `Hotel ${payload.places[0].name}`;
        return payload;
      },
    });
    await installMocks(page, {
      placesProxy,
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .loc-photo.loading")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
  });

  test("a place hundreds of km away is rejected on distance", async ({ page }) => {
    const { placesProxy } = placesRecorder({
      places: (url) => {
        const payload = googlePlacesPayload(url);
        /* Right name, right type, wrong continent. */
        payload.places[0].lat = -33.87;
        payload.places[0].lon = 151.21;
        return payload;
      },
    });
    await installMocks(page, {
      placesProxy,
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
  });
});

test.describe("google places — failures never break the page", () => {
  for (const [label, status, body] of [
    ["no key configured", 503, { error: "unavailable" }],
    ["quota exhausted", 429, { error: "rate_limited" }],
    ["denied", 403, { error: "unavailable" }],
    ["provider outage", 502, { error: "upstream_error" }],
    ["server error", 500, { error: "upstream_error" }],
  ]) {
    test(`${label} (${status}) falls through to the next provider`, async ({ page }) => {
      await installMocks(page, {
        placesProxy: (route) =>
          route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
        wikimediaProxy: (route) =>
          route.fulfill(
            json(
              wikimediaPhotoPage({
                title: GEOCODE_LABEL,
                alt: GEOCODE_LABEL,
                lat: 64.1,
                lon: -21.9,
              }),
            ),
          ),
      });
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();
      await searchFor(page, GEOCODE_LABEL);

      /* The weather, the forecast and a photo from another provider are all
         unaffected — a dead Google is invisible to the visitor. */
      await expect(page.locator(".hero-temp")).not.toBeEmpty();
      await expect(page.locator("#forecastRow .forecast-card").first()).toBeVisible();
      await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);
    });
  }

  test("a hung Places request never blocks the weather or the forecast", async ({ page }) => {
    await installMocks(page, {
      placesProxy: async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        return route.fulfill(json({ places: [] }));
      },
    });
    await page.goto("/");
    /* The photo chain is fire-and-forget; nothing in the render path awaits
       it, so the page is complete long before the hung request gives up. */
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await expect(page.locator(".hero-temp")).not.toBeEmpty();
    await expect(page.locator("#forecastRow .forecast-card").first()).toBeVisible();
  });

  test("a malformed proxy body is treated as no photo", async ({ page }) => {
    await installMocks(page, {
      placesProxy: (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "{not json" }),
      photoProxy: (route) => route.fulfill(json({ photo: null, photos: [] })),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
  });
});

test.describe("google places — rapid location changes", () => {
  test("switching places mid-load never leaves the previous photo or credit", async ({ page }) => {
    /* The failure this guards: an in-flight lookup for city A resolving after
       the visitor has already picked city B, and painting A's photo over B. */
    const { placesProxy } = placesRecorder();
    await openHome(page, { placesProxy });

    for (const label of ["Lyon", "Austin", "Tarbes"]) {
      await page.locator("#searchInput").fill(label);
      await page.locator("#searchResults .search-item").first().click();
    }
    await expect(page.locator("#heroCityName")).toContainText("Tarbes");

    /* Google answers for every one of those cities, so a photo must settle —
       and it must be the LAST selection's, never a late arrival from Lyon or
       Austin painting over it. */
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(1);
    await expect(page.locator("#heroLandmark img.loc-photo-img")).toHaveAttribute("alt", /Tarbes/i);
    await expect(page.locator("#heroInner .loc-credit")).toBeVisible();
  });
});

test.describe("google places — oceans and seas", () => {
  test.describe.configure({ mode: "default", timeout: 90_000 });
  const MAP_TIMEOUT = 20000;

  test("an ocean click never queries Google — it has no ocean entity", async ({ page }) => {
    const { placesProxy, queries } = placesRecorder();
    await installMocks(page, { placesProxy });
    await page.goto(`/#/map?c=${CLICK_OCEAN.lat},${CLICK_OCEAN.lon}&z=5`);
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: MAP_TIMEOUT });
    await expect
      .poll(() => page.url(), { timeout: MAP_TIMEOUT })
      .toContain(`c=${CLICK_OCEAN.lat}%2C`);

    const map = page.locator("#worldMap");
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).toHaveText(
      "Océan Atlantique",
      { timeout: MAP_TIMEOUT },
    );
    /* A text search for "Atlantic Ocean" returns a coastal business, which is
       exactly the "a result exists, so display it" failure to avoid. */
    expect(queries).toEqual([]);
  });
});
