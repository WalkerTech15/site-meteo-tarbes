/* Side-by-side comparison of saved places.
 *
 * Scope, deliberately narrow: this compares the CURRENT location and the
 * visitor's favorites, and lives inside the Favorites view. It adds no
 * route, no sidebar entry and no new view — the sidebar is a fixed set of
 * six items that the responsive-nav suite pins, and "compare my saved
 * places" belongs next to those saved places anyway.
 *
 * Selection is stored as ids only. The places themselves already live in
 * state.favorites / state.loc, so duplicating them here would be a second
 * copy to keep in sync (and a second thing to sanitize on read).
 *
 * Weather comes from ONE batched Open-Meteo call plus ONE batched
 * air-quality call, mirroring how features/favorites.js already fetches its
 * grid — so adding a column costs no extra round trip. Failure degrades the
 * way the rest of the app does: the row shows "—" rather than an error. */
import { state } from "../core/state.js";
import { getJSON, setJSON, KEYS } from "../core/storage.js";
import { FETCH_TIMEOUT_MS, FAVORITES_WEATHER_TTL_MS } from "../core/config.js";
import { createLatestOnly } from "../core/latest-only.js";

/* How many places can be compared at once. Five columns remains readable
   with the existing horizontal scroll on smaller screens. */
export const MAX_COMPARISON = 5;

/* The metrics a comparison shows, in display order. Kept as data (rather
   than inline in the renderer) so the row set is one list to read, and so
   the pure formatting can be unit-tested without a DOM. */
export const COMPARISON_METRICS = [
  "temperature",
  "feelsLike",
  "humidity",
  "wind",
  "precipitation",
  "uv",
  "airQuality",
  "localTime",
];

/* ── Selection ─────────────────────────────────────────────────────────── */

export function loadComparison() {
  const raw = getJSON(KEYS.comparison, []);
  if (!Array.isArray(raw)) return [];
  /* Re-sanitized on read: an older or hand-edited store can never
     reintroduce a shape (or a length) the current rules would refuse. */
  return raw.filter((id) => typeof id === "string" && id).slice(0, MAX_COMPARISON);
}

export function persistComparison() {
  setJSON(KEYS.comparison, state.comparison);
}

export function isCompared(loc) {
  return Boolean(loc) && state.comparison.includes(loc.id);
}

export function comparisonFull() {
  return state.comparison.length >= MAX_COMPARISON;
}

/**
 * Add or remove a place.
 * @returns {"added"|"removed"|"full"} what actually happened, so the caller
 *   can report it — silently doing nothing at the cap would look broken.
 */
export function toggleComparison(loc) {
  if (!loc || !loc.id) return "full";
  if (isCompared(loc)) {
    state.comparison = state.comparison.filter((id) => id !== loc.id);
    persistComparison();
    return "removed";
  }
  if (comparisonFull()) return "full";
  state.comparison = [...state.comparison, loc.id];
  persistComparison();
  return "added";
}

export function removeFromComparison(id) {
  state.comparison = state.comparison.filter((x) => x !== id);
  persistComparison();
}

export function clearComparison() {
  state.comparison = [];
  persistComparison();
}

/* Every place that can be compared: the current selection first (it is what
   the visitor is looking at), then favorites, deduplicated by id. */
export function comparableLocations() {
  const seen = new Set();
  const out = [];
  for (const loc of [state.loc, ...state.favorites]) {
    if (!loc || !loc.id || seen.has(loc.id)) continue;
    seen.add(loc.id);
    out.push(loc);
  }
  return out;
}

/* The selected places, in the order the visitor added them, dropping any id
   whose place is no longer available (a favorite removed elsewhere). */
export function comparisonLocations() {
  const byId = new Map(comparableLocations().map((loc) => [loc.id, loc]));
  return state.comparison.map((id) => byId.get(id)).filter(Boolean);
}

/* Drops ids that no longer resolve — called after favorites change so a
   stale id can never linger in storage. Returns true if anything changed. */
export function pruneComparison() {
  const available = new Set(comparableLocations().map((loc) => loc.id));
  const next = state.comparison.filter((id) => available.has(id));
  if (next.length === state.comparison.length) return false;
  state.comparison = next;
  persistComparison();
  return true;
}

/* ── Weather ───────────────────────────────────────────────────────────── */

/* loc.id → metric bag. Exported for the renderer; never mutated by it. */
export let comparisonWx = {};
let comparisonKey = "";
let comparisonAt = 0;

export function __resetComparisonForTests() {
  comparisonWx = {};
  comparisonKey = "";
  comparisonAt = 0;
}

/* One runner, so a rapid sequence of selections can only ever paint the
   last one — the same stale-response guard the map click uses. */
const runLatest = createLatestOnly();

function toEntry(current, daily) {
  return {
    temp: current?.temperature_2m ?? null,
    feelsLike: current?.apparent_temperature ?? null,
    humidity: current?.relative_humidity_2m ?? null,
    wind: current?.wind_speed_10m ?? null,
    code: current?.weather_code ?? null,
    isDay: current?.is_day ?? 1,
    precipitation: daily?.precipitation_probability_max?.[0] ?? null,
    uv: daily?.uv_index_max?.[0] ?? null,
    timezone: null,
    aqi: null,
  };
}

async function fetchAirQuality(locs, signal) {
  try {
    const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    url.search = new URLSearchParams({
      latitude: locs.map((l) => l.lat).join(","),
      longitude: locs.map((l) => l.lon).join(","),
      current: "european_aqi",
    }).toString();
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((d) => d?.current?.european_aqi ?? null);
  } catch {
    /* Air quality is the one column allowed to be missing on its own — it
       is a separate service, and losing it must not blank the comparison. */
    return [];
  }
}

/**
 * Fetch every selected place's metrics in one batch.
 * @param {boolean} force skip the freshness check (used after a change)
 */
export function loadComparisonWeather(force = false) {
  return runLatest(async (isStale) => {
    const locs = comparisonLocations();
    if (!locs.length) {
      comparisonWx = {};
      comparisonKey = "";
      return {};
    }
    const key = locs.map((l) => l.id).join(",");
    if (!force && key === comparisonKey && Date.now() - comparisonAt < FAVORITES_WEATHER_TTL_MS) {
      return comparisonWx;
    }

    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let next = {};
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: locs.map((l) => l.lat).join(","),
        longitude: locs.map((l) => l.lon).join(","),
        current:
          "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
        daily: "precipitation_probability_max,uv_index_max",
        forecast_days: "1",
        timezone: "auto",
      }).toString();
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [data];
      locs.forEach((loc, i) => {
        const entry = toEntry(arr[i]?.current, arr[i]?.daily);
        entry.timezone = arr[i]?.timezone || null;
        next[loc.id] = entry;
      });
    } catch {
      /* Whole-batch failure: keep the columns, blank the numbers. The
         renderer prints "—" per cell, which is honest and keeps the layout
         (and the remove buttons) usable. */
      next = {};
      for (const loc of locs) next[loc.id] = toEntry(null, null);
    }
    if (isStale()) return comparisonWx;

    const aqi = await fetchAirQuality(locs, signal);
    if (isStale()) return comparisonWx;
    locs.forEach((loc, i) => {
      if (next[loc.id]) next[loc.id].aqi = aqi[i] ?? null;
    });

    comparisonWx = next;
    comparisonKey = key;
    comparisonAt = Date.now();
    return comparisonWx;
  });
}
