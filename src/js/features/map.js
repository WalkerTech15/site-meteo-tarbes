/* Interactive map (MapTiler SDK + Hybrid v4 style and optional weather layers).
   Borders, state/province lines, city/town/road labels all come from the
   vector style itself (countries at low zoom, regions/cities at medium,
   towns/roads at high) — no GeoJSON overlays needed.
   MapLibre is an npm dependency, dynamically imported the first time a map
   actually needs to render, so its ~200KB JS chunk never blocks the initial
   page load. */
import "@maptiler/sdk/dist/maptiler-sdk.css";
import { state } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { MAPTILER_KEY, MAP_STYLE } from "../core/config.js";
import { weatherIcon } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { fmtTemp, tempUnit } from "../core/units.js";
import { flagsHtml, locRegion, locCountry, locName, kindLabel } from "../core/location.js";
import { COUNTRY_JUMPS } from "../data/country-jumps.js";
import { computeFadeVisibility } from "../core/carousel-fade.js";
import { normalizeBbox } from "../core/geo-bounds.js";
import { selectionFeature, isAdministrativeArea } from "../core/selection-area.js";
import { emit } from "../core/app-bus.js";
import { switchView } from "../ui/navigation.js";
import { showToast } from "../ui/notifications.js";
import {
  WEATHER_LAYER_IDS,
  removeWeatherLayer,
  applyWeatherLayer,
  setWeatherLayerTime,
  firstSymbolLayerId,
} from "./weather-layers.js";
import { normalizeOffset, availableOffsets } from "./map-timeline.js";
import { renderWeatherOverlayUI } from "../ui/render-map-weather.js";

let maplibreglPromise = null;
function loadMapLibre() {
  if (!maplibreglPromise)
    maplibreglPromise = import("@maptiler/sdk").then((sdk) => {
      sdk.config.apiKey = MAPTILER_KEY;
      return sdk;
    });
  return maplibreglPromise;
}

/* zoom per location type; huge countries get a wider view */
function zoomFor(loc) {
  if (typeof loc._zoom === "number") return loc._zoom; /* MapTiler result: type-based */
  if (loc.kind === "country") return ["usa", "canada", "australia"].includes(loc.id) ? 4 : 5;
  if (loc.kind === "state" || loc.kind === "province" || loc.kind === "region") return 6;
  if (loc.kind === "village") return 13;
  if (loc.kind === "address" || loc.kind === "poi") return 16;
  return 11; // city / town
}

function popupHtml(loc) {
  const line2 =
    loc.kind === "country"
      ? esc(locRegion(loc))
      : `${kindLabel(loc.kind)} · ${esc(locRegion(loc))}${locRegion(loc) ? ", " : ""}${esc(locCountry(loc))}`;
  const c = state.wx && state.wx.current;
  return `<div class="map-popup">
    <div class="mp-name">${flagsHtml(loc, "small")} <b>${esc(locName(loc))}</b></div>
    <div class="mp-sub">${line2}${loc.landmark ? ` · ${esc(loc.landmark[state.lang] || loc.landmark.en)}` : ""}</div>
    ${
      c
        ? `<div class="mp-wx">${weatherIcon(wmo(c.code).icon, c.isDay)}
      <div><b>${fmtTemp(c.temp)}${tempUnit()}</b><span>${wxDesc(c.code, state.lang)}</span></div>
    </div>`
        : ""
    }
    <button class="mp-link" type="button">${t("viewWeather")} →</button>
  </div>`;
}

/* MapLibre ships its own English UI strings ("Map", "Zoom in", "Toggle
   attribution"…). They are the accessible names of real controls, so they have
   to follow the interface language like everything else. The `locale` option
   covers map creation; applyMapControlLabels() covers a later language switch,
   which MapLibre has no API for. */
function mapLocale() {
  return {
    "Map.Title": t("mapTitle"),
    "Marker.Title": t("mapMarker"),
    "Popup.Close": t("mapClosePopup"),
    "NavigationControl.ZoomIn": t("mapZoomIn"),
    "NavigationControl.ZoomOut": t("mapZoomOut"),
    "AttributionControl.ToggleAttribution": t("mapToggleAttribution"),
  };
}

/* selector → translation key, for the controls that carry a visible-less name */
const CONTROL_LABELS = [
  [".maplibregl-ctrl-zoom-in", "mapZoomIn"],
  [".maplibregl-ctrl-zoom-out", "mapZoomOut"],
  [".maplibregl-ctrl-attrib-button", "mapToggleAttribution"],
  [".maplibregl-popup-close-button", "mapClosePopup"],
  [".maplibregl-marker", "mapMarker"],
  [".map-reset-btn", "mapResetView"],
];

/* Custom MapLibre IControl: re-flattens the camera to north-up (bearing 0)
   and pitch 0, without touching center, zoom, the selected location or the
   active weather layer. The map can no longer be tilted/rotated by the user
   at all (see the disabled dragRotate/touchPitch/rotation handlers in
   createMapInstance below), so this is mostly a safety net — for camera
   state a shared/bookmarked URL might carry, and as an explicit, discoverable
   "make it flat again" affordance. Built as a real <button> inside MapLibre's
   own `.maplibregl-ctrl-group` so it inherits the library's control styling
   (size, shadow, hover, focus ring) for free — see styles/views/map.css for
   the small bit of icon-specific styling it still needs. */
class ResetViewControl {
  onAdd(map) {
    this._map = map;
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-reset-btn";
    button.setAttribute("aria-label", t("mapResetView"));
    button.title = t("mapResetView");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>';
    button.addEventListener("click", () => {
      map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
    });
    container.appendChild(button);
    this._container = container;
    return container;
  }
  onRemove() {
    this._container?.parentNode?.removeChild(this._container);
    this._map = undefined;
  }
}

function applyMapControlLabels(map) {
  let root;
  try {
    const canvas = map.getCanvas();
    if (canvas) canvas.setAttribute("aria-label", t("mapTitle"));
    root = map.getContainer();
  } catch {
    return; /* map already removed (style/key failure) */
  }
  if (!root) return;
  for (const [selector, key] of CONTROL_LABELS) {
    root.querySelectorAll(selector).forEach((el) => {
      el.setAttribute("aria-label", t(key));
      /* MapLibre sets title on some of them; keep the tooltip in sync too */
      if (el.hasAttribute("title")) el.setAttribute("title", t(key));
    });
  }
}

const MAP_CONFIG = {
  /* the map page's full-size map is the one you can click to pick a place;
     the home preview stays a read-only summary of the current selection */
  worldMap: { view: "map", autoPopup: false, selectable: true },
  homeMap: { view: "home", autoPopup: false, selectable: false },
};
const MAPS = {}; // containerId → { map, marker, popup, lastKey }

function mapError(id) {
  const el = $("#" + id);
  if (el && !el.querySelector(".map-offline")) {
    el.classList.remove("is-loading");
    el.innerHTML = `<p class="map-offline">${t("mapError")}</p>`;
  }
}

/* Point every label layer at the active language's name field, falling back to
   the local name where no translation exists. MapTiler vector labels use
   name:<lang> fields; rewriting text-field is the SDK-free way to localize.
   No map recreation — just a layout-property update per symbol layer. */
function applyMapLanguage(map) {
  if (!map || !map.isStyleLoaded()) return;
  const field = ["coalesce", ["get", "name:" + state.lang], ["get", "name"]];
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const tf = layer.layout && layer.layout["text-field"];
    if (tf === undefined) continue; /* icon-only layer, no label */
    try {
      map.setLayoutProperty(layer.id, "text-field", field);
    } catch {
      /* layer doesn't support this property — ignore */
    }
  }
}

/* Satellite labels need administrative borders, but Hybrid v4's doubled
   white/dark strokes can compete with the selected place. Quiet only the
   known boundary source layers; roads and all other line work stay intact. */
function softenBaseBoundaries(map) {
  if (!map?.isStyleLoaded()) return;
  for (const layer of map.getStyle().layers || []) {
    const sourceLayer = layer["source-layer"];
    if (layer.type !== "line" || !["country_border", "sub_border"].includes(sourceLayer)) continue;
    const dark = /dark/i.test(layer.id);
    const opacity = dark ? 0.14 : sourceLayer === "country_border" ? 0.42 : 0.28;
    try {
      map.setPaintProperty(layer.id, "line-opacity", opacity);
    } catch {
      /* A future provider style may lock or remove this paint property. */
    }
  }
}

const SELECTION_SOURCE = "weather-selection-area";
const SELECTION_FILL = "weather-selection-fill";
const SELECTION_LINE = "weather-selection-line";

/* Add a Google-Maps-style blue tint/outline only for real polygon geometry.
   Point-only geocoder results use the persistent marker focus ring instead;
   their rectangular bbox is deliberately never drawn as a fake boundary. */
function applySelectionArea(inst) {
  const map = inst.map;
  if (!map.isStyleLoaded()) return;
  const data = selectionFeature(inst.selectionLoc);
  const source = map.getSource(SELECTION_SOURCE);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(SELECTION_SOURCE, { type: "geojson", data });
  const firstLabel = firstSymbolLayerId(map);
  map.addLayer(
    {
      id: SELECTION_FILL,
      type: "fill",
      source: SELECTION_SOURCE,
      paint: { "fill-color": "#2563eb", "fill-opacity": 0.1 },
    },
    firstLabel,
  );
  map.addLayer(
    {
      id: SELECTION_LINE,
      type: "line",
      source: SELECTION_SOURCE,
      paint: {
        "line-color": "#2563eb",
        "line-opacity": 0.95,
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2, 10, 3],
      },
    },
    firstLabel,
  );
}

function updateSelectionArea(inst, loc) {
  inst.selectionLoc = loc;
  if (inst.map.isStyleLoaded()) applySelectionArea(inst);
  else inst.map.once("idle", () => applySelectionArea(inst));
}

/* Keep the selected boundary above a freshly-added weather overlay, but still
   below the basemap's labels — the weather layer is inserted before the first
   symbol layer too (see firstSymbolLayerId), so this puts the boundary in the
   slot between them: visible through the overlay, never covering place names. */
function raiseSelectionArea(inst) {
  const map = inst?.map;
  if (!map?.getLayer(SELECTION_FILL)) return;
  try {
    const firstLabel = firstSymbolLayerId(map);
    map.moveLayer(SELECTION_FILL, firstLabel);
    map.moveLayer(SELECTION_LINE, firstLabel);
  } catch {
    /* style/layer changed while an optional weather layer was loading */
  }
}

export function refreshMapLanguage() {
  Object.values(MAPS).forEach((inst) => {
    if (inst.map.isStyleLoaded()) applyMapLanguage(inst.map);
    else inst.map.once("idle", () => applyMapLanguage(inst.map));
    applyMapControlLabels(inst.map);
  });
  renderWeatherOverlay(); /* legend labels and the timeline clock are translated */
}

/* ── Click-to-select ──────────────────────────────────────────────────────
   A genuine map click is a press and release on the map surface itself.
   MapLibre already withholds its `click` event when the pointer travelled
   further than its clickTolerance between mousedown and mouseup, so a pan or
   a pinch never arrives here at all. What it does NOT filter is a click that
   landed on something drawn ON the map: the selection marker (whose own
   handler toggles the popup), an open popup, or a map control. Those are
   interactions with that element, not a request to select a new place. */
const NON_MAP_TARGETS =
  ".maplibregl-marker, .maplibregl-popup, .maplibregl-ctrl, .maplibregl-control-container";

export function isSelectableMapClick(event) {
  const target = event?.originalEvent?.target;
  if (!target || typeof target.closest !== "function") return true;
  return !target.closest(NON_MAP_TARGETS);
}

/* The async half (reverse geocoding, weather, panel) lives in
   features/map-click.js and registers itself here, so this module never
   imports the selection pipeline back and the module graph stays acyclic. */
let mapClickHandler = null;
export function setMapClickHandler(handler) {
  mapClickHandler = handler;
}

function bindMapSelection(inst) {
  inst.map.on("click", (event) => {
    if (!mapClickHandler || !isSelectableMapClick(event)) return;
    const { lng, lat } = event.lngLat;
    /* Immediate feedback: the pin moves on this frame, before any network
       call. Remembering the clicked key lets updateMap() tell a click-driven
       selection from a search-driven one — a click should not yank the camera
       away from the point the user just aimed at (unless what they hit turns
       out to be a whole administrative area worth framing). */
    inst.marker.setLngLat([lng, lat]);
    inst.pendingClickKey = `${lat},${lng}`;
    /* drop the previous place's administrative outline right away rather than
       leaving it around a point the user did not select */
    updateSelectionArea(inst, null);
    mapClickHandler({ lat, lon: lng });
  });
}

/* Camera changes are incidental state: reported so the URL can be updated
   with a debounced replaceState, never a history entry (see map-url.js). */
function bindCameraReporting(inst, id) {
  inst.map.on("moveend", () => {
    const center = inst.map.getCenter();
    emit("map:moved", { id, lat: center.lat, lon: center.lng, zoom: inst.map.getZoom() });
  });
}

/* Current camera of the map page's map, for URL serialization. */
export function getMapCamera() {
  const inst = MAPS.worldMap;
  if (!inst) return null;
  try {
    const center = inst.map.getCenter();
    return { lat: center.lat, lon: center.lng, zoom: inst.map.getZoom() };
  } catch {
    return null; /* map removed mid-call */
  }
}

/* Creation is asynchronous (the SDK chunk is imported on demand), and several
   callers can ask for the same map in the same tick — switchView() and the
   weather fan-out both call renderMap(). Without this, each would get past the
   `!MAPS[id]` check and build a second MapLibre instance on the same
   container: duplicate canvases, duplicate listeners, and a camera applied to
   whichever one lost. One in-flight promise per container fixes that. */
const CREATING = {};

async function createMapInstance(id, el, cfg) {
  const loc = state.loc;
  const maplibregl = await loadMapLibre();
  /* container may have been swapped for an offline message while we awaited */
  if (!$("#" + id)) return;
  const map = new maplibregl.Map({
    container: id,
    style: MAP_STYLE,
    center: [loc.lon, loc.lat],
    /* slightly zoomed out so the first flyTo is a real flight — a no-op
         flight would skip the popup offset and the moveend event */
    zoom: zoomFor(loc) - 0.4,
    /* Permanently flat and north-up: a 3D tilted globe (space background,
       curved horizon) makes the weather overlays and boundaries hard to
       read, and there's no interaction left that can re-tilt it — see the
       disabled handlers just below. */
    pitch: 0,
    bearing: 0,
    dragRotate: false /* right-click/Ctrl-drag to rotate+pitch — fully off */,
    pitchWithRotate: false,
    touchPitch: false /* two-finger vertical drag to pitch — fully off */,
    renderWorldCopies: false,
    minZoom: 1 /* mercator already clamps latitude at ±85° — no pole panning */,
    navigationControl: false,
    attributionControl: { compact: true },
    locale: mapLocale(),
  });
  /* Both of these are "disable ONLY the rotate/pitch part" calls — pan
     (arrow keys / one-finger drag) and zoom (+/- / pinch) stay fully
     interactive. There's no equivalent constructor option for that split. */
  map.keyboard.disableRotation();
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new ResetViewControl(), "top-left");
  map.on("load", () => {
    el.classList.remove("is-loading");
    applyMapLanguage(map);
    applyMapControlLabels(map);
    softenBaseBoundaries(map);
  });
  map.once("error", () => {
    if (!map.isStyleLoaded()) {
      try {
        map.remove();
      } catch {
        /* already gone */
      }
      delete MAPS[id];
      mapError(id);
    }
  });

  const pin = document.createElement("div");
  pin.className = "map-pin-icon";
  pin.innerHTML =
    '<span class="map-focus-ring"></span><span class="map-ping"></span><span class="map-dot"></span>';
  /* anchor "bottom" = popup always above the marker; the flyTo offset below
       shifts the marker under the center so the popup always fits the map */
  const popup = new maplibregl.Popup({ offset: 16, maxWidth: "260px", anchor: "bottom" });
  /* the popup's "view weather" button has no inline handler (unlike a plain
       onclick="..." string, which would need switchView on window) — attach a
       fresh listener each time the popup's content actually opens instead. */
  popup.on("open", () => {
    const popupEl = popup.getElement && popup.getElement();
    const btn = popupEl && popupEl.querySelector(".mp-link");
    if (btn) btn.addEventListener("click", () => switchView("home"), { once: true });
    applyMapControlLabels(map);
  });
  const marker = new maplibregl.Marker({ element: pin })
    .setLngLat([loc.lon, loc.lat])
    .setPopup(popup)
    .addTo(map);
  MAPS[id] = {
    map,
    marker,
    popup,
    lastKey: null,
    userMarker: null,
    weatherLayer: null,
    weatherLayerType: null,
  };
  /* bound once, at creation — never on a later updateMap() pass, so the map
     can never accumulate duplicate listeners */
  if (cfg.selectable) bindMapSelection(MAPS[id]);
  bindCameraReporting(MAPS[id], id);
}

async function updateMap(id) {
  const loc = state.loc,
    cfg = MAP_CONFIG[id];
  const el = $("#" + id);
  /* only touch a map while its container is visible; the view becomes
     display:block one frame after switchView, so retry on the next frame */
  if (!el || !el.offsetWidth) {
    if (state.view === cfg.view) requestAnimationFrame(() => updateMap(id));
    return;
  }
  if (!MAPS[id]) {
    if (!MAPTILER_KEY) {
      mapError(id);
      return;
    }
    el.classList.add("is-loading");
    if (!CREATING[id]) {
      CREATING[id] = createMapInstance(id, el, cfg).finally(() => {
        delete CREATING[id];
      });
    }
    try {
      await CREATING[id];
    } catch {
      mapError(id);
      return;
    }
    if (!MAPS[id]) return; /* container disappeared mid-creation */
  }
  const inst = MAPS[id];
  inst.map.resize();
  /* re-apply the "you are here" overlay on a map that was created after a fix */
  if (userPos) setUserLocationOn(inst, userPos.lat, userPos.lon, userPos.acc);
  /* setHTML rebuilds the popup's close button from the locale MapLibre captured
     at construction, so its label has to be re-applied after every refresh */
  inst.popup.setHTML(popupHtml(loc));
  applyMapControlLabels(inst.map);
  inst.marker.setLngLat([loc.lon, loc.lat]);
  updateSelectionArea(inst, loc);
  const key = `${loc.lat},${loc.lon}`;
  if (inst.lastKey !== key) {
    /* new location: replay the finite ping once, fly there, open the popup */
    inst.lastKey = key;
    /* replace the ping node so its finite CSS animation restarts once */
    const pinEl = inst.marker.getElement();
    const oldPing = pinEl.querySelector(".map-ping");
    if (oldPing) {
      const ping = document.createElement("span");
      ping.className = "map-ping";
      oldPing.replaceWith(ping);
    }
    /* bbox present (country/region/city extents) → frame the WHOLE area; else
       type-based zoom. normalizeBbox repairs an antimeridian-crossing box and
       rejects a degenerate near-360°-wide one, which would otherwise zoom out
       to the entire planet instead of showing the place. The box is only ever
       used for the camera — the visible boundary comes from real polygon
       geometry or from nothing at all (see applySelectionArea). */
    let cam = null;
    const bounds = normalizeBbox(loc.bbox);
    if (bounds) {
      try {
        cam = inst.map.cameraForBounds(bounds, { padding: 48, maxZoom: 14 });
      } catch {
        cam = null;
      }
    }
    /* A click on the map is already aimed at a point: moving the camera under
       the user's cursor would be disorienting. The one exception is a click
       that turned out to land on a whole country/state/province/region — then
       framing its full extent is the point of the selection. */
    const fromClick = inst.pendingClickKey === key;
    inst.pendingClickKey = null;
    const keepCamera = fromClick && !(cam && isAdministrativeArea(loc));

    if (keepCamera) {
      /* nothing to do: the marker is already where the user clicked */
    } else if (cam)
      inst.map.flyTo({ center: cam.center, zoom: cam.zoom, bearing: 0, pitch: 0, duration: 1100 });
    else
      inst.map.flyTo({
        center: [loc.lon, loc.lat],
        zoom: zoomFor(loc),
        bearing: 0,
        pitch: 0,
        duration: 1100,
      });
    if (cfg.autoPopup) {
      /* moveend never fires when the map is already at the target — timer fallback */
      const open = () => {
        if (!inst.popup.isOpen()) inst.marker.togglePopup();
        /* MapLibre popups don't auto-pan like Leaflet: nudge the map if the
           popup pokes out of the container (small maps on phones) */
        requestAnimationFrame(() => {
          const popupEl = inst.popup.getElement && inst.popup.getElement();
          if (!popupEl) return;
          const pr = popupEl.getBoundingClientRect();
          const mr = inst.map.getContainer().getBoundingClientRect();
          const dy = pr.top - (mr.top + 10);
          if (dy < 0) inst.map.panBy([0, dy], { duration: 300 });
        });
      };
      inst.map.once("moveend", open);
      setTimeout(() => {
        inst.map.off("moveend", open);
        open();
      }, 1400);
    }
  }
  /* A shared link's camera wins over the selection's own framing: it is the
     view the sender chose to share. Applied last, and only once. */
  applyPendingCamera(id);
  /* same location (language/unit change): popup content refreshed above,
     user's zoom and center untouched */
}

export function renderMap() {
  if (!state.loc) return;
  updateMap("worldMap");
  updateMap("homeMap");
  /* units and language both change what the legend and the timeline clock
     read, and both funnel through renderAllWeather() → renderMap() */
  renderWeatherOverlay();
}

/* ── MapTiler weather overlay switcher ────────────────────────────────────
   Weather layers are loaded only after the user asks for one, keeping the
   heavier weather module out of the initial homepage bundle. Satellite is the
   Hybrid basemap itself, so returning to it simply removes the active overlay.
   The map-instance side of this (readiness wait, layer add/remove, stale-
   request guarding) lives in features/weather-layers.js, free of any
   window/document-touching import, so it's directly unit-testable; this file
   keeps only the DOM/button wiring. */
function setLayerButtonState(active) {
  $$(".map-layer").forEach((button) => {
    const on = button.dataset.mapLayer === active;
    button.classList.toggle("is-active", on);
    button.classList.remove("is-loading");
    button.setAttribute("aria-checked", String(on));
  });
}

/* The one description of what the weather overlay is currently showing —
   read by the legend, the timeline and the URL serializer, so those three can
   never disagree about which layer or which forecast hour is active. */
const overlay = {
  type: "satellite",
  status: "idle" /* idle | loading | ready | unavailable | error */,
  offset: 0,
  colorRamp: null,
  timeMs: null,
  clamped: false,
  offsets: [],
};

export function getMapOverlayState() {
  return { type: overlay.type, offset: overlay.offset, status: overlay.status };
}

function renderWeatherOverlay() {
  renderWeatherOverlayUI(overlay, { onSelectTime: setMapTime });
}

function resetOverlay(type) {
  overlay.type = type;
  overlay.colorRamp = null;
  overlay.timeMs = null;
  overlay.clamped = false;
  overlay.offsets = [];
  if (type === "satellite") {
    /* returning to the basemap resets the clock too, so re-enabling a layer
       later starts from "now" rather than a forgotten +6 h */
    overlay.offset = 0;
    overlay.status = "idle";
  }
}

/* Fold a weather-layers report into the overlay description. */
function absorbReport(report) {
  if (!report) return;
  overlay.colorRamp = report.colorRamp;
  overlay.timeMs = report.time?.timeMs ?? null;
  overlay.clamped = Boolean(report.time?.clamped);
  overlay.offsets = availableOffsets(report.layer);
  overlay.status = report.sourceReady && report.time?.available ? "ready" : "unavailable";
}

/* A single counter for BOTH layer changes and time changes: whichever the
   user asked for last is the only one allowed to finish, so a slow
   "temperature" cannot land after a fast "wind", and a queued "+6 h" cannot
   re-apply itself to a layer the user has already switched away from. */
let layerRequestId = 0;

export async function setMapLayer(type, { offset = overlay.offset } = {}) {
  const requested = WEATHER_LAYER_IDS[type] ? type : "satellite";
  const requestId = ++layerRequestId;
  const isStale = () => requestId !== layerRequestId;
  const button = $(`.map-layer[data-map-layer="${requested}"]`);
  button?.classList.add("is-loading");

  resetOverlay(requested);
  overlay.offset = requested === "satellite" ? 0 : normalizeOffset(offset);
  if (requested !== "satellite") overlay.status = "loading";
  renderWeatherOverlay();

  try {
    await updateMap("worldMap");
    const inst = MAPS.worldMap;
    if (!inst) throw new Error("Map unavailable");
    const report = await applyWeatherLayer(inst, requested, {
      isStale,
      onLayerAdded: raiseSelectionArea,
      offsetHours: overlay.offset,
    });
    if (isStale()) return;
    absorbReport(report);
    setLayerButtonState(requested);
    renderWeatherOverlay();
    emit("map:layer", getMapOverlayState());
  } catch {
    if (isStale()) return;
    removeWeatherLayer(MAPS.worldMap);
    resetOverlay("satellite");
    setLayerButtonState("satellite");
    renderWeatherOverlay();
    emit("map:layer", getMapOverlayState());
    showToast(t("mapLayerError"));
  } finally {
    /* the winning request's own setLayerButtonState() above already clears
       "is-loading" from every button; a superseded request clears just its
       own button immediately instead of leaving a stale spinner running
       until the newer request eventually finishes */
    if (isStale()) button?.classList.remove("is-loading");
  }
}

/* Move the active overlay to now / +3 h / +6 h. No layer is recreated: this
   is a setAnimationTime() call on the layer already on the map. */
export async function setMapTime(offsetHours) {
  const offset = normalizeOffset(offsetHours);
  if (overlay.type === "satellite") return; /* nothing to re-time */
  const requestId = ++layerRequestId;
  const isStale = () => requestId !== layerRequestId;

  overlay.offset = offset;
  overlay.status = "loading";
  renderWeatherOverlay();

  try {
    const report = await setWeatherLayerTime(MAPS.worldMap, offset, { isStale });
    if (isStale()) return;
    if (!report) {
      overlay.status = "unavailable";
      renderWeatherOverlay();
      return;
    }
    absorbReport(report);
    renderWeatherOverlay();
    emit("map:layer", getMapOverlayState());
  } catch {
    if (isStale()) return;
    overlay.status = "error";
    renderWeatherOverlay();
  }
}

/* Edge-fade visibility for the ≤820px horizontally-scrolling layer row —
   same computeFadeVisibility() the forecast day-carousel uses, so there's
   one shared implementation of "is there more content past this edge?"
   rather than a second one reinvented here. On desktop the row never
   overflows, so this is a harmless no-op (both fades stay hidden). */
export function updateMapLayerFades() {
  const el = $(".map-layer-switcher");
  if (!el) return;
  const { left, right } = computeFadeVisibility({
    scrollLeft: el.scrollLeft,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  });
  $("#mapLayerFadeLeft")?.classList.toggle("is-visible", left);
  $("#mapLayerFadeRight")?.classList.toggle("is-visible", right);
}

export function bindMapLayerControls() {
  $$(".map-layer").forEach((button) =>
    button.addEventListener("click", () => setMapLayer(button.dataset.mapLayer)),
  );
  $(".map-layer-switcher")?.addEventListener("scroll", updateMapLayerFades, { passive: true });
  updateMapLayerFades();
}

/* ── "You are here" overlay (Google-Maps-style blue dot + accuracy circle) ──
   Rendered as its own layer set per map instance, independent of the search
   pin, so recentering never blinks the pin. userPos is the last known fix so a
   map opened later still shows the dot. */
let userPos = null; // { lat, lon, acc }

/* Approximate a geographic circle of `meters` radius as a 64-gon polygon so the
   accuracy ring scales correctly with zoom (MapLibre circle radii are pixels). */
function circlePolygon(lon, lat, meters, steps = 64) {
  const R = 6378137,
    rad = Math.PI / 180;
  const dLat = meters / R / rad;
  const dLon = meters / (R * Math.cos(lat * rad)) / rad;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const th = (2 * Math.PI * i) / steps;
    ring.push([lon + dLon * Math.cos(th), lat + dLat * Math.sin(th)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } };
}

function setUserLocationOn(inst, lat, lon, acc) {
  const map = inst.map;
  const apply = () => {
    const poly = circlePolygon(lon, lat, Math.max(acc || 0, 20));
    const src = map.getSource("userAcc");
    if (src) {
      src.setData(poly);
    } else {
      map.addSource("userAcc", { type: "geojson", data: poly });
      map.addLayer({
        id: "userAccFill",
        type: "fill",
        source: "userAcc",
        paint: { "fill-color": "#4285F4", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "userAccLine",
        type: "line",
        source: "userAcc",
        paint: { "line-color": "#4285F4", "line-opacity": 0.4, "line-width": 1 },
      });
    }
    if (!inst.userMarker) {
      const dot = document.createElement("div");
      dot.className = "user-loc-dot";
      dot.innerHTML = '<span class="uld-halo"></span><span class="uld-core"></span>';
      loadMapLibre().then((maplibregl) => {
        inst.userMarker = new maplibregl.Marker({ element: dot }).setLngLat([lon, lat]).addTo(map);
      });
    } else {
      inst.userMarker.setLngLat([lon, lat]);
    }
  };
  /* addSource/addLayer need a loaded style. "idle" is more reliable than a late
     once("load") (which never fires if load already happened before we listened). */
  if (map.isStyleLoaded()) apply();
  else map.once("idle", apply);
}

export function showUserLocation(lat, lon, acc) {
  userPos = { lat, lon, acc };
  Object.values(MAPS).forEach((inst) => setUserLocationOn(inst, lat, lon, acc));
}

/* A camera asked for before the map exists — restoring a shared link opens
   the map page and sets its view in the same breath, and the map itself is
   created lazily one frame later. Held here and applied by updateMap(). */
let pendingCamera = null;

/* duration 0 = jump with no flight, used when restoring a shared/bookmarked
   camera on page load: the view should already BE there, not fly there. */
export function jumpTo(center, zoom, { duration = 1200 } = {}) {
  if (!MAPS.worldMap) {
    pendingCamera = { center, zoom, duration };
    return;
  }
  /* bearing/pitch are always explicit here: this is also the camera-restore
     path for a shared/bookmarked URL (see map-url-sync.js), and a link saved
     before this map became permanently flat must still open flat rather than
     replaying a stale tilt/rotation. */
  MAPS.worldMap.map.flyTo({ center, zoom, bearing: 0, pitch: 0, duration });
}

function applyPendingCamera(id) {
  if (id !== "worldMap" || !pendingCamera || !MAPS.worldMap) return;
  const { center, zoom, duration } = pendingCamera;
  pendingCamera = null;
  MAPS.worldMap.map.flyTo({ center, zoom, bearing: 0, pitch: 0, duration });
}

/* Country-jump chips above the map card ("Monde"/France/États-Unis/Canada).
   Target data lives in data/country-jumps.js (see its own test) so a wrong
   center/zoom pair is caught without needing to render an actual map. */
export function bindCountryFilters() {
  $$(".map-filters .chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      $$(".map-filters .chip").forEach((c) => {
        const on = c === chip;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", String(on));
      });
      const jump = COUNTRY_JUMPS[chip.dataset.jump];
      if (jump) jumpTo(jump.center, jump.zoom);
    }),
  );
}

export function resizeMaps() {
  Object.values(MAPS).forEach((m) => {
    try {
      m.map.resize();
    } catch {
      /* map not fully initialized yet — ignore */
    }
  });
}

/* Bearing/pitch are rendered into the WebGL canvas itself — unlike center,
   zoom or the selected layer, nothing about them is ever reflected in the
   DOM or the URL, so there is no way for a Playwright test to observe (or, to
   set up a "what if it were tilted?" case for the reset button) without some
   accessor. `import.meta.env.DEV` is Vite's own build-time flag: this whole
   block is dead code eliminated from `npm run build`'s output (verified by
   scripts/verify-no-secrets.mjs scanning dist/), so it only ever exists
   under `vite dev`/`vite preview`, which is what Playwright drives. */
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__mapOrientationForTests = {
    get: (id = "worldMap") => {
      const inst = MAPS[id];
      if (!inst) return null;
      return {
        bearing: inst.map.getBearing(),
        pitch: inst.map.getPitch(),
        dragRotateEnabled: inst.map.dragRotate.isEnabled(),
        touchPitchEnabled: inst.map.touchPitch.isEnabled(),
        /* MapLibre has no public getter for "is JUST the rotate half of this
           handler disabled" (only the enable/disable pair below) — reading
           the handler's own internal flag is fine here since this whole
           block never reaches production (see the DEV guard above). */
        touchRotateDisabled: inst.map.touchZoomRotate._rotationDisabled === true,
        keyboardRotateDisabled: inst.map.keyboard._rotationDisabled === true,
        /* the handlers this fix deliberately leaves untouched — pan and
           zoom must stay on, on both desktop and touch */
        dragPanEnabled: inst.map.dragPan.isEnabled(),
        scrollZoomEnabled: inst.map.scrollZoom.isEnabled(),
        touchZoomRotateEnabled: inst.map.touchZoomRotate.isEnabled(),
      };
    },
    /* test setup only, to exercise the reset control — the app itself never
       calls setBearing/setPitch anywhere */
    set: (id = "worldMap", bearing, pitch) => {
      const inst = MAPS[id];
      if (!inst) return false;
      inst.map.setBearing(bearing);
      inst.map.setPitch(pitch);
      return true;
    },
  };
}
