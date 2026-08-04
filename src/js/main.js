/* App bootstrap. ES module scripts run after the DOM is parsed, so unlike
   the previous classic-script version this needs no DOMContentLoaded wrapper. */
import { state } from "./core/state.js";
import { $, $$ } from "./core/dom.js";
import { t, applyStaticI18n } from "./core/i18n.js";
import { getJSON, setJSON, clearAll, KEYS } from "./core/storage.js";
import { injectIconDefs, weatherIcon, MAP_LAYER_ICONS } from "./data/icons.js";
import { flagHtml } from "./data/flags.js";
import { LOCATIONS, DEFAULT_LOCATION_ID } from "./data/locations.js";
import { bindSearchEvents, closeMobileSearch, focusSearch } from "./features/search.js";
import {
  setMode,
  setUnitTemp,
  setUnitWind,
  setTheme,
  setLang,
  applyTheme,
  syncThemeNav,
  syncLangBtnLabel,
  updateSettingsUI,
  closeThemeMenu,
} from "./features/settings.js";
import { locateMe, initGeo } from "./features/geolocation.js";
import {
  resizeMaps,
  bindMapLayerControls,
  bindCountryFilters,
  updateMapLayerFades,
} from "./features/map.js";
import { selectLocation } from "./features/location.js";
import {
  switchView,
  toggleSidebar,
  closeSidebar,
  bindSidebarA11y,
  positionThumb,
  bindSegToggle,
  syncSegToggle,
} from "./ui/navigation.js";
import { renderExplore, renderChart, renderHero } from "./ui/render-home.js";
import { renderFavorites } from "./ui/render-favorites.js";
import { renderForecastPage } from "./ui/render-forecast.js";
import { loadPopular } from "./ui/render-map.js";
import { bindForecastCarousel } from "./ui/render-forecast.js";
import { showToast } from "./ui/notifications.js";
import { confirmAction } from "./ui/confirm-dialog.js";

/* weather icon gradients live in one hidden <svg> injected once, so every
   icon instance can reference them by id instead of duplicating <defs> */
injectIconDefs();

document.body.dataset.mode = state.mode;
document.documentElement.lang = state.lang;

/* ── Search ── */
bindSearchEvents();

/* ── Language menu — one place owns hidden/aria-expanded/focus so click
   selection, outside-click, and Escape can never disagree on the state. */
function closeLanguageMenu({ focusTrigger = false } = {}) {
  const menu = $("#langMenu");
  if (menu.hidden) return;
  menu.hidden = true;
  $("#langBtn").setAttribute("aria-expanded", "false");
  if (focusTrigger) $("#langBtn").focus();
}

/* ── Overlays: click-outside and Escape close whichever is open ── */
document.addEventListener("click", (e) => {
  /* Search triggers sit outside #searchWrap — exclude them so the same click
     that opens/focuses search is not also read as "outside" and closed. */
  if (!e.target.closest("#searchWrap, #mobileSearchBtn, #favAddBtn")) closeMobileSearch();
  if (!e.target.closest(".lang-wrap")) closeLanguageMenu();
  if (!e.target.closest(".theme-wrap")) closeThemeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) {
    e.preventDefault();
    focusSearch();
  } else if (e.key === "Escape") {
    /* close whichever overlay is open; leave the event untouched for the map */
    if ($("#sidebar").classList.contains("is-open")) {
      closeSidebar();
      $("#burgerBtn").focus();
    }
    closeLanguageMenu({ focusTrigger: true });
    if (!$("#themeMenu").hidden) {
      closeThemeMenu();
      $("#themeBtn").focus();
    }
    closeMobileSearch({ focusTrigger: true });
  }
});

$("#langBtn").addEventListener("click", () => {
  const menu = $("#langMenu");
  if (menu.hidden) {
    menu.hidden = false;
    $("#langBtn").setAttribute("aria-expanded", "true");
  } else {
    closeLanguageMenu();
  }
});
$$("#langMenu button").forEach((b) =>
  b.addEventListener("click", () => {
    setLang(b.dataset.lang);
    closeLanguageMenu({ focusTrigger: true });
  }),
);

/* ── Theme menu — same open/close contract as the language menu, plus roving
   ArrowUp/ArrowDown since these are role="menuitemradio" items (tabindex=-1,
   only reachable via arrow keys once the menu is open, per the ARIA menu
   pattern) ── */
$("#themeBtn").addEventListener("click", () => {
  const menu = $("#themeMenu");
  const opening = menu.hidden;
  menu.hidden = !menu.hidden;
  $("#themeBtn").setAttribute("aria-expanded", String(opening));
  if (opening) {
    (
      menu.querySelector('[aria-checked="true"]') || menu.querySelector("[role=menuitemradio]")
    ).focus();
  }
});
$$("#themeMenu [role=menuitemradio]").forEach((b) =>
  b.addEventListener("click", () => {
    setTheme(b.dataset.theme);
    closeThemeMenu();
    $("#themeBtn").focus();
  }),
);
$("#themeMenu").addEventListener("keydown", (e) => {
  const items = $$("#themeMenu [role=menuitemradio]");
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    items[(i + 1) % items.length].focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    items[(i - 1 + items.length) % items.length].focus();
  }
});

/* ── Toggles ── */
bindSegToggle($("#modeToggle"), "mode", setMode);
bindSegToggle($("#modeToggleSide"), "mode", setMode);

/* ── Settings page controls ── */
$$("#chipTemp button").forEach((b) => b.addEventListener("click", () => setUnitTemp(b.dataset.ut)));
$$("#chipWind button").forEach((b) => b.addEventListener("click", () => setUnitWind(b.dataset.uw)));
$$("#langTiles .set-tile").forEach((b) =>
  b.addEventListener("click", () => setLang(b.dataset.lang)),
);
$$("#modeTiles .set-tile").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.mode)),
);
$$("#themeTiles .set-tile").forEach((b) =>
  b.addEventListener("click", () => setTheme(b.dataset.theme)),
);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "system") applyTheme();
});
$$(".switch[data-notif]").forEach((b) =>
  b.addEventListener("click", () => {
    state.notifs[b.dataset.notif] = !state.notifs[b.dataset.notif];
    setJSON(KEYS.notifs, state.notifs);
    updateSettingsUI();
    showToast(t("prefSaved"));
  }),
);
$$(".priv-tile").forEach((b) =>
  b.addEventListener("click", () => handlePrivacyAction(b.dataset.priv, b)),
);

/* ── Sidebar + views ── */
$$(".side-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
$$(".footer-col button[data-view]").forEach((b) =>
  b.addEventListener("click", () => switchView(b.dataset.view)),
);
$("#logoLink").addEventListener("click", (e) => {
  e.preventDefault();
  switchView("home");
});
$("#burgerBtn").addEventListener("click", toggleSidebar);
$("#sidebarScrim").addEventListener("click", () => closeSidebar());
bindSidebarA11y();

/* ── Explore nav ── */
$("#exploreLeft").addEventListener("click", () =>
  $("#exploreCarousel").scrollBy({ left: -480, behavior: "smooth" }),
);
$("#exploreRight").addEventListener("click", () =>
  $("#exploreCarousel").scrollBy({ left: 480, behavior: "smooth" }),
);

/* ── Favorites page: grid/list toggle (the "add" button is wired in features/search.js) ── */
$$("[data-favview]").forEach((btn) =>
  btn.addEventListener("click", () => {
    state.favView = btn.dataset.favview;
    $$("[data-favview]").forEach((b) =>
      b.setAttribute("aria-checked", b === btn ? "true" : "false"),
    );
    renderFavorites();
  }),
);

/* ── Forecast page: carousel + hourly strip arrows ── */
$("#fcPrev").addEventListener("click", () =>
  $("#forecastRow2").scrollBy({ left: -400, behavior: "smooth" }),
);
$("#fcNext").addEventListener("click", () =>
  $("#forecastRow2").scrollBy({ left: 400, behavior: "smooth" }),
);
$("#hsPrev").addEventListener("click", () =>
  $("#hourlyStrip").scrollBy({ left: -320, behavior: "smooth" }),
);
$("#hsNext").addEventListener("click", () =>
  $("#hourlyStrip").scrollBy({ left: 320, behavior: "smooth" }),
);
bindForecastCarousel();

/* ── Map page: quick-jump chips (MapLibre uses [lng, lat]) ── */
bindCountryFilters();
bindMapLayerControls();

/* ── Resize: realign toggle thumbs, resize maps, redraw charts ── */
let resizeTimer = null;
window.addEventListener(
  "resize",
  () => {
    $$(".seg-toggle").forEach(positionThumb);
    /* crossing the 820px breakpoint changes whether the layer row can even
       scroll — the switcher's own scroll listener never fires on its own */
    updateMapLayerFades();
    /* charts are drawn at their container's size — redraw after resizing */
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      /* the map must re-measure its container after responsive layout changes */
      resizeMaps();
      if (!state.wx) return;
      renderChart();
      renderForecastPage();
    }, 200);
  },
  { passive: true },
);

/* ── Initial state ── */
$$("[data-flag]").forEach((el) => {
  el.innerHTML = flagHtml(el.dataset.flag, "", state.lang);
});
$$("[data-wicon]").forEach((el) => {
  el.innerHTML = weatherIcon(el.dataset.wicon, 1);
});
$$("[data-layer-icon]").forEach((el) => {
  el.innerHTML = MAP_LAYER_ICONS[el.dataset.layerIcon] || "";
});
applyTheme();
syncThemeNav();
applyStaticI18n();
syncSegToggle($("#modeToggle"), "mode", state.mode);
syncSegToggle($("#modeToggleSide"), "mode", state.mode);
updateSettingsUI();
$("#langCode").textContent = state.lang.toUpperCase();
$$("#langMenu button").forEach((b) =>
  b.setAttribute("aria-checked", b.dataset.lang === state.lang ? "true" : "false"),
);
syncLangBtnLabel(); /* applyStaticI18n() above set the static fallback; name the actual language */
renderExplore();
renderFavorites();

/* Re-resolve stored locations against the current dataset (old saves may lack new fields) */
const freshen = (loc) => loc && (LOCATIONS.find((l) => l.id === loc.id) || loc);
state.favorites = state.favorites.map(freshen);
const startLoc = freshen(getJSON(KEYS.lastLocation, null));
selectLocation(startLoc || LOCATIONS.find((l) => l.id === DEFAULT_LOCATION_ID));
$("#geoRetryBtn").addEventListener("click", () => locateMe());
initGeo();
loadPopular();

/* Refresh "updated x min ago" line periodically */
setInterval(() => {
  if (state.wx && state.view === "home") renderHero();
}, 60000);

async function handlePrivacyAction(action, trigger) {
  if (action === "location") showToast(t("locMsg"));
  else if (action === "privacy") switchView("about");
  else if (action === "cache") {
    const accepted = await confirmAction({
      title: t("priv3T"),
      message: t("resetConfirm"),
      confirmLabel: t("resetAction"),
      cancelLabel: t("cancelAction"),
      trigger,
      danger: true,
    });
    if (!accepted) return;
    clearAll();
    showToast(t("cacheCleared"));
    setTimeout(() => location.reload(), 900);
  } else if (action === "export") {
    const data = {
      exportedAt: new Date().toISOString(),
      settings: {
        lang: state.lang,
        mode: state.mode,
        unitTemp: state.unitTemp,
        unitWind: state.unitWind,
        theme: state.theme,
        notifs: state.notifs,
      },
      favorites: state.favorites,
      lastLocation: state.loc,
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    a.download = "weathersphere-data.json";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(t("dataExported"));
  }
}
