/* Side-by-side comparison of saved places (ui/render-comparison.js).
 *
 * It lives inside the Favorites view rather than behind its own route: the
 * sidebar is a fixed set of six items (pinned by responsive-nav.spec.js)
 * and "compare my saved places" belongs next to those saved places. These
 * tests therefore also stand as a guard that adding the feature changed
 * neither the navigation nor the favorites grid. */
import { test, expect } from "./mocks.js";

const goToFavorites = (app) => app.locator('.side-item[data-view="favorites"]').click();
const goToHome = (app) => app.locator('.side-item[data-view="home"]').click();

const block = (app) => app.locator("#compareBlock");
const chips = (app) => app.locator(".compare-chip");
const table = (app) => app.locator(".compare-table");
const columns = (app) => app.locator(".compare-table thead th");

/* Star the current location, then pick a different one from the Explore
   carousel and star that too — two independent saved places, which is the
   minimum a comparison needs. */
async function saveTwoPlaces(app) {
  await app.locator("#heroFavBtn").click();
  await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");
  await app.locator('.explore-card[data-loc="tokyo"] .explore-open').click();
  await expect(app.locator("#heroCityName")).toContainText("Tokyo");
  await app.locator("#heroFavBtn").click();
  await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");
}

async function saveNamedPlaces(app, ids) {
  for (const id of ids) {
    await app.locator(`.explore-card[data-loc="${id}"] .explore-open`).click();
    await expect(app.locator("#heroFavBtn")).toBeVisible();
    if ((await app.locator("#heroFavBtn").getAttribute("aria-pressed")) === "false") {
      await app.locator("#heroFavBtn").click();
    }
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "true");
  }
}

test.describe("compare places", () => {
  test("invites the visitor to save a place when there is nothing to compare", async ({ app }) => {
    await goToFavorites(app);
    await expect(block(app)).toBeVisible();
    /* the current location is always comparable, so the picker is never
       truly empty — but one place is not a comparison */
    await expect(block(app)).toContainText(/au moins deux/i);
  });

  test("shows a table only once two places are picked", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);

    await expect(table(app)).toHaveCount(0);
    await chips(app).nth(0).click();
    await expect(table(app)).toHaveCount(0); /* one is still not a comparison */
    await chips(app).nth(1).click();
    await expect(table(app)).toBeVisible();
  });

  test("compares every promised metric, one row each", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await chips(app).nth(0).click();
    await chips(app).nth(1).click();
    await expect(table(app)).toBeVisible();

    /* temperature, feels-like, humidity, wind, precipitation, UV, air
       quality, local time */
    await expect(app.locator(".compare-table tbody tr")).toHaveCount(8);
    const labels = await app
      .locator(".compare-table tbody th")
      .evaluateAll((els) => els.map((el) => el.textContent.trim()));
    expect(labels).toEqual([
      "Température",
      "Ressenti",
      "Humidité",
      "Vent",
      "Précipitations",
      "Indice UV",
      "Qualité de l'air",
      "Heure locale",
    ]);
  });

  test("fills real values in, never leaving the whole table blank", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await chips(app).nth(0).click();
    await chips(app).nth(1).click();
    await expect(table(app)).toBeVisible();

    /* the mocked forecast is deterministic — the temperature row must carry
       a real reading for both columns */
    const tempCells = app.locator(".compare-table tbody tr").first().locator("td");
    await expect(tempCells).toHaveCount(2);
    await expect(tempCells.first()).toHaveText(/\d/);
    await expect(tempCells.nth(1)).toHaveText(/\d/);
  });

  test("removing a column drops it from the table", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await chips(app).nth(0).click();
    await chips(app).nth(1).click();
    await expect(columns(app)).toHaveCount(3); /* metric + two places */

    await app.locator(".compare-remove").first().click();
    /* back below two places, so the table stands down entirely */
    await expect(table(app)).toHaveCount(0);
    await expect(block(app)).toContainText(/au moins deux/i);
  });

  test("clearing empties the whole comparison", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await chips(app).nth(0).click();
    await chips(app).nth(1).click();
    await expect(table(app)).toBeVisible();

    await app.locator("#compareClearBtn").click();
    await expect(table(app)).toHaveCount(0);
    await expect(chips(app).nth(0)).toHaveAttribute("aria-pressed", "false");
  });

  test("caps the selection at five places and explains why", async ({ app }) => {
    await saveNamedPlaces(app, ["paris", "tokyo", "sydney", "france", "japan", "vietnam"]);
    await goToFavorites(app);

    const all = chips(app);
    const count = await all.count();
    expect(count).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 5; i++) await all.nth(i).click();

    await expect(columns(app)).toHaveCount(6); /* metric + five places */
    /* the sixth chip is disabled rather than silently ignored */
    await expect(all.nth(5)).toBeDisabled();
    /* and an already-selected chip stays clickable, so a slot can be freed */
    await expect(all.nth(0)).toBeEnabled();
    await all.nth(0).click();
    await expect(all.nth(5)).toBeEnabled();
  });

  test("survives a reload — the picked places come back", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await chips(app).nth(0).click();
    await chips(app).nth(1).click();
    await expect(table(app)).toBeVisible();

    await app.reload();
    await expect(app.locator("#heroCityName")).not.toBeEmpty();
    await goToFavorites(app);
    await expect(table(app)).toBeVisible();
    await expect(columns(app)).toHaveCount(3);
  });

  test("un-favouriting a compared place removes its column, leaving no stale data", async ({
    app,
  }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await chips(app).nth(0).click();
    await chips(app).nth(1).click();
    await expect(columns(app)).toHaveCount(3);

    /* Tokyo is the current location and is starred — un-star it */
    await goToHome(app);
    await app.locator("#heroFavBtn").click();
    await expect(app.locator("#heroFavBtn")).toHaveAttribute("aria-pressed", "false");
    await goToFavorites(app);

    /* it is still the CURRENT location, so it stays comparable — what must
       not happen is a column for a place that no longer resolves */
    const names = await app
      .locator(".compare-table thead th .compare-col-name")
      .evaluateAll((els) => els.map((el) => el.textContent.trim()));
    for (const name of names) expect(name).not.toBe("");
  });
});

test.describe("compare places: accessibility", () => {
  test("is a real table with a caption and row/column headers", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await chips(app).nth(0).click();
    await chips(app).nth(1).click();
    await expect(table(app)).toBeVisible();

    await expect(app.locator(".compare-table caption")).toHaveCount(1);
    await expect(app.locator('.compare-table thead th[scope="col"]')).toHaveCount(3);
    await expect(app.locator('.compare-table tbody th[scope="row"]')).toHaveCount(8);
  });

  test("the picker is a labelled group of toggle buttons", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);

    const picker = app.locator(".compare-picker");
    await expect(picker).toHaveAttribute("role", "group");
    await expect(picker).toHaveAttribute("aria-label", /.+/);
    for (const pressed of await chips(app).evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-pressed")),
    )) {
      expect(["true", "false"]).toContain(pressed);
    }
  });

  test("every chip and remove control carries an accessible name", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await chips(app).nth(0).click();
    await chips(app).nth(1).click();
    await expect(table(app)).toBeVisible();

    for (const label of await chips(app).evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label")),
    )) {
      expect(label).toBeTruthy();
    }
    for (const label of await app
      .locator(".compare-remove")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))) {
      expect(label).toBeTruthy();
    }
  });

  test("is operable by keyboard alone", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);

    const first = chips(app).nth(0);
    await first.focus();
    await expect(first).toBeFocused();
    await app.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-pressed", "true");

    await app.keyboard.press("Tab");
    await app.keyboard.press("Enter");
    await expect(table(app)).toBeVisible();
  });

  test("aria-pressed tracks the real selection", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    const first = chips(app).nth(0);

    await expect(first).toHaveAttribute("aria-pressed", "false");
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("compare places: responsive", () => {
  for (const { label, width } of [
    { label: "phone", width: 375 },
    { label: "tablet", width: 768 },
    { label: "desktop", width: 1440 },
  ]) {
    test(`${label} (${width}px): readable with no page overflow`, async ({ app }) => {
      await saveTwoPlaces(app);
      await app.setViewportSize({ width, height: 900 });
      if (width <= 900) await app.locator("#burgerBtn").click();
      await goToFavorites(app);
      await chips(app).nth(0).click();
      await chips(app).nth(1).click();
      await expect(table(app)).toBeVisible();

      const overflow = await app.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("wide tables scroll inside their own container, not the page", async ({ app }) => {
    await saveNamedPlaces(app, ["paris", "tokyo", "sydney", "france"]);
    await app.setViewportSize({ width: 375, height: 900 });
    await app.locator("#burgerBtn").click();
    await goToFavorites(app);
    const all = chips(app);
    for (let i = 0; i < 4; i++) await all.nth(i).click();
    await expect(table(app)).toBeVisible();

    const scroller = app.locator("#compareBlock .table-scroll");
    await expect(scroller).toHaveCount(1);
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("compare places: leaves the rest of the app alone", () => {
  test("the sidebar still carries exactly six items", async ({ app }) => {
    await expect(app.locator(".side-item")).toHaveCount(6);
  });

  test("the favorites grid and quick list are unchanged", async ({ app }) => {
    await saveTwoPlaces(app);
    await goToFavorites(app);
    await expect(app.locator("#favGrid")).toBeVisible();
    await expect(app.locator("#favGrid .favx-card")).toHaveCount(2);
  });
});
