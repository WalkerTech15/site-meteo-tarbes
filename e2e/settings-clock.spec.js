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

/* Card-level layout — the Time card is the only .set-card with just one chip
   group and one toggle row, so it inherited the same var(--s-3) rhythm as
   denser cards (Units' two chip groups, etc.) and read as visibly emptier.
   .set-time (settings.css) tightens that rhythm to var(--s-2) for this card
   only; these tests lock the tightened gaps in and guard the things that
   must stay untouched (width, border, radius, background). */
test.describe("settings — time: card layout & spacing", () => {
  const timeCard = (app) =>
    app.locator("#chipClockFormat").locator("xpath=ancestor::div[contains(@class,'set-card')][1]");
  const unitsCard = (app) =>
    app.locator("#chipTemp").locator("xpath=ancestor::div[contains(@class,'set-card')][1]");

  async function timeCardBoxes(app) {
    const card = timeCard(app);
    const [cardBox, headBox, groupsBox, labelBox, chipsBox, rowBox] = await Promise.all([
      card.boundingBox(),
      card.locator(".set-head").boundingBox(),
      card.locator(".uchip-groups").boundingBox(),
      card.locator(".ulabel").boundingBox(),
      card.locator("#chipClockFormat").boundingBox(),
      card.locator(".set-toggle-row").boundingBox(),
    ]);
    return { cardBox, headBox, groupsBox, labelBox, chipsBox, rowBox };
  }

  test("has tightened, non-excessive gaps between title, controls, seconds row and the card edge", async ({
    app,
  }) => {
    await goToSettings(app);
    const { cardBox, headBox, groupsBox, labelBox, chipsBox, rowBox } = await timeCardBoxes(app);

    const gaps = {
      titleToControls: groupsBox.y - (headBox.y + headBox.height),
      labelToChips: chipsBox.y - (labelBox.y + labelBox.height),
      controlsToSeconds: rowBox.y - (groupsBox.y + groupsBox.height),
      secondsToCardBottom: cardBox.y + cardBox.height - (rowBox.y + rowBox.height),
    };

    for (const [name, gap] of Object.entries(gaps)) {
      expect(gap, name).toBeGreaterThanOrEqual(0);
    }
    expect(gaps.titleToControls, "titleToControls").toBeLessThanOrEqual(20);
    expect(gaps.labelToChips, "labelToChips").toBeLessThanOrEqual(10);
    expect(gaps.controlsToSeconds, "controlsToSeconds").toBeLessThanOrEqual(20);
    expect(gaps.secondsToCardBottom, "secondsToCardBottom").toBeLessThanOrEqual(20);
  });

  test("the clock-format label lines up with its 12/24-hour controls", async ({ app }) => {
    await goToSettings(app);
    const { labelBox, chipsBox } = await timeCardBoxes(app);
    expect(Math.abs(labelBox.x - chipsBox.x)).toBeLessThanOrEqual(1);
  });

  test("keeps the same width and start position as the other Settings cards", async ({ app }) => {
    await goToSettings(app);
    const [timeBox, unitsBox] = await Promise.all([
      timeCard(app).boundingBox(),
      unitsCard(app).boundingBox(),
    ]);
    expect(Math.abs(timeBox.width - unitsBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(timeBox.x - unitsBox.x)).toBeLessThanOrEqual(1);
  });

  test("keeps the same border, radius and background as sibling Settings cards", async ({
    app,
  }) => {
    await goToSettings(app);
    const readStyle = (el) => {
      const s = getComputedStyle(el);
      return {
        radius: s.borderRadius,
        borderWidth: s.borderWidth,
        borderColor: s.borderColor,
        background: s.backgroundColor,
      };
    };
    const [timeStyle, unitsStyle] = await Promise.all([
      timeCard(app).evaluate(readStyle),
      unitsCard(app).evaluate(readStyle),
    ]);
    expect(timeStyle).toEqual(unitsStyle);
  });

  test("on mobile, the format controls and seconds row stay readable with no page overflow", async ({
    app,
  }) => {
    await app.setViewportSize({ width: 375, height: 800 });
    /* below the 900px drawer breakpoint the sidebar (and its nav items) is
       reachable only after opening the burger drawer — see responsive.css */
    await app.locator(".icon-btn.nav-burger").click();
    await goToSettings(app);
    await expect(app.locator("#chipClockFormat")).toBeVisible();
    await expect(app.locator("#clockSecondsSwitch")).toBeVisible();

    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    for (const width of await app
      .locator("#chipClockFormat button")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))) {
      expect(width).toBeGreaterThan(0);
    }
  });
});
