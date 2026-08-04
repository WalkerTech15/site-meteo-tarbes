/* applyWeatherLayer() is the DOM-free core of the weather-layer switcher:
 * it takes a map instance facade and an injected weather-module loader, so
 * it's exercised here with a fake `inst` rather than a real MapLibre map or
 * the (dynamically imported) @maptiler/weather SDK. */
import { describe, it, expect, vi } from "vitest";
import { applyWeatherLayer } from "./weather-layers.js";

/* Minimal stand-in for a MapLibre/MapTiler Map — just enough of the event +
   layer API applyWeatherLayer (via awaitMapReady) touches. */
function fakeMapInstance({ styleLoaded = true } = {}) {
  const layers = new Map();
  const listeners = new Map();
  const map = {
    isStyleLoaded: () => styleLoaded,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) || []) handler(payload);
    },
    addLayer(layer) {
      layers.set(layer.id, layer);
    },
    removeLayer(id) {
      layers.delete(id);
    },
    getLayer(id) {
      return layers.get(id);
    },
  };
  return {
    map,
    marker: {},
    popup: {},
    lastKey: null,
    userMarker: null,
    weatherLayer: null,
    layers,
  };
}

/* Fake @maptiler/weather module: records what was constructed instead of
   rendering real tiles. */
function fakeWeatherModule() {
  class FakeLayer {
    constructor(opts) {
      this.id = opts.id;
      this.opacity = opts.opacity;
    }
  }
  return {
    TemperatureLayer: class extends FakeLayer {},
    PrecipitationLayer: class extends FakeLayer {},
    WindLayer: class extends FakeLayer {},
  };
}

describe("applyWeatherLayer", () => {
  it("activates a temperature layer on an already-ready map", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    await applyWeatherLayer(inst, "temperature", { loadWeather: async () => weather });
    expect(inst.weatherLayer).toBeInstanceOf(weather.TemperatureLayer);
    expect(inst.weatherLayer.id).toBe("weather-temperature");
    expect(inst.map.getLayer("weather-temperature")).toBe(inst.weatherLayer);
  });

  it("activates a rain layer", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    await applyWeatherLayer(inst, "rain", { loadWeather: async () => weather });
    expect(inst.weatherLayer).toBeInstanceOf(weather.PrecipitationLayer);
    expect(inst.weatherLayer.id).toBe("weather-rain");
  });

  it("activates a wind layer", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    await applyWeatherLayer(inst, "wind", { loadWeather: async () => weather });
    expect(inst.weatherLayer).toBeInstanceOf(weather.WindLayer);
    expect(inst.weatherLayer.id).toBe("weather-wind");
  });

  it("returning to satellite removes the active overlay and adds nothing", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    await applyWeatherLayer(inst, "wind", { loadWeather: async () => weather });
    expect(inst.weatherLayer).not.toBeNull();
    const loadWeather = vi.fn();
    await applyWeatherLayer(inst, "satellite", { loadWeather });
    expect(inst.weatherLayer).toBeNull();
    expect(inst.map.getLayer("weather-wind")).toBeUndefined();
    expect(loadWeather).not.toHaveBeenCalled(); /* satellite never needs the weather chunk */
  });

  it("switching directly between two weather layers never leaves both on the map", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    await applyWeatherLayer(inst, "temperature", { loadWeather: async () => weather });
    await applyWeatherLayer(inst, "rain", { loadWeather: async () => weather });
    expect(inst.map.getLayer("weather-temperature")).toBeUndefined();
    expect(inst.map.getLayer("weather-rain")).toBeDefined();
    expect(inst.weatherLayer.id).toBe("weather-rain");
  });

  it("repeated clicks on the same layer never create a duplicate", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    await applyWeatherLayer(inst, "temperature", { loadWeather: async () => weather });
    const first = inst.weatherLayer;
    await applyWeatherLayer(inst, "temperature", { loadWeather: async () => weather });
    expect(inst.layers.size).toBe(1);
    expect(inst.weatherLayer).not.toBe(first); /* a fresh instance, not a leaked duplicate */
  });

  it("calls the onLayerAdded callback so the caller can re-raise its own selection layer", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    const onLayerAdded = vi.fn();
    await applyWeatherLayer(inst, "rain", { loadWeather: async () => weather, onLayerAdded });
    expect(onLayerAdded).toHaveBeenCalledWith(inst);
    const onSatellite = vi.fn();
    await applyWeatherLayer(inst, "satellite", { onLayerAdded: onSatellite });
    expect(onSatellite).not.toHaveBeenCalled(); /* nothing was added, nothing to re-raise */
  });

  it("waits for a temporarily-unready map (style still mid-reload) before mutating it", async () => {
    const inst = fakeMapInstance({ styleLoaded: false });
    const weather = fakeWeatherModule();
    const p = applyWeatherLayer(inst, "wind", { loadWeather: async () => weather });
    await Promise.resolve(); // let applyWeatherLayer reach the awaitMapReady() await
    expect(inst.weatherLayer).toBeNull(); /* nothing happens until the map says it's ready */
    inst.map.isStyleLoaded = () => true;
    inst.map.emit("idle"); // same event awaitMapReady rechecks readiness on
    await p;
    expect(inst.weatherLayer).toBeInstanceOf(weather.WindLayer);
  });

  it("a superseded (stale) request bails before touching the map, even mid-flight", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    let stale = false;
    const slowLoad = () => new Promise((resolve) => setTimeout(() => resolve(weather), 5));
    const p = applyWeatherLayer(inst, "temperature", {
      loadWeather: slowLoad,
      isStale: () => stale,
    });
    stale = true; /* a newer click supersedes this one before slowLoad resolves */
    await p;
    expect(inst.weatherLayer).toBeNull();
    expect(inst.map.getLayer("weather-temperature")).toBeUndefined();
  });

  it("rapid switching: the latest request's layer is what remains active", async () => {
    const inst = fakeMapInstance();
    const weather = fakeWeatherModule();
    let current = 0;
    const requestFor = (type, delayMs) => {
      const id = ++current;
      return applyWeatherLayer(inst, type, {
        loadWeather: () => new Promise((resolve) => setTimeout(() => resolve(weather), delayMs)),
        isStale: () => id !== current,
      });
    };
    const first = requestFor("temperature", 15); // slower…
    const second = requestFor("wind", 5); // …but wind is requested after and resolves first
    await Promise.all([first, second]);
    expect(inst.weatherLayer.id).toBe("weather-wind");
    expect(inst.map.getLayer("weather-temperature")).toBeUndefined();
  });
});
