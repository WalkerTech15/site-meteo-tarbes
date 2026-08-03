import {
  test,
  expect,
  installMocks,
  GEOCODE_LABEL,
  PEXELS_PHOTOGRAPHER,
  PEXELS_ALT,
} from "./mocks.js";

test.describe("home", () => {
  test("1. homepage loads with weather data and no console errors", async ({ app }) => {
    const errors = [];
    app.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    await expect(app.locator("#heroCityName")).toBeVisible();
    await expect(app.locator(".hero-temp")).toContainText("°");
    await expect(app.locator("#metricsGrid .metric-card").first()).toBeVisible();
    await expect(app.locator("#forecastRow .forecast-card")).toHaveCount(5);
    /* live badge, not the demo fallback — the mocked API answered 200 */
    await expect(app.locator(".hero-live")).not.toContainText(/démo|demo/i);
    expect(errors).toEqual([]);
  });

  test("2. selecting a search suggestion switches location", async ({ app }) => {
    await app.locator("#searchInput").fill(GEOCODE_LABEL);
    const option = app.locator("#searchResults .search-item").first();
    await expect(option).toBeVisible();
    await option.click();

    await expect(app.locator("#searchPanel")).toBeHidden();
    await expect(app.locator("#heroCityName")).toContainText(GEOCODE_LABEL);
    await expect(app.locator("#view-home")).toBeVisible();
  });

  test("3. a failing weather API activates the demo fallback", async ({ page }) => {
    await installMocks(page, { weatherStatus: 500 });
    await page.goto("/");

    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    /* the hero badge flips from "Live" to the demo-data label */
    await expect(page.locator(".hero-live")).toContainText(/démo|demo/i);
    /* and the UI is still fully populated from the deterministic demo dataset */
    await expect(page.locator("#forecastRow .forecast-card")).toHaveCount(5);
    await expect(page.locator(".hero-temp")).toContainText("°");
  });
});

test.describe("preferences", () => {
  test("4. switching language re-renders the interface in English and back", async ({ app }) => {
    await expect(app.locator('.side-item[data-view="home"]')).toContainText("Accueil");

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(app.locator('.side-item[data-view="home"]')).toContainText("Home");
    await expect(app.locator("html")).toHaveAttribute("lang", "en");

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="fr"]').click();
    await expect(app.locator('.side-item[data-view="home"]')).toContainText("Accueil");
  });

  test("5. switching Simple/Detailed swaps the metrics grid", async ({ app }) => {
    await expect(app.locator("body")).toHaveAttribute("data-mode", "simple");
    await expect(app.locator("#metricsGrid")).toBeVisible();

    await app.locator('#modeToggle button[data-mode="detailed"]').click();
    await expect(app.locator("body")).toHaveAttribute("data-mode", "detailed");
    await expect(app.locator("#metricsGridDetailed")).toBeVisible();
    await expect(app.locator('#modeToggleSide button[data-mode="detailed"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await app.locator('#modeToggle button[data-mode="simple"]').click();
    await expect(app.locator("body")).toHaveAttribute("data-mode", "simple");
    await expect(app.locator('#modeToggleSide button[data-mode="simple"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("10. settings persist across a reload", async ({ app }) => {
    await app.locator('.side-item[data-view="settings"]').click();
    await app.locator('#chipTemp button[data-ut="f"]').click();
    await app.locator('#themeTiles .set-tile[data-theme="dark"]').click();

    await expect(app.locator("body")).toHaveAttribute("data-theme", "dark");

    await app.reload();
    await expect(app.locator("#heroCityName")).not.toBeEmpty();

    await expect(app.locator("body")).toHaveAttribute("data-theme", "dark");
    await expect(app.locator(".hero-temp")).toContainText("F");
  });
});

/* Accessible names are UI text too: a screen-reader user who picked French must
   not hear "Main navigation". These labels carry no visible text, so nothing
   else in the suite would notice them staying English. */
test.describe("bilingual accessible names", () => {
  const setLang = async (app, lang) => {
    await app.locator("#langBtn").click();
    await app.locator(`#langMenu button[data-lang="${lang}"]`).click();
    await expect(app.locator("html")).toHaveAttribute("lang", lang);
  };

  test("11. landmark and footer labels follow the interface language", async ({ app }) => {
    const sidebar = app.locator("#sidebar");
    const insights = app.locator('#view-home section[data-i18n-aria="insightsMapRegion"]');
    const footerNavs = () =>
      app
        .locator(".footer-col[aria-label]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));

    await expect(sidebar).toHaveAttribute("aria-label", "Navigation principale");
    await expect(insights).toHaveAttribute("aria-label", "Analyses météo et carte");
    expect(await footerNavs()).toEqual(["Produit", "À propos", "Ressources"]);
    await expect(app.locator('[data-i18n="footerData"]')).toHaveText(
      "Données : Open-Meteo · OpenStreetMap",
    );

    await setLang(app, "en");
    await expect(sidebar).toHaveAttribute("aria-label", "Main navigation");
    await expect(insights).toHaveAttribute("aria-label", "Insights and map");
    expect(await footerNavs()).toEqual(["Product", "About", "Resources"]);
    await expect(app.locator('[data-i18n="footerData"]')).toHaveText(
      "Data: Open-Meteo · OpenStreetMap",
    );
  });

  test("12. a country card is not named twice", async ({ app }) => {
    /* the card is a container; its accessible name lives on the open button */
    const franceCard = app.locator('.explore-card[data-loc="france"] .explore-open');
    await expect(franceCard).toHaveAttribute("aria-label", "France, pays");

    await setLang(app, "en");
    await expect(franceCard).toHaveAttribute("aria-label", "France, country");
    /* the duplication this replaces */
    await expect(app.locator('.explore-open[aria-label="France, France"]')).toHaveCount(0);
    await expect(app.locator('.explore-open[aria-label="Japan, Japan"]')).toHaveCount(0);
    await expect(app.locator('.explore-open[aria-label="Vietnam, Vietnam"]')).toHaveCount(0);

    /* cities keep place + country */
    await expect(app.locator('.explore-card[data-loc="tokyo"] .explore-open')).toHaveAttribute(
      "aria-label",
      "Tokyo, Japan",
    );
  });

  test("13. MapLibre's own control labels are translated", async ({ app }) => {
    await app.locator('.side-item[data-view="map"]').click();
    const zoomIn = app.locator("#worldMap .maplibregl-ctrl-zoom-in");
    await expect(zoomIn).toBeVisible();

    await expect(zoomIn).toHaveAttribute("aria-label", "Zoom avant");
    await expect(app.locator("#worldMap .maplibregl-ctrl-zoom-out")).toHaveAttribute(
      "aria-label",
      "Zoom arrière",
    );
    await expect(app.locator("#worldMap canvas.maplibregl-canvas")).toHaveAttribute(
      "aria-label",
      "Carte",
    );
    await expect(app.locator("#worldMap .maplibregl-ctrl-attrib-button")).toHaveAttribute(
      "aria-label",
      "Afficher ou masquer les attributions",
    );

    /* the popup's close button is rebuilt on every content refresh, from the
       locale MapLibre captured when the map was created */
    const closeBtn = app.locator("#worldMap .maplibregl-popup-close-button");
    await expect(closeBtn).toHaveAttribute("aria-label", "Fermer la fenêtre");

    /* and they follow a language switch, which MapLibre has no API for */
    await setLang(app, "en");
    await expect(zoomIn).toHaveAttribute("aria-label", "Zoom in");
    await expect(app.locator("#worldMap canvas.maplibregl-canvas")).toHaveAttribute(
      "aria-label",
      "Map",
    );
    await expect(closeBtn).toHaveAttribute("aria-label", "Close popup");
    await expect(app.locator("#worldMap .maplibregl-marker")).toHaveAttribute(
      "aria-label",
      "Map marker",
    );
  });
});

/* The explore carousel shows a real photograph per city, hydrated lazily after
   the cards are already on screen. */
test.describe("explore carousel photos", () => {
  const proxyQueries = (page) => {
    const seen = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.pathname.endsWith("/api/pexels.php")) seen.push(url.searchParams.get("query"));
    });
    return seen;
  };
  const card = (page, id) => page.locator(`.explore-card[data-loc="${id}"]`);

  test("14. each card asks for its own precise query, never a bare city name", async ({ page }) => {
    const queries = proxyQueries(page);
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    /* nothing loads until the carousel is near the viewport */
    expect(queries.some((q) => q.includes("Tokyo"))).toBe(false);

    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();
    await expect(card(page, "losangeles").locator("img.loc-photo-img")).toHaveCount(1);
    /* the carousel scrolls sideways: cards past its right edge still wait */
    expect(queries.some((q) => q.includes("Japan"))).toBe(false);

    for (const id of ["tokyo", "japan"]) {
      await card(page, id).scrollIntoViewIfNeeded();
      await expect(card(page, id).locator("img.loc-photo-img")).toHaveCount(1);
    }

    expect(queries).toContain("Paris Île-de-France France city skyline landmark");
    expect(queries).toContain("Tokyo Kantō Japan city skyline landmark");
    /* countries ask for scenery instead */
    expect(queries).toContain("Japan East Asia landscape travel");
    /* no query is ever just a place name */
    for (const q of queries) expect(q.split(" ").length).toBeGreaterThan(2);
    /* and no card asks twice */
    expect(new Set(queries).size).toBe(queries.length);
  });

  test("15. the photo replaces the emoji, with a credit", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();

    const paris = card(page, "paris");
    await expect(paris.locator(".explore-bg.has-photo")).toHaveCount(1);
    await expect(paris.locator("img.loc-photo-img")).toHaveCSS("opacity", "1");
    /* the emoji placeholder steps aside once the photograph is in */
    await expect(paris.locator(".explore-emoji")).toHaveCSS("opacity", "0");

    /* the photo is decorative: the card's button already names the place */
    await expect(paris.locator("img.loc-photo-img")).toHaveAttribute("alt", "");
    await expect(paris.locator(".explore-open")).toHaveAttribute("aria-label", "Paris, France");

    const credit = paris.locator("a.explore-credit");
    await expect(credit).toBeVisible();
    await expect(credit).toContainText(PEXELS_PHOTOGRAPHER);
    await expect(credit).toContainText("Pexels");
    await expect(credit).toHaveAttribute("target", "_blank");
    await expect(credit).toHaveAttribute("rel", "noopener noreferrer");
    await expect(credit).toHaveAttribute("href", /^https:\/\/www\.pexels\.com\//);
  });

  test("16. clicking a card still opens that location", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();

    await card(page, "tokyo").locator(".explore-open").click();
    await expect(page.locator("#view-home")).toBeVisible();
    await expect(page.locator("#heroCityName")).toContainText("Tokyo");
  });

  test("17. a failing proxy leaves the emoji and gradient in place", async ({ page }) => {
    await installMocks(page, {
      photoProxy: (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable" }),
        }),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    await expect(page.locator("#exploreCarousel .explore-bg.has-photo")).toHaveCount(0);
    await expect(page.locator("#exploreCarousel img.loc-photo-img")).toHaveCount(0);
    /* no photo → no attribution, and the emoji is still the visual */
    await expect(page.locator("#exploreCarousel .loc-credit")).toHaveCount(0);
    await expect(card(page, "paris").locator(".explore-emoji")).toHaveCSS("opacity", "0.85");
    await expect(card(page, "paris")).toBeVisible();
  });

  /* The carousel is a fixed list; it must not start following the search box,
     and the hero must keep tracking the location the user actually chose. */
  test("19. the hero photo follows the searched city, the carousel does not", async ({ page }) => {
    const queries = proxyQueries(page);
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    await expect
      .poll(() => queries.some((q) => q.startsWith(`${GEOCODE_LABEL} `) && q.includes("Iceland")))
      .toBe(true);
    /* the explore list is unchanged — still the same ten curated places */
    await expect(page.locator("#exploreCarousel .explore-card")).toHaveCount(10);
    await expect(page.locator(`.explore-card[data-loc="paris"] .explore-open`)).toHaveAttribute(
      "aria-label",
      "Paris, France",
    );
  });

  test("18. the carousel never talks to Pexels directly", async ({ page }) => {
    const requested = [];
    page.on("request", (r) => requested.push(r.url()));
    await installMocks(page);
    await page.goto("/");
    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();
    await expect(page.locator("#exploreCarousel img.loc-photo-img").first()).toHaveCount(1);

    expect(requested.some((u) => u.includes("/api/pexels.php?query="))).toBe(true);
    expect(requested.some((u) => u.includes("api.pexels.com"))).toBe(false);
  });
});

test.describe("favorites", () => {
  /* Adds the current location, opens it from the favorites view, then removes
     it — the full lifecycle through the refactored (non-nested) controls. */
  test("6. add, open and remove a favorite", async ({ app }) => {
    await app.locator("#heroFavBtn").click();
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");

    await app.locator('.side-item[data-view="favorites"]').click();
    const card = app.locator("#favGrid .favx-card");
    await expect(card).toHaveCount(1);

    /* the card is a plain <article>: the open control and the remove control
       are siblings, neither nested inside the other */
    await expect(card).not.toHaveAttribute("role", "button");
    await expect(card.locator(".favx-open")).toHaveCount(1);
    await expect(card.locator(".favx-open .favx-star")).toHaveCount(0);

    await card.locator(".favx-open").click();
    await expect(app.locator("#view-home")).toBeVisible();
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");

    await app.locator('.side-item[data-view="favorites"]').click();
    await app.locator("#favGrid .favx-star").click();
    await expect(app.locator("#favGrid .favx-card")).toHaveCount(0);
    await expect(app.locator("#favGrid .empty-state")).toBeVisible();
  });

  test("7. grid and list views are mutually exclusive", async ({ app }) => {
    await app.locator("#heroFavBtn").click();
    await app.locator('.side-item[data-view="favorites"]').click();

    /* grid view: only the card grid */
    await expect(app.locator("#favGrid")).toBeVisible();
    await expect(app.locator("#favListBlock")).toBeHidden();

    await app.locator('[data-favview="list"]').click();
    await expect(app.locator("#favListBlock")).toBeVisible();
    await expect(app.locator("#favGrid")).toBeHidden();

    /* rows are no longer focusable; the location cell holds a real button */
    const row = app.locator("#favTable tbody tr").first();
    await expect(row).not.toHaveAttribute("tabindex", "0");
    await expect(row.locator(".ft-open")).toHaveCount(1);

    await app.locator('[data-favview="grid"]').click();
    await expect(app.locator("#favGrid")).toBeVisible();
    await expect(app.locator("#favListBlock")).toBeHidden();
  });

  test("7b. a row's location button opens that location with the keyboard", async ({ app }) => {
    await app.locator("#heroFavBtn").click();
    await app.locator('.side-item[data-view="favorites"]').click();
    await app.locator('[data-favview="list"]').click();

    const openBtn = app.locator("#favTable .ft-open").first();
    await openBtn.focus();
    await app.keyboard.press("Enter");
    await expect(app.locator("#view-home")).toBeVisible();
  });
});

test.describe("photo attribution", () => {
  test("9a. a Pexels photo renders a visible, linked credit", async ({ app }) => {
    const credit = app.locator("#heroInner .loc-credit");
    await expect(credit).toBeVisible();
    await expect(credit).toContainText(PEXELS_PHOTOGRAPHER);
    await expect(credit).toContainText("Pexels");
    await expect(credit).toHaveAttribute("target", "_blank");
    await expect(credit).toHaveAttribute("rel", "noopener noreferrer");
    await expect(credit).toHaveAttribute("href", /^https:\/\/www\.pexels\.com\//);
    /* the proxy also forwards Pexels' description, used as the image's alt */
    await expect(app.locator("#heroLandmark img.loc-photo-img")).toHaveAttribute("alt", PEXELS_ALT);
  });

  test("9b. the credit is in French, and switches with the interface language", async ({ app }) => {
    await expect(app.locator("#heroInner .loc-credit")).toContainText(
      `Photo de ${PEXELS_PHOTOGRAPHER} sur Pexels`,
    );

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(app.locator("#heroInner .loc-credit")).toContainText(
      `Photo by ${PEXELS_PHOTOGRAPHER} on Pexels`,
    );
  });

  test("9c. no credit is rendered when the image is not from Pexels", async ({ page }) => {
    /* The proxy reports no match → the gradient/emoji fallback is used, and a
       fallback visual must never be credited to a photographer. */
    await installMocks(page, {
      photoProxy: (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ photo: null }),
        }),
    });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await expect(page.locator(".loc-photo.has-photo")).toHaveCount(0);
    await expect(page.locator(".loc-credit")).toHaveCount(0);
  });

  test("9d. the photo comes from the same-origin proxy, never from Pexels", async ({ page }) => {
    const requested = [];
    page.on("request", (r) => requested.push(r.url()));

    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroInner .loc-credit")).toBeVisible();

    /* the proxy was called... */
    expect(requested.some((u) => u.includes("/api/pexels.php?query="))).toBe(true);
    /* ...and the browser never went to Pexels itself, which is what would
       require shipping the API key to client code */
    expect(requested.some((u) => u.includes("api.pexels.com"))).toBe(false);
  });
});

/* Task requirement 7: every way the proxy can fail must leave the user with the
   existing gradient/emoji fallback and no server detail on screen. */
test.describe("photo proxy failures", () => {
  const failures = [
    ["missing server secret", 503, { error: "unavailable" }],
    ["Pexels rate limit", 429, { error: "rate_limited" }],
    ["upstream failure", 502, { error: "upstream_error" }],
    ["invalid query", 400, { error: "invalid_query" }],
  ];

  for (const [label, status, body] of failures) {
    test(`7. ${label} (${status}) falls back without breaking the page`, async ({ page }) => {
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

      await installMocks(page, {
        photoProxy: (route) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          }),
      });
      await page.goto("/");

      /* the app still renders completely */
      await expect(page.locator("#heroCityName")).not.toBeEmpty();
      await expect(page.locator(".hero-temp")).toContainText("°");
      /* the fallback visual is what's shown, with no photo and no credit */
      await expect(page.locator(".loc-photo.has-photo")).toHaveCount(0);
      await expect(page.locator(".loc-credit")).toHaveCount(0);
      /* and no server error text leaks into the UI */
      await expect(page.locator("body")).not.toContainText(body.error);
      expect(errors.filter((e) => !/Failed to load resource/i.test(e))).toEqual([]);
    });
  }

  test("7b. a proxy that never answers falls back once the timeout fires", async ({ page }) => {
    await installMocks(page, { photoProxy: (route) => route.abort() });
    await page.goto("/");

    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await expect(page.locator(".loc-photo.has-photo")).toHaveCount(0);
    await expect(page.locator(".loc-credit")).toHaveCount(0);
    /* the skeleton shimmer must be cleared, not left spinning forever */
    await expect(page.locator("#heroLandmark .loc-photo.loading")).toHaveCount(0);
  });
});
