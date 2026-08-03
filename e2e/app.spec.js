import { test, expect, installMocks, GEOCODE_LABEL, PEXELS_PHOTOGRAPHER } from "./mocks.js";

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

    await app.locator('#modeToggle button[data-mode="simple"]').click();
    await expect(app.locator("body")).toHaveAttribute("data-mode", "simple");
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
    /* Pexels returns nothing → the gradient/emoji fallback is used, and a
       fallback visual must never be credited to a photographer. */
    await installMocks(page);
    await page.route("**://api.pexels.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ photos: [] }),
      }),
    );
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    await expect(page.locator(".loc-photo.has-photo")).toHaveCount(0);
    await expect(page.locator(".loc-credit")).toHaveCount(0);
  });
});
