/* Turning a clicked coordinate into a selected location.
 *
 * The whole pipeline is one function so the ordering guarantees are visible
 * in one place:
 *
 *   1. a request token is taken BEFORE anything async starts;
 *   2. the panel shows a loading state immediately;
 *   3. the coordinate is reverse-geocoded through the existing geocoding
 *      service (MapTiler, keyless provider as fallback), which caches and
 *      deduplicates by coordinate — a second click on the same spot costs no
 *      request;
 *   4. the token is rechecked after every await, so a slower earlier click can
 *      never overwrite a faster later one;
 *   5. selectLocation() does the rest — weather, shared state, and the render
 *      fan-out that repaints the map panel — and carries its own token guard
 *      for the weather half.
 *
 * A coordinate with no recognised place (ocean, desert, polar ice) is not an
 * error: core/coord-location.js falls back to the best available geographical
 * name, and to the raw coordinate when there is not even that. A reverse
 * geocoder that actually FAILS (offline, provider down) is reported as a
 * translated, non-blocking notice — the weather still loads. */
import { t } from "../core/i18n.js";
import { createLatestOnly } from "../core/latest-only.js";
import { showToast } from "../ui/notifications.js";
import { showMapPanel, renderMapPanelLoading } from "../ui/render-map.js";
import { resolveCoordinateLocation } from "./coordinate-lookup.js";
import { selectLocation } from "./location.js";
import { setMapClickHandler } from "./map.js";

/* One runner for all coordinate selections, so click N+1 always invalidates
   click N — see core/latest-only.js. */
const runLatest = createLatestOnly();

/**
 * Select a coordinate: loading state → reverse geocode → weather → panel.
 * @returns {Promise<object|null>} the selected location, or null if a newer
 *          selection superseded this one at any point.
 */
export function selectCoordinate(lat, lon, { onLoading, onError, lookup } = {}) {
  return runLatest(async (isStale) => {
    onLoading?.(lat, lon);

    const { loc, geocodeFailed } = await resolveCoordinateLocation(lat, lon, { lookup });
    if (isStale()) return null;

    /* selectLocation carries its own token, so a superseded weather response
       cannot repaint either */
    await selectLocation(loc);
    if (isStale()) return null;

    if (geocodeFailed) onError?.(loc);
    return loc;
  });
}

/* Install the handler features/map.js calls on a genuine map click. Kept out
   of map.js itself so that module never imports the selection pipeline back
   (map → map-click → location → map would be a cycle). */
export function bindMapClickSelection() {
  setMapClickHandler(({ lat, lon }) => {
    selectCoordinate(lat, lon, {
      onLoading: (clickLat, clickLon) => {
        showMapPanel();
        renderMapPanelLoading(clickLat, clickLon);
      },
      /* non-blocking: the weather is already on screen under a coordinate
         label, this only explains why there is no place name */
      onError: () => showToast(t("mapClickGeoError")),
    });
  });
}
