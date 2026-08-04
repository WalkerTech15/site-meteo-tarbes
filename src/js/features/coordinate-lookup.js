/* Coordinate → location, with the honest fallbacks.
 *
 * Split out of features/map-click.js so it can be unit-tested on its own: this
 * half touches no DOM and no map, only the existing geocoding service and
 * core/coord-location.js. The reverse lookup is cached and deduplicated by
 * coordinate inside services/geocoding-api.js, so clicking around the same
 * spot does not repeat requests.
 *
 * Never throws. A provider failure and an empty result are different things
 * and are reported separately:
 *   - empty result  → open ocean or an unnamed place; `coordsOnly` is set and
 *                     the coordinate becomes the name.
 *   - failure       → `geocodeFailed`; the caller shows a translated,
 *                     non-blocking notice while the weather still loads. */
import { coordLocation } from "../core/coord-location.js";
import { reverseGeocodeLocation } from "../services/geocoding-api.js";

export async function resolveCoordinateLocation(
  lat,
  lon,
  { lookup = reverseGeocodeLocation } = {},
) {
  let info = null;
  let geocodeFailed = false;
  try {
    info = await lookup(lat, lon);
  } catch {
    geocodeFailed = true;
  }
  return {
    loc: coordLocation(lat, lon, info || {}, { idPrefix: "map" }),
    geocodeFailed,
  };
}
