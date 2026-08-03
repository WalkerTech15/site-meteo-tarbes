/* Phone-profile checks for the forecast page's chart and carousel polish. */
import { test, expect } from "./mocks.js";

test.describe("forecast page on a phone", () => {
  test("the day carousel keeps scrolling horizontally without any page overflow", async ({
    app,
  }) => {
    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="forecast"]').click();

    const row = app.locator("#forecastRow2");
    await expect(row).toHaveCSS("overflow-x", "auto");
    await expect(row.locator(".forecast-card")).toHaveCount(7);

    const before = await app.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      row: document.querySelector("#forecastRow2").scrollWidth,
    }));
    expect(before.doc).toBeLessThanOrEqual(0);
    const rowBox = await row.boundingBox();
    expect(before.row).toBeGreaterThan(rowBox.width); /* content genuinely overflows */

    await row.evaluate((el) => {
      el.scrollLeft = 200;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(app.locator("#fcFadeLeft")).toHaveClass(/is-visible/);

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("chart axis labels stay readable and unclipped at phone width", async ({ app }) => {
    await app.locator("#burgerBtn").click();
    await app.locator('.side-item[data-view="forecast"]').click();

    const labels = app.locator("#fcChartHost svg text");
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
    const xs = await labels.evaluateAll((els) => els.map((el) => el.getBBox().x));
    xs.forEach((x) => expect(x).toBeGreaterThanOrEqual(0));

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
