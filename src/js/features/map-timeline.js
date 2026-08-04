/* Forecast-time control for the active weather overlay.
 *
 * MapTiler weather layers are time-frame animations: `onAdd()` registers one
 * frame per keyframe returned by the provider's `weather/latest.json`, and the
 * layer exposes (all present in the installed @maptiler/weather 3.1.1):
 *
 *   getAnimationStart()  first frame time
 *   getAnimationEnd()    last frame time
 *   getAnimationTime()   currently displayed time
 *   setAnimationTime(t)  jump to a time, clamped to [start, end] internally
 *
 * All four speak UNIX SECONDS, not milliseconds — the SDK seeds the layer with
 * `+new Date() / 1000`. That is the single easiest thing to get wrong here, so
 * every conversion happens in this file and nowhere else.
 *
 * Changing the time is a synchronous property change on an already-added
 * layer: no layer is recreated, no source is re-added, and the map/style is
 * untouched. The only asynchronous part is waiting for the layer's data source
 * to exist at all, which the caller guards with its own staleness token.
 *
 * Pure logic with an injected `layer` and `now` — unit-testable against a
 * plain fake object. */

/* The three offsets the UI always offers, in hours. */
export const TIME_OFFSETS = [0, 3, 6];

const HOUR_SECONDS = 3600;

export function isSupportedOffset(hours) {
  return TIME_OFFSETS.includes(hours);
}

/* Anything unsupported resolves to "now" — never to a time with no control. */
export function normalizeOffset(hours) {
  const value = Number(hours);
  return isSupportedOffset(value) ? value : 0;
}

/* Layer time bounds in milliseconds, or null when the layer has no frames yet
   (still loading, or the provider returned nothing). */
export function layerTimeRange(layer) {
  if (!layer || typeof layer.getAnimationStart !== "function") return null;
  const start = layer.getAnimationStart();
  const end = layer.getAnimationEnd();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { startMs: start * 1000, endMs: end * 1000 };
}

/**
 * Point an already-added weather layer at `now + offsetHours`.
 *
 * @returns {object} always a status object, never throws:
 *   { available, offset, timeMs, requestedMs, clamped }
 *   - available:false → the layer has no time frames (loading or unsupported)
 *   - clamped:true    → the provider's forecast does not reach that far, so
 *                       the nearest available frame is shown instead
 */
export function applyLayerTime(layer, offsetHours, nowMs = Date.now()) {
  const offset = normalizeOffset(offsetHours);
  const requestedMs = nowMs + offset * HOUR_SECONDS * 1000;
  const range = layerTimeRange(layer);
  if (!range || typeof layer.setAnimationTime !== "function") {
    return { available: false, offset, timeMs: null, requestedMs, clamped: false };
  }

  const timeMs = Math.min(range.endMs, Math.max(range.startMs, requestedMs));
  /* setAnimationTime clamps internally too; passing the already-clamped value
     keeps what we report identical to what the layer displays. */
  layer.setAnimationTime(Math.round(timeMs / 1000));

  /* tolerate the second-rounding the SDK works in */
  const clamped = Math.abs(timeMs - requestedMs) > 1000;
  return { available: true, offset, timeMs, requestedMs, clamped };
}

/* Which offsets the currently-loaded frames can actually satisfy, so the UI
   can mark an out-of-range button rather than silently showing the same
   picture for two different times. */
export function availableOffsets(layer, nowMs = Date.now()) {
  const range = layerTimeRange(layer);
  if (!range) return [];
  return TIME_OFFSETS.filter((offset) => {
    const target = nowMs + offset * HOUR_SECONDS * 1000;
    return target >= range.startMs - 1000 && target <= range.endMs + 1000;
  });
}
