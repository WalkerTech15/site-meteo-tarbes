/* Small-phone search (≤520px, see components/forms.css and features/search.js).
   Runs on the "mobile" Playwright project (Pixel 5, 393px wide) — comfortably
   under the 520px breakpoint that replaces the inline bar with a button. */
import { test, expect, GEOCODE_LABEL } from "./mocks.js";

test.describe("mobile search", () => {
  test("the compact button replaces the inline bar", async ({ app }) => {
    await expect(app.locator("#mobileSearchBtn")).toBeVisible();
    await expect(app.locator("#mobileSearchBtn")).toHaveAttribute(
      "aria-label",
      "Rechercher un lieu",
    );
    await expect(app.locator("#searchWrap")).toBeHidden();
  });

  test("opening focuses the input and shows the full-width overlay", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await expect(app.locator("#mobileSearchBtn")).toHaveAttribute("aria-expanded", "true");
    await expect(app.locator("#searchWrap")).toBeVisible();
    await expect(app.locator("#searchInput")).toBeFocused();

    const box = await app.locator("#searchWrap").boundingBox();
    const viewport = app.viewportSize();
    expect(box.width).toBeGreaterThan(viewport.width * 0.8); /* genuinely full-width */
  });

  test("a typed query stays fully readable, not clipped to one character", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill("Reykjavik");
    await expect(app.locator("#searchInput")).toHaveValue("Reykjavik");
    const clipped = await app
      .locator("#searchInput")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
  });

  test("results appear, are selectable, and close the overlay on pick", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill(GEOCODE_LABEL);
    const option = app.locator("#searchResults .search-item").first();
    await expect(option).toBeVisible();
    await option.click();

    await expect(app.locator("#heroCityName")).toContainText(GEOCODE_LABEL);
    await expect(app.locator("#searchWrap")).toBeHidden();
    await expect(app.locator("#mobileSearchBtn")).toHaveAttribute("aria-expanded", "false");
  });

  test("keyboard arrows and Enter select a result", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill(GEOCODE_LABEL);
    await expect(app.locator("#searchResults .search-item").first()).toBeVisible();

    await app.keyboard.press("ArrowDown");
    await expect(app.locator("#searchResults [role=option]").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await app.keyboard.press("Enter");
    await expect(app.locator("#heroCityName")).toContainText(GEOCODE_LABEL);
    await expect(app.locator("#searchWrap")).toBeHidden();
  });

  test("Escape closes the overlay and restores focus to the button", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill("par");
    await expect(app.locator("#searchResults .search-item").first()).toBeVisible();

    await app.keyboard.press("Escape");
    await expect(app.locator("#searchWrap")).toBeHidden();
    await expect(app.locator("#mobileSearchBtn")).toHaveAttribute("aria-expanded", "false");
    await expect(app.locator("#mobileSearchBtn")).toBeFocused();
  });

  test("clicking outside closes the overlay", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await expect(app.locator("#searchWrap")).toBeVisible();

    await app.locator("#logoLink").click();
    await expect(app.locator("#searchWrap")).toBeHidden();
    await expect(app.locator("#mobileSearchBtn")).toHaveAttribute("aria-expanded", "false");
  });

  test("clicking the button again while open closes it (toggle)", async ({ app }) => {
    const btn = app.locator("#mobileSearchBtn");
    await btn.click();
    await expect(app.locator("#searchWrap")).toBeVisible();
    await btn.click();
    await expect(app.locator("#searchWrap")).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  test("an empty or no-match query keeps a safe, announced state", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill("zzzznonexistentplace9999");
    await expect(app.locator(".search-empty")).toBeVisible();
    await app.locator("#searchInput").fill("");
    await expect(app.locator("#searchPanel")).toBeHidden();
  });

  test("does not create horizontal page overflow while open", async ({ app }) => {
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill("par");
    await expect(app.locator("#searchResults .search-item").first()).toBeVisible();
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("does not interfere with the hamburger, logo, theme, or language buttons", async ({
    app,
  }) => {
    for (const sel of ["#burgerBtn", "#logoLink", "#themeBtn", "#langBtn"]) {
      await expect(app.locator(sel)).toBeVisible();
    }
    await app.locator("#mobileSearchBtn").click();
    await expect(app.locator("#searchWrap")).toBeVisible();
    /* the header controls are still reachable while the overlay is open,
       since it drops down below the header rather than covering it */
    for (const sel of ["#burgerBtn", "#logoLink", "#themeBtn", "#langBtn"]) {
      await expect(app.locator(sel)).toBeVisible();
      await expect(app.locator(sel)).toBeEnabled();
    }
  });

  test("touch target is at least 44x44px", async ({ app }) => {
    const box = await app.locator("#mobileSearchBtn").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(box.w).toBeGreaterThanOrEqual(44);
    expect(box.h).toBeGreaterThanOrEqual(44);
  });

  test("the Favorites add-location action opens the visible search overlay", async ({ app }) => {
    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="favorites"]').click();
    await app.locator("#favAddBtn").click();

    await expect(app.locator("#searchWrap")).toBeVisible();
    await expect(app.locator("#mobileSearchBtn")).toHaveAttribute("aria-expanded", "true");
    await expect(app.locator("#searchInput")).toBeFocused();
  });

  test("the slash shortcut opens the visible search overlay", async ({ app }) => {
    await app.locator("body").click({ position: { x: 2, y: 200 } });
    await app.keyboard.press("/");

    await expect(app.locator("#searchWrap")).toBeVisible();
    await expect(app.locator("#mobileSearchBtn")).toHaveAttribute("aria-expanded", "true");
    await expect(app.locator("#searchInput")).toBeFocused();
  });
});
