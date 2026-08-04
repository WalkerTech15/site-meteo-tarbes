/* Weather-overlay legends, built from the layer's OWN color ramp.
 *
 * The colours and value ranges are never re-declared here. Each MapTiler
 * weather layer exposes `getColorRamp()` (TemperatureLayer, PrecipitationLayer
 * and WindLayer all implement it — see the installed @maptiler/weather 3.1.1
 * typings), which returns the exact ColorRamp the shader samples: an array of
 * `{ value, color: [r, g, b, a] }` stops in the layer's native unit. Reading
 * that is what guarantees the legend and the map agree — a hand-copied
 * gradient would silently drift the first time the provider retunes a ramp.
 *
 * Native units per layer, straight from the SDK:
 *   temperature  °C     (builtin TEMPERATURE_2 ramp)
 *   rain         mm/h   (builtin PRECIPITATION ramp)
 *   wind         m/s    (builtin VIRIDIS scaled to 0–40 m/s)
 *
 * Satellite has no weather data, so it deliberately has no legend.
 *
 * buildLegend() is pure — it takes an explicit converter and unit, so it is
 * unit-testable on plain stop arrays. legendModel() is the thin wrapper that
 * supplies those from the user's current unit settings. */
import {
  convTemp,
  tempUnit,
  convWind,
  windUnit,
  convPrecip,
  precipUnit,
  MS_TO_KMH,
} from "../core/units.js";

export const LEGEND_LAYERS = ["temperature", "rain", "wind"];

export function hasLegend(type) {
  return LEGEND_LAYERS.includes(type);
}

/* Readonly<ColorRamp> → plain, sorted, validated stops.
   ColorRamp extends Array, so it is iterable directly; getRawColorStops() is
   its documented accessor and is preferred when present. Anything malformed
   (a NaN value, a missing colour) is dropped rather than poisoning the
   gradient. */
export function normalizeRampStops(ramp) {
  if (!ramp) return [];
  const raw = typeof ramp.getRawColorStops === "function" ? ramp.getRawColorStops() : ramp;
  if (!raw || typeof raw.length !== "number") return [];
  return Array.from(raw)
    .filter((stop) => stop && Number.isFinite(stop.value) && Array.isArray(stop.color))
    .map((stop) => ({ value: stop.value, color: stop.color.slice(0, 4) }))
    .sort((a, b) => a.value - b.value);
}

function rgba([r, g, b, a = 255]) {
  const alpha = Math.round((a / 255) * 1000) / 1000;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/* Decimals that keep a tick readable without inventing precision. The scale's
   own span sets the base precision (a 120 °C range needs none, a 2 in/h range
   needs two), and a real-but-tiny value is then escalated to one significant
   digit so light drizzle never renders as a flat "0". */
function formatValue(value, span) {
  if (value === 0) return "0";
  const decimals = span < 2 ? 2 : span < 10 ? 1 : 0;
  const rounded = Number(value.toFixed(decimals));
  if (rounded !== 0) return String(rounded);
  return String(Number(value.toPrecision(1)));
}

/**
 * Pure legend builder.
 *
 * @param {object} options
 * @param {Array}  options.stops     normalized ramp stops, in the layer's native unit
 * @param {Function} options.convert native unit → display unit
 * @param {string} options.unit      display unit label ("°C", "mm/h", "km/h"…)
 * @param {number} options.tickCount how many labels to place along the bar
 * @returns {object|null} { unit, gradient, stops, ticks, min, max } or null if
 *          the ramp is unusable (no stops, or a zero-width range).
 */
export function buildLegend({ stops, convert = (v) => v, unit = "", tickCount = 5 } = {}) {
  const clean = Array.isArray(stops) ? stops.filter((s) => s && Number.isFinite(s.value)) : [];
  if (clean.length < 2) return null;

  const min = clean[0].value;
  const max = clean[clean.length - 1].value;
  if (!(max > min)) return null;

  /* Positions come from the NATIVE values, so each colour sits exactly where
     the shader puts it. Only the labels are converted. */
  const positioned = clean.map((stop) => ({
    pct: Math.round(((stop.value - min) / (max - min)) * 10000) / 100,
    color: rgba(stop.color),
    value: convert(stop.value),
  }));

  const gradient = `linear-gradient(to right, ${positioned
    .map((stop) => `${stop.color} ${stop.pct}%`)
    .join(", ")})`;

  const displayMin = convert(min);
  const displayMax = convert(max);
  const span = Math.abs(displayMax - displayMin);

  /* Ticks are drawn from REAL stops (nearest to each evenly-spaced position)
     rather than interpolated numbers, so every label names a colour that
     actually exists on the bar. */
  const wanted = Math.max(2, Math.min(tickCount, positioned.length));
  const ticks = [];
  for (let i = 0; i < wanted; i++) {
    const target = (i / (wanted - 1)) * 100;
    let best = positioned[0];
    for (const stop of positioned) {
      if (Math.abs(stop.pct - target) < Math.abs(best.pct - target)) best = stop;
    }
    if (!ticks.some((tick) => tick.pct === best.pct)) {
      ticks.push({ pct: best.pct, label: formatValue(best.value, span), value: best.value });
    }
  }

  return {
    unit,
    gradient,
    stops: positioned,
    ticks,
    min: displayMin,
    max: displayMax,
    minLabel: formatValue(displayMin, span),
    maxLabel: formatValue(displayMax, span),
  };
}

/* Native-unit → user-unit converters, one per weather layer. */
const CONVERTERS = {
  temperature: { convert: convTemp, unit: tempUnit },
  rain: { convert: convPrecip, unit: precipUnit },
  /* the ramp is metres per second; convWind() takes km/h */
  wind: { convert: (mps) => convWind(mps * MS_TO_KMH), unit: windUnit },
};

/**
 * Legend view-model for one layer type, in the user's current units.
 * Returns null for satellite (no weather data) or an unusable ramp.
 */
export function legendModel(type, stops, options = {}) {
  const converter = CONVERTERS[type];
  if (!converter) return null;
  const legend = buildLegend({
    stops,
    convert: converter.convert,
    unit: converter.unit(),
    ...options,
  });
  return legend && { ...legend, type };
}
