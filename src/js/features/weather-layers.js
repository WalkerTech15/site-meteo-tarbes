/* MapTiler weather-overlay switching (Temperature/Rain/Wind, added on top of
   the Satellite basemap) — the map-instance/SDK logic only, with no import
   that touches `window`/`document` at load time (unlike features/map.js,
   which pulls in ui/navigation.js for switchView). Kept separate so
   applyWeatherLayer() is directly unit-testable with a fake map instance;
   see features/map.js for the button/DOM wiring that calls it. */
import { awaitMapReady } from "../core/map-ready.js";

export const WEATHER_LAYER_IDS = {
  temperature: "weather-temperature",
  rain: "weather-rain",
  wind: "weather-wind",
};

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
}

function makeWeatherLayer(module, type) {
  const options = { id: WEATHER_LAYER_IDS[type], opacity: type === "wind" ? 0.8 : 0.68 };
  if (type === "temperature") return new module.TemperatureLayer(options);
  if (type === "rain") return new module.PrecipitationLayer(options);
  return new module.WindLayer(options);
}

/* The actual layer swap, once the map instance is known to be ready. Takes
   its dependencies as parameters (no module-level map registry, no DOM) so
   it's testable in isolation with a fake `inst`. `isStale()` is rechecked
   after every await — a superseded request (an older click, overtaken by a
   newer one) must never mutate the map, or a slow "temperature" response
   arriving after a fast "wind" one would silently undo the user's latest
   choice. `onLayerAdded` lets the caller re-raise its own selection-boundary
   layer above the new weather layer without this module needing to know
   about it. */
export async function applyWeatherLayer(
  inst,
  requested,
  { loadWeather = loadWeatherLayers, isStale = () => false, onLayerAdded } = {},
) {
  await awaitMapReady(inst.map);
  if (isStale()) return;
  if (requested === "satellite") {
    removeWeatherLayer(inst);
    return;
  }
  const weather = await loadWeather();
  if (isStale()) return;
  /* always remove any previous overlay first — repeated clicks (even on the
     same layer) never leave more than one weather layer on the map */
  removeWeatherLayer(inst);
  const layer = makeWeatherLayer(weather, requested);
  inst.map.addLayer(layer);
  inst.weatherLayer = layer;
  onLayerAdded?.(inst);
}
