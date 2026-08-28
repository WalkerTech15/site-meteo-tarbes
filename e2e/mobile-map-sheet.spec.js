/* Task 5: the map's location detail panel becomes a draggable, accessible
   bottom sheet at mobile widths. Runs only in the "mobile" Playwright project
   (Pixel 5, 393px — comfortably under the 820px breakpoint this feature is
   gated on). Desktop behaviour (the existing floating panel) is unaffected
   and is covered by app.spec.js instead. */
import { test, expect } from "./mocks.js";

async function openMapPanel(app) {
  await app.locator("#burgerBtn").click();
  await app.locator('.side-item[data-view="map"]').click();
  await expect(app.locator("#mapWeatherPanel .map-panel-head")).toBeVisible();
}

const panel = (app) => app.locator("#mapWeatherPanel");
const handle = (app) => app.locator("#mapPanelHandle");

test.describe("mobile map detail sheet", () => {
  test("opens at the default 'half' state, not fully collapsed or fully expanded", async ({
    app,
  }) => {
    await openMapPanel(app);
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "half");
    await expect(app.locator(".map-panel-body")).toBeVisible();
    await expect(app.locator(".map-panel-peek")).toBeHidden();
  });

  test("no horizontal page overflow with the sheet open", async ({ app }) => {
    await openMapPanel(app);
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("tapping the handle cycles collapsed → half → expanded → collapsed", async ({ app }) => {
    await openMapPanel(app);
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "half");

    await handle(app).click();
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "expanded");
    await expect(app.locator(".map-panel-body")).toBeVisible();

    await handle(app).click();
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "collapsed");
    /* collapsed: only the compact name+temperature peek is shown, not the
       full head/photo/stats/nearby content */
    await expect(app.locator(".map-panel-peek")).toBeVisible();
    await expect(app.locator(".map-panel-body")).toBeHidden();
    await expect(app.locator(".map-panel-peek")).toContainText("Paris");

    await handle(app).click();
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "half");
  });

  test("the handle exposes aria-expanded, false only when collapsed", async ({ app }) => {
    await openMapPanel(app);
    await expect(handle(app)).toHaveAttribute("aria-expanded", "true"); // half
    await handle(app).click();
    await expect(handle(app)).toHaveAttribute("aria-expanded", "true"); // expanded
    await handle(app).click();
    await expect(handle(app)).toHaveAttribute("aria-expanded", "false"); // collapsed
  });

  test("ArrowUp/ArrowDown on the focused handle step through the states", async ({ app }) => {
    await openMapPanel(app);
    await handle(app).focus();

    await app.keyboard.press("ArrowUp");
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "expanded");
    await app.keyboard.press("ArrowUp"); // already at the top — clamps, does not error
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "expanded");

    await app.keyboard.press("ArrowDown");
    await app.keyboard.press("ArrowDown");
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "collapsed");
    await app.keyboard.press("ArrowDown"); // already at the bottom — clamps
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "collapsed");
  });

  test("Home/End on the handle jump to fully expanded/collapsed", async ({ app }) => {
    await openMapPanel(app);
    await handle(app).focus();
    await app.keyboard.press("End");
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "collapsed");
    await app.keyboard.press("Home");
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "expanded");
  });

  test("Escape collapses an open sheet and returns focus to the handle", async ({ app }) => {
    await openMapPanel(app);
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "half");

    await app.keyboard.press("Escape");
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "collapsed");
    await expect(handle(app)).toBeFocused();

    /* already collapsed: Escape is a no-op, not an error, and does not steal
       focus from something else */
    await app
      .locator("#mapForecastBtn")
      .focus()
      .catch(() => {});
    await app.keyboard.press("Escape");
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "collapsed");
  });

  /* The mobile Playwright project emulates touch (Pixel 5), where
     page.mouse's synthesized drag doesn't reliably reach a listener bound to
     PointerEvent — so the gesture is dispatched directly as the same
     pointerdown/pointermove/pointerup sequence features/map-sheet.js
     actually listens for, with an explicit pointerId (setPointerCapture
     needs one) and clientY, which is all resolveDragState() reads. */
  async function dragHandle(app, deltaY) {
    const box = await handle(app).boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const pointerId = 7;
    await handle(app).dispatchEvent("pointerdown", {
      pointerId,
      button: 0,
      clientX: x,
      clientY: y,
    });
    await handle(app).dispatchEvent("pointermove", {
      pointerId,
      clientX: x,
      clientY: y + deltaY / 2,
    });
    await handle(app).dispatchEvent("pointermove", { pointerId, clientX: x, clientY: y + deltaY });
    await handle(app).dispatchEvent("pointerup", { pointerId, clientX: x, clientY: y + deltaY });
  }

  test("dragging the handle up expands, dragging down collapses", async ({ app }) => {
    await openMapPanel(app);
    await dragHandle(app, -120); // up
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "expanded");

    await dragHandle(app, 400); // down, well past the threshold
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "half");
  });

  test("a short drag under the threshold snaps back — reads as a tap-and-release, not a resize", async ({
    app,
  }) => {
    await openMapPanel(app);
    await dragHandle(app, -10); // well under the drag threshold
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "half");
  });

  /* "expanded" is deliberately capped below 100vh (84vh — see map.css) so
     SOME map is always visible in principle, but on a short phone the layer
     switcher itself can still fall under that top sliver — the same
     trade-off every native app's fully-expanded bottom sheet makes. Genuine
     reachability is the requirement at "collapsed" and "half", where the map
     is the co-equal, primary view. */
  test("the map's layer switcher stays reachable and clickable at collapsed and half", async ({
    app,
  }) => {
    await openMapPanel(app);
    const temperatureLayer = app.locator('[data-map-layer="temperature"]');

    for (const state of ["half", "collapsed"]) {
      while ((await panel(app).getAttribute("data-sheet-state")) !== state) {
        await handle(app).click();
      }
      await expect(temperatureLayer).toBeInViewport();
      await temperatureLayer.click();
      await expect(temperatureLayer).toHaveAttribute("aria-checked", "true");
      /* back to satellite for the next iteration's clean click */
      await app.locator('[data-map-layer="satellite"]').click();
    }
  });

  test("even 'expanded' leaves the top of the viewport, above the sheet, uncovered", async ({
    app,
  }) => {
    await openMapPanel(app);
    await handle(app).click(); // half -> expanded
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "expanded");

    const sheetBox = await panel(app).boundingBox();
    const viewport = app.viewportSize();
    expect(sheetBox.y).toBeGreaterThan(0); // never covers the full screen
    expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  test("a brand-new selection resets the sheet to 'half', a same-location re-render (favourite toggle) does not", async ({
    app,
  }) => {
    await openMapPanel(app);
    await handle(app).click(); // half -> expanded
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "expanded");

    /* re-render for the SAME location (toggling favourite calls
       renderMapInfo() again) must not reset the state the user just set */
    await app.locator("#mapFavoriteBtn").click();
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "expanded");

    /* selecting a genuinely different place resets to the default peek — via
       search, not a popular/recent card: those sit below the map in normal
       page flow, and the fixed sheet can cover that scroll position, same as
       a real bottom sheet covering whatever is scrolled underneath it.
       Search itself always jumps to the home view (features/search.js), so
       the map is reopened afterward to check the panel it left behind. */
    await app.locator("#mobileSearchBtn").click();
    await app.locator("#searchInput").fill("Tokyo");
    const option = app.locator("#searchResults .search-item").first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(app.locator("#heroCityName")).toContainText("Tokyo");

    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="map"]').click();
    await expect(app.locator("#mapWeatherPanel .map-panel-head")).toBeVisible();
    await expect(panel(app)).toHaveAttribute("data-sheet-state", "half");
  });
});
