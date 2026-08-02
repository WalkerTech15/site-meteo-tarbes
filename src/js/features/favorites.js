/* Favorites: persistence, batched live-weather fetch for the favorites
   list, and the add/remove toggle used by the hero star button. */
import { state } from "../core/state.js";
import { t } from "../core/i18n.js";
import { setJSON, KEYS } from "../core/storage.js";
import { FAVORITES_WEATHER_TTL_MS, FETCH_TIMEOUT_MS } from "../core/config.js";
import { demoWeather } from "../services/weather-api.js";
import { showToast } from "../ui/notifications.js";
import { renderHero } from "../ui/render-home.js";
import { renderFavorites } from "../ui/render-favorites.js";

export function isFav(loc) {
  return state.favorites.some((f) => f.id === loc.id);
}

export function persistFavs() {
  setJSON(KEYS.favorites, state.favorites);
}

/* Live weather for all favorites, fetched in one batched call */
export let favWx = {}; // loc.id → { temp, code, isDay, hi, lo, humidity, wind }
export let favWxAt = 0;
let favWxKey = "";

export function favAgoMinutes() {
  return Math.max(0, Math.round((Date.now() - favWxAt) / 60000));
}

export async function loadFavWeather(force = false) {
  const locs = state.favorites;
  if (!locs.length) return;
  const key = locs.map((l) => l.id).join(",");
  if (!force && key === favWxKey && Date.now() - favWxAt < FAVORITES_WEATHER_TTL_MS) return;
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: locs.map((l) => l.lat).join(","),
      longitude: locs.map((l) => l.lon).join(","),
      current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
      daily: "temperature_2m_max,temperature_2m_min",
      forecast_days: "1",
      timezone: "auto",
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const d = await res.json();
    const arr = Array.isArray(d) ? d : [d];
    favWx = {};
    locs.forEach((loc, i) => {
      favWx[loc.id] = {
        temp: arr[i].current.temperature_2m,
        code: arr[i].current.weather_code,
        isDay: arr[i].current.is_day,
        humidity: arr[i].current.relative_humidity_2m,
        wind: arr[i].current.wind_speed_10m,
        hi: arr[i].daily.temperature_2m_max[0],
        lo: arr[i].daily.temperature_2m_min[0],
      };
    });
  } catch {
    favWx = {};
    locs.forEach((loc) => {
      const w = demoWeather(loc);
      favWx[loc.id] = {
        temp: w.current.temp,
        code: w.current.code,
        isDay: w.current.isDay,
        humidity: w.current.humidity,
        wind: w.current.windSpeed,
        hi: w.daily[0].hi,
        lo: w.daily[0].lo,
      };
    });
  }
  favWxAt = Date.now();
  favWxKey = key;
  renderFavorites();
}

export function toggleFavorite() {
  const loc = state.loc;
  if (isFav(loc)) {
    state.favorites = state.favorites.filter((f) => f.id !== loc.id);
    showToast(t("removedFav"));
  } else {
    state.favorites.push(loc);
    showToast(t("addedFav"));
    loadFavWeather(true);
  }
  persistFavs();
  renderHero();
  renderFavorites();
}
