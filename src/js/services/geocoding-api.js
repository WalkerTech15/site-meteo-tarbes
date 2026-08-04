/* Forward + reverse geocoding: keyless Open-Meteo fallback, MapTiler global
   search/reverse (same key as the map), and a keyless BigDataCloud reverse
   provider for when no MapTiler key is configured. Returns loc objects
   shaped like the curated data/locations.js entries so the rest of the
   pipeline (search, favorites, map) doesn't need to know where a result
   came from. Duplicate names (Paris FR / TX / ON) are told apart by region +
   country from the feature's own context — never by guessing from the query
   text. */
import { state } from "../core/state.js";
import { normalize } from "../data/locations.js";
import {
  MAPTILER_KEY,
  FETCH_TIMEOUT_MS,
  GEOCODE_FALLBACK_TIMEOUT_MS,
  MAPTILER_SEARCH_CACHE_MAX,
  REVERSE_GEOCODE_TTL_MS,
} from "../core/config.js";
import { createBoundedCache, createAsyncCache } from "./cache.js";

/* Geocoding fallback for places outside the curated set */
export async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=${state.lang}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(GEOCODE_FALLBACK_TIMEOUT_MS) });
  if (!res.ok) return [];
  const d = await res.json();
  return (d.results || []).map((r) => ({
    id: "geo-" + r.id,
    kind: "city",
    flag: "📍",
    cc: (r.country_code || "").toUpperCase(),
    lat: r.latitude,
    lon: r.longitude,
    name: { en: r.name, fr: r.name },
    region: { en: r.admin1 || "", fr: r.admin1 || "" },
    country: { en: r.country || "", fr: r.country || "" },
    landmark: null,
    aliases: [],
    grad: ["#3B82F6", "#1E40AF"],
    dynamic: true,
  }));
}

/* MapTiler place_type → our kind + fallback zoom (used only when no bbox). */
const MT_KIND = {
  country: { kind: "country", zoom: 5 },
  region: { kind: "region", zoom: 6 },
  subregion: { kind: "region", zoom: 7 },
  county: { kind: "region", zoom: 7 },
  municipal_district: { kind: "region", zoom: 7 },
  joint_municipality: { kind: "city", zoom: 11 },
  municipality: { kind: "city", zoom: 11 },
  place: { kind: "city", zoom: 11 },
  locality: { kind: "village", zoom: 13 },
  neighbourhood: { kind: "village", zoom: 13 },
  postal_code: { kind: "address", zoom: 14 },
  address: { kind: "address", zoom: 16 },
  poi: { kind: "poi", zoom: 16 },
};

function ccFromFeature(f) {
  const p = f.properties || {};
  if (p.country_code) return String(p.country_code).toUpperCase();
  const ctx = (f.context || []).find((c) => String(c.id || "").startsWith("country"));
  if (ctx) {
    if (ctx.country_code) return String(ctx.country_code).toUpperCase();
    if (ctx.short_code) return String(ctx.short_code).toUpperCase();
  }
  if (String(f.id || "").startsWith("country") && (p.short_code || p["short_code"]))
    return String(p.short_code).toUpperCase();
  return "";
}

/* The two interface languages, requested together so a country/state/region
   carries BOTH its English and French name in one response. That is what lets
   a selected administrative area stay correctly named when the user switches
   language, without a second round trip — and the plain `text` fallback keeps
   the local name whenever the provider has no translation for that tier. */
export const GEOCODE_LANGS = ["en", "fr"];

/* MapTiler returns `text_<lang>` / `place_name_<lang>` alongside `text` when
   the request asked for several languages. */
function localizedText(feature) {
  const base = (feature && feature.text) || "";
  const out = {};
  for (const lang of GEOCODE_LANGS) out[lang] = (feature && feature[`text_${lang}`]) || base;
  return out;
}

const EMPTY_TEXT = { en: "", fr: "" };
const hasText = (value) => Boolean(value && (value.en || value.fr));

/* Convert one MapTiler GeoJSON feature into a WeatherSphere loc object. */
function featureToLoc(f) {
  const primary = (f.place_type && f.place_type[0]) || "place";
  const map = MT_KIND[primary] || { kind: "city", zoom: 11 };
  const ctx = f.context || [];
  const pick = (pfx) => {
    const c = ctx.find((x) => String(x.id || "").startsWith(pfx));
    return c ? localizedText(c) : null;
  };
  const region = pick("region") || pick("subregion") || pick("county") || EMPTY_TEXT;
  const countryCtx = pick("country");
  const country = countryCtx || (map.kind === "country" ? localizedText(f) : EMPTY_TEXT);
  const fallbackName = f.text || (f.place_name || "").split(",")[0];
  const name = hasText(localizedText(f))
    ? localizedText(f)
    : { en: fallbackName, fr: fallbackName };
  /* ISO 3166-2 region code (e.g. "US-TX") from the region context entry, or the
     feature itself when it IS a state/province — the surest region signal. */
  const regionCtx = ctx.find((x) => String(x.id || "").startsWith("region"));
  const regionCode =
    (regionCtx && regionCtx.short_code) || (f.properties && f.properties.short_code) || "";
  /* Most MapTiler geocoder results are points, but keep a genuine area
     geometry when a provider supplies one. The map can then outline the real
     administrative shape instead of pretending the result's bbox is a
     boundary. */
  const geometry = ["Polygon", "MultiPolygon"].includes(f.geometry?.type) ? f.geometry : null;
  return {
    id: "mt-" + (f.id || `${f.center[0]},${f.center[1]}`),
    kind: map.kind,
    cc: ccFromFeature(f),
    flag: "📍",
    lat: f.center[1],
    lon: f.center[0],
    name,
    region,
    country,
    landmark: null,
    aliases: [],
    grad: ["#3B82F6", "#1E40AF"],
    dynamic: true,
    bbox: Array.isArray(f.bbox) && f.bbox.length === 4 ? f.bbox : null,
    geometry,
    fullName: f[`place_name_${state.lang}`] || f.place_name || name.en || name.fr,
    placeType: primary,
    _zoom: map.zoom,
    regionCode,
  };
}

/* Exported for the reverse-geocoding tests, which check the multi-language and
   administrative-shape handling on real provider payload shapes. */
export { featureToLoc as __featureToLoc };

/* Both interface languages, the active one first so MapTiler still ranks
   results for the language the user is actually reading. */
function geocodeLanguages() {
  return [state.lang, ...GEOCODE_LANGS.filter((lang) => lang !== state.lang)].join(",");
}

/* Small LRU-ish cache of recent query→results (per language). */
const mtCache = createBoundedCache(MAPTILER_SEARCH_CACHE_MAX);
function mtCacheKey(q) {
  return `${state.lang}::${q}`;
}

/* MapTiler's fuzzy autocomplete can return attractive but unrelated places
   for nonsense input (for example, a query ending in "place" produced several
   French addresses named "Place …"). Keep typo-tolerance, but require every
   meaningful query token to match the returned name/region/country. */
const GENERIC_SEARCH_WORDS = new Set([
  "a",
  "an",
  "at",
  "city",
  "country",
  "de",
  "des",
  "du",
  "en",
  "etat",
  "in",
  "la",
  "le",
  "les",
  "meteo",
  "near",
  "of",
  "pays",
  "place",
  "province",
  "region",
  "state",
  "the",
  "town",
  "village",
  "ville",
  "weather",
]);

function searchTokens(value) {
  return normalize(String(value || ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

function adjacentSwap(a, b) {
  if (a.length !== b.length) return false;
  const diffs = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
  return (
    diffs.length === 2 &&
    diffs[1] === diffs[0] + 1 &&
    a[diffs[0]] === b[diffs[1]] &&
    a[diffs[1]] === b[diffs[0]]
  );
}

function tokenMatches(queryToken, candidateToken) {
  if (queryToken === candidateToken) return true;
  /* Preserve useful autocomplete such as "Tar" → "Tarbes". */
  if (queryToken.length >= 3 && candidateToken.startsWith(queryToken)) return true;
  if (queryToken.length < 4 || candidateToken.length < 4) return false;
  if (adjacentSwap(queryToken, candidateToken)) return true;
  const tolerance = Math.max(queryToken.length, candidateToken.length) <= 5 ? 1 : 2;
  return editDistance(queryToken, candidateToken) <= tolerance;
}

export function isRelevantGeocodeResult(query, loc) {
  const queryTokens = searchTokens(query).filter((token) => !GENERIC_SEARCH_WORDS.has(token));
  if (!queryTokens.length || !loc) return false;
  const candidateTokens = searchTokens(
    [
      loc.name && (loc.name.en || loc.name.fr),
      loc.region && (loc.region.en || loc.region.fr),
      loc.country && (loc.country.en || loc.country.fr),
      loc.fullName,
      loc.cc,
      loc.regionCode,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return queryTokens.every((token) =>
    candidateTokens.some((candidate) => tokenMatches(token, candidate)),
  );
}

/* Forward autocomplete. Caller supplies an AbortSignal so stale requests are
   cancelled. Returns [] on any failure (offline / bad key / aborted). */
export async function maptilerGeocode(query, signal) {
  const q = query.trim();
  if (!MAPTILER_KEY || q.length < 2) return [];
  const cached = mtCache.get(mtCacheKey(q));
  if (cached) return cached;
  const url =
    `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json` +
    `?key=${MAPTILER_KEY}&language=${geocodeLanguages()}&autocomplete=true&fuzzyMatch=true&limit=7`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const d = await res.json();
  const locs = (d.features || [])
    .map(featureToLoc)
    .filter((loc) => isRelevantGeocodeResult(q, loc));
  mtCache.set(mtCacheKey(q), locs);
  return locs;
}

/* Settlement-level place types, preferred over a raw address or POI when
   naming a clicked coordinate — "Tarbes" reads better than "12 Rue …". */
const SETTLEMENT_TYPES = ["place", "municipality", "locality", "joint_municipality"];

/* Reverse geocode a coordinate through MapTiler → a full loc object (both
   languages, kind, region code, bbox, and a real polygon when the provider
   supplies one), or null when the coordinate has no feature at all — open
   ocean, for instance. Callers turn null into an honest coordinate label via
   core/coord-location.js rather than guessing a nearby city. */
export async function reverseGeocodeMaptiler(lat, lon) {
  const url =
    `https://api.maptiler.com/geocoding/${lon},${lat}.json` +
    `?key=${MAPTILER_KEY}&language=${geocodeLanguages()}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const feats = d.features || [];
  const f = feats.find((x) => SETTLEMENT_TYPES.includes((x.place_type || [])[0])) || feats[0];
  return f ? featureToLoc(f) : null;
}

/* reverse-geocoding provider (no key, CORS-friendly); swap URL to change provider */
const REVERSE_GEO_URL = (lat, lon, lang) =>
  `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`;

async function reverseGeocodeFallback(lat, lon) {
  const r = await fetch(REVERSE_GEO_URL(lat, lon, state.lang), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const name = d.city || d.locality || "";
  const region = d.principalSubdivision || "";
  const country = d.countryName || "";
  if (!name && !region && !country) return null;
  /* one language only from this provider — the same text is used for both,
     which is exactly the "preserve the local name" fallback */
  return {
    kind: "city",
    cc: (d.countryCode || "").toUpperCase(),
    lat,
    lon,
    name: { en: name, fr: name },
    region: { en: region, fr: region },
    country: { en: country, fr: country },
    regionCode: d.principalSubdivisionCode || "",
    bbox: null,
    geometry: null,
  };
}

/* Coordinate → place, deduplicated and cached. The key is rounded to ~11 m so
   repeated clicks in the same spot (and the map click + the geolocation card
   asking about the same fix) share a single request. A rejected lookup is
   evicted by createAsyncCache, so a transient failure still retries. */
const reverseCache = createAsyncCache(REVERSE_GEOCODE_TTL_MS);

function reverseCacheKey(lat, lon) {
  return `${state.lang}::${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * Reverse geocode to a full loc-shaped object (or null if nothing is there).
 * Cached; callers guard against stale results with their own request token
 * rather than an AbortController, so one caller cancelling can never abort a
 * shared in-flight request another caller is still waiting on.
 */
export function reverseGeocodeLocation(lat, lon) {
  return reverseCache.get(reverseCacheKey(lat, lon), async () => {
    if (MAPTILER_KEY) {
      try {
        return await reverseGeocodeMaptiler(lat, lon);
      } catch {
        /* fall through to the keyless provider */
      }
    }
    return reverseGeocodeFallback(lat, lon);
  });
}

/* Flat {name, region, cc, country} shape kept for the "my location" card,
   which only ever needs those four strings in the active language. */
export async function reverseGeocode(lat, lon) {
  const loc = await reverseGeocodeLocation(lat, lon);
  if (!loc) return { name: "", region: "", cc: "", country: "" };
  const pick = (value) => (value && (value[state.lang] || value.en || value.fr)) || "";
  return { name: pick(loc.name), region: pick(loc.region), cc: loc.cc, country: pick(loc.country) };
}
