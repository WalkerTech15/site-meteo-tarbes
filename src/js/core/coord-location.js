/* Build a canonical WeatherSphere location object from a raw coordinate.
 *
 * Two callers share this: the "my location" widget (a browser geolocation fix)
 * and the map's click-to-select. Both start from a lat/lon plus whatever a
 * reverse geocoder could tell us about it, and both need the SAME honest
 * fallback when the coordinate has no recognised place name — an ocean, a
 * sea, a desert, Antarctica. When it looks like open water, core/marine-
 * regions.js names the ocean/sea instead — never a nearest-city label the
 * user never clicked on. Only when even that comes up empty (open desert,
 * a landmass gap in the approximate sea/ocean boxes) does the coordinate
 * itself become the name.
 *
 * Pure: no DOM, no network, no state — unit-testable directly. */
import { marineRegionByName, nearestMarineRegion } from "./marine-regions.js";

/* Same two-decimal form the geolocation card has always shown (~1.1 km). */
export function coordLabel(lat, lon) {
  return `${Number(lat).toFixed(2)}°, ${Number(lon).toFixed(2)}°`;
}

/* Accepts either a plain string or an already-localized {en, fr} pair, and
   always returns a {en, fr} pair — geocoders answer in one language at a time,
   so an unlocalized string is legitimately used for both. */
function localized(value, fallback = "") {
  if (value && typeof value === "object") {
    const en = value.en || value.fr || fallback;
    const fr = value.fr || value.en || fallback;
    return { en, fr };
  }
  const text = typeof value === "string" && value ? value : fallback;
  return { en: text, fr: text };
}

/* First non-empty of the localized candidates — used to decide whether the
   reverse geocoder gave us ANY usable geographical name before falling back
   to raw coordinates. */
function firstNamed(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const text = typeof candidate === "object" ? candidate.en || candidate.fr : candidate;
    if (text) return candidate;
  }
  return null;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {object} info  reverse-geocoding result: { name, region, country, cc,
 *                       kind, regionCode, bbox, geometry, fullName } — every
 *                       field optional, names may be strings or {en, fr}.
 * @param {object} opts  { idPrefix } — "geo-me" for a device fix, "map" for a
 *                       map click, so the two never collide in favorites.
 */
export function coordLocation(lat, lon, info = {}, { idPrefix = "map" } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  /* Ocean / unnamed coordinate: use the best available geographical name —
     the place, else its region, else its country. Only once the geocoder has
     truly given us nothing is a marine name inferred from the coordinate
     itself (never for a coordinate the geocoder already named — a real,
     however partial, geocoded name always wins over a guessed body of
     water), and only once THAT also comes up empty do the raw coordinates
     become the name. */
  const named = firstNamed(info.name, info.region, info.country);
  /* Two independent ways to conclude "this is water", in priority order.
     BY NAME first: the geocoder answered with a name that IS a known body of
     water ("Pacific Ocean", "Mer Méditerranée"). That is direct evidence, so
     it outranks the coordinate guess and — unlike it — is also allowed to
     override a provider name, because it IS the provider's own name, just
     recognised for what it is. Without this the result kept whatever kind
     the provider's place_type mapped to, which for an unrecognised marine
     type is "city": an ocean labelled "City / Ville", searched on Pexels as
     a cityscape.
     BY COORDINATE second, and still only when the geocoder gave no name at
     all — the long-standing rule that a real geocoded name (an island, a
     rig) always beats a guessed body of water. */
  const namedMarine = marineRegionByName(named);
  const marine = namedMarine || (named ? null : nearestMarineRegion(latitude, longitude));
  /* `marine` also carries a `kind` (ocean/sea/gulf/bay/strait/lake) — kept
     out of the name pair, which is strictly {en, fr}, and surfaced as
     `waterKind` below instead. A recognised water body uses the table's own
     bilingual pair rather than the provider's single-language text, so the
     French UI says "Océan Pacifique" even when the lookup answered in
     English. */
  const name = marine
    ? { en: marine.en, fr: marine.fr }
    : named
      ? localized(named, coordLabel(latitude, longitude))
      : localized(null, coordLabel(latitude, longitude));

  return {
    /* Coordinate-derived id, not a constant: favorites are matched by id
       alone, so two different clicks must produce two different entries.
       Four decimals ≈ 11 m. */
    id: `${idPrefix}-${latitude.toFixed(4)},${longitude.toFixed(4)}`,
    /* "ocean" is the single kind every marine branch in the app keys off
       (photo query, relevance filter, flags, kind label), so a body of water
       gets it whatever the provider called the feature — `waterKind` below
       carries the finer distinction. */
    kind: marine ? "ocean" : info.kind || "city",
    /* The finer classification, when the coordinate was identified as open
       water. `kind` deliberately stays "ocean" — every marine branch in the
       app keys off it (see isMarineKind in services/photo-relevance.js) —
       while `waterKind` carries the distinction the UI and the photo query
       actually need: a lake is not a sea, and a gulf photographs
       differently from open ocean. Absent for a land location. */
    waterKind: marine ? marine.kind : null,
    /* An ocean or sea belongs to no country, so a territorial-waters country
       code the provider may have attached is dropped: keeping it would draw
       a national flag beside "Pacific Ocean" (see locCountryFlagHtml). */
    cc: marine ? "" : (info.cc || "").toUpperCase(),
    flag: "📍",
    lat: latitude,
    lon: longitude,
    name,
    /* never repeat the place name as its own region/country — and a body of
       water sits in neither, so both stay empty for a marine result */
    region: !marine && named === info.name ? localized(info.region) : { en: "", fr: "" },
    country: marine ? { en: "", fr: "" } : localized(info.country),
    landmark: null,
    aliases: [],
    /* a cooler, water-toned gradient behind the fallback/loading state —
       see services/photo-api.js gradBg() — while a real (or no) Pexels
       photo for the ocean/sea loads */
    grad: marine ? ["#0EA5E9", "#0C4A6E"] : ["#3B82F6", "#1E40AF"],
    dynamic: true,
    regionCode: info.regionCode || "",
    bbox: Array.isArray(info.bbox) && info.bbox.length === 4 ? info.bbox : null,
    geometry: ["Polygon", "MultiPolygon"].includes(info.geometry?.type) ? info.geometry : null,
    /* true when nothing but the coordinate could be resolved — false for a
       marine name too, since that is now a real (if approximate) place
       name, not the coordinate standing in for one */
    coordsOnly: !named && !marine,
  };
}
