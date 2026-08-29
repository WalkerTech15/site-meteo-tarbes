/* Settings → Time: 12/24-hour choice, the optional seconds display, and the
 * hero clock's use of the SELECTED CITY's own IANA zone (never the visitor's
 * browser zone). See features/settings.js (setClockFormat/setClockSeconds),
 * core/location.js (localTimeStr) and ui/render-home.js (updateHeroClock). */
import { test, expect, installMocks } from "./mocks.js";

function fmt(tz, { hour12 = false, seconds = false } = {}) {
  const opts = {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
  };
  if (seconds) opts.second = "2-digit";
  return new Intl.DateTimeFormat("fr-FR", opts).format(new Date());
}

const goToSettings = (app) => app.locator('.side-item[data-view="settings"]').click();
const goToHome = (app) => app.locator('.side-item[data-view="home"]').click();

test.describe("settings — time", () => {
  test("the Time card lives only in Settings, never inside the Home weather card", async ({
    app,
  }) => {
    /* views are hidden (not removed) siblings, so this is a structural check,
       independent of which view is currently active */
    await expect(app.locator("#view-home #chipClockFormat")).toHaveCount(0);
    await expect(app.locator("#view-home #clockSecondsSwitch")).toHaveCount(0);
    await expect(app.locator("#heroInner")).not.toContainText("Show seconds");

    await goToSettings(app);
    await expect(app.locator("#view-settings #chipClockFormat")).toBeVisible();
    await expect(app.locator("#view-settings #clockSecondsSwitch")).toBeVisible();
  });

  test("defaults to 24-hour with seconds off", async ({ app }) => {
    await goToSettings(app);
    await expect(app.locator('#chipClockFormat button[data-cf="24"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#chipClockFormat button[data-cf="12"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(app.locator("#clockSecondsSwitch")).toHaveAttribute("aria-checked", "false");
    await expect(app.locator("#heroClockTime")).toHaveText(/^\d{2}:\d{2}$/);
  });

  test("switching to 12-hour applies to the hero clock immediately, no reload", async ({ app }) => {
    await goToSettings(app);
    await app.locator('#chipClockFormat button[data-cf="12"]').click();
    await expect(app.locator('#chipClockFormat button[data-cf="12"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator('#chipClockFormat button[data-cf="24"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await goToHome(app);
    await expect(app.locator("#heroClockTime")).toHaveText(/^\d{2}:\d{2}\s?(AM|PM)$/);

    /* and back to 24-hour, still without a reload */
    await goToSettings(app);
    await app.locator('#chipClockFormat button[data-cf="24"]').click();
    await goToHome(app);
    await expect(app.locator("#heroClockTime")).toHaveText(/^\d{2}:\d{2}$/);
  });

  test("the seconds toggle is off by default and shows/hides seconds immediately", async ({
    app,
  }) => {
    await expect(app.locator("#heroClockTime")).toHaveText(/^\d{2}:\d{2}$/);

    await goToSettings(app);
    await app.locator("#clockSecondsSwitch").click();
    await expect(app.locator("#clockSecondsSwitch")).toHaveAttribute("aria-checked", "true");

    await goToHome(app);
    await expect(app.locator("#heroClockTime")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

    await goToSettings(app);
    await app.locator("#clockSecondsSwitch").click();
    await expect(app.locator("#clockSecondsSwitch")).toHaveAttribute("aria-checked", "false");
    await goToHome(app);
    await expect(app.locator("#heroClockTime")).toHaveText(/^\d{2}:\d{2}$/);
  });

  test("12-hour and seconds combine correctly", async ({ app }) => {
    await goToSettings(app);
    await app.locator('#chipClockFormat button[data-cf="12"]').click();
    await app.locator("#clockSecondsSwitch").click();
    await goToHome(app);
    await expect(app.locator("#heroClockTime")).toHaveText(/^\d{2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  test("clock format and seconds persist after a reload", async ({ app }) => {
    await goToSettings(app);
    await app.locator('#chipClockFormat button[data-cf="12"]').click();
    await app.locator("#clockSecondsSwitch").click();

    await app.reload();
    await expect(app.locator("#heroCityName")).not.toBeEmpty();

    await expect(app.locator("#heroClockTime")).toHaveText(/^\d{2}:\d{2}:\d{2}\s?(AM|PM)$/);
    await goToSettings(app);
    await expect(app.locator('#chipClockFormat button[data-cf="12"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(app.locator("#clockSecondsSwitch")).toHaveAttribute("aria-checked", "true");
  });

  test("uses the selected city's real IANA zone, not the visitor's browser zone", async ({
    page,
  }) => {
    /* the Playwright context itself is pinned to Europe/Paris (playwright.config.js)
       — Tokyo proves the clock follows wx.timezone, not that ambient zone */
    await installMocks(page, { weatherTimezone: "Asia/Tokyo" });
    const before = fmt("Asia/Tokyo");
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();

    const text = await page.locator("#heroClockTime").textContent();
    const after = fmt("Asia/Tokyo");
    /* before/after brackets the instant the app itself rendered, absorbing any
       minute rollover between the two reads above */
    expect([before, after]).toContain(text);
    expect(text).not.toBe(fmt("Europe/Paris"));
  });

  test("the removed Notifications prototype is gone, but Time settings still work", async ({
    app,
  }) => {
    await goToSettings(app);
    /* the whole card, its "Prototype" badge, and all four switches — gone */
    await expect(app.locator("[data-notif]")).toHaveCount(0);
    await expect(app.locator(".notif-grid")).toHaveCount(0);
    await expect(app.locator(".proto-pill")).toHaveCount(0);
    await expect(app.locator("#view-settings")).not.toContainText("Notifications");
    await expect(app.locator("#view-settings")).not.toContainText("Prototype");

    /* Time — a sibling card sharing the same .notif-item/.notif-txt/.switch
       styling as the removed card — is unaffected. [data-i18n="setTime"] is
       used instead of the visible text so this doesn't depend on which
       language the page happens to be in. */
    await expect(app.locator('[data-i18n="setTime"]')).toBeVisible();
    await expect(app.locator("#chipClockFormat")).toBeVisible();
    await expect(app.locator("#clockSecondsSwitch")).toBeVisible();
    await app.locator('#chipClockFormat button[data-cf="12"]').click();
    await expect(app.locator('#chipClockFormat button[data-cf="12"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("the clock format chips and seconds switch expose correct semantics", async ({ app }) => {
    await goToSettings(app);
    await expect(app.locator("#chipClockFormat")).toHaveAttribute("role", "radiogroup");
    const radios = app.locator("#chipClockFormat button");
    await expect(radios).toHaveCount(2);
    for (const role of await radios.evaluateAll((els) =>
      els.map((el) => el.getAttribute("role")),
    )) {
      expect(role).toBe("radio");
    }
    await expect(app.locator("#clockSecondsSwitch")).toHaveAttribute("role", "switch");
    await expect(app.locator("#clockSecondsSwitch")).toHaveAttribute(
      "aria-labelledby",
      "clockSecondsLbl",
    );
  });
});
