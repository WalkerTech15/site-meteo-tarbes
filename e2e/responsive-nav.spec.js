/* The 900px drawer breakpoint must agree between CSS (styles/layout/topnav.css,
   styles/utilities/responsive.css) and JS (ui/navigation.js's
   `matchMedia("(max-width: 900px)")`) — this file exercises the exact widths
   named in the task, plus the resize transition across the boundary, on the
   "desktop" Playwright project so arbitrary viewport sizes are unconstrained
   by a device profile. */
import { test, expect, installMocks } from "./mocks.js";

const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 901, height: 768 },
];
const DRAWER_VIEWPORTS = [
  { width: 900, height: 768 },
  { width: 768, height: 1024 },
  { width: 480, height: 800 },
  { width: 375, height: 812 },
  { width: 320, height: 568 },
];

async function freshAt(page, viewport) {
  await page.setViewportSize(viewport);
  await installMocks(page);
  await page.goto("/");
  await expect(page.locator("#heroCityName")).not.toBeEmpty();
}

function noOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("desktop widths: hamburger hidden, sidebar permanent", () => {
  for (const viewport of DESKTOP_VIEWPORTS) {
    test(`${viewport.width}x${viewport.height}`, async ({ page }) => {
      await freshAt(page, viewport);
      const burger = page.locator("#burgerBtn");
      const sidebar = page.locator("#sidebar");

      await expect(burger).toBeHidden();
      await expect(burger).toHaveAttribute("aria-expanded", "false");
      await expect(sidebar).toBeVisible();
      await expect(sidebar).not.toHaveAttribute("inert", "");
      await expect(sidebar).not.toHaveAttribute("aria-hidden");
      await expect(page.locator("#sidebarScrim")).toBeHidden();
      /* permanent sidebar: the shell uses its two-column grid, not the
         single-column mobile layout */
      const columns = await page.evaluate(
        () => getComputedStyle(document.querySelector(".shell")).gridTemplateColumns,
      );
      expect(columns.trim().split(/\s+/).length).toBeGreaterThan(1);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("900px and below: hamburger visible, drawer closed by default", () => {
  for (const viewport of DRAWER_VIEWPORTS) {
    test(`${viewport.width}x${viewport.height}`, async ({ page }) => {
      await freshAt(page, viewport);
      const burger = page.locator("#burgerBtn");
      const sidebar = page.locator("#sidebar");

      await expect(burger).toBeVisible();
      await expect(burger).toHaveAttribute("aria-expanded", "false");
      await expect(sidebar).toHaveAttribute("aria-hidden", "true");
      await expect(sidebar).toHaveAttribute("inert", "");
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);

      /* first click opens */
      await burger.click();
      await expect(burger).toHaveAttribute("aria-expanded", "true");
      await expect(sidebar).toHaveAttribute("aria-hidden", "false");
      await expect(sidebar).not.toHaveAttribute("inert", "");

      /* second click closes — this is the toggle behaviour Fix 2 adds */
      await burger.click();
      await expect(burger).toHaveAttribute("aria-expanded", "false");
      await expect(sidebar).toHaveAttribute("aria-hidden", "true");
      await expect(sidebar).toHaveAttribute("inert", "");
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("crossing the 900px breakpoint by resizing", () => {
  test("mobile to desktop: an open drawer closes, inert/aria-hidden clear, scrim hides", async ({
    page,
  }) => {
    await freshAt(page, { width: 375, height: 812 });
    await page.locator("#burgerBtn").click();
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "false");

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("#burgerBtn")).toBeHidden();
    await expect(page.locator("#burgerBtn")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#sidebar")).not.toHaveAttribute("aria-hidden");
    await expect(page.locator("#sidebar")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#sidebarScrim")).toBeHidden();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("desktop to mobile: the drawer starts closed, no stale is-open carries over", async ({
    page,
  }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await page.setViewportSize({ width: 375, height: 812 });

    const sidebar = page.locator("#sidebar");
    await expect(page.locator("#burgerBtn")).toBeVisible();
    await expect(page.locator("#burgerBtn")).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(sidebar).toHaveAttribute("inert", "");
    await expect(page.locator("#sidebarScrim")).toBeHidden();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("opening on mobile, resizing to desktop, then back to mobile starts closed again", async ({
    page,
  }) => {
    await freshAt(page, { width: 375, height: 812 });
    await page.locator("#burgerBtn").click();
    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "false");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setViewportSize({ width: 375, height: 812 });

    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#sidebar")).toHaveAttribute("inert", "");
    await expect(page.locator("#burgerBtn")).toHaveAttribute("aria-expanded", "false");
  });

  /* Regression, deterministic counterpart to the test above. That one only
     catches the bug when the machine is loaded enough for the breakpoint
     `change` event to be delivered late — after a second resize has already
     put the viewport back in drawer mode. This reproduces the state such a
     late event leaves behind (a stale `is-open` present as drawer mode is
     entered) directly, with no timing dependency: the drawer must still come
     up closed. Before the fix in ui/navigation.js, entering drawer mode never
     cleared `is-open`, so this reported aria-hidden="false". */
  test("a stale is-open cannot survive entering drawer mode", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await page.evaluate(() => document.querySelector("#sidebar").classList.add("is-open"));

    await page.setViewportSize({ width: 375, height: 812 });

    await expect(page.locator("#sidebar")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#sidebar")).toHaveAttribute("inert", "");
    await expect(page.locator("#sidebar")).not.toHaveClass(/is-open/);
    await expect(page.locator("#burgerBtn")).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("accessible name toggles with state and language", () => {
  test("French: Ouvrir le menu / Fermer le menu", async ({ page }) => {
    await freshAt(page, { width: 375, height: 812 });
    const burger = page.locator("#burgerBtn");
    await expect(burger).toHaveAttribute("aria-label", "Ouvrir le menu");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-label", "Fermer le menu");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-label", "Ouvrir le menu");
  });

  test("English: Open menu / Close menu", async ({ page }) => {
    await freshAt(page, { width: 375, height: 812 });
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();

    const burger = page.locator("#burgerBtn");
    await expect(burger).toHaveAttribute("aria-label", "Open menu");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-label", "Close menu");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-label", "Open menu");
  });

  test("switching language while the drawer is open keeps the label correct", async ({ page }) => {
    await freshAt(page, { width: 375, height: 812 });
    const burger = page.locator("#burgerBtn");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-label", "Fermer le menu");

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(burger).toHaveAttribute("aria-label", "Close menu");
  });
});

test.describe("existing header/sidebar controls still work at both breakpoints", () => {
  for (const [label, viewport] of [
    ["desktop", { width: 1280, height: 800 }],
    ["mobile", { width: 375, height: 812 }],
  ]) {
    test(`language, theme, and mode controls work at ${label} width`, async ({ page }) => {
      await freshAt(page, viewport);
      if (viewport.width <= 900) await page.locator("#burgerBtn").click();

      await page.locator("#langBtn").click();
      await page.locator('#langMenu button[data-lang="en"]').click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");

      await page.locator("#themeBtn").click();
      await page.locator('#themeMenu button[data-theme="dark"]').click();
      await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");

      const modeToggle = viewport.width <= 900 ? "#modeToggleSide" : "#modeToggle";
      await page.locator(`${modeToggle} button[data-mode="detailed"]`).click();
      await expect(page.locator("body")).toHaveAttribute("data-mode", "detailed");
    });
  }
});
