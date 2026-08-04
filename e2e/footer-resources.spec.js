import { test, expect, installMocks } from "./mocks.js";

test.describe("footer user resources", () => {
  test("Help and Privacy open dedicated pages, while provider links stay out of Resources", async ({
    page,
  }) => {
    await installMocks(page);
    await page.goto("/#/about");

    const resources = page.locator("footer nav.footer-col").filter({ hasText: "Ressources" });
    await expect(resources.locator('a[href="https://open-meteo.com"]')).toHaveCount(0);

    await resources.locator('button[data-view="help"]').click();
    await expect(page.locator("#view-help")).toBeVisible();
    await expect(page.locator("#helpTitle")).toHaveText("Aide");
    await expect(page.locator("#view-help .help-step")).toHaveCount(3);
    await expect(page.locator("#view-help .faq-item")).toHaveCount(3);
    await expect(page).toHaveURL(/#\/help/);

    await resources.locator('button[data-view="privacy"]').click();
    await expect(page.locator("#view-privacy")).toBeVisible();
    await expect(page.locator("#view-help")).toBeHidden();
    await expect(page.locator("#view-privacy .policy-card")).toHaveCount(4);
    await expect(page.locator("#view-privacy .privacy-controls")).toBeVisible();
    await expect(page).toHaveURL(/#\/privacy/);
  });
});
