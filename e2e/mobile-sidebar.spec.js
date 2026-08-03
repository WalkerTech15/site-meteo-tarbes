/* Task 8, case 8: the mobile drawer's keyboard behaviour and ARIA state.
   Runs only in the "mobile" Playwright project (Pixel 5), where the viewport is
   below the 900px breakpoint that turns the sidebar into an off-canvas drawer. */
import { test, expect } from "./mocks.js";

test.describe("mobile sidebar", () => {
  test("8a. a closed drawer is inert, hidden, and out of the tab order", async ({ app }) => {
    const sidebar = app.locator("#sidebar");
    const burger = app.locator("#burgerBtn");

    await expect(burger).toBeVisible();
    await expect(burger).toHaveAttribute("aria-controls", "sidebar");
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(sidebar).toHaveAttribute("inert", "");

    /* inert must actually prevent focus, not merely be present */
    const focusable = await sidebar.locator('.side-item[data-view="home"]').evaluate((el) => {
      el.focus();
      return document.activeElement === el;
    });
    expect(focusable).toBe(false);
  });

  test("8b. opening moves focus into the drawer and updates ARIA", async ({ app }) => {
    const sidebar = app.locator("#sidebar");
    const burger = app.locator("#burgerBtn");

    await burger.click();

    await expect(burger).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");
    await expect(sidebar).not.toHaveAttribute("inert", "");

    /* focus lands on the current nav item */
    const focusInside = await app.evaluate(() =>
      document.querySelector("#sidebar").contains(document.activeElement),
    );
    expect(focusInside).toBe(true);
    await expect(app.locator(".side-item.is-active")).toBeFocused();
  });

  test("8c. Tab is trapped inside the open drawer", async ({ app }) => {
    await app.locator("#burgerBtn").click();
    await expect(app.locator(".side-item.is-active")).toBeFocused();

    /* walk well past the number of controls in the drawer; focus must never
       escape to the page behind the scrim */
    for (let i = 0; i < 14; i++) {
      await app.keyboard.press("Tab");
      const inside = await app.evaluate(() =>
        document.querySelector("#sidebar").contains(document.activeElement),
      );
      expect(inside).toBe(true);
    }

    /* and backwards too */
    for (let i = 0; i < 14; i++) {
      await app.keyboard.press("Shift+Tab");
      const inside = await app.evaluate(() =>
        document.querySelector("#sidebar").contains(document.activeElement),
      );
      expect(inside).toBe(true);
    }
  });

  test("8d. Escape closes the drawer and returns focus to the burger", async ({ app }) => {
    const sidebar = app.locator("#sidebar");
    const burger = app.locator("#burgerBtn");

    await burger.click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");

    await app.keyboard.press("Escape");

    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(sidebar).toHaveAttribute("inert", "");
    await expect(burger).toBeFocused();
  });

  test("8e. the scrim and a nav selection both close the drawer", async ({ app }) => {
    const sidebar = app.locator("#sidebar");

    await app.locator("#burgerBtn").click();
    /* the 268px drawer overlays the scrim's left edge — click clear of it */
    const scrim = app.locator("#sidebarScrim");
    const width = (await scrim.boundingBox()).width;
    await scrim.click({ position: { x: width - 10, y: 40 } });
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");

    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="map"]').click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(sidebar).toHaveAttribute("inert", "");
    await expect(app.locator("#view-map")).toBeVisible();
  });

  test("8g. the burger is a real toggle: a second click closes what the first opened", async ({
    app,
  }) => {
    const sidebar = app.locator("#sidebar");
    const burger = app.locator("#burgerBtn");

    await burger.click();
    await expect(burger).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");

    await burger.click();
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(sidebar).toHaveAttribute("inert", "");
    /* focus was already on the burger when it closed the drawer itself —
       it must stay there, not jump anywhere else */
    await expect(burger).toBeFocused();
  });

  test("8h. the burger's accessible name reflects open/closed state", async ({ app }) => {
    const burger = app.locator("#burgerBtn");
    await expect(burger).toHaveAttribute("aria-label", "Ouvrir le menu");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-label", "Fermer le menu");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-label", "Ouvrir le menu");
  });

  test("8f. touch targets on key controls are at least 44px", async ({ app }) => {
    const targets = ["#burgerBtn", "#themeBtn", "#langBtn", "#heroFavBtn"];
    for (const sel of targets) {
      const box = await app.locator(sel).evaluate((el) => {
        /* measure the control plus any ::before hit area it declares */
        const r = el.getBoundingClientRect();
        const before = getComputedStyle(el, "::before");
        const w = parseFloat(before.width) || 0;
        const h = parseFloat(before.height) || 0;
        return { w: Math.max(r.width, w), h: Math.max(r.height, h) };
      });
      expect.soft(box.w, `${sel} width`).toBeGreaterThanOrEqual(44);
      expect.soft(box.h, `${sel} height`).toBeGreaterThanOrEqual(44);
    }
  });
});
