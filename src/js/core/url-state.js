/* Shareable app/map state, encoded in the URL hash.
 *
 * The hash — not a path or a query string — because the site is built with a
 * relative base (vite.config.js) and deploys under a domain root OR a project
 * subdirectory, with no server rewrite available in either case. A hash needs
 * neither.
 *
 * Shape: `#/<view>?sel=lat,lon&c=lat,lon&z=zoom&layer=<id>&t=<hours>&panel=0|1`
 *
 *   view   which section is open (mirrors the #view-* sections in index.html)
 *   sel    the SELECTED location — what the marker and weather panel describe
 *   c, z   the camera: where the map is pointed and how far in. Separate from
 *          `sel` on purpose: panning away from your selection is a real state
 *          worth sharing, and conflating the two would make every pan move the
 *          marker.
 *   layer  active weather overlay
 *   t      forecast-time offset in whole hours
 *   panel  whether the map details panel is open
 *
 * Everything here is pure string ↔ object translation with validation and
 * clamping; nothing touches `window`. features/map-url.js owns the actual
 * history/popstate plumbing, and this file is what makes the parsing testable
 * without a browser. No key, token or device coordinate is ever encoded — the
 * caller decides what to pass in, and features/map-url-sync.js is the place
 * that enforces the privacy rule. */

export const URL_VIEWS = ["home", "map", "forecast", "favorites", "settings", "about"];
export const URL_LAYERS = ["satellite", "temperature", "rain", "wind"];
export const URL_TIME_OFFSETS = [0, 3, 6];

export const DEFAULT_URL_STATE = {
  view: "home",
  sel: null,
  center: null,
  zoom: null,
  layer: "satellite",
  offset: 0,
  panel: null,
};

/* Web Mercator latitude limit — the same clamp the map itself applies. */
const MAX_LAT = 85.0511;
const MIN_ZOOM = 1;
const MAX_ZOOM = 20;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* Strict finite-number parse: rejects "", "abc", "NaN", "1e999", " ". */
function num(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, decimals) {
  return Number(value.toFixed(decimals));
}

/* "48.8566,2.3522" → { lat, lon }, clamped, or null if either half is junk.
   Longitude is wrapped rather than clamped so a shared ±180 edge survives. */
export function parseLatLon(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lat = num(parts[0]);
  const lon = num(parts[1]);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 360) return null; /* not a coordinate at all */
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: round(clamp(lat, -MAX_LAT, MAX_LAT), 4), lon: round(wrapped, 4) };
}

export function formatLatLon(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  return `${round(point.lat, 4)},${round(point.lon, 4)}`;
}

/* Split "#/map?a=1&b=2" into its view segment and its parameters. Anything
   that isn't in that shape (a bare "#", an old anchor link, a hand-typed
   fragment) degrades to "no view, no params" rather than throwing. */
function splitHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const [pathPart = "", queryPart = ""] = raw.split("?");
  const view = pathPart.replace(/^\/+/, "").split("/")[0] || "";
  return { view, params: new URLSearchParams(queryPart) };
}

/**
 * Parse a location hash into validated app state. Never throws: any invalid,
 * missing or out-of-range value falls back to its default, so a hand-edited or
 * truncated link still opens a working app.
 */
export function parseAppUrl(hash) {
  const { view, params } = splitHash(hash);
  const state = { ...DEFAULT_URL_STATE };

  if (URL_VIEWS.includes(view)) state.view = view;

  state.sel = parseLatLon(params.get("sel"));
  state.center = parseLatLon(params.get("c"));

  const zoom = num(params.get("z"));
  if (zoom !== null) state.zoom = round(clamp(zoom, MIN_ZOOM, MAX_ZOOM), 2);

  const layer = params.get("layer");
  if (URL_LAYERS.includes(layer)) state.layer = layer;

  const offset = num(params.get("t"));
  /* an unsupported offset (t=99, t=-3, t=1.5) resolves to "now", never to a
     time the timeline has no control for */
  if (offset !== null && URL_TIME_OFFSETS.includes(offset)) state.offset = offset;

  const panel = params.get("panel");
  if (panel === "0" || panel === "1") state.panel = panel === "1";

  /* a forecast time only means something with a weather layer under it */
  if (state.layer === "satellite") state.offset = 0;

  return state;
}

/**
 * Serialize app state back to a hash. Defaults are omitted so an ordinary
 * "home, nothing selected" session keeps a clean `#/home` URL instead of a
 * wall of redundant parameters.
 */
export function buildAppUrl(input = {}) {
  const state = { ...DEFAULT_URL_STATE, ...input };
  const view = URL_VIEWS.includes(state.view) ? state.view : DEFAULT_URL_STATE.view;
  const params = new URLSearchParams();

  const sel = formatLatLon(state.sel);
  if (sel) params.set("sel", sel);

  const center = formatLatLon(state.center);
  if (center) params.set("c", center);

  if (Number.isFinite(state.zoom)) {
    params.set("z", String(round(clamp(state.zoom, MIN_ZOOM, MAX_ZOOM), 2)));
  }

  if (URL_LAYERS.includes(state.layer) && state.layer !== "satellite") {
    params.set("layer", state.layer);
    if (URL_TIME_OFFSETS.includes(state.offset) && state.offset !== 0) {
      params.set("t", String(state.offset));
    }
  }

  if (state.panel === true || state.panel === false) params.set("panel", state.panel ? "1" : "0");

  const query = params.toString();
  return `#/${view}${query ? `?${query}` : ""}`;
}

/* True when two parsed states describe the same thing — used to skip
   history writes that would add an entry identical to the current one. */
export function sameAppUrl(a, b) {
  return buildAppUrl(a) === buildAppUrl(b);
}
