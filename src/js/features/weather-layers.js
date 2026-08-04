/* MapTiler weather-overlay switching (Temperature/Rain/Wind, added on top of
   the Satellite basemap) — the map-instance/SDK logic only, with no import
   that touches `window`/`document` at load time (unlike features/map.js,
   which pulls in ui/navigation.js for switchView). Kept separate so
   applyWeatherLayer() is directly unit-testable with a fake map instance;
   see features/map.js for the button/DOM wiring that calls it.

   Methods used from @maptiler/weather 3.1.1 (all verified against the
   installed typings, none invented):
     new TemperatureLayer / PrecipitationLayer / WindLayer ({ id, opacity })
     layer.onSourceReadyAsync()   resolves once the layer's data source exists
     layer.getColorRamp()         the ramp the shader samples → the legend
     layer.setAnimationTime(s)    forecast time, UNIX SECONDS (see map-timeline)
     layer.getAnimationStart/End()
*/
import { awaitMapReady } from "../core/map-ready.js";
import { applyLayerTime } from "./map-timeline.js";

export const WEATHER_LAYER_IDS = {
  temperature: "weather-temperature",
  rain: "weather-rain",
  wind: "weather-wind",
};

/* A weather source that never becomes ready must not leave the legend and
   timeline spinning forever — after this the UI shows its "unavailable"
   state instead. */
export const WEATHER_SOURCE_TIMEOUT_MS = 12000;

let weatherPromise = null;
export function loadWeatherLayers() {
  if (!weatherPromise) weatherPromise = import("@maptiler/weather");
  return weatherPromise;
}

export function removeWeatherLayer(inst) {
  if (!inst?.weatherLayer) return;
  try {
    if (inst.map.getLayer(inst.weatherLayer.id)) inst.map.removeLayer(inst.weatherLayer.id);
  } catch {
    /* the style may have reloaded while the weather module was resolving */
  }
  inst.weatherLayer = null;
  inst.weatherLayerType = null;
}

function makeWeatherLayer(module, type) {
  const options = { id: WEATHER_LAYER_IDS[type], opacity: type === "wind" ? 0.8 : 0.68 };
  if (type === "temperature") return new module.TemperatureLayer(options);
  if (type === "rain") return new module.PrecipitationLayer(options);
  return new module.WindLayer(options);
}

/* Insert weather UNDER the basemap's labels rather than on top of everything.
   Two reasons: place names stay readable through the overlay, and it leaves a
   slot between the weather and the labels for the selection boundary (see
   raiseSelectionArea in features/map.js), which must sit above the weather
   while staying subtle. Returns undefined for a label-less style, which
   addLayer/moveLayer both read as "on top" — the previous behaviour. */
export function firstSymbolLayerId(map) {
  try {
    return (map.getStyle().layers || []).find((layer) => layer.type === "symbol")?.id;
  } catch {
    return undefined; /* style not available yet */
  }
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Weather source timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/* Resolves true when the layer's data source is usable, false when it timed
   out or errored. A layer with no such method (an older build, or a test
   double) has nothing to wait for and counts as ready. */
async function waitForSource(layer, timeoutMs) {
  if (typeof layer?.onSourceReadyAsync !== "function") return true;
  try {
    await withTimeout(layer.onSourceReadyAsync(), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

function describe(layer, type, sourceReady, time) {
  return {
    type,
    layer,
    sourceReady,
    time,
    /* the layer's own ramp, in its native unit — features/map-legend.js turns
       it into a legend, so the legend can never disagree with the map */
    colorRamp:
      sourceReady && typeof layer.getColorRamp === "function" ? layer.getColorRamp() : null,
  };
}

/* The actual layer swap, once the map instance is known to be ready. Takes
   its dependencies as parameters (no module-level map registry, no DOM) so
   it's testable in isolation with a fake `inst`. `isStale()` is rechecked
   after every await — a superseded request (an older click, overtaken by a
   newer one) must never mutate the map, or a slow "temperature" response
   arriving after a fast "wind" one would silently undo the user's latest
   choice. `onLayerAdded` lets the caller re-raise its own selection-boundary
   layer above the new weather layer without this module needing to know
   about it; `onSourceReady` reports the ramp and the resolved forecast time
   once the data actually exists. */
export async function applyWeatherLayer(
  inst,
  requested,
  {
    loadWeather = loadWeatherLayers,
    isStale = () => false,
    onLayerAdded,
    onSourceReady,
    offsetHours = 0,
    now,
    timeoutMs = WEATHER_SOURCE_TIMEOUT_MS,
  } = {},
) {
  await awaitMapReady(inst.map);
  if (isStale()) return null;
  if (requested === "satellite") {
    removeWeatherLayer(inst);
    return null;
  }
  const weather = await loadWeather();
  if (isStale()) return null;
  /* always remove any previous overlay first — repeated clicks (even on the
     same layer) never leave more than one weather layer on the map */
  removeWeatherLayer(inst);
  const layer = makeWeatherLayer(weather, requested);
  inst.map.addLayer(layer, firstSymbolLayerId(inst.map));
  inst.weatherLayer = layer;
  inst.weatherLayerType = requested;
  onLayerAdded?.(inst);

  const sourceReady = await waitForSource(layer, timeoutMs);
  /* the identity check catches a newer request that already swapped the layer
     out while this one was waiting on its source */
  if (isStale() || inst.weatherLayer !== layer) return null;
  const time = applyLayerTime(layer, offsetHours, now);
  const report = describe(layer, requested, sourceReady, time);
  onSourceReady?.(report);
  return report;
}

/* Move the ALREADY-ADDED overlay to a different forecast time. No layer is
   recreated and no source is re-added — setAnimationTime is a property change
   on the existing time-frame animation, so the map and its style are never
   rebuilt. Returns null when there is no overlay or the request went stale. */
export async function setWeatherLayerTime(
  inst,
  offsetHours,
  { isStale = () => false, now, timeoutMs = WEATHER_SOURCE_TIMEOUT_MS } = {},
) {
  const layer = inst?.weatherLayer;
  if (!layer) return null;
  const type = inst.weatherLayerType;
  const sourceReady = await waitForSource(layer, timeoutMs);
  if (isStale() || inst.weatherLayer !== layer) return null;
  const time = applyLayerTime(layer, offsetHours, now);
  return describe(layer, type, sourceReady, time);
}
