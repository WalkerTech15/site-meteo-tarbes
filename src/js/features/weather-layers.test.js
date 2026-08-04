/* applyWeatherLayer() is the DOM-free core of the weather-layer switcher:
 * it takes a map instance facade and an injected weather-module loader, so
 * it's exercised here with a fake `inst` rather than a real MapLibre map or
 * the (dynamically imported) @maptiler/weather SDK. */
import { describe, it, expect, vi } from "vitest";
import { applyWeatherLayer, setWeatherLayerTime, firstSymbolLayerId } from "./weather-layers.js";

/* Minimal stand-in for a MapLibre/MapTiler Map — just enough of the event +
   layer API applyWeatherLayer (via awaitMapReady) touches. */
function fakeMapInstance({ styleLoaded = true, styleLayers = null } = {}) {
  const layers = new Map();
  const listeners = new Map();
  const addedBefore = [];
  const map = {
    isStyleLoaded: () => styleLoaded,
    /* only defined when a test cares about label ordering — otherwise absent,
       exactly like a map whose style has not resolved yet */
    ...(styleLayers ? { getStyle: () => ({ layers: styleLayers }) } : {}),
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
    addLayer(layer, beforeId) {
      layers.set(layer.id, layer);
      addedBefore.push(beforeId);
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
    weatherLayerType: null,
    layers,
    addedBefore,
  };
}

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

/* Fake @maptiler/weather module: records what was constructed instead of
   rendering real tiles. `sourceReady` and the time-frame accessors mirror the
   real layers' API (seconds, not milliseconds — see features/map-timeline.js). */
function fakeWeatherModule({ sourceReady = "immediate", ramp = null } = {}) {
  class FakeLayer {
    constructor(opts) {
      this.id = opts.id;
      this.opacity = opts.opacity;
      this.animationTime = null;
    }
    onSourceReadyAsync() {
      if (sourceReady === "immediate") return Promise.resolve();
      if (sourceReady === "never") return new Promise(() => {});
      return new Promise((resolve) => setTimeout(resolve, sourceReady));
    }
    getColorRamp() {
      return ramp;
    }
    getAnimationStart() {
      return (NOW - 3 * HOUR) / 1000;
    }
    getAnimationEnd() {
      return (NOW + 9 * HOUR) / 1000;
    }
    setAnimationTime(seconds) {
      this.animationTime = seconds;
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

describe("layer ordering", () => {
  it("finds the first symbol layer so weather goes under the labels", () => {
    const map = {
      getStyle: () => ({
        layers: [
          { id: "bg", type: "background" },
          { id: "water", type: "fill" },
          { id: "place-labels", type: "symbol" },
          { id: "road-labels", type: "symbol" },
        ],
      }),
    };
    expect(firstSymbolLayerId(map)).toBe("place-labels");
  });

  it("returns undefined for a label-less or not-yet-loaded style, meaning 'on top'", () => {
    expect(
      firstSymbolLayerId({ getStyle: () => ({ layers: [{ id: "bg", type: "background" }] }) }),
    ).toBeUndefined();
    expect(firstSymbolLayerId({})).toBeUndefined();
  });

  it("inserts the weather layer before the first label layer", async () => {
    const inst = fakeMapInstance({
      styleLayers: [
        { id: "bg", type: "background" },
        { id: "place-labels", type: "symbol" },
      ],
    });
    await applyWeatherLayer(inst, "rain", { loadWeather: async () => fakeWeatherModule() });
    expect(inst.addedBefore).toEqual(["place-labels"]);
  });
});

describe("forecast time", () => {
  it("applies the requested offset once the source is ready", async () => {
    const inst = fakeMapInstance();
    const report = await applyWeatherLayer(inst, "temperature", {
      loadWeather: async () => fakeWeatherModule(),
      offsetHours: 3,
      now: NOW,
    });
    expect(report.sourceReady).toBe(true);
    expect(report.time).toMatchObject({ available: true, offset: 3, clamped: false });
    expect(inst.weatherLayer.animationTime).toBe((NOW + 3 * HOUR) / 1000);
  });

  it("hands the caller the layer's own colour ramp for the legend", async () => {
    const ramp = [{ value: 0, color: [1, 2, 3, 255] }];
    const inst = fakeMapInstance();
    const report = await applyWeatherLayer(inst, "wind", {
      loadWeather: async () => fakeWeatherModule({ ramp }),
      now: NOW,
    });
    expect(report.colorRamp).toBe(ramp);
  });

  it("reports the source as unavailable rather than hanging forever", async () => {
    const inst = fakeMapInstance();
    const report = await applyWeatherLayer(inst, "rain", {
      loadWeather: async () => fakeWeatherModule({ sourceReady: "never" }),
      timeoutMs: 10,
      now: NOW,
    });
    expect(report.sourceReady).toBe(false);
    expect(report.colorRamp).toBeNull();
  });

  it("re-times the existing layer without recreating or re-adding anything", async () => {
    const inst = fakeMapInstance();
    await applyWeatherLayer(inst, "wind", {
      loadWeather: async () => fakeWeatherModule(),
      now: NOW,
    });
    const layer = inst.weatherLayer;
    const addedCount = inst.addedBefore.length;

    const report = await setWeatherLayerTime(inst, 6, { now: NOW });
    expect(inst.weatherLayer).toBe(layer); /* same instance, still on the map */
    expect(inst.addedBefore).toHaveLength(addedCount); /* nothing re-added */
    expect(layer.animationTime).toBe((NOW + 6 * HOUR) / 1000);
    expect(report.type).toBe("wind");
  });

  it("does nothing when there is no overlay to re-time", async () => {
    expect(await setWeatherLayerTime(fakeMapInstance(), 3, { now: NOW })).toBeNull();
    expect(await setWeatherLayerTime(null, 3, { now: NOW })).toBeNull();
  });

  it("a time change superseded by a layer change never touches the new layer", async () => {
    const inst = fakeMapInstance();
    await applyWeatherLayer(inst, "temperature", {
      loadWeather: async () => fakeWeatherModule({ sourceReady: 20 }),
      now: NOW,
    });
    const slowTime = setWeatherLayerTime(inst, 6, { now: NOW });
    /* the user switches layer while that +6 h request is still waiting */
    await applyWeatherLayer(inst, "wind", {
      loadWeather: async () => fakeWeatherModule(),
      now: NOW,
    });
    expect(await slowTime).toBeNull();
    expect(inst.weatherLayer.id).toBe("weather-wind");
    expect(inst.weatherLayer.animationTime).toBe(NOW / 1000); /* still "now" */
  });
});
