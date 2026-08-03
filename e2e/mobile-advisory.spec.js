/* Phone-profile checks for the forecast advisory banner (Pixel 5 viewport).
   Runs only in the `mobile` project — see playwright.config.js. */
import { test, expect, installMocks } from "./mocks.js";

test.describe("advisory banner on a phone", () => {
  test("28. the banner fits the viewport and never scrolls the page sideways", async ({ page }) => {
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    const region = page.locator("#advisoryRegion");
    await expect(region).toBeVisible();

    const viewport = page.viewportSize();
    const box = await region.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);

    /* the document itself must not gain a horizontal scrollbar */
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      card: (() => {
        const el = document.querySelector("#advisoryList .advisory");
        return el.scrollWidth - el.clientWidth;
      })(),
    }));
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.card).toBeLessThanOrEqual(0);
  });

  test("29. it stays readable in dark mode", async ({ page }) => {
    await installMocks(page, { weatherKind: "storm" });
    await page.goto("/");
    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="settings"]').click();
    await page.locator('#themeTiles .set-tile[data-theme="dark"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");

    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="home"]').click();
    const card = page.locator("#advisoryList .advisory").first();
    await expect(card).toBeVisible();
    /* the card follows the theme tokens rather than a hard-coded light surface */
    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgb(255, 255, 255)");
    await expect(card.locator(".adv-title")).toBeVisible();
  });
});
