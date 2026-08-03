/* Interactive map (MapLibre GL JS + MapTiler Hybrid v4 style).
   Borders, state/province lines, city/town/road labels all come from the
   vector style itself (countries at low zoom, regions/cities at medium,
   towns/roads at high) — no GeoJSON overlays needed.
   MapLibre is an npm dependency, dynamically imported the first time a map
   actually needs to render, so its ~200KB JS chunk never blocks the initial
   page load. */
import "maplibre-gl/dist/maplibre-gl.css";
import { state } from "../core/state.js";
import { $ } from "../core/dom.js";
import { esc } from "../core/dom.js";
import { t } from "../core/i18n.js";
import { MAPTILER_KEY, MAP_STYLE } from "../core/config.js";
import { weatherIcon } from "../data/icons.js";
import { wmo, wxDesc } from "../data/weather-codes.js";
import { fmtTemp, tempUnit } from "../core/units.js";
import { flagsHtml, locRegion, locCountry, locName, kindLabel } from "../core/location.js";
import { switchView } from "../ui/navigation.js";

let maplibreglPromise = null;
function loadMapLibre() {
  if (!maplibreglPromise) maplibreglPromise = import("maplibre-gl").then((m) => m.default);
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
];

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
  worldMap: { view: "map", autoPopup: true },
  homeMap: { view: "home", autoPopup: false },
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

export function refreshMapLanguage() {
  Object.values(MAPS).forEach((inst) => {
    if (inst.map.isStyleLoaded()) applyMapLanguage(inst.map);
    else inst.map.once("idle", () => applyMapLanguage(inst.map));
    applyMapControlLabels(inst.map);
  });
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
    let maplibregl;
    try {
      maplibregl = await loadMapLibre();
    } catch {
      mapError(id);
      return;
    }
    /* container may have been swapped for an offline message while we awaited */
    if (!$("#" + id)) return;
    const map = new maplibregl.Map({
      container: id,
      style: MAP_STYLE,
      center: [loc.lon, loc.lat],
      /* slightly zoomed out so the first flyTo is a real flight — a no-op
         flight would skip the popup offset and the moveend event */
      zoom: zoomFor(loc) - 0.4,
      renderWorldCopies: false,
      minZoom: 1 /* mercator already clamps latitude at ±85° — no pole panning */,
      attributionControl: { compact: true },
      locale: mapLocale(),
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("load", () => {
      el.classList.remove("is-loading");
      applyMapLanguage(map);
      applyMapControlLabels(map);
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
    pin.innerHTML = '<span class="map-ping"></span><span class="map-dot"></span>';
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
    MAPS[id] = { map, marker, popup, lastKey: null, userMarker: null };
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
    /* bbox present (country/region/city extents) → frame it; else type-based zoom */
    let cam = null;
    if (loc.bbox) {
      try {
        cam = inst.map.cameraForBounds(
          [
            [loc.bbox[0], loc.bbox[1]],
            [loc.bbox[2], loc.bbox[3]],
          ],
          { padding: 48, maxZoom: 14 },
        );
      } catch {
        cam = null;
      }
    }
    if (cam) inst.map.flyTo({ center: cam.center, zoom: cam.zoom, duration: 1100 });
    else inst.map.flyTo({ center: [loc.lon, loc.lat], zoom: zoomFor(loc), duration: 1100 });
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
  /* same location (language/unit change): popup content refreshed above,
     user's zoom and center untouched */
}

export function renderMap() {
  if (!state.loc) return;
  updateMap("worldMap");
  updateMap("homeMap");
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

export function jumpTo(center, zoom) {
  if (MAPS.worldMap) MAPS.worldMap.map.flyTo({ center, zoom, duration: 1200 });
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
