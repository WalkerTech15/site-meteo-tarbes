/* Nearby places for the map's location detail panel.
 *
 * MapTiler's geocoder has no "search near this point" call (only forward text
 * search and single-point reverse lookup — see geocoding-api.js), so nearby
 * real places are DISCOVERED by reverse-geocoding a ring of points around the
 * selection. Each probe reuses reverseGeocodeLocation()'s existing cache and
 * MapTiler→BigDataCloud fallback — no new geocoding provider. The resulting
 * candidates' weather is then fetched in ONE batched Open-Meteo request (the
 * same comma-joined-coordinates technique features/favorites.js already uses
 * for the favorites list), never one request per place.
 *
 * Deliberately scoped to granular selections (city/town/village/address/poi):
 * probing a ring around a COUNTRY's centroid would just return other spots in
 * the same province, which is not what "nearby" means for an area that large. */
import { reverseGeocodeLocation } from "./geocoding-api.js";
import { FETCH_TIMEOUT_MS } from "../core/config.js";
import { createAsyncCache } from "./cache.js";
import { haversineKm, offsetPoint } from "../core/geo.js";

const NEARBY_RADIUS_KM = 30;
/* Six probes (60° apart) — enough ring coverage for 3-5 results without
   turning every selection into eight parallel geocoding requests. */
const NEARBY_BEARINGS = [0, 60, 120, 180, 240, 300];
/* A probe that resolves back to the origin's own settlement (common in a
   sparsely-mapped area, or a very large city) is not a "nearby place". */
const NEARBY_MIN_DISTANCE_KM = 3;
const NEARBY_MAX_RESULTS = 5;
const NEARBY_CACHE_TTL_MS = 5 * 60000;

const NEARBY_ELIGIBLE_KINDS = new Set(["city", "town", "village", "address", "poi"]);

export function isNearbyEligible(loc) {
  return Boolean(loc && NEARBY_ELIGIBLE_KINDS.has(loc.kind));
}

function placeName(loc) {
  return (loc.name && (loc.name.en || loc.name.fr)) || "";
}

/* Reverse-geocode the six ring points, dedupe by resolved place (two probes
   can easily land in the same neighbouring town), and keep the closest
   NEARBY_MAX_RESULTS. `allFailed` distinguishes "the geocoder is down" (every
   probe rejected) from "there's genuinely nothing out there" (probes
   answered, just with no usable place) — the panel shows a different message
   for each. */
async function discoverCandidates(loc) {
  const probes = NEARBY_BEARINGS.map((bearing) =>
    offsetPoint(loc.lat, loc.lon, bearing, NEARBY_RADIUS_KM),
  );
  const settled = await Promise.allSettled(probes.map((p) => reverseGeocodeLocation(p.lat, p.lon)));
  const fulfilledCount = settled.filter((r) => r.status === "fulfilled").length;

  const originName = placeName(loc);
  const seen = new Map();
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const place = result.value;
    if (typeof place.lat !== "number" || typeof place.lon !== "number") continue;
    if (placeName(place) && placeName(place) === originName) continue;
    const distanceKm = haversineKm(loc.lat, loc.lon, place.lat, place.lon);
    if (distanceKm < NEARBY_MIN_DISTANCE_KM) continue;
    const key = place.id || `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
    const existing = seen.get(key);
    if (!existing || distanceKm < existing.distanceKm) {
      seen.set(key, {
        loc: { ...place, id: place.id || `nearby-${place.lat.toFixed(4)},${place.lon.toFixed(4)}` },
        distanceKm,
      });
    }
  }

  const list = Array.from(seen.values())
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, NEARBY_MAX_RESULTS);
  return { list, allFailed: fulfilledCount === 0 };
}

/* Same index-matching approach as fetchWeatherRaw in weather-api.js: the
   batched response's hourly array is in each place's own local time
   (timezone=auto), so "now" is found per-place rather than assumed to be
   index 0. */
function currentRainProb(entry) {
  const times = entry?.hourly?.time || [];
  const nowIso = entry?.current?.time?.slice(0, 13);
  let idx = nowIso ? times.findIndex((x) => x.slice(0, 13) === nowIso) : -1;
  if (idx < 0) idx = 0;
  return entry?.hourly?.precipitation_probability?.[idx] ?? 0;
}

async function attachWeather(candidates) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: candidates.map((c) => c.loc.lat).join(","),
    longitude: candidates.map((c) => c.loc.lon).join(","),
    current: "temperature_2m,wind_speed_10m,weather_code,is_day",
    hourly: "precipitation_probability",
    forecast_days: "1",
    timezone: "auto",
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const d = await res.json();
  const arr = Array.isArray(d) ? d : [d];
  return candidates.map((c, i) => {
    const entry = arr[i];
    if (!entry || !entry.current) return { ...c, weather: null };
    return {
      ...c,
      weather: {
        temp: entry.current.temperature_2m,
        windSpeed: entry.current.wind_speed_10m,
        code: entry.current.weather_code,
        isDay: entry.current.is_day,
        rainProb: currentRainProb(entry),
      },
    };
  });
}

const nearbyCache = createAsyncCache(NEARBY_CACHE_TTL_MS);
const cacheKey = (loc) => `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;

/**
 * @returns {Promise<{status: "ineligible"|"empty"|"error"|"ready", places: Array}>}
 *   `places` items are `{ loc, distanceKm, weather: {temp,windSpeed,code,isDay,rainProb}|null }`.
 *   `weather` is null only under "error" (candidates were found, but the
 *   batched forecast call itself failed) — the panel still lists the places.
 */
export function loadNearbyPlaces(loc) {
  if (!isNearbyEligible(loc)) return Promise.resolve({ status: "ineligible", places: [] });
  return nearbyCache.get(cacheKey(loc), async () => {
    const { list, allFailed } = await discoverCandidates(loc);
    if (!list.length) return { status: allFailed ? "error" : "empty", places: [] };
    try {
      const places = await attachWeather(list);
      return { status: "ready", places };
    } catch {
      return { status: "error", places: list.map((c) => ({ ...c, weather: null })) };
    }
  });
}

/* Test seam only — mirrors the pattern in services/photo-api.js. */
export function __resetNearbyCacheForTests() {
  nearbyCache.clear();
}
