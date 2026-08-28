/* Phone-profile checks for the integrated map workspace. */
import { test, expect, AUSTIN_LABEL } from "./mocks.js";

test.describe("map workspace on a phone", () => {
  /* Task 5: below 820px the details panel is now a draggable bottom sheet
     (position: fixed, anchored to the viewport's bottom edge) rather than a
     document-flow block stacked below the map — see mobile-map-sheet.spec.js
     for its drag/keyboard/state contract. This test now checks the sheet's
     own structural contract instead of the pre-task-5 stacking order. */
  test("the details panel is a bottom sheet anchored to the viewport, without horizontal overflow", async ({
    app,
  }) => {
    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="map"]').click();

    const map = app.locator("#worldMap");
    const panel = app.locator("#mapWeatherPanel");
    await expect(map).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS("position", "fixed");
    await expect(panel).toHaveAttribute("data-sheet-state", "half");

    const panelBox = await panel.boundingBox();
    const viewport = app.viewportSize();
    /* anchored to the bottom edge, never spilling past either side */
    expect(Math.round(panelBox.y + panelBox.height)).toBeLessThanOrEqual(viewport.height + 1);
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width + 1);

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(panel.locator(".map-panel-stats > div")).toHaveCount(4);
  });

  test("the geo-identity chips wrap instead of overflowing", async ({ app }) => {
    /* search always returns to Home — select first, then open Map to see it.
       At this width the inline bar is replaced by #mobileSearchBtn (see
       mobile-search.spec.js), so it has to be opened before the input is
       usable. */
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill(AUSTIN_LABEL);
    const option = app.locator("#searchResults .search-item").first();
    await expect(option).toBeVisible();
    await option.click();

    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="map"]').click();

    const identity = app.locator("#mapWeatherPanel .geo-identity");
    await expect(identity).toBeVisible();
    await expect(identity.locator(".geo-chip")).toHaveCount(2);

    const overflow = await app.evaluate(() => {
      const el = document.querySelector("#mapWeatherPanel .geo-identity-row");
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        row: el.scrollWidth - el.clientWidth,
      };
    });
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.row).toBeLessThanOrEqual(0);
  });

  test("the country filter pills wrap cleanly, stay touch-friendly, and the active one stays visible", async ({
    app,
  }) => {
    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="map"]').click();

    const chips = app.locator(".map-filters .chip");
    await expect(chips).toHaveCount(4);
    for (const label of ["Monde", "France", "États-Unis", "Canada"]) {
      await expect(app.locator(".map-filters .chip", { hasText: label })).toBeVisible();
    }

    /* activate the last pill and confirm it is still on-screen without scrolling */
    await app.locator('.chip[data-jump="canada"]').click();
    await expect(app.locator('.chip[data-jump="canada"]')).toHaveAttribute("aria-pressed", "true");
    await expect(app.locator('.chip[data-jump="canada"]')).toBeInViewport();

    const heights = await chips.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    heights.forEach((h) => expect(h).toBeGreaterThanOrEqual(44)); /* touch target */

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the popular-locations row scrolls horizontally, with readable, untruncated names", async ({
    app,
  }) => {
    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="map"]').click();

    const list = app.locator(".map-popular-list");
    await expect(list).toHaveCSS("overflow-x", "auto");
    const cards = app.locator(".map-popular-place");
    await expect(cards).toHaveCount(5);

    const overflow = await app.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      row: document.querySelector(".map-popular-list").scrollWidth,
    }));
    expect(overflow.doc).toBeLessThanOrEqual(0); /* the row scrolls; the page never does */
    const listBox = await list.boundingBox();
    expect(overflow.row).toBeGreaterThan(listBox.width); /* content genuinely exceeds the frame */

    const newYork = app.locator('.map-popular-place[data-loc="newyork"] b');
    await newYork.scrollIntoViewIfNeeded();
    await expect(newYork).toBeVisible();
    const truncated = await newYork.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(truncated).toBe(false);
  });
});
