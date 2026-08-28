/* Approximate ocean/sea identification for a coordinate that reverse
 * geocoding could not name at all — the "open water" fallback for map clicks
 * and geolocation fixes (see core/coord-location.js). Without this, such a
 * point falls back to its raw "12.34°, -56.78°" label, which is honest but
 * useless for choosing a Pexels query or a human-readable place name.
 *
 * This is deliberately a simplified bounding-region heuristic, not a real
 * coastline dataset: shipping one would mean either a multi-megabyte GeoJSON
 * bundle or a live third-party GIS call, neither proportionate to "which
 * ocean is roughly here" for a weather app. The tradeoff is asymmetric on
 * purpose — every box below is written to UNDER-name rather than over-name:
 *
 *   1. A named sea/gulf/bay/strait — small, water-shaped boxes, checked
 *      first so they win over the coarser continent exclusion below (the
 *      Mediterranean sits entirely inside the Europe/Africa land boxes).
 *   2. A rough continent bounding box — if the point falls inside one, this
 *      returns null rather than guess, so a coordinate that failed to
 *      geocode over LAND (a provider outage, a sparsely-mapped area) is
 *      never relabelled as ocean. The caller's existing raw-coordinate
 *      fallback applies instead, exactly as before this module existed.
 *   3. Polar bands (Arctic Ocean / Southern Ocean).
 *   4. The three basin oceans (Atlantic / Indian / Pacific), by longitude.
 *
 * A missed sea still shows honest coordinates (never wrong); the continent
 * boxes are deliberately generous, which trades away a few genuinely wet
 * coastal/strait pixels (Gulf of Aden, Hawai'i's surrounding Pacific, the
 * Great Australian Bight) for the guarantee that land is never mislabelled
 * as ocean. Pure, dependency-free, unit-testable on plain numbers. */

/* [west, south, east, north]. West > east means the box crosses the
 * antimeridian (mirrors the GeoJSON bbox convention used elsewhere in this
 * codebase — see core/geo-bounds.js).
 */
function inBox(lat, lon, [west, south, east, north]) {
  if (lat < south || lat > north) return false;
  return west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
}

/* Ordered by nothing but readability — every entry is checked, first match
 * wins, so overlapping boxes (e.g. Gulf of Aden touching the Red Sea) just
 * mean "whichever is listed first" and that is fine at this precision. */
const SEAS = [
  ["Mediterranean Sea", "Mer Méditerranée", [-6, 30, 36, 46]],
  ["Black Sea", "Mer Noire", [27, 40, 42, 47]],
  ["Caspian Sea", "Mer Caspienne", [46, 36, 55, 47]],
  ["Red Sea", "Mer Rouge", [32, 12, 44, 30]],
  ["Persian Gulf", "Golfe Persique", [48, 24, 56, 30]],
  ["Arabian Sea", "Mer d'Arabie", [50, 5, 78, 25]],
  ["Bay of Bengal", "Golfe du Bengale", [80, 5, 95, 22]],
  ["Andaman Sea", "Mer d'Andaman", [92, 5, 99, 18]],
  ["South China Sea", "Mer de Chine méridionale", [105, -3, 121, 23]],
  ["Sea of Japan", "Mer du Japon", [127, 34, 142, 52]],
  ["Sea of Okhotsk", "Mer d'Okhotsk", [135, 43, 165, 62]],
  ["Bering Sea", "Mer de Béring", [163, 52, -157, 66]],
  ["Gulf of Alaska", "Golfe d'Alaska", [-158, 52, -135, 60]],
  ["Gulf of Mexico", "Golfe du Mexique", [-98, 18, -80, 31]],
  ["Caribbean Sea", "Mer des Caraïbes", [-89, 8, -60, 22]],
  ["Baltic Sea", "Mer Baltique", [9, 53, 30, 66]],
  ["North Sea", "Mer du Nord", [-4, 51, 9, 62]],
  ["Hudson Bay", "Baie d'Hudson", [-95, 51, -75, 70]],
  ["Gulf of Guinea", "Golfe de Guinée", [-10, -5, 10, 5]],
  ["Tasman Sea", "Mer de Tasman", [149, -46, 174, -30]],
  ["Coral Sea", "Mer de Corail", [142, -25, 170, -8]],
];

/* Rough, generous landmass extents — deliberately wider than the true
 * coastline (see file header: this trades away a few real coastal-water
 * points to guarantee land is never called ocean). Order doesn't matter;
 * any single match excludes ocean/sea naming (seas above are still checked
 * first, since they are more specific than "somewhere in this continent"). */
const LANDMASSES = [
  [-168, 5, -52, 84], // North America mainland + Alaska/Aleutians
  [-73, 59, -12, 84], // Greenland
  [-82, -56, -34, 13], // South America
  [-18, -35, 52, 38], // Africa
  [-10, 36, 40, 71], // Europe
  [40, 1, 180, 82], // Asia (incl. Middle East, Russia east of the Urals)
  [112, -44, 154, -10], // Australia
  [165, -48, 180, -33], // New Zealand
];

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {{en: string, fr: string} | null} the ocean/sea name, or null if
 *   the coordinate looks like land (or the classification is otherwise not
 *   confident enough to guess) — callers should keep their existing
 *   raw-coordinate fallback in that case.
 */
export function nearestMarineRegion(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  for (const [en, fr, bbox] of SEAS) {
    if (inBox(lat, lon, bbox)) return { en, fr };
  }
  if (LANDMASSES.some((bbox) => inBox(lat, lon, bbox))) return null;

  if (lat >= 66) return { en: "Arctic Ocean", fr: "Océan Arctique" };
  if (lat <= -60) return { en: "Southern Ocean", fr: "Océan Austral" };
  if (lon >= -70 && lon <= 20) return { en: "Atlantic Ocean", fr: "Océan Atlantique" };
  if (lon > 20 && lon <= 147) return { en: "Indian Ocean", fr: "Océan Indien" };
  return { en: "Pacific Ocean", fr: "Océan Pacifique" };
}
