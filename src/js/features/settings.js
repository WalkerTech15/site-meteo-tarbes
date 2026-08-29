/* Display mode, units, theme, and language — the settings that persist to
   localStorage and drive both the Settings page and the navbar controls. */
import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { setStr, KEYS } from "../core/storage.js";
import { t, applyStaticI18n } from "../core/i18n.js";
import { syncSegToggle, syncSidebarA11y } from "../ui/navigation.js";
import { renderChart, renderExplore, updateHeroClock } from "../ui/render-home.js";
import { renderFavorites } from "../ui/render-favorites.js";
import { renderAllWeather } from "./location.js";
import { refreshMapLanguage, resizeMaps } from "./map.js";

export function setMode(mode) {
  state.mode = mode;
  setStr(KEYS.mode, mode);
  document.body.dataset.mode = mode;
  syncSegToggle($("#modeToggleSide"), "mode", mode);
  updateSettingsUI();
  if (mode === "detailed") renderChart();
  /* Simple ↔ Detailed changes #homeMap's column width (full-width vs. the
     home-duo split) synchronously via the body[data-mode] CSS — MapLibre
     caches its canvas size and never re-measures on its own, so it has to be
     told explicitly once the new layout has been applied. */
  requestAnimationFrame(resizeMaps);
}

export function setUnitTemp(v) {
  state.unitTemp = v;
  setStr(KEYS.unitTemp, v);
  updateSettingsUI();
  renderAllWeather();
}

export function setUnitWind(v) {
  state.unitWind = v;
  setStr(KEYS.unitWind, v);
  updateSettingsUI();
  renderAllWeather();
}

export function setTheme(v) {
  state.theme = v;
  setStr(KEYS.theme, v);
  applyTheme();
  updateSettingsUI();
  syncThemeNav(); /* one preference, two controls (navbar + Settings) — keep both in sync */
}

export function setClockFormat(v) {
  state.clockFormat = v;
  setStr(KEYS.clockFormat, v);
  updateSettingsUI();
  updateHeroClock();
}

export function setClockSeconds(v) {
  state.clockSeconds = v;
  setStr(KEYS.clockSeconds, v ? "1" : "0");
  updateSettingsUI();
  updateHeroClock();
}

export function applyTheme() {
  const dark =
    state.theme === "dark" ||
    (state.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.dataset.theme = dark ? "dark" : "light";
}

/* reflect current state on every Settings control */
export function updateSettingsUI() {
  $$("#chipTemp button").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.ut === state.unitTemp),
  );
  $$("#chipWind button").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.uw === state.unitWind),
  );
  $$("#langTiles .set-tile").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.lang === state.lang),
  );
  $$("#modeTiles .set-tile").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.mode === state.mode),
  );
  $$("#themeTiles .set-tile").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.theme === state.theme),
  );
  $$("#chipClockFormat button").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.cf === state.clockFormat),
  );
  const secSwitch = $("#clockSecondsSwitch");
  if (secSwitch) secSwitch.setAttribute("aria-checked", !!state.clockSeconds);
  $$(".switch[data-recents]").forEach((b) => b.setAttribute("aria-checked", !!state.saveRecents));
}

/* ── Navbar theme control ──
   Trigger icon reflects the SAVED preference (light/dark/system), not the
   resolved light/dark — "system" keeps its own monitor icon even while the OS
   is dark, so the icon never gets confused with an explicit "dark" choice. */
const THEME_NAV_ICONS = {
  light:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6 19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4 19 5"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
  system:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
};
export function syncThemeNav() {
  const icon = $("#themeBtnIcon");
  if (icon) icon.innerHTML = THEME_NAV_ICONS[state.theme] || THEME_NAV_ICONS.light;
  $$("#themeMenu [role=menuitemradio]").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.theme === state.theme)),
  );
}
export function closeThemeMenu() {
  const menu = $("#themeMenu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("#themeBtn").setAttribute("aria-expanded", "false");
}

/* Native names, not translated — the language menu itself shows "English"/
   "Français" the same way regardless of the active interface language, so
   the trigger's accessible label follows the same convention. */
const LANG_NAMES = { en: "English", fr: "Français" };

export function syncLangBtnLabel() {
  const name = LANG_NAMES[state.lang] || state.lang;
  $("#langBtn").setAttribute("aria-label", t("changeLangCurrent").replace("{lang}", name));
}

export function setLang(lang) {
  state.lang = lang;
  setStr(KEYS.lang, lang);
  document.documentElement.lang = lang;
  $("#langCode").textContent = lang.toUpperCase();
  $$("#langMenu button").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.lang === lang ? "true" : "false"),
  );
  updateSettingsUI();
  applyStaticI18n();
  /* applyStaticI18n() just reset the burger's aria-label to its static
     data-i18n-aria fallback ("openMenu") — reassert the real open/closed
     wording in case the drawer is currently open. Same story for the
     language button: its static data-i18n-aria fallback doesn't name the
     current language, so reassert that too. */
  syncSidebarA11y();
  syncLangBtnLabel();
  /* toggle labels change width with the language — realign the thumb */
  syncSegToggle($("#modeToggleSide"), "mode", state.mode);
  renderExplore();
  renderFavorites();
  renderAllWeather();
  refreshMapLanguage(); /* localize map labels instantly, no recreation */
}
