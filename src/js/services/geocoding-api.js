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
} from "../core/config.js";
import { createBoundedCache } from "./cache.js";

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

/* Convert one MapTiler GeoJSON feature into a WeatherSphere loc object. */
function featureToLoc(f) {
  const primary = (f.place_type && f.place_type[0]) || "place";
  const map = MT_KIND[primary] || { kind: "city", zoom: 11 };
  const ctx = f.context || [];
  const pick = (pfx) => {
    const c = ctx.find((x) => String(x.id || "").startsWith(pfx));
    return c ? c.text : "";
  };
  const region = pick("region") || pick("subregion") || pick("county") || "";
  const country = pick("country") || (map.kind === "country" ? f.text : "");
  const name = f.text || (f.place_name || "").split(",")[0];
  /* ISO 3166-2 region code (e.g. "US-TX") from the region context entry, or the
     feature itself when it IS a state/province — the surest region signal. */
  const regionCtx = ctx.find((x) => String(x.id || "").startsWith("region"));
  const regionCode =
    (regionCtx && regionCtx.short_code) || (f.properties && f.properties.short_code) || "";
  return {
    id: "mt-" + (f.id || `${f.center[0]},${f.center[1]}`),
    kind: map.kind,
    cc: ccFromFeature(f),
    flag: "📍",
    lat: f.center[1],
    lon: f.center[0],
    name: { en: name, fr: name },
    region: { en: region, fr: region },
    country: { en: country, fr: country },
    landmark: null,
    aliases: [],
    grad: ["#3B82F6", "#1E40AF"],
    dynamic: true,
    bbox: Array.isArray(f.bbox) && f.bbox.length === 4 ? f.bbox : null,
    fullName: f.place_name || name,
    placeType: primary,
    _zoom: map.zoom,
    regionCode,
  };
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
    `?key=${MAPTILER_KEY}&language=${state.lang}&autocomplete=true&fuzzyMatch=true&limit=7`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const d = await res.json();
  const locs = (d.features || [])
    .map(featureToLoc)
    .filter((loc) => isRelevantGeocodeResult(q, loc));
  mtCache.set(mtCacheKey(q), locs);
  return locs;
}

/* Reverse geocode a coordinate through MapTiler → {name, region, cc, country}.
   Falls back to the keyless BigDataCloud provider when MapTiler is unavailable. */
export async function reverseGeocodeMaptiler(lat, lon) {
  const url =
    `https://api.maptiler.com/geocoding/${lon},${lat}.json` +
    `?key=${MAPTILER_KEY}&language=${state.lang}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const feats = d.features || [];
  /* prefer a settlement-level feature over a raw address/POI for the card */
  const f =
    feats.find((x) =>
      ["place", "municipality", "locality", "joint_municipality"].includes((x.place_type || [])[0]),
    ) || feats[0];
  if (!f) return { name: "", region: "", cc: "", country: "" };
  const loc = featureToLoc(f);
  return { name: loc.name.en, region: loc.region.en, cc: loc.cc, country: loc.country.en };
}

/* reverse-geocoding provider (no key, CORS-friendly); swap URL to change provider */
const REVERSE_GEO_URL = (lat, lon, lang) =>
  `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`;

export async function reverseGeocode(lat, lon) {
  /* preferred: MapTiler (same key as the map, honours FR/EN) */
  if (MAPTILER_KEY) {
    try {
      return await reverseGeocodeMaptiler(lat, lon);
    } catch {
      /* fall through to the keyless provider */
    }
  }
  const r = await fetch(REVERSE_GEO_URL(lat, lon, state.lang), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  return {
    name: d.city || d.locality || "",
    region: d.principalSubdivision || "",
    cc: (d.countryCode || "").toUpperCase(),
  };
}
