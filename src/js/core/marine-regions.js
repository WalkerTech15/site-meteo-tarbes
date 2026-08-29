/* Approximate ocean/sea/lake identification for a coordinate that reverse
 * geocoding could not name at all — the "open water" fallback for map clicks
 * and geolocation fixes (see core/coord-location.js). Without this, such a
 * point falls back to its raw "12.34°, -56.78°" label, which is honest but
 * useless for choosing a photo query or a human-readable place name.
 *
 * WHY BOUNDING BOXES, NOT AN AUTHORITATIVE DATASET
 * The authoritative limits are the IHO's "Limits of Oceans and Seas"
 * (Special Publication S-23), published as polygons by marineregions.org.
 * The boxes below are read off those published limits, but the polygons
 * themselves are not shipped: the IHO Sea Areas GeoJSON is tens of
 * megabytes, and a hosted lookup would put a third-party GIS call on the
 * critical path of every unnamed map click. Neither is proportionate for a
 * school weather app whose only question is "roughly which body of water is
 * this". These are a deliberate approximation of an authoritative source,
 * not invented numbers.
 *
 * THE SAFETY RULE — UNDER-NAME RATHER THAN OVER-NAME
 * Named waters are checked FIRST, then a set of deliberately generous
 * continent boxes; a point inside a continent that no water box claimed
 * returns null, so a coordinate that failed to geocode over LAND (a
 * provider outage, a sparsely-mapped area) is never relabelled as water.
 * That ordering is what makes an enclosed sea nameable at all — the
 * Mediterranean sits entirely inside the Europe/Africa boxes — so every
 * water box has to earn its place by being overwhelmingly water at its own
 * extent. Boxes are therefore trimmed AWAY from inhabited coastline, and
 * several real seas are deliberately absent (the English Channel, the Irish
 * and Celtic Seas, the Bay of Biscay, the Gulf of California, the Gulf of
 * St. Lawrence): each is so narrow relative to the land around it that no
 * rectangle covers the water without also covering towns, and a neutral
 * "48.86°, 2.35°" is a better answer than a confidently wrong one.
 *
 * The known residual cost is that a few genuinely inland points share a
 * sea's latitude band — southwest France sits at Mediterranean latitudes
 * but on the Atlantic side, so an unnamed coordinate there resolves to
 * "Mediterranean Sea". Fixing that needs real polygons, not a tighter
 * rectangle. marine-regions.test.js pins the tradeoff.
 *
 * Pure, dependency-free, unit-testable on plain numbers. */

/* [west, south, east, north]. West > east means the box crosses the
 * antimeridian (mirrors the GeoJSON bbox convention used elsewhere in this
 * codebase — see core/geo-bounds.js).
 */
function inBox(lat, lon, [west, south, east, north]) {
  if (lat < south || lat > north) return false;
  return west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
}

/* The kinds a water body can be reported as. `ocean` and `sea` share the
 * app's existing "Ocean / Sea" label; `lake` is the distinction that
 * genuinely needed making, since calling Lake Baikal a sea is simply wrong.
 * Gulfs, bays and straits are arms of the sea and share its label, but stay
 * distinct here because the photo pipeline phrases their image search
 * differently (see WATER_QUERY_SUFFIX in services/photo-api.js). */
export const WATER_KINDS = ["ocean", "sea", "gulf", "bay", "strait", "lake"];

/* [english, french, bbox, kind]. FIRST match wins, so a smaller water body
 * nested inside a larger one is listed above it (the Adriatic before the
 * Mediterranean, the Gulf of Carpentaria before the Arafura Sea). Grouping
 * is by region, for readability only. */
const WATERS = [
  /* Enclosed European / west-Asian waters.

     The Mediterranean's own sub-seas (Adriatic, Aegean, Ionian, Tyrrhenian)
     are deliberately NOT listed. They would all report kind "sea" exactly as
     the basin does, so they buy name precision only — while their boxes
     overlap both each other and the basin badly enough at this resolution to
     move well-known points onto a different answer (12°E at 40°N is Rome's
     longitude, not the Adriatic). The basin is the stable, defensible
     answer; splitting it needs polygons. */
  ["Mediterranean Sea", "Mer Méditerranée", [-6, 30, 36, 46], "sea"],
  ["Black Sea", "Mer Noire", [27, 40, 42, 47], "sea"],
  ["Caspian Sea", "Mer Caspienne", [46, 36, 55, 47], "sea"],
  /* West edge at 12°E, not 9°E: the wider box reached across the whole
     Scandinavian peninsula and named Oslo and Trondheim — both on the
     Atlantic side — as the Baltic. The cost is that the Skagerrak and
     Kattegat now fall through to a neutral coordinate instead, which is the
     right trade under this file's under-name rule. */
  ["Baltic Sea", "Mer Baltique", [12, 53.5, 30, 66], "sea"],
  ["North Sea", "Mer du Nord", [-4, 51, 9, 62], "sea"],
  ["Red Sea", "Mer Rouge", [32, 12, 44, 30], "sea"],
  ["Persian Gulf", "Golfe Persique", [48, 24, 56, 30], "gulf"],
  ["Gulf of Oman", "Golfe d'Oman", [56, 22, 62, 27], "gulf"],
  ["Gulf of Aden", "Golfe d'Aden", [43, 10, 52, 15], "gulf"],

  /* Large lakes. Each box is drawn tight to the shoreline: a lake lies
     wholly inside a continent box, so a generous one would rename the towns
     around it. Every name carries "Lake"/"Lac", which is why the distinct
     `lake` kind reads correctly in the UI. */
  ["Lake Superior", "Lac Supérieur", [-92, 46.5, -84.5, 49], "lake"],
  ["Lake Michigan", "Lac Michigan", [-88, 41.7, -85, 46], "lake"],
  ["Lake Huron", "Lac Huron", [-84.5, 43.1, -79.8, 46.3], "lake"],
  ["Lake Erie", "Lac Érié", [-83.4, 41.4, -78.9, 42.8], "lake"],
  ["Lake Ontario", "Lac Ontario", [-79.8, 43.3, -76.2, 44.2], "lake"],
  ["Great Bear Lake", "Grand lac de l'Ours", [-125, 65, -117, 67], "lake"],
  ["Great Slave Lake", "Grand lac des Esclaves", [-116, 61, -109.5, 62.9], "lake"],
  ["Great Salt Lake", "Grand Lac Salé", [-113.1, 40.7, -112, 41.7], "lake"],
  ["Lake Baikal", "Lac Baïkal", [103.7, 51.5, 110, 55.8], "lake"],
  ["Lake Ladoga", "Lac Ladoga", [30, 60.1, 32.8, 61.6], "lake"],
  ["Lake Balkhash", "Lac Balkhach", [73.5, 45, 79, 46.8], "lake"],
  ["Lake Victoria", "Lac Victoria", [31.7, -2.9, 34.8, 0.4], "lake"],
  ["Lake Tanganyika", "Lac Tanganyika", [29.1, -8.8, 31.2, -3.4], "lake"],
  ["Lake Titicaca", "Lac Titicaca", [-70, -16.5, -68.6, -15.3], "lake"],

  /* Arctic. Southern edges are pulled well north of the inhabited coast —
     Murmansk, Tiksi and Utqiaġvik must all fall OUTSIDE these boxes. */
  ["Greenland Sea", "Mer du Groenland", [-20, 70, 10, 79], "sea"],
  ["Norwegian Sea", "Mer de Norvège", [-8, 62, 10, 72], "sea"],
  ["Barents Sea", "Mer de Barents", [20, 70, 60, 80], "sea"],
  ["Kara Sea", "Mer de Kara", [60, 71, 100, 80], "sea"],
  ["Laptev Sea", "Mer de Laptev", [100, 73, 140, 81], "sea"],
  ["East Siberian Sea", "Mer de Sibérie orientale", [140, 71, 180, 77], "sea"],
  ["Chukchi Sea", "Mer des Tchouktches", [-180, 68, -158, 72], "sea"],
  ["Beaufort Sea", "Mer de Beaufort", [-150, 70, -120, 76], "sea"],
  ["Baffin Bay", "Baie de Baffin", [-70, 71, -56, 77], "bay"],
  ["Labrador Sea", "Mer du Labrador", [-58, 52, -44, 63], "sea"],

  /* Americas */
  ["Hudson Bay", "Baie d'Hudson", [-95, 51, -75, 70], "bay"],
  ["Gulf of Mexico", "Golfe du Mexique", [-98, 18, -80, 31], "gulf"],
  ["Caribbean Sea", "Mer des Caraïbes", [-89, 8, -60, 22], "sea"],

  /* East and south-east Asia — narrower seas before the basins they open
     into (Sulu and Java before the South China Sea). */
  ["Gulf of Thailand", "Golfe de Thaïlande", [99, 6, 105, 14], "gulf"],
  ["Sulu Sea", "Mer de Sulu", [117, 5, 123, 12], "sea"],
  ["Celebes Sea", "Mer de Célèbes", [117, 0, 125, 7], "sea"],
  ["Java Sea", "Mer de Java", [105, -7, 116, -2], "sea"],
  ["Banda Sea", "Mer de Banda", [123, -8, 133, -3], "sea"],
  ["South China Sea", "Mer de Chine méridionale", [105, -3, 121, 23], "sea"],
  ["Philippine Sea", "Mer des Philippines", [125, 5, 145, 25], "sea"],
  ["East China Sea", "Mer de Chine orientale", [121, 24, 131, 33], "sea"],
  ["Yellow Sea", "Mer Jaune", [117, 32, 127, 41], "sea"],
  ["Sea of Japan", "Mer du Japon", [127, 34, 142, 52], "sea"],
  ["Sea of Okhotsk", "Mer d'Okhotsk", [135, 43, 165, 62], "sea"],
  ["Bering Sea", "Mer de Béring", [163, 52, -157, 66], "sea"],
  ["Gulf of Alaska", "Golfe d'Alaska", [-158, 52, -135, 60], "gulf"],

  /* Indian Ocean rim — Andaman before the Bay of Bengal they overlap in */
  ["Andaman Sea", "Mer d'Andaman", [92, 5, 99, 18], "sea"],
  ["Bay of Bengal", "Golfe du Bengale", [80, 5, 95, 22], "bay"],
  ["Arabian Sea", "Mer d'Arabie", [50, 5, 78, 25], "sea"],

  /* Australasia — Carpentaria before Arafura */
  ["Gulf of Carpentaria", "Golfe de Carpentarie", [135, -18, 142, -10], "gulf"],
  ["Arafura Sea", "Mer d'Arafura", [130, -12, 142, -3], "sea"],
  ["Timor Sea", "Mer de Timor", [124, -14, 132, -8], "sea"],
  ["Great Australian Bight", "Grande Baie australienne", [118, -40, 135, -32], "bay"],
  ["Tasman Sea", "Mer de Tasman", [149, -46, 174, -30], "sea"],
  ["Coral Sea", "Mer de Corail", [142, -25, 170, -8], "sea"],

  /* Africa and the Southern Ocean */
  ["Gulf of Guinea", "Golfe de Guinée", [-10, -5, 10, 5], "gulf"],
  ["Weddell Sea", "Mer de Weddell", [-60, -78, -10, -64], "sea"],
  ["Scotia Sea", "Mer de Scotia", [-60, -60, -40, -52], "sea"],
  ["Ross Sea", "Mer de Ross", [160, -78, -150, -70], "sea"],
];

/* Rough, generous landmass extents — deliberately wider than the true
 * coastline (see the header: this trades away a few real coastal-water
 * points to guarantee land is never called water). Order doesn't matter;
 * any single match means "unnamed", unless a water box above already
 * claimed the point. */
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

/* The five open oceans, named separately from WATERS because they are the
 * coordinate fallback rather than boxes — and because the by-name lookup
 * below has to recognise them too. */
const OCEANS = [
  ["Arctic Ocean", "Océan Arctique"],
  ["Southern Ocean", "Océan Austral"],
  ["Atlantic Ocean", "Océan Atlantique"],
  ["Indian Ocean", "Océan Indien"],
  ["Pacific Ocean", "Océan Pacifique"],
];
const ocean = (i) => ({ en: OCEANS[i][0], fr: OCEANS[i][1], kind: "ocean" });

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {{en: string, fr: string, kind: string} | null} the water body's
 *   name in both interface languages plus its kind (one of WATER_KINDS), or
 *   null if the coordinate looks like land — or the classification is
 *   otherwise not confident enough to guess. Callers keep their existing
 *   raw-coordinate fallback in that case.
 */
export function nearestMarineRegion(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  for (const [en, fr, bbox, kind] of WATERS) {
    if (inBox(lat, lon, bbox)) return { en, fr, kind };
  }
  if (LANDMASSES.some((bbox) => inBox(lat, lon, bbox))) return null;

  if (lat >= 66) return ocean(0);
  if (lat <= -60) return ocean(1);
  if (lon >= -70 && lon <= 20) return ocean(2);
  if (lon > 20 && lon <= 147) return ocean(3);
  return ocean(4);
}

/* Diacritic- and case-insensitive, punctuation-tolerant. Deliberately local
   rather than reusing data/locations.js normalize(): this module is pure and
   dependency-free by design (see the header), and the comparison here only
   ever runs against the fixed table below. */
function normalizeWaterName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* name (either language) → the water body, built once from the same tables
   nearestMarineRegion() uses, so the two can never disagree. */
const WATERS_BY_NAME = new Map();
for (const [en, fr, , kind] of WATERS) {
  WATERS_BY_NAME.set(normalizeWaterName(en), { en, fr, kind });
  WATERS_BY_NAME.set(normalizeWaterName(fr), { en, fr, kind });
}
for (const [en, fr] of OCEANS) {
  const entry = { en, fr, kind: "ocean" };
  WATERS_BY_NAME.set(normalizeWaterName(en), entry);
  WATERS_BY_NAME.set(normalizeWaterName(fr), entry);
}

/**
 * Identify a body of water from a NAME rather than a coordinate.
 *
 * This is what lets a water body that a geocoder *did* name — a search for
 * "Pacific Ocean", or a reverse lookup that answered "Mer Méditerranée" —
 * be classified as marine. Without it such a result keeps whatever kind the
 * provider's place_type mapped to, which for an unrecognised marine type is
 * "city" (services/geocoding-api.js MT_KIND) — so the app would label an
 * ocean "City / Ville" and search Pexels for a cityscape.
 *
 * Exact whole-name matching only, in either interface language. Substring
 * matching is deliberately NOT used: "Bay City" and "Oceanside" are towns,
 * and a photo query built from the wrong classification is exactly the bug
 * this prevents.
 *
 * @param {string | {en?: string, fr?: string}} name
 * @returns {{en: string, fr: string, kind: string} | null}
 */
export function marineRegionByName(name) {
  if (!name) return null;
  const candidates = typeof name === "object" ? [name.en, name.fr] : [name];
  for (const candidate of candidates) {
    const hit = WATERS_BY_NAME.get(normalizeWaterName(candidate));
    if (hit) return hit;
  }
  return null;
}
