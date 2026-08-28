/* Phone-profile checks for the Home compact forecast strip, now 7 days
 * (previously 5 — see ui/render-home.js renderForecast). Below the 1080px
 * breakpoint it falls back to the same horizontal-scroll row as every other
 * carousel in the app (styles/utilities/responsive.css); this just confirms
 * that stays true with two more cards in it. */
import { test, expect } from "./mocks.js";

test.describe("home forecast strip on a phone", () => {
  test("shows all 7 days as a swipeable row, with no page-level overflow", async ({ app }) => {
    const row = app.locator("#forecastRow");
    await expect(row.locator(".forecast-card")).toHaveCount(7);
    await expect(row).toHaveCSS("overflow-x", "auto");
    await expect(row).toHaveCSS("display", "flex");

    const before = await app.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      row: document.querySelector("#forecastRow").scrollWidth,
    }));
    expect(before.doc).toBeLessThanOrEqual(0);
    const rowBox = await row.boundingBox();
    expect(before.row).toBeGreaterThan(rowBox.width); /* 7 cards genuinely overflow the row */

    await row.evaluate((el) => {
      el.scrollLeft = 200;
      el.dispatchEvent(new Event("scroll"));
    });

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the rest of the Home layout stays intact around the wider strip", async ({ app }) => {
    await expect(app.locator("#heroCityName")).toBeVisible();
    await expect(app.locator("#forecastRow .forecast-card").first()).toBeVisible();
    await expect(app.locator("#homeHourlyStrip .hour-cell")).toHaveCount(6);

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
