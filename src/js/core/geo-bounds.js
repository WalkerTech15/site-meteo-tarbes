/* Bounding-box validation and normalization for camera framing.
 *
 * Geocoders return a `bbox` for administrative areas (countries, states,
 * provinces, regions). It is used ONLY to frame the camera — never drawn as
 * if it were the real border, which is what features/map.js's polygon-only
 * selection layer is for.
 *
 * Two real-world cases this guards against:
 *
 * 1. Antimeridian crossing. The GeoJSON convention writes a crossing box with
 *    west > east (e.g. Fiji: west 177, east -178). Adding 360° to the eastern
 *    edge turns that back into a continuous span MapLibre can frame.
 * 2. A degenerate "whole planet" box. Some providers describe Alaska (and
 *    other territories straddling ±180°) as west -179.15 / east 179.77 —
 *    technically 359° wide, which would zoom the map out to the entire world
 *    and show the user nothing. The true extent is unrecoverable from those
 *    four numbers, so such a box is rejected and the caller falls back to the
 *    feature's own point + type-based zoom.
 *
 * Pure functions, no SDK types — unit-testable on plain arrays. */

/* Web Mercator cannot represent the poles; MapLibre clamps here too. */
export const MAX_LAT = 85.0511;

/* Beyond this longitude span a box tells us nothing useful about where the
   place actually is (see case 2 above). */
const MAX_USEFUL_LON_SPAN = 180;

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

export function clampLat(lat) {
  return Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
}

/* Longitude wrapped into [-180, 180]. Values already in range are returned
   untouched: running them through the modulo arithmetic would introduce
   floating-point drift (-5.2 → -5.2000000000000455) for no reason. */
export function wrapLon(lon) {
  if (lon >= -180 && lon <= 180) return lon;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  /* keep exactly 180 rather than flipping it to -180 */
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

/* [west, south, east, north] → [[west, south], [east, north]] for
   map.cameraForBounds(), or null when the box is unusable. The eastern
   longitude may exceed 180° for a genuine antimeridian span; MapLibre accepts
   that and wraps the resulting centre itself. */
export function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(finite)) return null;

  const [rawWest, rawSouth, rawEast, rawNorth] = bbox;
  const south = clampLat(Math.min(rawSouth, rawNorth));
  const north = clampLat(Math.max(rawSouth, rawNorth));
  if (north <= south) return null; /* zero-height or inverted beyond repair */

  let west = wrapLon(rawWest);
  let east = wrapLon(rawEast);
  /* west > east is the GeoJSON way of writing "this crosses the antimeridian" */
  if (east < west) east += 360;
  if (east === west) return null;
  if (east - west > MAX_USEFUL_LON_SPAN) return null; /* degenerate, see case 2 */

  return [
    [west, south],
    [east, north],
  ];
}

/* Convenience predicate for callers that only need the yes/no answer. */
export function isUsableBbox(bbox) {
  return normalizeBbox(bbox) !== null;
}
