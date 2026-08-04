/* The legend must describe the layer that is actually on the map, in the
 * user's units. These tests use the REAL builtin ramp definitions shipped in
 * @maptiler/weather 3.1.1 (copied as fixtures rather than imported, because
 * the SDK entry point needs a browser), so a provider change that our code
 * silently ignored would show up here. */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../core/state.js";
import { buildLegend, legendModel, normalizeRampStops, hasLegend } from "./map-legend.js";

/* Head of the builtin TEMPERATURE_2 ramp (°C) used by TemperatureLayer. */
const TEMPERATURE_STOPS = [
  { value: -70.15, color: [255, 255, 255, 255] },
  { value: -40, color: [140, 0, 180, 255] },
  { value: 0, color: [0, 160, 220, 255] },
  { value: 20, color: [240, 220, 60, 255] },
  { value: 46.85, color: [180, 0, 0, 255] },
];

/* Head of the builtin PRECIPITATION ramp (mm/h) used by PrecipitationLayer —
   note the transparent zero stop: "no rain" is nothing, not a colour. */
const RAIN_STOPS = [
  { value: 0, color: [255, 255, 255, 0] },
  { value: 1, color: [168, 225, 188, 255] },
  { value: 10, color: [57, 93, 156, 255] },
  { value: 50, color: [11, 4, 5, 255] },
];

/* WindLayer uses VIRIDIS scaled to 0–40 m/s. */
const WIND_STOPS = [
  { value: 0, color: [68, 1, 84, 255] },
  { value: 20, color: [33, 145, 140, 255] },
  { value: 40, color: [253, 231, 37, 255] },
];

/* Stand-in for a Readonly<ColorRamp>: the SDK's ColorRamp extends Array and
   also exposes getRawColorStops(), so both access paths are exercised. */
function fakeColorRamp(stops) {
  const ramp = [...stops];
  ramp.getRawColorStops = () => stops;
  return ramp;
}

beforeEach(() => {
  state.unitTemp = "c";
  state.unitWind = "kmh";
});

describe("hasLegend", () => {
  it("covers the three weather layers and never satellite", () => {
    expect(hasLegend("temperature")).toBe(true);
    expect(hasLegend("rain")).toBe(true);
    expect(hasLegend("wind")).toBe(true);
    expect(hasLegend("satellite")).toBe(false);
  });
});

describe("normalizeRampStops", () => {
  it("reads a ColorRamp through getRawColorStops()", () => {
    expect(normalizeRampStops(fakeColorRamp(WIND_STOPS))).toHaveLength(3);
  });

  it("reads a plain array ramp too", () => {
    expect(normalizeRampStops(WIND_STOPS)).toHaveLength(3);
  });

  it("sorts by value and drops malformed stops", () => {
    const stops = normalizeRampStops([
      { value: 10, color: [1, 2, 3] },
      { value: NaN, color: [1, 2, 3] },
      { value: 0, color: [4, 5, 6] },
      { value: 5 },
      null,
    ]);
    expect(stops.map((s) => s.value)).toEqual([0, 10]);
  });

  it("returns an empty list for a layer with no ramp yet", () => {
    expect(normalizeRampStops(null)).toEqual([]);
    expect(normalizeRampStops(undefined)).toEqual([]);
  });
});

describe("buildLegend", () => {
  it("positions colours by their NATIVE value, so the bar matches the shader", () => {
    const legend = buildLegend({ stops: WIND_STOPS });
    expect(legend.stops.map((s) => s.pct)).toEqual([0, 50, 100]);
    expect(legend.gradient).toContain("rgba(68, 1, 84, 1) 0%");
    expect(legend.gradient).toContain("rgba(253, 231, 37, 1) 100%");
  });

  it("keeps a transparent stop transparent", () => {
    expect(buildLegend({ stops: RAIN_STOPS }).gradient).toContain("rgba(255, 255, 255, 0) 0%");
  });

  it("labels ticks from real stops, never interpolated values", () => {
    const legend = buildLegend({ stops: TEMPERATURE_STOPS, tickCount: 5 });
    const values = legend.ticks.map((tick) => tick.value);
    values.forEach((value) =>
      expect(TEMPERATURE_STOPS.some((stop) => stop.value === value)).toBe(true),
    );
    expect(legend.ticks[0].pct).toBe(0);
    expect(legend.ticks[legend.ticks.length - 1].pct).toBe(100);
  });

  it("returns null for a ramp that cannot describe a range", () => {
    expect(buildLegend({ stops: [] })).toBeNull();
    expect(buildLegend({ stops: [{ value: 5, color: [0, 0, 0] }] })).toBeNull();
    expect(
      buildLegend({
        stops: [
          { value: 5, color: [0, 0, 0] },
          { value: 5, color: [1, 1, 1] },
        ],
      }),
    ).toBeNull();
  });
});

describe("legendModel — units follow the user's settings", () => {
  it("temperature in °C", () => {
    const legend = legendModel("temperature", TEMPERATURE_STOPS);
    expect(legend.unit).toBe("°C");
    expect(legend.minLabel).toBe("-70");
    expect(legend.maxLabel).toBe("47");
  });

  it("temperature in °F once the unit changes", () => {
    state.unitTemp = "f";
    const legend = legendModel("temperature", TEMPERATURE_STOPS);
    expect(legend.unit).toBe("°F");
    expect(legend.minLabel).toBe("-94"); /* -70.15 °C */
    expect(legend.maxLabel).toBe("116"); /* 46.85 °C */
  });

  it("wind converts the ramp's m/s into the selected unit", () => {
    const kmh = legendModel("wind", WIND_STOPS);
    expect(kmh.unit).toBe("km/h");
    expect(kmh.maxLabel).toBe("144"); /* 40 m/s */

    state.unitWind = "ms";
    const ms = legendModel("wind", WIND_STOPS);
    expect(ms.unit).toBe("m/s");
    expect(ms.maxLabel).toBe("40");

    state.unitWind = "mph";
    const mph = legendModel("wind", WIND_STOPS);
    expect(mph.unit).toBe("mph");
    expect(mph.maxLabel).toBe("89"); /* 40 m/s */
  });

  it("rain follows the imperial/metric choice, in the provider's own units", () => {
    const metric = legendModel("rain", RAIN_STOPS);
    expect(metric.unit).toBe("mm/h");
    expect(metric.maxLabel).toBe("50");

    state.unitTemp = "f";
    const imperial = legendModel("rain", RAIN_STOPS);
    expect(imperial.unit).toBe("in/h");
    expect(imperial.maxLabel).toBe("1.97"); /* 50 mm/h */
  });

  it("keeps sub-millimetre precipitation readable instead of rounding it to 0", () => {
    const legend = legendModel("rain", [
      { value: 0, color: [0, 0, 0, 0] },
      { value: 0.1, color: [1, 1, 1, 255] },
      { value: 0.5, color: [2, 2, 2, 255] },
    ]);
    expect(legend.ticks.map((tick) => tick.label)).toContain("0.1");
  });

  it("has no model for satellite", () => {
    expect(legendModel("satellite", TEMPERATURE_STOPS)).toBeNull();
  });
});
