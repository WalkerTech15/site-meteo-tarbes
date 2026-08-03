import {
  test,
  expect,
  installMocks,
  GEOCODE_LABEL,
  PEXELS_PHOTOGRAPHER,
  PEXELS_ALT,
  AUSTIN_LABEL,
  TARBES_LABEL,
  LYON_LABEL,
} from "./mocks.js";

async function searchAndSelect(app, query) {
  await app.locator("#searchInput").fill(query);
  const option = app.locator("#searchResults .search-item").first();
  await expect(option).toBeVisible();
  await option.click();
}

test.describe("home", () => {
  test("1. homepage loads with weather data and no console errors", async ({ app }) => {
    const errors = [];
    app.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    await expect(app.locator("#heroCityName")).toBeVisible();
    await expect(app.locator(".hero-temp")).toContainText("°");
    await expect(app.locator("#metricsTitle")).toHaveText("Aujourd'hui en bref");
    const visibleMetrics = app.locator("#metricsGrid .metric-card:visible");
    await expect(visibleMetrics).toHaveCount(4);
    await expect(app.locator('[data-metric="feelsLike"]')).toBeVisible();
    await expect(app.locator('[data-metric="humidity"]')).toBeVisible();
    await expect(app.locator('[data-metric="windSpeed"]')).toBeVisible();
    await expect(app.locator('[data-metric="rainNext12h"]')).toBeVisible();
    await expect(app.locator('[data-metric="temperature"]')).toBeHidden();
    await expect(app.locator("#homeHourlyStrip .hour-cell")).toHaveCount(6);
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

    /* The integrated panel replaces the automatic popup, but the marker keeps
       an optional accessible popup for users who explicitly select it. */
    await app.locator("#worldMap .maplibregl-marker").click();
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

test.describe("map workspace", () => {
  test("14. selected weather and popular places form one compact workspace", async ({ app }) => {
    await app.locator('.side-item[data-view="map"]').click();

    const panel = app.locator("#mapWeatherPanel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".map-panel-current strong")).toContainText("°C");
    await expect(panel.locator(".map-panel-stats > div")).toHaveCount(4);
    await expect(panel.locator(".map-hour")).toHaveCount(4);
    await expect(app.locator("#mapPopular .map-popular-place")).toHaveCount(5);

    await expect(app.locator('.map-layer[data-map-layer="satellite"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator(".map-info-grid")).toHaveCount(0);
  });

  test("15. the panel actions remain functional", async ({ app }) => {
    await app.locator('.side-item[data-view="map"]').click();

    const favorite = app.locator("#mapFavoriteBtn");
    const initial = await favorite.getAttribute("aria-pressed");
    await favorite.click();
    await expect(app.locator("#mapFavoriteBtn")).toHaveAttribute(
      "aria-pressed",
      initial === "true" ? "false" : "true",
    );

    await app.locator("#mapForecastBtn").click();
    await expect(app.locator("#view-forecast")).toBeVisible();
  });

  test("16. closing the panel confirms, hides nothing permanently, and can be undone", async ({
    app,
  }) => {
    await app.locator('.side-item[data-view="map"]').click();
    const panel = app.locator("#mapWeatherPanel");
    const close = app.locator("#mapPanelClose");
    const show = app.locator("#mapShowPanel");

    await close.click();
    await expect(app.locator("#confirmDialog")).toBeVisible();
    await expect(app.locator("#confirmDialogMessage")).toContainText(
      "Aucun lieu ni aucune donnée météo ne sera supprimé",
    );
    await expect(app.locator("#confirmDialogConfirm")).toHaveClass(/confirm-dialog-danger/);
    await app.locator("#confirmDialogCancel").click();
    await expect(panel).toBeVisible();
    await expect(close).toBeFocused();

    await close.click();
    await app.locator("#confirmDialogConfirm").click();
    await expect(panel).toBeHidden();
    await expect(show).toBeVisible();
    await expect(show).toBeFocused();

    await show.click();
    await expect(panel).toBeVisible();
    await expect(close).toBeFocused();
  });
});

/* The geographic identity box (core/geo-identity.js) at the top of the map's
   weather panel. Every location here is searched dynamically through the
   mocked MapTiler geocoder — none of Austin, Tarbes or Lyon is a curated
   data/locations.js entry — so these prove the box works for any resolved
   place, not just hard-coded cities. */
test.describe("geographic identity box", () => {
  test("31. a US city shows its state flag and a Texas, États-Unis hierarchy", async ({ app }) => {
    /* search always returns to Home (see test 2) — select first, then open
       Map to see the panel it fed. */
    await searchAndSelect(app, AUSTIN_LABEL);
    await app.locator('.side-item[data-view="map"]').click();

    const panel = app.locator("#mapWeatherPanel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".map-panel-location h2")).toHaveText(AUSTIN_LABEL);
    await expect(panel.locator(".map-panel-location p")).toHaveText("Ville");

    const identity = panel.locator(".geo-identity");
    const chips = identity.locator(".geo-chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText("États-Unis");
    await expect(chips.nth(1)).toContainText("Texas");
    /* both are real flags — neither falls back to the neutral icon */
    await expect(identity.locator(".geo-chip-flag")).toHaveCount(2);
    await expect(identity.locator(".geo-chip-icon")).toHaveCount(0);
    await expect(identity.locator(".geo-hierarchy")).toHaveText("Texas, États-Unis");
    await expect(identity).toHaveAttribute("aria-label", "Austin, Ville, États-Unis, Texas");
  });

  test("32. a French city shows France and its region without duplicating either", async ({
    app,
  }) => {
    await searchAndSelect(app, TARBES_LABEL);
    await app.locator('.side-item[data-view="map"]').click();

    const identity = app.locator("#mapWeatherPanel .geo-identity");
    await expect(identity).toBeVisible();
    const chips = identity.locator(".geo-chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText("France");
    await expect(chips.nth(1)).toContainText("Occitanie");
    /* Occitanie is one of the few French regions with a supported flag */
    await expect(identity.locator(".geo-chip-flag")).toHaveCount(2);
    await expect(identity.locator(".geo-hierarchy")).toHaveText("Occitanie, France");
    /* never a bare "France, France" */
    await expect(identity).not.toHaveAttribute("aria-label", /France, France/);
  });

  test("33. a region with no supported flag falls back to the neutral icon, never a guess", async ({
    app,
  }) => {
    await searchAndSelect(app, LYON_LABEL);
    await app.locator('.side-item[data-view="map"]').click();

    const identity = app.locator("#mapWeatherPanel .geo-identity");
    await expect(identity).toBeVisible();
    const chips = identity.locator(".geo-chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText("France"); /* the country flag IS supported */
    await expect(chips.nth(1)).toContainText("Auvergne-Rhône-Alpes");
    await expect(identity.locator(".geo-chip-flag")).toHaveCount(1); /* country only */
    await expect(identity.locator(".geo-chip-icon")).toHaveCount(1); /* region: neutral pin */
    await expect(identity.locator(".geo-hierarchy")).toHaveText("Auvergne-Rhône-Alpes, France");
  });

  test("34. it relabels itself when the interface language changes", async ({ app }) => {
    await searchAndSelect(app, AUSTIN_LABEL);
    await app.locator('.side-item[data-view="map"]').click();
    const identity = app.locator("#mapWeatherPanel .geo-identity");
    await expect(identity).toBeVisible();
    await expect(identity.locator(".geo-hierarchy")).toHaveText("Texas, États-Unis");

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(identity.locator(".geo-hierarchy")).toHaveText("Texas, United States");
    await expect(identity).toHaveAttribute("aria-label", "Austin, City, United States, Texas");
    await expect(app.locator("#mapWeatherPanel .map-panel-location p")).toHaveText("City");
  });

  test("35. a country result shows no duplicate chip or hierarchy line", async ({ app }) => {
    /* France itself — a curated kind:"country" entry, picked from the Explore
       carousel — is the other end of the dedup rule proven in test 32. */
    await app.locator('.explore-card[data-loc="france"] .explore-open').click();
    await app.locator('.side-item[data-view="map"]').click();

    const panel = app.locator("#mapWeatherPanel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".map-panel-location h2")).toHaveText("France");
    const identity = panel.locator(".geo-identity");
    await expect(identity).toHaveCount(0);
  });
});

/* The Monde/France/États-Unis/Canada country-jump pills above the map card. */
test.describe("country filter chips", () => {
  const CHIP_IDS = ["world", "france", "usa", "canada"];
  const chip = (app, id) => app.locator(`.chip[data-jump="${id}"]`);

  test("36. every flag and the globe icon share one fixed box, never stretching the pill", async ({
    app,
  }) => {
    await app.locator('.side-item[data-view="map"]').click();
    await expect(app.locator(".map-filters .chip")).toHaveCount(4);

    const pillHeights = await app
      .locator(".map-filters .chip")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(new Set(pillHeights).size).toBe(1); /* one consistent pill height for all four */

    const iconBoxes = await app.locator(".map-filters .chip-icon").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      }),
    );
    expect(iconBoxes).toHaveLength(4);
    expect(new Set(iconBoxes).size).toBe(1); /* globe + FR + US + CA: identical box */

    /* the flag images themselves are cropped to that box (object-fit: cover),
       never stretched out of their native aspect ratio */
    await expect(app.locator('.chip[data-jump="usa"] .chip-icon .flag')).toHaveCSS(
      "object-fit",
      "cover",
    );
  });

  test("37. clicking each filter moves the active state and leaves the map error-free", async ({
    app,
  }) => {
    await app.locator('.side-item[data-view="map"]').click();
    const errors = [];
    app.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    await expect(chip(app, "world")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(app, "world")).toHaveClass(/is-active/);

    for (const id of ["france", "usa", "canada", "world"]) {
      await chip(app, id).click();
      await expect(chip(app, id)).toHaveAttribute("aria-pressed", "true");
      await expect(chip(app, id)).toHaveClass(/is-active/);
      for (const other of CHIP_IDS.filter((x) => x !== id)) {
        await expect(chip(app, other)).toHaveAttribute("aria-pressed", "false");
        await expect(chip(app, other)).not.toHaveClass(/is-active/);
      }
    }
    await app.waitForTimeout(1300); /* let the last flyTo animation finish cleanly */
    expect(errors.filter((e) => !/Failed to load resource/i.test(e))).toEqual([]);
  });

  test("38. keyboard activation works on every filter", async ({ app }) => {
    await app.locator('.side-item[data-view="map"]').click();
    await chip(app, "france").focus();
    await expect(chip(app, "france")).toBeFocused();
    await app.keyboard.press("Enter");
    await expect(chip(app, "france")).toHaveAttribute("aria-pressed", "true");

    await app.keyboard.press("Tab");
    await expect(chip(app, "usa")).toBeFocused();
    await app.keyboard.press(" ");
    await expect(chip(app, "usa")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(app, "france")).toHaveAttribute("aria-pressed", "false");
  });

  test("39. labels follow the interface language", async ({ app }) => {
    await app.locator('.side-item[data-view="map"]').click();
    await expect(chip(app, "world")).toContainText("Monde");
    await expect(chip(app, "usa")).toContainText("États-Unis");

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(chip(app, "world")).toContainText("World");
    await expect(chip(app, "usa")).toContainText("United States");
    /* the active selection survives the relabel */
    await expect(chip(app, "world")).toHaveAttribute("aria-pressed", "true");
  });

  test("40. the pills stay readable in dark mode", async ({ app }) => {
    await app.locator('.side-item[data-view="settings"]').click();
    await app.locator('#themeTiles .set-tile[data-theme="dark"]').click();
    await app.locator('.side-item[data-view="map"]').click();

    const active = chip(app, "world");
    const inactive = chip(app, "france");
    await expect(active).toBeVisible();
    const activeBg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
    const inactiveBg = await inactive.evaluate((el) => getComputedStyle(el).backgroundColor);
    /* the two states still read as visually distinct, not both defaulting to
       the same flat surface */
    expect(activeBg).not.toBe(inactiveBg);
    expect(inactiveBg).not.toBe("rgb(255, 255, 255)");
  });
});

/* In-page forecast advisories. Nothing here may ask for a notification
   permission or register a service worker — the banner is on-page only. */
test.describe("forecast advisory banner", () => {
  const region = (page) => page.locator("#advisoryRegion");
  const cards = (page) => page.locator("#advisoryList .advisory");

  /* Records any attempt to reach for the browser's notification machinery. */
  async function watchNotificationApis(page) {
    await page.addInitScript(() => {
      window.__notifyCalls = [];
      const record = (what) => window.__notifyCalls.push(what);
      if (window.Notification)
        window.Notification.requestPermission = () => {
          record("Notification.requestPermission");
          return Promise.resolve("denied");
        };
      if (navigator.serviceWorker) {
        const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register = (...a) => {
          record("serviceWorker.register");
          return register(...a);
        };
      }
    });
  }

  test("20. no banner for ordinary weather", async ({ app }) => {
    await expect(region(app)).toBeHidden();
    await expect(cards(app)).toHaveCount(0);
  });

  test("21. hazardous weather raises a banner, most urgent first", async ({ page }) => {
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await expect(region(page)).toBeVisible();
    /* storm outranks the 88 km/h gusts that the same forecast also triggers */
    await expect(cards(page).first()).toContainText("Orages");
    await expect(cards(page).nth(1)).toContainText("Vent fort");
    await expect(cards(page).first()).toHaveClass(/is-primary/);
    await expect(cards(page).nth(1)).toHaveClass(/is-secondary/);
    await expect(cards(page)).toHaveCount(2);
    /* never more than three, however many hazards coincide */
    expect(await cards(page).count()).toBeLessThanOrEqual(3);
    /* the blocked third-party webfont is the suite's own doing, not the app's */
    expect(errors.filter((e) => !/Failed to load resource/i.test(e))).toEqual([]);
  });

  test("22. it is announced politely and reads without colour", async ({ page }) => {
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await expect(region(page)).toBeVisible();

    const list = page.locator("#advisoryList");
    await expect(list).toHaveAttribute("role", "status");
    await expect(list).toHaveAttribute("aria-live", "polite");
    /* the region is labelled, and the severity is spelled out, not just tinted */
    await expect(region(page)).toHaveAttribute("aria-labelledby", "advisoryRegionTitle");
    await expect(page.locator("#advisoryRegionTitle")).toHaveText("Conseils météo");
    await expect(cards(page).first().locator(".adv-sev")).toHaveText("Élevé");
    /* every card states its window and its advice in words */
    await expect(cards(page).first()).toContainText("Période");
    await expect(cards(page).first()).toContainText("Conseil");
    /* the icon adds nothing a screen reader needs */
    await expect(cards(page).first().locator(".adv-icon")).toHaveAttribute("aria-hidden", "true");
  });

  test("23. the wording is forecast-based and says it is not official", async ({ page }) => {
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await expect(region(page)).toBeVisible();

    const disclaimer = page.locator("#advisoryList .adv-disclaimer");
    await expect(disclaimer).toHaveText(
      "Basé sur les prévisions, ce message n'est pas une alerte officielle.",
    );
    await expect(cards(page).first()).toContainText("Conseil météo basé sur les prévisions");
    await expect(cards(page).first()).toContainText("Des orages sont possibles.");
    /* "alerte officielle" may appear only inside the phrase that denies it */
    const text = await region(page).innerText();
    expect((text.match(/alerte officielle/g) || []).length).toBe(
      (text.match(/n'est pas une alerte officielle/g) || []).length,
    );
    await expect(region(page)).not.toContainText(/urgence|garanti/i);

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(disclaimer).toHaveText("Based on forecast data, not an official emergency alert.");
    await expect(cards(page).first()).toContainText("Forecast advisory");
    await expect(cards(page).first()).toContainText("Thunderstorms");
    await expect(cards(page).first()).toContainText("Thunderstorms are possible.");
  });

  test("24. values follow the chosen units, detection does not", async ({ page }) => {
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    const wind = cards(page).nth(1);
    await expect(wind).toContainText("88 km/h");

    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator('#chipWind button[data-uw="mph"]').click();
    await page.locator('.side-item[data-view="home"]').click();

    /* 88 km/h ≈ 55 mph: the number changes, the advisory itself does not */
    await expect(wind).toContainText("55 mph");
    await expect(cards(page)).toHaveCount(2);
  });

  test("25. changing location updates the banner and leaves nothing stale", async ({ page }) => {
    /* Paris (the default) is stormy; the searched city is calm. */
    await installMocks(page, {
      weatherKind: (url) => (url.includes("latitude=64.1355") ? "calm" : "storm"),
    });
    await page.goto("/");
    await expect(region(page)).toBeVisible();
    await expect(cards(page).first()).toContainText("Orages");

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    /* the previous city's storm must not survive the move */
    await expect(region(page)).toBeHidden();
    await expect(cards(page)).toHaveCount(0);
  });

  test("26. it survives Simple and Detailed without disturbing the layout", async ({ page }) => {
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await expect(region(page)).toBeVisible();

    const box = async () => (await region(page).boundingBox()) || { y: 0, height: 0 };
    for (const mode of ["detailed", "simple"]) {
      await page.locator(`#modeToggle button[data-mode="${mode}"]`).click();
      await expect(page.locator("body")).toHaveAttribute("data-mode", mode);
      await expect(region(page)).toBeVisible();
      const advisory = await box();
      const grid = (await page.locator(".home-grid").boundingBox()) || { y: 0, height: 0 };
      /* directly under the current conditions, with no gap left over */
      expect(advisory.y).toBeGreaterThan(grid.y);
      expect(advisory.y - (grid.y + grid.height)).toBeLessThan(40);
      expect(advisory.height).toBeGreaterThan(0);
    }
  });

  test("27. it asks for no notification permission and registers no worker", async ({ page }) => {
    await watchNotificationApis(page);
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await expect(region(page)).toBeVisible();
    /* flipping a prototype notification switch must not change that either */
    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator('#view-settings .switch[data-notif="alerts"]').click();

    expect(await page.evaluate(() => window.__notifyCalls)).toEqual([]);
    expect(await page.evaluate(() => (window.Notification || {}).permission ?? "default")).not.toBe(
      "granted",
    );
    expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull();
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
    await expect(credit).toHaveText("Pexels ↗");
    await expect(credit).toHaveAttribute(
      "aria-label",
      `Photo de ${PEXELS_PHOTOGRAPHER} sur Pexels`,
    );
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
  /* Adds the current location, opens it, safely confirms removal, then uses
     the toast action to restore it. */
  test("6. removing a favorite asks for confirmation and can be undone", async ({ app }) => {
    await app.locator("#heroFavBtn").click();
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");

    await app.locator('.side-item[data-view="favorites"]').click();
    const card = app.locator("#favGrid .favx-card");
    await expect(card).toHaveCount(1);

    /* Saved places use the same protected photo proxy as the hero. The image
       is decorative because the card's open button already names the place. */
    await expect(card.locator("img.loc-photo-img")).toHaveCount(1);
    await expect(card.locator("img.loc-photo-img")).toHaveAttribute("alt", "");
    await expect(card.locator("a.favx-credit")).toBeVisible();
    await expect(card.locator("a.favx-credit")).toHaveText("Pexels ↗");
    await expect(card.locator("a.favx-credit")).toHaveAttribute(
      "aria-label",
      `Photo de ${PEXELS_PHOTOGRAPHER} sur Pexels`,
    );

    /* the card is a plain <article>: the open control and the remove control
       are siblings, neither nested inside the other */
    await expect(card).not.toHaveAttribute("role", "button");
    await expect(card.locator(".favx-open")).toHaveCount(1);
    await expect(card.locator(".favx-open .favx-star")).toHaveCount(0);

    await card.locator(".favx-open").click();
    await expect(app.locator("#view-home")).toBeVisible();
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");

    await app.locator('.side-item[data-view="favorites"]').click();
    const remove = app.locator("#favGrid .favx-star");
    await remove.click();
    await expect(remove).toHaveClass(/is-confirming/);
    await expect(app.locator("#confirmDialog")).toBeVisible();
    await expect(app.locator("#confirmDialogConfirm")).toHaveClass(/confirm-dialog-danger/);
    const dialogBox = await app.locator("#confirmDialog").boundingBox();
    expect(dialogBox.width).toBeLessThanOrEqual(380);

    /* Cancel is safe and returns focus to the original remove control. */
    await app.locator("#confirmDialogCancel").click();
    await expect(app.locator("#favGrid .favx-card")).toHaveCount(1);
    await expect(remove).toBeFocused();

    await remove.click();
    await app.locator("#confirmDialogConfirm").click();
    await expect(app.locator("#favGrid .favx-card")).toHaveCount(0);
    await expect(app.locator("#favGrid .empty-state")).toBeVisible();

    /* The actionable toast restores the same favorite and its card. */
    await expect(app.locator("#toast .toast-action")).toContainText("Annuler la suppression");
    await app.locator("#toast .toast-action").click();
    await expect(app.locator("#favGrid .favx-card")).toHaveCount(1);
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
    await expect(row.locator(".ft-visual img.loc-photo-img")).toHaveAttribute("alt", "");
    await expect(row.locator(".ft-place-cell > a.ft-credit")).toBeVisible();
    /* The attribution remains a sibling of the location button, never an
       invalid interactive link nested inside a button. */
    await expect(row.locator(".ft-open a")).toHaveCount(0);

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
  test("9a. a Pexels photo renders a compact, linked source", async ({ app }) => {
    const credit = app.locator("#heroInner .loc-credit");
    await expect(credit).toBeVisible();
    await expect(credit).toHaveText("Pexels ↗");
    await expect(credit).toHaveAttribute(
      "aria-label",
      `Photo de ${PEXELS_PHOTOGRAPHER} sur Pexels`,
    );
    await expect(credit).toHaveAttribute("target", "_blank");
    await expect(credit).toHaveAttribute("rel", "noopener noreferrer");
    await expect(credit).toHaveAttribute("href", /^https:\/\/www\.pexels\.com\//);
    /* the proxy also forwards Pexels' description, used as the image's alt */
    await expect(app.locator("#heroLandmark img.loc-photo-img")).toHaveAttribute("alt", PEXELS_ALT);
  });

  test("9b. the full accessible credit switches with the interface language", async ({ app }) => {
    await expect(app.locator("#heroInner .loc-credit")).toHaveAttribute(
      "aria-label",
      `Photo de ${PEXELS_PHOTOGRAPHER} sur Pexels`,
    );

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(app.locator("#heroInner .loc-credit")).toHaveText("Pexels ↗");
    await expect(app.locator("#heroInner .loc-credit")).toHaveAttribute(
      "aria-label",
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
