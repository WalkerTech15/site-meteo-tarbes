/* Coverage for the top-navbar visual polish pass: a true 3-column desktop
 * grid (search centered against the full bar, not just the leftover space
 * between two differently-sized side groups), consistent ~44px control
 * heights, a restrained Simple/Détaillé selected state, equal visual weight
 * between the theme and language buttons, and no new horizontal overflow —
 * layered on top of the existing responsive-nav.spec.js (hamburger/drawer
 * breakpoint) and mobile-search.spec.js (mobile overlay) suites, which this
 * file does not duplicate. */
import { test, expect, installMocks } from "./mocks.js";

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

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe("navbar polish: true desktop search centering", () => {
  for (const width of [901, 1024, 1280, 1440]) {
    test(`search bar is centered against the full viewport at ${width}px`, async ({ page }) => {
      await freshAt(page, { width, height: 900 });
      const sw = await page.locator(".search-wrap").boundingBox();
      const searchCenter = sw.x + sw.width / 2;
      expect(Math.abs(searchCenter - width / 2)).toBeLessThan(2);
    });
  }

  test("the search field is wider on large desktop screens, still centered", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 900 });
    const narrower = (await page.locator(".search-wrap").boundingBox()).width;

    await page.setViewportSize({ width: 1920, height: 1000 });
    const wider = (await page.locator(".search-wrap").boundingBox()).width;

    expect(wider).toBeGreaterThan(narrower);
  });

  test("the two outer nav groups resolve to equal-width tracks (the mechanism behind centering)", async ({
    page,
  }) => {
    await freshAt(page, { width: 1024, height: 900 });
    const start = await page.locator(".topnav-start").boundingBox();
    const actions = await page.locator(".topnav-actions").boundingBox();
    const inner = await page.locator(".topnav-inner").boundingBox();
    const leftTrack = start.x - inner.x;
    const rightTrack = inner.x + inner.width - (actions.x + actions.width);
    expect(Math.abs(leftTrack - rightTrack)).toBeLessThan(2);
  });
});

test.describe("navbar polish: no overlap or horizontal overflow", () => {
  for (const width of [1440, 1280, 1024, 901, 900, 768, 520, 480, 360]) {
    test(`${width}px`, async ({ page }) => {
      await freshAt(page, { width, height: 900 });
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);

      const start = await page.locator(".topnav-start").boundingBox();
      const center = await page.locator(".topnav-center").boundingBox();
      const actions = await page.locator(".topnav-actions").boundingBox();
      expect(intersects(start, center), "start/center overlap").toBe(false);
      expect(intersects(center, actions), "center/actions overlap").toBe(false);
      expect(intersects(start, actions), "start/actions overlap").toBe(false);
    });
  }
});

test.describe("navbar polish: the 901/900px drawer breakpoint", () => {
  test("901px keeps the desktop grid — search inline, mode toggle visible, hamburger hidden", async ({
    page,
  }) => {
    await freshAt(page, { width: 901, height: 800 });
    await expect(page.locator("#burgerBtn")).toBeHidden();
    await expect(page.locator("#modeToggle")).toBeVisible();
    await expect(page.locator(".search-wrap")).toBeVisible();
    const display = await page
      .locator(".topnav-inner")
      .evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("grid");
  });

  test("900px switches to the drawer layout — hamburger visible, mode toggle hidden", async ({
    page,
  }) => {
    await freshAt(page, { width: 900, height: 800 });
    await expect(page.locator("#burgerBtn")).toBeVisible();
    await expect(page.locator("#modeToggle")).toBeHidden();
    const display = await page
      .locator(".topnav-inner")
      .evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("flex");

    await page.locator("#burgerBtn").click();
    await expect(page.locator("#sidebar")).toHaveClass(/is-open/);
  });
});

test.describe("navbar polish: consistent control heights", () => {
  test("search field, mode toggle, theme and language buttons share one ~44px height", async ({
    page,
  }) => {
    await freshAt(page, { width: 1440, height: 900 });
    const heights = {};
    for (const [name, sel] of [
      ["search", ".search-bar"],
      ["mode", "#modeToggle"],
      ["theme", "#themeBtn"],
      ["lang", "#langBtn"],
    ]) {
      const box = await page.locator(sel).boundingBox();
      heights[name] = box.height;
    }
    for (const [name, h] of Object.entries(heights)) {
      expect(h, `${name} height`).toBeGreaterThanOrEqual(42);
      expect(h, `${name} height`).toBeLessThanOrEqual(46);
    }
    const values = Object.values(heights);
    expect(Math.max(...values) - Math.min(...values), "spread across controls").toBeLessThanOrEqual(
      2,
    );
  });

  test("navbar icon buttons reach the 44×44px touch target at the drawer breakpoint", async ({
    page,
  }) => {
    await freshAt(page, { width: 900, height: 800 });
    for (const sel of ["#burgerBtn", "#themeBtn", "#langBtn"]) {
      const box = await page.locator(sel).boundingBox();
      expect(box.width, sel).toBeGreaterThanOrEqual(44);
      expect(box.height, sel).toBeGreaterThanOrEqual(44);
    }
  });

  test("theme and language buttons carry equal visual weight (same box size, full-contrast icon color)", async ({
    page,
  }) => {
    await freshAt(page, { width: 1280, height: 800 });
    const theme = await page.locator("#themeBtn").boundingBox();
    const lang = await page.locator("#langBtn").boundingBox();
    expect(theme.height).toBe(lang.height);

    // the theme icon used to render in the muted --text-2 gray, reading as
    // fainter than the language button's bold code + colourful flag emoji —
    // it should now match the full-strength --text colour used everywhere
    // else in the bar (search icon, logo, selected mode label).
    const themeColor = await page.locator("#themeBtn").evaluate((el) => getComputedStyle(el).color);
    const bodyTextColor = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--text").trim(),
    );
    const toRgb = (hex) => {
      const n = parseInt(hex.replace("#", ""), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    expect(themeColor).toBe(toRgb(bodyTextColor));
  });
});

test.describe("navbar polish: Simple/Détaillé selection is clear without a heavy shadow", () => {
  test("the selected option carries a distinct background (thumb), border and heavier weight", async ({
    page,
  }) => {
    await freshAt(page, { width: 1280, height: 800 });
    const simple = page.locator('#modeToggle button[data-mode="simple"]');
    const detailed = page.locator('#modeToggle button[data-mode="detailed"]');
    const thumb = page.locator("#modeToggle .seg-thumb");

    await expect(simple).toHaveAttribute("aria-checked", "true");
    const simpleWeight = await simple.evaluate((el) => getComputedStyle(el).fontWeight);
    const detailedWeight = await detailed.evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(simpleWeight)).toBeGreaterThan(Number(detailedWeight));
    await expect(thumb).toHaveCSS("border-style", "solid");

    // restrained, not heavy: a single soft shadow layer, not a stacked/inset one
    const shadow = await thumb.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow.split("),").length, "single shadow layer").toBeLessThanOrEqual(1);
    expect(shadow).not.toContain("inset");

    await detailed.click();
    await expect(detailed).toHaveAttribute("aria-checked", "true");
    await expect(simple).toHaveAttribute("aria-checked", "false");
    const detailedWeightAfter = await detailed.evaluate((el) => getComputedStyle(el).fontWeight);
    const simpleWeightAfter = await simple.evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(detailedWeightAfter)).toBeGreaterThan(Number(simpleWeightAfter));
  });

  test("keeps Simple first, Détaillé second", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 800 });
    const labels = await page.locator("#modeToggle button").allTextContents();
    expect(labels.map((s) => s.trim())).toEqual(["Simple", "Détaillé"]);
  });
});

test.describe("navbar polish: Simple/Détaillé keyboard operation", () => {
  test("is reachable and operable via Tab, Enter and Space", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 800 });
    const group = page.locator("#modeToggle");
    await expect(group).toHaveAttribute("role", "radiogroup");
    const simple = group.locator('button[data-mode="simple"]');
    const detailed = group.locator('button[data-mode="detailed"]');
    await expect(simple).toHaveAttribute("role", "radio");
    await expect(detailed).toHaveAttribute("role", "radio");

    await detailed.focus();
    await page.keyboard.press("Enter");
    await expect(detailed).toHaveAttribute("aria-checked", "true");
    await expect(simple).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("body")).toHaveAttribute("data-mode", "detailed");

    await simple.focus();
    await page.keyboard.press(" ");
    await expect(simple).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("body")).toHaveAttribute("data-mode", "simple");
  });
});

test.describe("navbar polish: keyboard focus is visible", () => {
  test("Tabbing to the search field, mode toggle and theme button shows a focus outline", async ({
    page,
  }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await page.locator("#searchInput").focus();
    await expect(page.locator("#searchInput")).toBeFocused();

    for (const sel of ["#modeToggle button[data-mode='detailed']", "#themeBtn", "#langBtn"]) {
      await page.locator(sel).focus();
      const outline = await page.locator(sel).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: cs.outlineWidth };
      });
      expect(outline.style, `${sel} outline-style`).not.toBe("none");
      expect(outline.width, `${sel} outline-width`).not.toBe("0px");
    }
  });
});

test.describe("navbar polish: theme and language controls", () => {
  test("theme button opens its menu and is keyboard-operable (Enter, arrows, Enter)", async ({
    page,
  }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await page.locator("#themeBtn").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#themeMenu")).toBeVisible();
    await expect(page.locator("#themeBtn")).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator("#themeMenu")).toBeHidden();
    await expect(page.locator("body")).toHaveAttribute("data-theme", /^(light|dark)$/);
  });

  test("language button opens its menu and is keyboard-operable (Enter, Tab, Enter)", async ({
    page,
  }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await page.locator("#langBtn").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#langMenu")).toBeVisible();

    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("clicking still works for both (regression guard)", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await page.locator("#themeBtn").click();
    await page.locator('#themeMenu button[data-theme="dark"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");

    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("navbar polish: '/' shortcut on desktop widths", () => {
  test("focuses the inline search field directly, without the mobile overlay", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await page.locator("body").click({ position: { x: 2, y: 200 } });
    await page.keyboard.press("/");
    await expect(page.locator("#searchInput")).toBeFocused();
    await expect(page.locator("#searchWrap")).not.toHaveClass(/is-mobile-open/);
  });
});

test.describe("navbar polish: mobile search still opens and focuses correctly", () => {
  test("tapping the compact search button opens the overlay and focuses the input", async ({
    page,
  }) => {
    await freshAt(page, { width: 480, height: 800 });
    await expect(page.locator("#mobileSearchBtn")).toBeVisible();
    await expect(page.locator(".search-wrap")).toBeHidden();

    await page.locator("#mobileSearchBtn").click();
    await expect(page.locator(".search-wrap")).toHaveClass(/is-mobile-open/);
    await expect(page.locator("#searchInput")).toBeFocused();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("navbar polish: bilingual accessible labels", () => {
  test("French (default)", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await expect(page.locator("#searchInput")).toHaveAttribute("aria-label", "Rechercher un lieu");
    await expect(page.locator("#themeBtn")).toHaveAttribute("aria-label", "Choisir le thème");
    await expect(page.locator("#modeToggle")).toHaveAttribute("aria-label", "Mode d'affichage");
    await expect(page.locator("#langBtn")).toHaveAttribute(
      "aria-label",
      "Changer de langue — actuellement Français",
    );
    await expect(page.locator('#modeToggle button[data-mode="simple"]')).toHaveText("Simple");
    await expect(page.locator('#modeToggle button[data-mode="detailed"]')).toHaveText("Détaillé");
  });

  test("English", async ({ page }) => {
    await freshAt(page, { width: 1280, height: 800 });
    await page.locator("#langBtn").click();
    await page.locator('#langMenu button[data-lang="en"]').click();

    await expect(page.locator("#searchInput")).toHaveAttribute("aria-label", "Search location");
    await expect(page.locator("#themeBtn")).toHaveAttribute("aria-label", "Choose theme");
    await expect(page.locator("#modeToggle")).toHaveAttribute("aria-label", "Display mode");
    await expect(page.locator("#langBtn")).toHaveAttribute(
      "aria-label",
      "Change language — currently English",
    );
    await expect(page.locator('#modeToggle button[data-mode="simple"]')).toHaveText("Simple");
    await expect(page.locator('#modeToggle button[data-mode="detailed"]')).toHaveText("Detailed");
  });
});

test.describe("navbar polish: reduced motion is respected", () => {
  test("the mode-toggle thumb and menus still work with prefers-reduced-motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await freshAt(page, { width: 1280, height: 800 });
    await page.locator('#modeToggle button[data-mode="detailed"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-mode", "detailed");
    await page.locator("#themeBtn").click();
    await expect(page.locator("#themeMenu")).toBeVisible();
  });
});
