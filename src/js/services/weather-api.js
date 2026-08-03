/* Open-Meteo weather + air-quality fetching, with caching/dedup and a
   deterministic offline demo fallback. */
import { FETCH_TIMEOUT_MS, WEATHER_CACHE_TTL_MS } from "../core/config.js";
import { createAsyncCache } from "./cache.js";

/* Short-lived cache keyed by coordinates: deduplicates in-flight requests
   (e.g. sidebar widget + popular list + selected city hitting the same place)
   and avoids refetching a location viewed less than 5 minutes ago. */
const weatherCache = createAsyncCache(WEATHER_CACHE_TTL_MS);

export function fetchWeather(loc) {
  const key = `${loc.lat},${loc.lon}`;
  return weatherCache.get(key, () => fetchWeatherRaw(loc));
}

export async function fetchWeatherRaw(loc) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    /* wind_gusts_10m is what the severe-weather advisory thresholds are
       defined against (sustained wind understates a squall). Added to the
       SAME request — no extra round trip. */
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure",
    hourly:
      "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,surface_pressure,dew_point_2m,precipitation_probability,visibility,uv_index,weather_code,is_day",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max,wind_speed_10m_max",
    forecast_days: "8",
    timezone: "auto",
  }).toString();

  /* air quality comes from a separate Open-Meteo endpoint — optional */
  const aqiPromise = fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&current=european_aqi`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  )
    .then((r) => r.json())
    .then((a) => a.current?.european_aqi ?? null)
    .catch(() => null);

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const d = await res.json();
  if (!d || !d.current || !d.hourly?.time || !d.daily?.time) throw new Error("Malformed response");
  /* timezone=auto makes Open-Meteo resolve the real IANA zone for these coords
     (e.g. "Asia/Tokyo") — that's what drives the hero's local-time clock. */
  const timezone = d.timezone || null;

  const nowIso = d.current.time.slice(0, 13);
  let idx = d.hourly.time.findIndex((x) => x.slice(0, 13) === nowIso);
  if (idx < 0) idx = 0;

  const hourly = [];
  for (let i = idx; i < Math.min(idx + 25, d.hourly.time.length); i++) {
    hourly.push({
      time: d.hourly.time[i],
      temp: d.hourly.temperature_2m[i],
      feels: d.hourly.apparent_temperature?.[i] ?? d.hourly.temperature_2m[i],
      humidity: d.hourly.relative_humidity_2m[i],
      wind: d.hourly.wind_speed_10m[i],
      /* null, not 0, when the provider omits them: the advisory checks skip a
         missing field rather than reading it as "calm" or "clear" */
      gust: d.hourly.wind_gusts_10m?.[i] ?? null,
      vis: d.hourly.visibility?.[i] != null ? d.hourly.visibility[i] / 1000 : null, // km, like current.visibility
      pressure: d.hourly.surface_pressure[i],
      rainProb: d.hourly.precipitation_probability?.[i] ?? 0,
      code: d.hourly.weather_code[i],
      isDay: d.hourly.is_day[i],
    });
  }

  const daily = d.daily.time.slice(0, 7).map((date, i) => ({
    date,
    code: d.daily.weather_code[i],
    hi: d.daily.temperature_2m_max[i],
    lo: d.daily.temperature_2m_min[i],
    sunrise: d.daily.sunrise[i],
    sunset: d.daily.sunset[i],
    rainProb: d.daily.precipitation_probability_max?.[i] ?? 0,
    uvMax: d.daily.uv_index_max?.[i] ?? 0,
    windMax: d.daily.wind_speed_10m_max?.[i] ?? 0,
  }));

  return {
    current: {
      temp: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      windSpeed: d.current.wind_speed_10m,
      gust: d.current.wind_gusts_10m ?? null,
      windDir: d.current.wind_direction_10m,
      pressure: d.current.surface_pressure,
      code: d.current.weather_code,
      isDay: d.current.is_day,
      uv: d.hourly.uv_index?.[idx] ?? 0,
      visibility: (d.hourly.visibility?.[idx] ?? 10000) / 1000,
      dewPoint: d.hourly.dew_point_2m?.[idx] ?? 0,
      rainProb: d.hourly.precipitation_probability?.[idx] ?? 0,
      aqi: null /* filled in later by _aqi — never blocks the weather render */,
    },
    hourly,
    daily,
    updatedAt: new Date(),
    timezone,
    _aqi: aqiPromise,
  };
}

/* Fixed-offset zone string ("Etc/GMT-9") from longitude — offline/demo fallback
   only, no DST. Etc/GMT signs are inverted vs normal tz convention (POSIX). */
export function tzFromLon(lon) {
  const off = Math.round(lon / 15);
  if (off === 0) return "UTC";
  return `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}

/* Deterministic demo data (offline fallback) */
export function demoWeather(loc) {
  let seed = 0;
  for (const ch of loc.id || loc.name.en) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const month = new Date().getMonth();
  const north = loc.lat >= 0;
  const summer = north ? [5, 6, 7].includes(month) : [11, 0, 1].includes(month);
  const base = 26 - Math.abs(loc.lat) * 0.45 + (summer ? 8 : -4) + rnd() * 4;
  const hour = new Date().getHours();
  const codes = [0, 1, 2, 3, 61, 2, 1, 0, 80, 3];
  const code = codes[Math.floor(rnd() * codes.length)];

  const hourly = [];
  for (let i = 0; i <= 24; i++) {
    const h = (hour + i) % 24;
    const diurnal = Math.sin(((h - 9) / 24) * Math.PI * 2) * 5;
    hourly.push({
      time: new Date(Date.now() + i * 36e5).toISOString().slice(0, 16),
      temp: base + diurnal + rnd() * 1.4,
      feels: base + diurnal - 1 + rnd() * 3,
      humidity: Math.min(96, Math.max(28, 62 - diurnal * 3 + rnd() * 10)),
      wind: 8 + rnd() * 14 + Math.sin(i / 4) * 4,
      gust: (8 + rnd() * 14 + Math.sin(i / 4) * 4) * 1.45,
      vis: 8 + rnd() * 14,
      pressure: 1013 + Math.sin(i / 7 + seed) * 6 + rnd() * 2,
      rainProb: code >= 61 ? 40 + rnd() * 45 : rnd() * 22,
      code,
      isDay: h >= 7 && h <= 20 ? 1 : 0,
    });
  }
  const daily = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const c = codes[Math.floor(rnd() * codes.length)];
    daily.push({
      date: d.toISOString().slice(0, 10),
      code: c,
      hi: base + 4 + rnd() * 3,
      lo: base - 5 - rnd() * 3,
      sunrise: d.toISOString().slice(0, 10) + "T06:42",
      sunset: d.toISOString().slice(0, 10) + "T20:12",
      rainProb: c >= 61 ? 55 + rnd() * 30 : rnd() * 25,
      uvMax: 2 + rnd() * 7,
      windMax: 12 + rnd() * 20,
    });
  }
  const cur = hourly[0];
  return {
    current: {
      temp: cur.temp,
      feels: cur.temp - 1.5 + rnd() * 3,
      humidity: cur.humidity,
      windSpeed: cur.wind,
      gust: cur.gust,
      windDir: rnd() * 360,
      pressure: cur.pressure,
      code,
      isDay: cur.isDay,
      uv: daily[0].uvMax * (cur.isDay ? 0.8 : 0),
      visibility: 8 + rnd() * 14,
      dewPoint: cur.temp - 4 - rnd() * 4,
      rainProb: cur.rainProb,
      aqi: Math.round(25 + rnd() * 40),
    },
    hourly,
    daily,
    updatedAt: new Date(),
    timezone: tzFromLon(loc.lon) /* no network in demo mode — offset-only estimate */,
  };
}
