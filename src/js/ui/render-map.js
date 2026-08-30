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
import { fmtTemp, tempUnit, fmtWind, windUnit, fmtDistance, distanceUnit } from "../core/units.js";
import { locName, locRegion, locCountry, locKindLabel, flagsHtml } from "../core/location.js";
import { coordLabel } from "../core/coord-location.js";
import { geoIdentityHtml } from "../core/geo-identity.js";
import { demoWeather } from "../services/weather-api.js";
import { hydrateLocPhoto, locPhotoHtml } from "../services/photo-api.js";
import { loadNearbyPlaces, isNearbyEligible } from "../services/nearby-api.js";
import { selectLocation } from "../features/location.js";
import { isFav, toggleFavorite } from "../features/favorites.js";
import {
  RECENTS_LIMIT,
  clearRecents,
  restoreRecents,
  recentToLocation,
} from "../features/recent-locations.js";
import { bindMapSheet, DEFAULT_SHEET_STATE } from "../features/map-sheet.js";
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

/* ── Subtitle ──────────────────────────────────────────────────────────────
   One concise line, never both: a curated landmark is more useful and less
   generic than repeating the kind label geoIdentityHtml's chips already
   imply, so it takes priority when present. Deliberately short — this is a
   subtitle, not the tourist-blurb the task explicitly ruled out. */
function panelSubtitle(loc) {
  const landmark = loc.landmark;
  if (landmark && (landmark.en || landmark.fr)) {
    const name = landmark[state.lang] || landmark.en || landmark.fr;
    return t("nearLandmark").replace("{landmark}", name);
  }
  return locKindLabel(loc);
}

/* ── Nearby places ─────────────────────────────────────────────────────────
   Rendered in two passes: weatherPanelHtml() draws the section synchronously
   (from whatever is already cached for this exact location, or a "loading"
   placeholder), and loadAndRenderNearbyPlaces() fills #mapPanelNearbyBody in
   once the async lookup resolves — the same pattern already used for the AQI
   fill-in in features/location.js, so a slow lookup never blocks the rest of
   the panel or the map. */
let nearbyResult = { locId: null, status: "loading", places: [] };
let nearbyToken = 0;

function nearbyPlaceHtml(place) {
  const { loc, distanceKm, weather } = place;
  const distance = `${fmtDistance(distanceKm)} ${distanceUnit()}`;
  if (!weather) {
    return `<button class="map-nearby-place" type="button" data-nearby="${esc(loc.id)}"
        aria-label="${esc(`${locName(loc)}, ${distance}`)}">
        <span class="map-nearby-text"><b>${esc(locName(loc))}</b><span>${esc(distance)}</span></span>
      </button>`;
  }
  const label = [
    locName(loc),
    distance,
    `${fmtTemp(weather.temp)}${tempUnit()}`,
    `${Math.round(weather.rainProb)}% ${t("rainChance")}`,
    `${fmtWind(weather.windSpeed)} ${windUnit()}`,
  ].join(", ");
  return `<button class="map-nearby-place" type="button" data-nearby="${esc(loc.id)}"
      aria-label="${esc(label)}">
      ${weatherIcon(wmo(weather.code).icon, weather.isDay)}
      <span class="map-nearby-text"><b>${esc(locName(loc))}</b><span>${esc(distance)}</span></span>
      <span class="map-nearby-stats">
        <b>${fmtTemp(weather.temp)}${tempUnit()}</b>
        <span>${Math.round(weather.rainProb)}% · ${fmtWind(weather.windSpeed)} ${windUnit()}</span>
      </span>
    </button>`;
}

function nearbyBodyHtml(status, places) {
  if (status === "loading") {
    return `<p class="map-nearby-note" data-state="loading">
      <span class="map-panel-spinner" aria-hidden="true"></span>${esc(t("nearbyLoading"))}</p>`;
  }
  if (status === "empty") {
    return `<p class="map-nearby-note" data-state="empty">${esc(t("nearbyEmpty"))}</p>`;
  }
  if (status === "error") {
    return `<p class="map-nearby-note" data-state="error">${esc(t("nearbyError"))}</p>`;
  }
  return `<div class="map-nearby-list">${places.map(nearbyPlaceHtml).join("")}</div>`;
}

function nearbySectionHtml(loc) {
  if (!isNearbyEligible(loc)) return "";
  const cached = nearbyResult.locId === loc.id ? nearbyResult : { status: "loading", places: [] };
  return `<div class="map-panel-nearby">
      <h3 class="map-panel-nearby-title">${esc(t("nearbyTitle"))}</h3>
      <div id="mapPanelNearbyBody">${nearbyBodyHtml(cached.status, cached.places)}</div>
    </div>`;
}

function bindNearbyClicks() {
  $$("#mapPanelNearbyBody .map-nearby-place").forEach((button) => {
    button.addEventListener("click", () => {
      const place = nearbyResult.places.find((p) => p.loc.id === button.dataset.nearby);
      if (place) selectLocation(place.loc);
    });
  });
}

async function loadAndRenderNearbyPlaces(loc) {
  if (!isNearbyEligible(loc)) return;
  if (nearbyResult.locId !== loc.id) nearbyToken++;
  const token = nearbyToken;
  const result = await loadNearbyPlaces(loc);
  if (token !== nearbyToken) return; /* a newer location superseded this lookup */
  nearbyResult = { locId: loc.id, status: result.status, places: result.places };
  const body = $("#mapPanelNearbyBody");
  if (!body) return; /* panel re-rendered/hidden while this was in flight */
  body.innerHTML = nearbyBodyHtml(result.status, result.places);
  bindNearbyClicks();
}

/* ── Mobile bottom sheet ──────────────────────────────────────────────────
   Desktop is untouched (see the ≤820px gate in styles/views/map.css). State
   lives here, not in core/state.js, because it is transient viewport/UI
   state, not app data — the same reasoning as `panelHidden` above. */
let sheetState = DEFAULT_SHEET_STATE;
let sheetController = null;

/* A brand-new selection resets to the default "half" peek; re-renders of the
   SAME location (favourite toggle, unit/language change) must not yank the
   sheet out from under a user who just dragged it — see features/location.js. */
export function resetMapSheet() {
  sheetState = DEFAULT_SHEET_STATE;
}

/* Escape support (task requirement): collapses the sheet rather than fully
   hiding the panel, which stays the close button's job. Harmless to call
   outside mobile widths — the CSS driving `data-sheet-state` is scoped to the
   same ≤820px breakpoint, so this is a no-op visually on desktop. */
export function collapseMapSheet() {
  if (!sheetController || sheetController.getState() === "collapsed") return false;
  sheetController.setState("collapsed");
  $("#mapPanelHandle")?.focus();
  return true;
}

function sheetHandleHtml() {
  return `<button class="map-sheet-handle" id="mapPanelHandle" type="button"
      aria-label="${esc(t("sheetHandleLabel"))}">
      <span class="map-sheet-grip" aria-hidden="true"></span>
    </button>`;
}

function panelPeekHtml(loc, wx) {
  return `<div class="map-panel-peek">
      <span>${esc(locName(loc))}</span>
      <b>${fmtTemp(wx.current.temp)}${tempUnit()}</b>
    </div>`;
}

function weatherPanelHtml(loc, wx) {
  const c = wx.current;
  const favorite = isFav(loc);
  return `
    ${sheetHandleHtml()}
    ${panelPeekHtml(loc, wx)}
    <div class="map-panel-body">
      <div class="map-panel-head">
        <div class="map-panel-location">
          <span class="map-panel-pin" aria-hidden="true">●</span>
          <div><h2>${loc.kind === "country" ? `${flagsHtml(loc, "small")} ` : ""}${esc(locName(loc))}</h2><p>${esc(panelSubtitle(loc))}</p></div>
        </div>
        <div class="map-panel-actions">
          <button class="map-panel-favorite ${favorite ? "is-active" : ""}" id="mapFavoriteBtn"
            type="button" aria-label="${favorite ? t("removeFavorite") : t("addFavorite")}" aria-pressed="${favorite}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>
          </button>
          <button class="map-panel-share" id="mapPanelShare" type="button" aria-label="${t("mapShare")}">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
            </svg>
          </button>
          <button class="map-panel-close" id="mapPanelClose" type="button" aria-label="${t("hideMapDetails")}">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      ${geoIdentityHtml(loc)}
      ${locPhotoHtml(loc, "map-panel-photo")}
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
      <div class="map-hourly" aria-label="${t("hourlyForecast")}">${hourlyHtml(wx)}</div>
      ${nearbySectionHtml(loc)}
    </div>`;
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
          <span>${esc(where || locKindLabel(loc))}</span>
        </span>
        <span class="map-recent-kind">${esc(locKindLabel(loc))}</span>
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

  sheetController?.destroy();
  sheetController = bindMapSheet(panel, $("#mapPanelHandle"), {
    initialState: sheetState,
    onChange: (next) => {
      sheetState = next;
    },
  });

  /* The panel is min(350px, …) wide and the photo 132px tall, so the default
     720px `sizes` had the browser pick Pexels' 1880w candidate for a
     thumbnail — several times the pixels this box can show. Matches the
     panel's own width rule in styles/views/map.css (full-bleed once the
     panel becomes the mobile bottom sheet at ≤820px). */
  hydrateLocPhoto($(".map-panel-photo", panel), state.loc, {
    creditClass: "map-panel-credit",
    sizes: "(max-width: 820px) 100vw, 350px",
  });

  $("#mapFavoriteBtn").addEventListener("click", () => {
    toggleFavorite();
    renderMapInfo();
  });
  $("#mapPanelShare")?.addEventListener("click", () => emit("map:share-requested"));
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

  bindNearbyClicks();
  void loadAndRenderNearbyPlaces(state.loc);
}
