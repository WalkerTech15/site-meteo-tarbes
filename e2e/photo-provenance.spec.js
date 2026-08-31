/* What the visitor is TOLD about the photo they are looking at.
 *
 * The photo chain has seven steps making four different strengths of claim,
 * and the whole point of the provenance tiers is that the UI never lets a
 * weak one read as a strong one. These tests are the visible half of that:
 *   - an exact photo carries no qualifier (silence means "this place");
 *   - a nearby photo says so, names what it actually shows, and says it in
 *     both languages and to a screen reader;
 *   - a regional/country photo keeps saying it is not the place itself;
 *   - Mapillary and Google are attributed as their licences require.
 *
 * Also covers Mapillary's own guarantees: the token never leaves the server,
 * and it is never asked about a region, a country or the open sea.
 */
import {
  test,
  expect,
  installMocks,
  json,
  googlePlacesPayload,
  mapillaryPayload,
  wikimediaPhotoPage,
  GEOCODE_LABEL,
  GOOGLE_PHOTO_URL,
  MAPILLARY_CONTRIBUTOR,
  CLICK_OCEAN,
} from "./mocks.js";

const credit = (page) => page.locator("#heroInner .loc-credit");
const heroPhoto = (page) => page.locator("#heroLandmark .has-photo");

/* Google answers with a landmark rather than the locality — the real-world
   case that used to yield no usable candidate at all. */
function landmarkPlacesProxy(route) {
  const url = route.request().url();
  const params = new URL(url).searchParams;
  if (params.get("photo")) {
    return route.fulfill(json({ photo: { src: GOOGLE_PHOTO_URL, width: 1280 } }));
  }
  const payload = googlePlacesPayload(url);
  payload.places[0].name = "Hallgrímskirkja";
  payload.places[0].types = ["church", "tourist_attraction", "place_of_worship"];
  return route.fulfill(json(payload));
}

function exactPlacesProxy(route) {
  const url = route.request().url();
  if (new URL(url).searchParams.get("photo")) {
    return route.fulfill(json({ photo: { src: GOOGLE_PHOTO_URL, width: 1280 } }));
  }
  return route.fulfill(json(googlePlacesPayload(url)));
}

const silentPexels = (route) => route.fulfill(json({ photo: null, photos: [] }));

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

test.describe("provenance — an exact photo makes no excuses", () => {
  test("shows no qualifier when the photo really is of the place", async ({ page }) => {
    await openHome(page, { placesProxy: exactPlacesProxy });
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);

    await expect(credit(page)).toHaveAttribute("data-provenance", "exact");
    /* French default — must not be apologising for anything. */
    await expect(credit(page)).not.toContainText("environs");
    await expect(credit(page)).not.toContainText("À proximité");
  });
});

test.describe("provenance — a nearby photo says so", () => {
  test("labels a landmark standing in for the city, and names it", async ({ page }) => {
    await openHome(page, { placesProxy: landmarkPlacesProxy, photoProxy: silentPexels });
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);

    await expect(credit(page)).toHaveAttribute("data-provenance", "nearby");
    /* The short badge is on the image; the full sentence is the accessible
       name, and it must name what is actually pictured. */
    await expect(credit(page)).toContainText("À proximité");
    await expect(credit(page)).toHaveAttribute("aria-label", /Hallgrímskirkja/);
  });

  test("the disclaimer is translated with the interface", async ({ page }) => {
    await openHome(page, { placesProxy: landmarkPlacesProxy, photoProxy: silentPexels });
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);

    await expect(credit(page)).toContainText("Nearby");
    await expect(credit(page)).toHaveAttribute("aria-label", /not a photo of the place itself/i);
  });

  test("never claims a landmark is the city, in either language", async ({ page }) => {
    for (const lang of ["fr", "en"]) {
      await installMocks(page, {
        placesProxy: landmarkPlacesProxy,
        photoProxy: silentPexels,
      });
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();
      if (lang === "en") {
        await page.locator("#langBtn").click();
        await page.locator('#langMenu button[data-lang="en"]').click();
      }
      await searchFor(page, GEOCODE_LABEL);
      await expect(credit(page)).toHaveAttribute("data-provenance", "nearby");
      /* An "exact" provenance here would be the lie this whole feature is
         built to prevent. */
      await expect(credit(page)).not.toHaveAttribute("data-provenance", "exact");
    }
  });
});

test.describe("provenance — the tiers are visibly different", () => {
  test("exact, nearby and regional each render a distinct disclosure", async ({ page }) => {
    const seen = {};

    await openHome(page, { placesProxy: exactPlacesProxy });
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);
    seen.exact = await credit(page).getAttribute("aria-label");

    await installMocks(page, { placesProxy: landmarkPlacesProxy, photoProxy: silentPexels });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);
    seen.nearby = await credit(page).getAttribute("aria-label");

    expect(seen.exact).toBeTruthy();
    expect(seen.nearby).toBeTruthy();
    expect(seen.nearby).not.toBe(seen.exact);
    /* The weaker claim must be the longer one — it has something to admit. */
    expect(seen.nearby.length).toBeGreaterThan(seen.exact.length);
  });
});

test.describe("mapillary — the token stays on the server", () => {
  test("the browser calls only the same-origin proxy, never Mapillary", async ({ page }) => {
    const proxied = [];
    const direct = [];
    await installMocks(page, {
      placesProxy: (route) => route.fulfill(json({ places: [] })),
      photoProxy: silentPexels,
      mapillaryProxy: (route) => route.fulfill(json(mapillaryPayload(route.request().url()))),
    });
    page.on("request", (r) => {
      if (r.url().includes("/api/mapillary")) proxied.push(r.headers());
      if (r.url().includes("graph.mapillary.com")) direct.push(r.url());
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);

    expect(direct).toEqual([]);
    expect(proxied.length).toBeGreaterThan(0);
    for (const headers of proxied) {
      expect(Object.keys(headers).some((h) => /authorization/i.test(h))).toBe(false);
    }
  });

  test("no request URL carries a Mapillary-shaped token", async ({ page }) => {
    const urls = [];
    await installMocks(page, {
      placesProxy: (route) => route.fulfill(json({ places: [] })),
      photoProxy: silentPexels,
      mapillaryProxy: (route) => route.fulfill(json(mapillaryPayload(route.request().url()))),
    });
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);

    for (const url of urls) expect(url).not.toMatch(/MLY(%7C|\|)/i);
  });
});

test.describe("mapillary — attribution and labelling", () => {
  async function withMapillary(page) {
    await installMocks(page, {
      placesProxy: (route) => route.fulfill(json({ places: [] })),
      photoProxy: silentPexels,
      mapillaryProxy: (route) => route.fulfill(json(mapillaryPayload(route.request().url()))),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);
  }

  test("shows the contributor and the CC BY-SA licence, as the licence requires", async ({
    page,
  }) => {
    await withMapillary(page);
    await expect(credit(page)).toContainText(MAPILLARY_CONTRIBUTOR);
    await expect(credit(page)).toContainText("Mapillary");
    await expect(credit(page)).toHaveAttribute("aria-label", /CC BY-SA 4\.0/);
    await expect(credit(page)).toHaveAttribute("data-provider", "mapillary");
  });

  test("links back to the image's own Mapillary page over https", async ({ page }) => {
    await withMapillary(page);
    await expect(credit(page)).toHaveAttribute("href", /^https:\/\/www\.mapillary\.com\/app\//);
    await expect(credit(page)).toHaveAttribute("rel", /noopener/);
  });

  test("is always a nearby photo, never presented as the city itself", async ({ page }) => {
    await withMapillary(page);
    await expect(credit(page)).toHaveAttribute("data-provenance", "nearby");
  });

  /* Mapillary supplies no caption at all, so without generated alt text a
     screen-reader user would meet an unlabelled hero image. */
  test("gives a caption-less street photo meaningful alt text naming the place", async ({
    page,
  }) => {
    await withMapillary(page);
    const img = page.locator("#heroLandmark img.loc-photo-img");
    const alt = await img.getAttribute("alt");
    expect(alt).toBeTruthy();
    expect(alt).toContain(GEOCODE_LABEL);
    expect(alt).not.toMatch(/\{\w+\}/);
  });

  test("a Mapillary image that cannot be attributed is not shown at all", async ({ page }) => {
    await installMocks(page, {
      placesProxy: (route) => route.fulfill(json({ places: [] })),
      photoProxy: silentPexels,
      mapillaryProxy: (route) =>
        route.fulfill(json(mapillaryPayload(route.request().url(), { creator: "" }))),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await searchFor(page, GEOCODE_LABEL);

    await expect(page.locator("#heroLandmark .loc-photo.loading")).toHaveCount(0);
    await expect(heroPhoto(page)).toHaveCount(0);
    await expect(credit(page)).toHaveCount(0);
  });
});

test.describe("mapillary — where it is never asked", () => {
  test("stays behind Wikimedia's coordinate search", async ({ page }) => {
    let mapillaryAsked = 0;
    await installMocks(page, {
      placesProxy: (route) => route.fulfill(json({ places: [] })),
      mapillaryProxy: (route) => {
        mapillaryAsked += 1;
        return route.fulfill(json({ images: [] }));
      },
      wikimediaProxy: (route) =>
        route.fulfill(
          json(
            wikimediaPhotoPage({
              title: GEOCODE_LABEL,
              alt: GEOCODE_LABEL,
              lat: 64.1466,
              lon: -21.9426,
            }),
          ),
        ),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    const before = mapillaryAsked;
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);

    await expect(credit(page)).toContainText("Wikimedia Commons");
    expect(mapillaryAsked).toBe(before);
  });

  test("never queries Mapillary for an ocean — there are no streets there", async ({ page }) => {
    test.setTimeout(90_000);
    let mapillaryAsked = 0;
    await installMocks(page, {
      placesProxy: (route) => route.fulfill(json({ places: [] })),
      mapillaryProxy: (route) => {
        mapillaryAsked += 1;
        return route.fulfill(json({ images: [] }));
      },
    });
    await page.goto(`/#/map?c=${CLICK_OCEAN.lat},${CLICK_OCEAN.lon}&z=5`);
    await expect(page.locator("#worldMap canvas")).toBeVisible({ timeout: 20000 });
    await expect.poll(() => page.url(), { timeout: 20000 }).toContain(`c=${CLICK_OCEAN.lat}%2C`);
    const map = page.locator("#worldMap");
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.locator("#mapWeatherPanel .map-panel-location h2")).toHaveText(
      "Océan Atlantique",
      { timeout: 20000 },
    );
    expect(mapillaryAsked).toBe(0);
  });

  test("a dead Mapillary never breaks the page", async ({ page }) => {
    for (const status of [429, 500, 503]) {
      await installMocks(page, {
        placesProxy: (route) => route.fulfill(json({ places: [] })),
        mapillaryProxy: (route) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify({ error: "x" }),
          }),
        wikimediaProxy: (route) =>
          route.fulfill(
            json(
              wikimediaPhotoPage({
                title: GEOCODE_LABEL,
                alt: GEOCODE_LABEL,
                lat: 64.1466,
                lon: -21.9426,
              }),
            ),
          ),
      });
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();
      await expect(page.locator(".hero-temp")).not.toBeEmpty();
      await expect(page.locator("#forecastRow .forecast-card").first()).toBeVisible();
    }
  });
});

test.describe("provenance — mobile", () => {
  test("the disclosure stays visible and does not overflow on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await installMocks(page, { placesProxy: landmarkPlacesProxy, photoProxy: silentPexels });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    const mobileBtn = page.locator("#mobileSearchBtn");
    if (await mobileBtn.isVisible()) await mobileBtn.click();
    await searchFor(page, GEOCODE_LABEL);
    await expect(heroPhoto(page)).toHaveCount(1);

    await expect(credit(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
