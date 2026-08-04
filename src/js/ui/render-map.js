/* Map view: one integrated selected-location panel plus a compact popular-cities row. */
import { state } from "../core/state.js";
import { $, $$, esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { fmtHour } from "../core/datetime.js";
import { FETCH_TIMEOUT_MS } from "../core/config.js";
import { emit } from "../core/app-bus.js";
import { LOCATIONS } from "../data/locations.js";
import { weatherIcon } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { fmtTemp, tempUnit, fmtWind, windUnit } from "../core/units.js";
import { locName, locRegion, locCountry, kindLabel, flagsHtml } from "../core/location.js";
import { coordLabel } from "../core/coord-location.js";
import { geoIdentityHtml } from "../core/geo-identity.js";
import { demoWeather } from "../services/weather-api.js";
import { selectLocation } from "../features/location.js";
import { isFav, toggleFavorite } from "../features/favorites.js";
import {
  RECENTS_LIMIT,
  clearRecents,
  restoreRecents,
  recentToLocation,
} from "../features/recent-locations.js";
import { switchView } from "./navigation.js";
import { confirmAction } from "./confirm-dialog.js";
import { showToast } from "./notifications.js";

const POPULAR_IDS = ["paris", "newyork", "tokyo", "sydney", "london"];
let popularCache = null;
let panelHidden = false;

export async function loadPopular() {
  const locs = POPULAR_IDS.map((id) => LOCATIONS.find((l) => l.id === id));
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: locs.map((l) => l.lat).join(","),
      longitude: locs.map((l) => l.lon).join(","),
      current: "temperature_2m,weather_code,is_day",
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const d = await res.json();
    const arr = Array.isArray(d) ? d : [d];
    popularCache = locs.map((loc, i) => ({
      loc,
      temp: arr[i].current.temperature_2m,
      code: arr[i].current.weather_code,
      isDay: arr[i].current.is_day,
    }));
  } catch {
    popularCache = locs.map((loc) => {
      const w = demoWeather(loc);
      return { loc, temp: w.current.temp, code: w.current.code, isDay: w.current.isDay };
    });
  }
  renderMapInfo();
}

function hourlyHtml(wx) {
  return wx.hourly
    .slice(0, 4)
    .map((hour, index) => {
      const time = index === 0 ? t("mapNow") : fmtHour(hour.time);
      const description = wxDesc(hour.code, state.lang);
      return `<div class="map-hour" aria-label="${esc(
        `${time}, ${description}, ${fmtTemp(hour.temp)}${tempUnit()}`,
      )}">
        <span>${esc(time)}</span>
        ${weatherIcon(wmo(hour.code).icon, hour.isDay)}
        <b>${fmtTemp(hour.temp)}${tempUnit()}</b>
      </div>`;
    })
    .join("");
}

function weatherPanelHtml(loc, wx) {
  const c = wx.current;
  const favorite = isFav(loc);
  return `
    <div class="map-panel-head">
      <div class="map-panel-location">
        <span class="map-panel-pin" aria-hidden="true">●</span>
        <div><h2>${esc(locName(loc))}</h2><p>${esc(kindLabel(loc.kind))}</p></div>
      </div>
      <div class="map-panel-actions">
        <button class="map-panel-favorite ${favorite ? "is-active" : ""}" id="mapFavoriteBtn"
          type="button" aria-label="${favorite ? t("removeFavorite") : t("addFavorite")}" aria-pressed="${favorite}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>
        </button>
        <button class="map-panel-close" id="mapPanelClose" type="button" aria-label="${t("hideMapDetails")}">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
    ${geoIdentityHtml(loc)}
    <div class="map-panel-current">
      <div class="map-panel-icon">${weatherIcon(wmo(c.code).icon, c.isDay)}</div>
      <div><strong>${fmtTemp(c.temp)}${tempUnit()}</strong><span>${wxDesc(c.code, state.lang)}</span></div>
    </div>
    <dl class="map-panel-stats">
      <div><dt>${t("feelsLike")}</dt><dd>${fmtTemp(c.feels)}${tempUnit()}</dd></div>
      <div><dt>${t("humidity")}</dt><dd>${Math.round(c.humidity)}%</dd></div>
      <div><dt>${t("wind")}</dt><dd>${fmtWind(c.windSpeed)} ${windUnit()}</dd></div>
      <div><dt>${t("pressure")}</dt><dd>${Math.round(c.pressure)} hPa</dd></div>
    </dl>
    <button class="map-forecast-button" id="mapForecastBtn" type="button">
      <span>${t("viewForecast")}</span><span aria-hidden="true">→</span>
    </button>
    <div class="map-hourly" aria-label="${t("hourlyForecast")}">${hourlyHtml(wx)}</div>`;
}

function popularHtml() {
  return `
    <h2 class="info-title" id="mapPopularTitle">${t("popularTitle")}</h2>
    <div class="map-popular-list">${(popularCache || [])
      .map(
        (item) => `<button class="map-popular-place" data-loc="${esc(item.loc.id)}" type="button"
          aria-label="${esc(`${locName(item.loc)}, ${fmtTemp(item.temp)}${tempUnit()}`)}">
          ${flagsHtml(item.loc, "small")}
          <b>${esc(locName(item.loc))}</b>
          <span>${fmtTemp(item.temp)}${tempUnit()}</span>
          ${weatherIcon(wmo(item.code).icon, item.isDay)}
        </button>`,
      )
      .join("")}</div>`;
}

/* ── Map-click states ─────────────────────────────────────────────────────
   A click on the map has to acknowledge itself before any network call
   returns, so the panel gets a skeleton naming the exact coordinate that was
   clicked. The panel is aria-live="polite", so the loading line and then the
   resolved place are both announced. */
export function isMapPanelOpen() {
  return !panelHidden;
}

export function showMapPanel() {
  const panel = $("#mapWeatherPanel");
  const showButton = $("#mapShowPanel");
  panelHidden = false;
  if (panel) panel.hidden = false;
  if (showButton) showButton.hidden = true;
}

/* Close without the confirmation dialog — used when restoring `panel=0` from
   a shared URL, where the user already made that choice once. */
export function hideMapPanel() {
  const panel = $("#mapWeatherPanel");
  const showButton = $("#mapShowPanel");
  panelHidden = true;
  if (panel) panel.hidden = true;
  if (showButton) showButton.hidden = false;
}

export function renderMapPanelLoading(lat, lon) {
  const panel = $("#mapWeatherPanel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="map-panel-loading">
      <p class="map-panel-loading-title">
        <span class="map-panel-spinner" aria-hidden="true"></span>${esc(t("mapClickLoading"))}
      </p>
      <p class="map-panel-loading-coords">${esc(coordLabel(lat, lon))}</p>
    </div>`;
}

/* ── Recent searches ──────────────────────────────────────────────────────
   Opt-in (off by default), capped at five, and stored with the minimum
   needed to re-select a place — see features/recent-locations.js for the
   privacy rules this renders. */
function recentEntryHtml(entry, index) {
  const loc = recentToLocation(entry);
  const name = locName(loc);
  const where = [locRegion(loc), locCountry(loc)].filter(Boolean).join(", ");
  const label = [name, where].filter(Boolean).join(", ");
  return `<li>
      <button class="map-recent" type="button" data-recent="${index}"
        aria-label="${esc(label)}">
        ${flagsHtml(loc, "small")}
        <span class="map-recent-text">
          <b>${esc(name)}</b>
          <span>${esc(where || kindLabel(loc.kind))}</span>
        </span>
        <span class="map-recent-kind">${esc(kindLabel(loc.kind))}</span>
      </button>
    </li>`;
}

function recentsBodyHtml() {
  if (!state.saveRecents) {
    return `<p class="map-recents-note" data-state="disabled">${esc(t("recentDisabled"))}</p>
      <button class="map-recents-link" id="mapRecentsSettings" type="button">${esc(
        t("recentOpenSettings"),
      )}</button>`;
  }
  if (!state.recents.length) {
    return `<p class="map-recents-note" data-state="empty">${esc(t("recentEmpty"))}</p>`;
  }
  return `<ol class="map-recents-list">${state.recents.map(recentEntryHtml).join("")}</ol>
    <button class="map-recents-clear" id="mapRecentsClear" type="button">${esc(
      t("recentClear"),
    )}</button>`;
}

export function renderRecentLocations() {
  const host = $("#mapRecents");
  if (!host) return;
  host.innerHTML = `
    <div class="map-recents-head">
      <h2 class="info-title" id="mapRecentsTitle">${esc(t("recentTitle"))}</h2>
      <p class="map-recents-sub">${esc(t("recentSub").replace("{count}", RECENTS_LIMIT))}</p>
    </div>
    ${recentsBodyHtml()}`;

  $$("#mapRecents .map-recent").forEach((button) =>
    button.addEventListener("click", () => {
      const entry = state.recents[Number(button.dataset.recent)];
      const loc = recentToLocation(entry);
      if (loc) selectLocation(loc);
    }),
  );

  $("#mapRecentsSettings")?.addEventListener("click", () => switchView("settings"));

  $("#mapRecentsClear")?.addEventListener("click", (event) =>
    clearRecentSearches(event.currentTarget),
  );
}

/* Shared by the map page's Clear button and the Settings privacy tile, so the
   confirmation wording, the success message and the Undo window are the same
   whichever one the user reaches for. */
export async function clearRecentSearches(trigger) {
  const accepted = await confirmAction({
    title: t("recentClearTitle"),
    message: t("recentClearMessage"),
    confirmLabel: t("recentClearAction"),
    cancelLabel: t("cancelAction"),
    trigger,
    danger: true,
  });
  if (!accepted) return false;
  /* the snapshot is what makes Undo safe: nothing is re-derived, the exact
     entries go back if the user changes their mind */
  const removed = clearRecents();
  renderRecentLocations();
  showToast(t("recentCleared"), {
    actionLabel: t("undoAction"),
    onAction: () => {
      restoreRecents(removed);
      renderRecentLocations();
    },
  });
  return true;
}

export function renderMapInfo() {
  const panel = $("#mapWeatherPanel");
  const popular = $("#mapPopular");
  const showButton = $("#mapShowPanel");
  if (!state.loc || !state.wx || !panel || !popular || !showButton) return;

  panel.innerHTML = weatherPanelHtml(state.loc, state.wx);
  popular.innerHTML = popularHtml();
  panel.hidden = panelHidden;
  showButton.hidden = !panelHidden;

  $("#mapFavoriteBtn").addEventListener("click", () => {
    toggleFavorite();
    renderMapInfo();
  });
  $("#mapPanelClose").addEventListener("click", async (event) => {
    const accepted = await confirmAction({
      title: t("hideMapDetailsTitle"),
      message: t("hideMapDetailsMessage"),
      confirmLabel: t("hideAction"),
      cancelLabel: t("cancelAction"),
      trigger: event.currentTarget,
      danger: true,
    });
    if (!accepted) return;
    hideMapPanel();
    showButton.focus();
    emit("map:panel", { open: false });
  });
  showButton.onclick = () => {
    showMapPanel();
    $("#mapPanelClose")?.focus();
    emit("map:panel", { open: true });
  };
  $("#mapForecastBtn").addEventListener("click", () => switchView("forecast"));
  $$("#mapPopular .map-popular-place").forEach((button) =>
    button.addEventListener("click", () => {
      selectLocation(LOCATIONS.find((loc) => loc.id === button.dataset.loc));
    }),
  );
}
