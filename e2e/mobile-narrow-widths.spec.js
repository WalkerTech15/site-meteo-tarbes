/* The two phone widths the Pixel 5 project does not cover.
 *
 * playwright.config.js runs the mobile project at Pixel 5 (393 px). The two
 * most common iPhone widths sit just below that — 390 px (iPhone 12/13/14/15)
 * and 375 px (iPhone SE, and every iPhone up to the 8) — and a layout that
 * fits 393 can still overflow at 375. Horizontal overflow on a phone is not a
 * cosmetic defect: it makes the page pan sideways under a thumb and pushes
 * controls off-screen, so it is checked on every view rather than only Home.
 *
 * Deliberately narrow in what it asserts: no horizontal overflow, and the
 * primary heading actually visible. This is a guard against regressions at
 * these widths, not a second copy of the per-view specs.
 */
import { test, expect, installMocks } from "./mocks.js";

const VIEWS = ["home", "map", "forecast", "favorites", "settings", "about"];
const WIDTHS = [375, 390];

for (const width of WIDTHS) {
  test.describe(`layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 812 } });

    test(`no view scrolls sideways at ${width}px`, async ({ page }) => {
      await installMocks(page);
      await page.goto("/");
      await expect(page.locator("#heroCityName")).not.toBeEmpty();

      for (const view of VIEWS) {
        /* Below the 900px breakpoint the sidebar is an off-canvas drawer, so
           each view is reached through the burger, exactly as a visitor does. */
        await page.locator("#burgerBtn").click();
        await page.locator(`.side-item[data-view="${view}"]`).click();
        /* Let any view-entry transition settle before measuring. */
        await page.waitForTimeout(250);

        const overflow = await page.evaluate((w) => {
          const doc = document.documentElement;
          /* The widest offender, so a failure names something actionable
             rather than just reporting the document is too wide. */
          let worst = { sel: "", right: 0 };
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            /* An element scrolled inside its own overflow container is fine —
               only what pushes the DOCUMENT wide counts. */
            if (r.right > worst.right) {
              worst = {
                sel:
                  el.tagName.toLowerCase() +
                  (el.className ? "." + String(el.className).split(" ")[0] : ""),
                right: Math.round(r.right),
              };
            }
          }
          return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, viewport: w, worst };
        }, width);

        expect(
          overflow.scrollWidth,
          `${view} at ${width}px overflows; widest element ${overflow.worst.sel} reaches ${overflow.worst.right}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }
    });
  });
}
