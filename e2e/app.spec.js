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

test.describe("settings page", () => {
  const goToSettings = (app) => app.locator('.side-item[data-view="settings"]').click();

  test("62. every display-mode control uses the same Simple-then-Détaillé order", async ({
    app,
  }) => {
    const headerOrder = await app
      .locator("#modeToggle button")
      .evaluateAll((els) => els.map((el) => el.dataset.mode));
    const sideOrder = await app
      .locator("#modeToggleSide button")
      .evaluateAll((els) => els.map((el) => el.dataset.mode));
    await goToSettings(app);
    const settingsOrder = await app
      .locator("#modeTiles .set-tile")
      .evaluateAll((els) => els.map((el) => el.dataset.mode));

    expect(headerOrder).toEqual(["simple", "detailed"]);
    expect(sideOrder).toEqual(["simple", "detailed"]);
    expect(settingsOrder).toEqual(["simple", "detailed"]);
  });

  test("63. changing mode from the settings tiles updates every other control immediately", async ({
    app,
  }) => {
    await goToSettings(app);
    await app.locator('#modeTiles .set-tile[data-mode="detailed"]').click();

    await expect(app.locator("body")).toHaveAttribute("data-mode", "detailed");
    await expect(app.locator('#modeToggle button[data-mode="detailed"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#modeToggleSide button[data-mode="detailed"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#modeTiles .set-tile[data-mode="detailed"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#modeTiles .set-tile[data-mode="simple"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );

    /* the reverse direction: header controls the settings tiles too */
    await app.locator('#modeToggle button[data-mode="simple"]').click();
    await expect(app.locator('#modeTiles .set-tile[data-mode="simple"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("64. mode persists after a reload", async ({ app }) => {
    await goToSettings(app);
    await app.locator('#modeTiles .set-tile[data-mode="detailed"]').click();
    await app.reload();
    await expect(app.locator("#heroCityName")).not.toBeEmpty();
    await expect(app.locator("body")).toHaveAttribute("data-mode", "detailed");
    await expect(app.locator('#modeToggle button[data-mode="detailed"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("65. the mode tiles keep correct French and English labels in order", async ({ app }) => {
    await goToSettings(app);
    const texts = () =>
      app.locator("#modeTiles .set-tile b").evaluateAll((els) => els.map((el) => el.textContent));
    expect(await texts()).toEqual(["Simple", "Détaillé"]);

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    expect(await texts()).toEqual(["Simple", "Detailed"]);
  });

  test("66. the System theme preview is a clean two-half swatch, not a gradient", async ({
    app,
  }) => {
    await goToSettings(app);
    const halves = app.locator(".tprev-sys .tprev-sys-half");
    await expect(halves).toHaveCount(2);
    const backgrounds = await halves.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).backgroundImage),
    );
    /* solid colours only — no gradient anywhere in the swatch */
    expect(backgrounds.every((b) => b === "none")).toBe(true);
    /* decorative preview, hidden as a whole; the visible label does the naming */
    await expect(app.locator('.set-tile[data-theme="system"] .tprev')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(app.locator('.set-tile[data-theme="system"] b')).toHaveText("Système");
  });

  test("67. the System theme follows the operating system colour scheme", async ({ app }) => {
    await goToSettings(app);
    await app.locator('#themeTiles .set-tile[data-theme="system"]').click();
    await expect(app.locator('#themeTiles .set-tile[data-theme="system"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await app.emulateMedia({ colorScheme: "dark" });
    await expect(app.locator("body")).toHaveAttribute("data-theme", "dark");

    await app.emulateMedia({ colorScheme: "light" });
    await expect(app.locator("body")).toHaveAttribute("data-theme", "light");
  });

  test("68. theme selection persists after a reload", async ({ app }) => {
    await goToSettings(app);
    await app.locator('#themeTiles .set-tile[data-theme="dark"]').click();
    await app.reload();
    await expect(app.locator("#heroCityName")).not.toBeEmpty();
    await expect(app.locator("body")).toHaveAttribute("data-theme", "dark");
    await expect(app.locator('#themeTiles .set-tile[data-theme="dark"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("69. mode, language and theme tiles expose radiogroup/radio semantics", async ({ app }) => {
    await goToSettings(app);
    for (const id of ["langTiles", "modeTiles", "themeTiles"]) {
      await expect(app.locator(`#${id}`)).toHaveAttribute("role", "radiogroup");
      const radios = app.locator(`#${id} .set-tile`);
      const count = await radios.count();
      expect(count).toBeGreaterThan(0);
      for (const role of await radios.evaluateAll((els) =>
        els.map((el) => el.getAttribute("role")),
      )) {
        expect(role).toBe("radio");
      }
    }
  });

  test("70. settings radio tiles can be activated from the keyboard", async ({ app }) => {
    await goToSettings(app);
    const detailed = app.locator('#modeTiles .set-tile[data-mode="detailed"]');
    await detailed.focus();
    await expect(detailed).toBeFocused();
    await app.keyboard.press("Enter");
    await expect(detailed).toHaveAttribute("aria-checked", "true");
    await expect(app.locator("body")).toHaveAttribute("data-mode", "detailed");
  });

  test("71. resetting the app asks for confirmation through the shared dialog, not a native popup", async ({
    app,
  }) => {
    await app.locator("#heroFavBtn").click(); /* something for reset to actually erase */
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");
    await goToSettings(app);

    const reset = app.locator('.priv-tile[data-priv="cache"]');
    await reset.click();
    await expect(app.locator("#confirmDialog")).toBeVisible();
    await expect(app.locator("#confirmDialogConfirm")).toHaveClass(/confirm-dialog-danger/);

    /* cancelling changes nothing */
    await app.locator("#confirmDialogCancel").click();
    await expect(app.locator("#confirmDialog")).toBeHidden();
    await expect(reset).toBeFocused();
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");

    /* confirming clears storage and reloads */
    await reset.click();
    await Promise.all([
      app.waitForEvent("load", { timeout: 5000 }),
      app.locator("#confirmDialogConfirm").click(),
    ]);
    await expect(app.locator("#heroCityName")).not.toBeEmpty();
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "false");
    await expect(app.locator("body")).toHaveAttribute("data-mode", "simple");
  });

  test("72. location and privacy tiles perform their stated action", async ({ app }) => {
    await goToSettings(app);
    await app.locator('.priv-tile[data-priv="location"]').click();
    await expect(app.locator("#toast")).toBeVisible();

    await app.locator('.priv-tile[data-priv="privacy"]').click();
    await expect(app.locator("#view-privacy")).toBeVisible();
  });

  test("73. exporting data includes preferences but never a key or credential", async ({ app }) => {
    await goToSettings(app);
    const [download] = await Promise.all([
      app.waitForEvent("download"),
      app.locator('.priv-tile[data-priv="export"]').click(),
    ]);
    expect(download.suggestedFilename()).toBe("weathersphere-data.json");

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    const data = JSON.parse(text);

    expect(data.settings).toMatchObject({ lang: "fr", mode: "simple" });
    expect(data).toHaveProperty("favorites");
    expect(text).not.toMatch(/pexels_api_key|maptiler_key|VITE_[A-Z_]*KEY/i);
  });

  test("74. the prototype notification switches persist locally", async ({ app }) => {
    await goToSettings(app);
    const alerts = app.locator('.switch[data-notif="alerts"]');
    await expect(alerts).toHaveAttribute("aria-checked", "true");
    await alerts.click();
    await expect(alerts).toHaveAttribute("aria-checked", "false");

    await app.reload();
    await goToSettings(app);
    await expect(app.locator('.switch[data-notif="alerts"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("75. the settings page has no horizontal overflow at phone width", async ({ app }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    await app.locator("#burgerBtn").click();
    await goToSettings(app);
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(app.locator("#modeTiles")).toBeVisible();
  });

  test("76. no application console errors while exercising the settings controls", async ({
    app,
  }) => {
    const errors = [];
    app.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await goToSettings(app);
    await app.locator('#modeTiles .set-tile[data-mode="detailed"]').click();
    await app.locator('#themeTiles .set-tile[data-theme="system"]').click();
    await app.locator('#langTiles .set-tile[data-lang="en"]').click();
    await app.locator('.switch[data-notif="daily"]').click();
    expect(errors).toEqual([]);
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

test.describe("map visual polish", () => {
  test('41. "New York" and every other popular-location name display in full, with no page overflow', async ({
    app,
  }) => {
    await app.locator('.side-item[data-view="map"]').click();
    const cards = app.locator(".map-popular-place");
    await expect(cards).toHaveCount(5);

    const truncated = await cards.evaluateAll((els) =>
      els
        .map((el) => el.querySelector("b"))
        .filter((b) => b.scrollWidth > b.clientWidth + 1)
        .map((b) => b.textContent),
    );
    expect(truncated).toEqual([]);

    /* the fix must not cost New York its country + state flag pair */
    const newYork = app.locator('.map-popular-place[data-loc="newyork"]');
    await expect(newYork).toContainText("New York");
    await expect(newYork.locator(".location-flag-wrap")).toHaveCount(2);

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("42. every map-layer button uses an SVG icon, not the old text glyph", async ({ app }) => {
    await app.locator('.side-item[data-view="map"]').click();
    const buttons = app.locator(".map-layer");
    await expect(buttons).toHaveCount(4);

    const icons = await buttons.evaluateAll((els) =>
      els.map((el) => ({
        hasSvg: !!el.querySelector(".map-layer-icon svg"),
        text: el.textContent,
      })),
    );
    for (const { hasSvg, text } of icons) {
      expect(hasSvg).toBe(true);
      expect(text).not.toMatch(/[▱♨☂≋]/); /* the retired text symbols */
    }
    /* decorative — the visible, translated label already names the control */
    await expect(
      app.locator('.map-layer[data-map-layer="satellite"] .map-layer-icon'),
    ).toHaveAttribute("aria-hidden", "true");
  });

  test("43. the layer controls keep their radiogroup contract and bilingual labels", async ({
    app,
  }) => {
    await app.locator('.side-item[data-view="map"]').click();
    await expect(app.locator(".map-layer-switcher")).toHaveAttribute("role", "radiogroup");
    const satellite = app.locator('.map-layer[data-map-layer="satellite"]');
    await expect(satellite).toHaveAttribute("role", "radio");
    await expect(satellite).toHaveAttribute("aria-checked", "true");
    await expect(app.locator('.map-layer[data-map-layer="temperature"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(app.locator('.map-layer[data-map-layer="temperature"]')).toContainText(
      "Température",
    );

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(app.locator('.map-layer[data-map-layer="temperature"]')).toContainText(
      "Temperature",
    );
    await expect(satellite).toHaveAttribute("aria-checked", "true"); /* survives the relabel */
  });

  test("44. the selected marker carries a persistent, clearly visible focus ring", async ({
    app,
  }) => {
    await app.locator('.side-item[data-view="map"]').click();
    const ring = app.locator("#worldMap .maplibregl-marker .map-focus-ring");
    await expect(ring).toHaveCount(1);
    await expect(ring).toBeVisible();
    const box = await ring.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeLessThanOrEqual(56);
    /* the central marker dot stays present and on top of the ring */
    await expect(app.locator("#worldMap .maplibregl-marker .map-dot")).toBeVisible();
  });

  test("45. reduced motion keeps the arrival pulse finite, never a continuous animation", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator('.side-item[data-view="map"]').click();

    const ping = page.locator("#worldMap .maplibregl-marker .map-ping");
    await expect(ping).toHaveCount(1);
    const iterationCount = await ping.evaluate(
      (el) => getComputedStyle(el).animationIterationCount,
    );
    expect(iterationCount).not.toBe("infinite");

    await page.waitForTimeout(500);
    const opacityAfter = await ping.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    expect(opacityAfter).toBe(0); /* settled at its finished state, not still cycling */

    /* the static focus ring itself carries no animation to begin with */
    const ringAnimation = await page
      .locator("#worldMap .maplibregl-marker .map-focus-ring")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(ringAnimation).toBe("none");
  });
});

test.describe("forecast page polish", () => {
  /* Fixture hourly precipitation_probability is `(i % 10) * 5`; the forecast
     page samples every 3rd hour and keeps the first 8 (indices 0,3,...,21),
     so the peak is index 9 → 45% at 09:00. */
  const goToForecast = (app) => app.locator('.side-item[data-view="forecast"]').click();

  test("46. the precipitation card reports the true peak and its time, in French", async ({
    app,
  }) => {
    await goToForecast(app);
    await expect(app.locator("#precipSummary")).toHaveText("Risque maximal : 45 % vers 9 h");
  });

  test("47. the precipitation summary re-renders in English and stays correct after a new search", async ({
    app,
  }) => {
    await goToForecast(app);
    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(app.locator("#precipSummary")).toHaveText("Maximum chance: 45% around 9 AM");

    /* searching always lands back on Home; the forecast page for the newly
       selected place must still show a correct, non-stale summary. */
    await app.locator("#searchInput").fill(GEOCODE_LABEL);
    await app.locator("#searchResults .search-item").first().click();
    await goToForecast(app);
    await expect(app.locator("#forecastViewSub")).toContainText(GEOCODE_LABEL);
    await expect(app.locator("#precipSummary")).toHaveText("Maximum chance: 45% around 9 AM");
  });

  test("48. the temperature chart axis carries the active unit and updates when it changes", async ({
    app,
  }) => {
    await goToForecast(app);
    const axisText = () => app.locator("#fcChartHost svg text").allTextContents();
    await expect.poll(async () => (await axisText()).some((s) => /°C/.test(s))).toBe(true);

    await app.locator('.side-item[data-view="settings"]').click();
    await app.locator('#chipTemp button[data-ut="f"]').click();
    await goToForecast(app);
    await expect.poll(async () => (await axisText()).some((s) => /°F/.test(s))).toBe(true);
    await expect.poll(async () => (await axisText()).some((s) => /°C/.test(s))).toBe(false);
  });

  test("49. the wind and precipitation chart tabs use their own units on the axis", async ({
    app,
  }) => {
    await goToForecast(app);
    const axisText = () => app.locator("#fcChartHost svg text").allTextContents();

    await app.locator('#fcTabs button[data-tab="wind"]').click();
    await expect.poll(async () => (await axisText()).some((s) => /km\/h/.test(s))).toBe(true);

    await app.locator('#fcTabs button[data-tab="precip"]').click();
    await expect.poll(async () => (await axisText()).some((s) => /%/.test(s))).toBe(true);
  });

  test("50. the day carousel shows a right fade that yields to a left fade while scrolling", async ({
    app,
  }) => {
    await goToForecast(app);
    const left = app.locator("#fcFadeLeft");
    const right = app.locator("#fcFadeRight");
    const row = app.locator("#forecastRow2");

    /* 7 daily cards overflow the row at desktop width, so it starts pinned
       to the left: only the right fade hints at more content. */
    await expect(right).toHaveClass(/is-visible/);
    await expect(left).not.toHaveClass(/is-visible/);
    expect(await left.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    expect(await right.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

    await row.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(left).toHaveClass(/is-visible/);
    await expect(right).not.toHaveClass(/is-visible/);

    /* dragging/clicking through the carousel must still work — the fades sit
       over it with pointer-events: none, not as a blocking overlay. */
    await app.locator("#fcPrev").click();
    await expect
      .poll(async () => row.evaluate((el) => el.scrollLeft))
      .toBeLessThan(await row.evaluate((el) => el.scrollWidth));
  });

  test("51. the forecast page has no page-level horizontal overflow", async ({ app }) => {
    await goToForecast(app);
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("about page", () => {
  const goToAbout = (app) => app.locator('.side-item[data-view="about"]').click();

  test("52. the wording accurately describes periodic, not real-time, updates", async ({ app }) => {
    await goToAbout(app);
    await expect(app.locator('[data-i18n="feat2T"]')).toHaveText("Mises à jour régulières");
    await expect(app.locator('[data-i18n="feat2X"]')).toHaveText(
      "Les conditions météo sont actualisées régulièrement afin de vous fournir des informations récentes.",
    );

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(app.locator('[data-i18n="feat2T"]')).toHaveText("Regular updates");
    await expect(app.locator('[data-i18n="feat2X"]')).toHaveText(
      "Weather conditions are refreshed regularly to provide recent information.",
    );
  });

  test("53. the privacy explanation covers permission, local storage and no user accounts", async ({
    app,
  }) => {
    await goToAbout(app);
    const privacyCard = app.locator('[data-i18n="feat4X"]');
    await expect(privacyCard).toContainText("autorisation");
    await expect(privacyCard).toContainText(/localement/);

    const privacyNote = app.locator('[data-i18n="aboutPrivacyNote"]');
    await expect(privacyNote).toContainText("services météo ou de géocodage");
    await expect(privacyNote).toContainText("compte");

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(privacyCard).toContainText("permission");
    await expect(privacyCard).toContainText(/locally/);
    await expect(privacyNote).toContainText("weather or geocoding services");
    await expect(privacyNote).toContainText("user-account database");
  });

  test("54. the educational-project disclaimer appears in both languages", async ({ app }) => {
    await goToAbout(app);
    const note = app.locator('[data-i18n="aboutEduNote"]');
    await expect(note).toHaveText(
      "WeatherSphere est un projet scolaire à vocation pédagogique et ne remplace pas les services météorologiques officiels.",
    );

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(note).toHaveText(
      "WeatherSphere is an educational school project and does not replace official meteorological services.",
    );
  });

  test("55. BigDataCloud is listed as the reverse-geocoding fallback, alongside the other providers", async ({
    app,
  }) => {
    await goToAbout(app);
    const rows = app.locator(".src-row");
    await expect(rows).toHaveCount(5);
    const bdc = rows.filter({ hasText: "BigDataCloud" });
    await expect(bdc).toHaveCount(1);
    await expect(bdc).toContainText("Géocodage inverse de secours");

    const link = bdc.locator(".link-chip");
    await expect(link).toHaveAttribute("href", "https://www.bigdatacloud.com");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    await expect(link).toHaveAccessibleName(/bigdatacloud\.com/);
  });

  test("56. every data-source link has a working destination and accessible name", async ({
    app,
  }) => {
    await goToAbout(app);
    const links = app.locator(".src-list .link-chip");
    await expect(links).toHaveCount(5);
    const info = await links.evaluateAll((els) =>
      els.map((el) => ({
        href: el.getAttribute("href"),
        target: el.getAttribute("target"),
        rel: el.getAttribute("rel"),
        name: el.textContent.trim(),
      })),
    );
    for (const { href, target, rel, name } of info) {
      expect(href).toMatch(/^https:\/\//);
      expect(target).toBe("_blank");
      expect(rel).toContain("noopener");
      expect(name.length).toBeGreaterThan(0);
    }
    /* the decorative "external link" arrow never speaks for itself */
    const arrowCount = await app.locator(".src-list .link-chip svg[aria-hidden='true']").count();
    expect(arrowCount).toBe(5);
  });

  test("57. the heading hierarchy and provider/technology cards survive the changes", async ({
    app,
  }) => {
    await goToAbout(app);
    await expect(app.locator("#aboutTitle")).toHaveAttribute("id", "aboutTitle");
    await expect(app.locator("h1#aboutTitle")).toBeVisible();
    await expect(app.locator(".feature-card")).toHaveCount(4);
    await expect(app.locator(".tech-item")).toHaveCount(14);
    await expect(app.locator(".tech-group")).toHaveCount(3);
    await expect(app.locator("h3.tech-group-title")).toHaveCount(3);
    await expect(app.locator('h2[data-i18n="srcTitle"]')).toBeVisible();
    await expect(app.locator('h2[data-i18n="techTitle"]')).toBeVisible();
  });

  test("58. the about page has no horizontal overflow on a phone-width viewport", async ({
    app,
  }) => {
    await app.setViewportSize({ width: 390, height: 844 });
    await app.locator("#burgerBtn").click();
    await goToAbout(app);
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(app.locator(".src-row").last()).toBeVisible();
  });

  test("59. PHP is listed as a core technology and described as the server-side Pexels proxy", async ({
    app,
  }) => {
    await goToAbout(app);
    const php = app.locator(".tech-item", { hasText: "PHP" });
    await expect(php).toHaveCount(1);
    await expect(php).toHaveAttribute(
      "title",
      "Utilisé côté serveur pour protéger la clé Pexels et transmettre les requêtes photo.",
    );
    /* server-side, not a frontend badge — no secret value anywhere near it */
    const html = await php.innerHTML();
    expect(html).not.toMatch(/[A-Za-z0-9_-]{20,}/); /* no API-key-shaped string */

    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(php).toHaveAttribute(
      "title",
      "Used on the server to protect the Pexels key and proxy photo requests.",
    );
  });

  test("60. technologies and data sources stay separated, without unnecessary duplication", async ({
    app,
  }) => {
    await goToAbout(app);
    const techNames = await app
      .locator(".tech-item")
      .evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()));
    /* pure data providers live only in the data-source card */
    expect(techNames.some((n) => n.includes("Open-Meteo"))).toBe(false);
    expect(techNames.some((n) => n === "Pexels")).toBe(false);
    expect(techNames.some((n) => n.includes("BigDataCloud"))).toBe(false);
    /* MapTiler appears here too, but as the SDK/library, not the tile/geocoding provider */
    expect(techNames.some((n) => n.includes("MapTiler SDK"))).toBe(true);
    expect(techNames.some((n) => n.includes("MapTiler Weather"))).toBe(true);

    /* the data-source card still lists all five real providers */
    const srcNames = await app
      .locator(".src-row b")
      .evaluateAll((els) => els.map((el) => el.textContent.trim()));
    expect(srcNames).toEqual(["Open-Meteo", "OpenStreetMap", "MapTiler", "Pexels", "BigDataCloud"]);
  });

  test("61. every technology badge is the same size and hidden from assistive tech", async ({
    app,
  }) => {
    await goToAbout(app);
    const logos = app.locator(".tech-logo");
    await expect(logos).toHaveCount(14);
    for (const attr of await logos.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-hidden")),
    )) {
      expect(attr).toBe("true");
    }
    const sizes = await logos.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      }),
    );
    expect(new Set(sizes).size).toBe(1); /* one consistent badge size throughout */

    /* the name itself, not the tooltip, is what makes each item identifiable */
    const names = await app
      .locator(".tech-item")
      .evaluateAll((els) => els.map((el) => el.textContent.trim()));
    expect(names.every((n) => n.length > 0)).toBe(true);
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
  /* Every /api/pexels request, split into its "id" (curated landmark, exact
     photo) and "query" (generic text search) forms — a request only ever
     carries one of the two. */
  const proxyRequests = (page) => {
    const seen = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.pathname.endsWith("/api/pexels")) {
        seen.push({ id: url.searchParams.get("id"), query: url.searchParams.get("query") });
      }
    });
    return seen;
  };
  const card = (page, id) => page.locator(`.explore-card[data-loc="${id}"]`);

  test("14. curated landmarks fetch their exact reviewed photo by ID; uncurated countries still ask a precise search query", async ({
    page,
  }) => {
    const requests = proxyRequests(page);
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    /* nothing loads until the carousel is near the viewport (Tokyo Tower's ID) */
    expect(requests.some((r) => r.id === "12245414")).toBe(false);

    await page.locator("#exploreCarousel").scrollIntoViewIfNeeded();
    await expect(card(page, "losangeles").locator("img.loc-photo-img")).toHaveCount(1);
    /* the carousel scrolls sideways: cards past its right edge still wait */
    expect(requests.some((r) => r.query && r.query.includes("Japan"))).toBe(false);

    for (const id of ["tokyo", "japan"]) {
      await card(page, id).scrollIntoViewIfNeeded();
      await expect(card(page, id).locator("img.loc-photo-img")).toHaveCount(1);
    }

    /* curated landmarks (src/js/data/locations.js) carry a manually reviewed
       Pexels photo ID and are fetched by exact ID — never a text search that
       could rank an unrelated image first */
    expect(requests.some((r) => r.id === "5688653")).toBe(true); // Los Angeles — Hollywood Sign
    expect(requests.some((r) => r.id === "12245414")).toBe(true); // Tokyo — Tokyo Tower
    expect(requests.some((r) => r.id === "532826")).toBe(true); // Paris (default hero) — Eiffel Tower

    /* countries carry no curated landmark, so they still fall back to the
       qualified text search, scenery only, no continent */
    expect(requests.some((r) => r.query === "Japan landscape travel")).toBe(true);

    const queries = requests.map((r) => r.query).filter(Boolean);
    /* no query ever names, or even says the word, "landmark" — that biased
       results toward the same handful of famous monuments (the Eiffel Tower
       for Paris, etc.) instead of a representative photo of the place */
    for (const q of queries) expect(q.toLowerCase()).not.toContain("landmark");
    /* no query is ever just a place name */
    for (const q of queries) expect(q.split(" ").length).toBeGreaterThan(1);
    /* and no card asks twice, whether by id or by query */
    const keys = requests.map((r) => r.id ?? r.query);
    expect(new Set(keys).size).toBe(keys.length);
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
    const requests = proxyRequests(page);
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#searchInput").fill(GEOCODE_LABEL);
    await page.locator("#searchResults .search-item").first().click();
    await expect(page.locator("#heroCityName")).toContainText(GEOCODE_LABEL);

    /* a searched, geocoded city carries no curated landmark, so it still uses
       the qualified text search — never the ID lookup */
    await expect
      .poll(() =>
        requests.some(
          (r) => r.query && r.query.startsWith(`${GEOCODE_LABEL} `) && r.query.includes("Iceland"),
        ),
      )
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

    /* the same-origin proxy, by ID (curated landmark) or by query (uncurated) */
    expect(requested.some((u) => u.includes("/api/pexels?"))).toBe(true);
    expect(requested.some((u) => u.includes("api.pexels.com"))).toBe(false);
  });
});

/* Two curated landmarks (Paris, TX's Eiffel Tower replica and Paris, ON's
   Grand River) have no manually reviewed Pexels photo — see locations.js.
   noPhotoSearch keeps them from ever falling back to a generic text search,
   which could otherwise rank an unrelated photo for a landmark name this
   specific. They must stay on the emoji/gradient fallback with no proxy call
   at all, not even a search. */
test.describe("curated landmarks with no reviewed photo (noPhotoSearch)", () => {
  const pickBySearch = async (page, text) => {
    await page.locator("#searchInput").fill(text);
    await page.locator("#searchResults .search-item").first().click();
  };

  test("Paris, Texas never calls the Pexels proxy and keeps its emoji fallback", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    const requested = [];
    page.on("request", (r) => requested.push(r.url()));

    await pickBySearch(page, "Paris, Texas");
    await expect(page.locator("#heroCityName")).toContainText("Paris");
    await expect(page.locator("#heroLandmark .loc-photo.loading")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
    await expect(page.locator("#heroInner .loc-credit")).toHaveCount(0);

    expect(requested.some((u) => u.includes("/api/pexels?"))).toBe(false);
  });

  test("Paris, Ontario never calls the Pexels proxy and keeps its emoji fallback", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    const requested = [];
    page.on("request", (r) => requested.push(r.url()));

    await pickBySearch(page, "Paris, Ontario");
    await expect(page.locator("#heroCityName")).toContainText("Paris");
    await expect(page.locator("#heroLandmark .loc-photo.loading")).toHaveCount(0);
    await expect(page.locator("#heroLandmark .has-photo")).toHaveCount(0);
    await expect(page.locator("#heroInner .loc-credit")).toHaveCount(0);

    expect(requested.some((u) => u.includes("/api/pexels?"))).toBe(false);
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

    /* the proxy was called — the default hero location (Paris) is curated, so
       this is the exact-ID lookup, not a text search */
    expect(requested.some((u) => u.includes("/api/pexels?id=532826"))).toBe(true);
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
    /* curated-landmark ID lookup only: the reviewed photo was removed/renamed
       upstream on Pexels' side */
    ["curated photo not found", 404, { error: "not_found" }],
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

test.describe("language menu accessibility", () => {
  test("77. clicking the language button toggles the menu and its aria-expanded state", async ({
    app,
  }) => {
    const btn = app.locator("#langBtn");
    const menu = app.locator("#langMenu");
    await expect(menu).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");

    await btn.click();
    await expect(menu).toBeVisible();
    await expect(btn).toHaveAttribute("aria-expanded", "true");

    await btn.click();
    await expect(menu).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  test("78. selecting a language closes the menu, resets aria-expanded, and returns focus", async ({
    app,
  }) => {
    const btn = app.locator("#langBtn");
    await btn.click();
    await app.locator('#langMenu button[data-lang="en"]').click();

    await expect(app.locator("#langMenu")).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(btn).toBeFocused();
    await expect(app.locator('#langMenu button[data-lang="en"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#langMenu button[data-lang="fr"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("79. selecting the already-active language still closes the menu", async ({ app }) => {
    /* app boots in French, so the "fr" item is already active */
    const btn = app.locator("#langBtn");
    await btn.click();
    await app.locator('#langMenu button[data-lang="fr"]').click();

    await expect(app.locator("#langMenu")).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(btn).toBeFocused();
  });

  test("80. clicking outside closes the menu and syncs aria-expanded", async ({ app }) => {
    await app.locator("#langBtn").click();
    await expect(app.locator("#langMenu")).toBeVisible();

    await app.locator("#logoLink").click();
    await expect(app.locator("#langMenu")).toBeHidden();
    await expect(app.locator("#langBtn")).toHaveAttribute("aria-expanded", "false");
  });

  test("81. Escape closes the menu, syncs aria-expanded, and restores focus", async ({ app }) => {
    const btn = app.locator("#langBtn");
    await btn.click();
    await expect(app.locator("#langMenu")).toBeVisible();

    await app.keyboard.press("Escape");
    await expect(app.locator("#langMenu")).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(btn).toBeFocused();
  });

  test("82. the trigger's accessible label names the current interface language, in both languages", async ({
    app,
  }) => {
    const btn = app.locator("#langBtn");
    await expect(btn).toHaveAttribute("aria-label", "Changer de langue — actuellement Français");

    await btn.click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(btn).toHaveAttribute("aria-label", "Change language — currently English");

    await btn.click();
    await app.locator('#langMenu button[data-lang="fr"]').click();
    await expect(btn).toHaveAttribute("aria-label", "Changer de langue — actuellement Français");
  });

  test("83. switching language while the mobile drawer is open keeps accessible names correct", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await page.locator("#burgerBtn").click();
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "false");

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();

    await expect(page.locator("#langBtn")).toHaveAttribute(
      "aria-label",
      "Change language — currently English",
    );
    /* the drawer's own open/closed labelling survived the language switch too */
    await expect(page.locator("#burgerBtn")).toHaveAttribute("aria-label", "Close menu");
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "false");
  });
});

test.describe("forecast subtitle: no duplicated country name", () => {
  test("84. a city shows its name and country", async ({ app }) => {
    /* the app boots on Paris (data/locations.js DEFAULT_LOCATION_ID) */
    await expect(app.locator("#forecastSub")).toHaveText("Prévisions pour Paris, France");
  });

  test("85. a country appears only once, never doubled", async ({ app }) => {
    await app.locator('.explore-card[data-loc="france"] .explore-open').click();
    await expect(app.locator("#forecastSub")).toHaveText("Prévisions pour France");
    await expect(app.locator("#forecastSub")).not.toContainText("France, France");
  });

  test("86. language switching preserves the correct hierarchy for a country", async ({ app }) => {
    await app.locator('.explore-card[data-loc="france"] .explore-open').click();
    await app.locator("#langBtn").click();
    await app.locator('#langMenu button[data-lang="en"]').click();
    await expect(app.locator("#forecastSub")).toHaveText("Forecast for France");
    await expect(app.locator("#forecastSub")).not.toContainText("France, France");
  });

  test("87. a dynamically searched (MapTiler/Open-Meteo) city is handled correctly", async ({
    app,
  }) => {
    await app.locator("#searchInput").fill(GEOCODE_LABEL);
    const option = app.locator("#searchResults .search-item").first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(app.locator("#forecastSub")).toContainText(GEOCODE_LABEL);
    /* name and country are genuinely different words here — must both show */
    await expect(app.locator("#forecastSub")).toContainText(",");
  });

  test("88. the hierarchy also updates after selecting a favorite", async ({ app }) => {
    await app.locator('.explore-card[data-loc="france"] .explore-open').click();
    await expect(app.locator("#heroFavBtn")).toBeVisible();
    await app.locator("#heroFavBtn").click();
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");

    /* jump elsewhere, then reselect France from Favorites */
    await app.locator('.side-item[data-view="favorites"]').click();
    await app.locator(".favx-open").click();
    await expect(app.locator("#view-home")).toBeVisible();
    await expect(app.locator("#forecastSub")).toHaveText("Prévisions pour France");
    await expect(app.locator("#forecastSub")).not.toContainText("France, France");
  });
});

test.describe("single/double advisory layout", () => {
  const region = (page) => page.locator("#advisoryRegion");

  test("89. one advisory spans the row without leaving empty desktop columns", async ({ page }) => {
    await installMocks(page, { weatherKind: "heat" });
    await page.goto("/");
    await expect(region(page)).toBeVisible();
    await expect(page.locator(".advisory")).toHaveCount(1);

    const box = await page.locator(".advisory").boundingBox();
    const listBox = await page.locator(".advisory-list").boundingBox();
    expect(box.width).toBeGreaterThan(listBox.width * 0.95);
    expect(Math.abs(box.x - listBox.x)).toBeLessThan(2);
  });

  test("90. two advisories split the row evenly", async ({ page }) => {
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await expect(region(page)).toBeVisible();
    const cards = page.locator(".advisory");
    await expect(cards).toHaveCount(2);

    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    expect(a.y).toBeCloseTo(b.y, 0); /* same row, not stacked */
  });

  test("91. three advisories retain the primary/secondary hierarchy", async ({ page }) => {
    await installMocks(page, { weatherKind: "severe" });
    await page.goto("/");
    await expect(region(page)).toBeVisible();
    const cards = page.locator(".advisory");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveClass(/is-primary/);
    await expect(cards.nth(1)).toHaveClass(/is-secondary/);
    await expect(cards.nth(2)).toHaveClass(/is-secondary/);

    const [primary, secondary] = await Promise.all([
      cards.nth(0).boundingBox(),
      cards.nth(1).boundingBox(),
    ]);
    expect(primary.width).toBeGreaterThan(secondary.width); /* the 1.4fr/1fr/1fr hierarchy */
  });

  test("92. the disclaimer spans the complete row regardless of advisory count", async ({
    page,
  }) => {
    for (const kind of ["heat", "storm", "severe"]) {
      await installMocks(page, { weatherKind: kind });
      await page.goto("/");
      await expect(region(page)).toBeVisible();
      const disclaimer = page.locator(".adv-disclaimer");
      const list = page.locator(".advisory-list");
      const [dBox, lBox] = await Promise.all([disclaimer.boundingBox(), list.boundingBox()]);
      expect(dBox.width).toBeGreaterThan(lBox.width * 0.9);
    }
  });

  test("93. no advisory hides the region entirely (unchanged baseline)", async ({ page }) => {
    await installMocks(page, { weatherKind: "calm" });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await expect(region(page)).toBeHidden();
  });

  test("94. mobile keeps the single-column advisory layout regardless of count", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await expect(region(page)).toBeVisible();
    const cards = page.locator(".advisory");
    await expect(cards).toHaveCount(2);
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    expect(b.y).toBeGreaterThan(a.y); /* stacked, not side-by-side */
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("map layer switcher: mobile scrolling", () => {
  test("95. the inline search stays unchanged above the mobile-search breakpoint", async ({
    app,
  }) => {
    await expect(app.locator("#searchWrap")).toBeVisible();
    await expect(app.locator("#mobileSearchBtn")).toBeHidden();
  });

  test("96. the native scrollbar is visually hidden on the layer row", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="map"]').click();

    const scrollbarWidth = await page
      .locator(".map-layer-switcher")
      .evaluate((el) => getComputedStyle(el).scrollbarWidth);
    expect(scrollbarWidth).toBe("none");
  });

  test("97. the row remains horizontally scrollable and every layer stays reachable and operable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="map"]').click();

    const switcher = page.locator(".map-layer-switcher");
    await expect(switcher).toHaveCSS("overflow-x", "auto");
    const overflowAmount = await switcher.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflowAmount).toBeGreaterThan(0);

    /* the last control ("Vent"/wind) is off-screen until scrolled to, but
       must still be reachable and keyboard-focusable once it is. Activating
       a weather overlay depends on live MapTiler weather tiles the e2e
       mocks don't provide, so reachability — not the resulting map state —
       is what's asserted here. */
    const wind = page.locator('.map-layer[data-map-layer="wind"]');
    await wind.scrollIntoViewIfNeeded();
    await expect(wind).toBeVisible();
    await wind.focus();
    await expect(wind).toBeFocused();

    /* every control, not just the visually-nearest ones, is reachable this way */
    for (const layer of ["satellite", "temperature", "rain", "wind"]) {
      const btn = page.locator(`.map-layer[data-map-layer="${layer}"]`);
      await btn.scrollIntoViewIfNeeded();
      await expect(btn).toBeVisible();
    }
  });

  test("98. edge fades appear/disappear at the start and end of the scroll range", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="map"]').click();

    const left = page.locator("#mapLayerFadeLeft");
    const right = page.locator("#mapLayerFadeRight");
    const switcher = page.locator(".map-layer-switcher");

    await expect(right).toHaveClass(/is-visible/);
    await expect(left).not.toHaveClass(/is-visible/);
    expect(await left.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    expect(await right.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

    await switcher.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(left).toHaveClass(/is-visible/);
    await expect(right).not.toHaveClass(/is-visible/);
  });

  test("99. the layer radiogroup and its French/English labels survive the change", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="map"]').click();

    await expect(page.locator(".map-layer-switcher")).toHaveAttribute("role", "radiogroup");
    await expect(page.locator('.map-layer[data-map-layer="temperature"]')).toContainText(
      "Température",
    );

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(page.locator('.map-layer[data-map-layer="temperature"]')).toContainText(
      "Temperature",
    );
  });

  test("100. no page-level horizontal overflow on the map view at phone width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="map"]').click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
