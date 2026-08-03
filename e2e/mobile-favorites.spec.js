/* Phone-profile checks for favorite removal confirmation. */
import { test, expect, installMocks } from "./mocks.js";

test.describe("favorite confirmation on a phone", () => {
  test("30. the compact dialog fits and keeps touch-friendly actions", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await page.locator("#heroFavBtn").click();

    await page.locator("#burgerBtn").click();
    await page.locator('.side-item[data-view="favorites"]').click();
    await page.locator("#favGrid .favx-star").click();

    const dialog = page.locator("#confirmDialog");
    await expect(dialog).toBeVisible();
    const viewport = page.viewportSize();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);

    const cancel = await page.locator("#confirmDialogCancel").boundingBox();
    const remove = await page.locator("#confirmDialogConfirm").boundingBox();
    expect(cancel.height).toBeGreaterThanOrEqual(44);
    expect(remove.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(cancel.y - remove.y)).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator("#favGrid .favx-star")).toBeFocused();
  });
});
