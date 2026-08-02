/* ═══════════════════════════════════════════════════════════════
   WeatherSphere — Application
   ═══════════════════════════════════════════════════════════════ */

const state = {
  lang: localStorage.getItem("ws_lang") || "fr",
  mode: localStorage.getItem("ws_mode") || "simple",
  unitTemp: localStorage.getItem("ws_unit_t") || (localStorage.getItem("ws_units") === "imperial" ? "f" : "c"),
  unitWind: localStorage.getItem("ws_unit_w") || (localStorage.getItem("ws_units") === "imperial" ? "mph" : "kmh"),
  theme: localStorage.getItem("ws_theme") || "light",
  notifs: JSON.parse(localStorage.getItem("ws_notifs") || '{"alerts":true,"daily":true,"changes":true,"features":false}'),
  favorites: JSON.parse(localStorage.getItem("ws_favs") || "[]"),
  loc: null,
  wx: null,
  isDemo: false,
  view: "home",
  chartTab: "temp",
  fcTab: "temp",
  favView: "grid",
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const t = key => I18N[state.lang][key] ?? I18N.en[key] ?? key;

/* HTML-escape any value that reaches an innerHTML template. Place names, regions
   and ids come from third-party geocoders (MapTiler / Open-Meteo / BigDataCloud)
   whose datasets are partly crowd-sourced, so a name like `<img onerror=…>`
   would otherwise run as script. Escape at the interpolation site, never at the
   source: locName/locRegion/locCountry are also used with textContent, where an
   escaped string would display the raw entities. */
const esc = v => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ─────────────────────────── Units ─────────────────────────── */
const toF = c => c * 9 / 5 + 32;
const toMph = k => k / 1.609;
const convTemp = c => state.unitTemp === "f" ? toF(c) : c;
const fmtTemp = c => Math.round(convTemp(c));
const tempUnit = () => state.unitTemp === "f" ? "°F" : "°C";
const convWind = k => state.unitWind === "mph" ? toMph(k) : state.unitWind === "ms" ? k / 3.6 : k;
const fmtWind = k => Math.round(convWind(k));
const windUnit = () => ({ kmh: "km/h", mph: "mph", ms: "m/s" })[state.unitWind];

function compass(deg) {
  const keys = ["windDirN", "windDirNE", "windDirE", "windDirSE", "windDirS", "windDirSW", "windDirW", "windDirNW"];
  const abbr = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const i = Math.round(((deg % 360) / 45)) % 8;
  return { label: t(keys[i]), abbr: abbr[i], deg };
}

function uvLabel(uv) {
  if (uv < 3) return t("uvLow");
  if (uv < 6) return t("uvModerate");
  if (uv < 8) return t("uvHigh");
  if (uv < 11) return t("uvVeryHigh");
  return t("uvExtreme");
}

/* ─────────────────────── Weather fetching ─────────────────────── */

/* Short-lived cache keyed by coordinates: deduplicates in-flight requests
   (e.g. sidebar widget + popular list + selected city hitting the same place)
   and avoids refetching a location viewed less than 5 minutes ago. */
const WX_CACHE = new Map();
const WX_TTL = 5 * 60000;

function fetchWeather(loc) {
  const key = `${loc.lat},${loc.lon}`;
  const hit = WX_CACHE.get(key);
  if (hit && Date.now() - hit.at < WX_TTL) return hit.p;
  const p = fetchWeatherRaw(loc);
  WX_CACHE.set(key, { p, at: Date.now() });
  p.catch(() => WX_CACHE.delete(key));
  return p;
}

async function fetchWeatherRaw(loc) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure",
    hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,surface_pressure,dew_point_2m,precipitation_probability,visibility,uv_index,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max,wind_speed_10m_max",
    forecast_days: "8", timezone: "auto",
  }).toString();

  /* air quality comes from a separate Open-Meteo endpoint — optional */
  const aqiPromise = fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&current=european_aqi`,
    { signal: AbortSignal.timeout(8000) },
  ).then(r => r.json()).then(a => a.current?.european_aqi ?? null).catch(() => null);

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const d = await res.json();
  if (!d || !d.current || !d.hourly?.time || !d.daily?.time) throw new Error("Malformed response");
  /* timezone=auto makes Open-Meteo resolve the real IANA zone for these coords
     (e.g. "Asia/Tokyo") — that's what drives the hero's local-time clock. */
  const timezone = d.timezone || null;

  const nowIso = d.current.time.slice(0, 13);
  let idx = d.hourly.time.findIndex(x => x.slice(0, 13) === nowIso);
  if (idx < 0) idx = 0;

  const hourly = [];
  for (let i = idx; i < Math.min(idx + 25, d.hourly.time.length); i++) {
    hourly.push({
      time: d.hourly.time[i],
      temp: d.hourly.temperature_2m[i],
      feels: d.hourly.apparent_temperature?.[i] ?? d.hourly.temperature_2m[i],
      humidity: d.hourly.relative_humidity_2m[i],
      wind: d.hourly.wind_speed_10m[i],
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
      windDir: d.current.wind_direction_10m,
      pressure: d.current.surface_pressure,
      code: d.current.weather_code,
      isDay: d.current.is_day,
      uv: d.hourly.uv_index?.[idx] ?? 0,
      visibility: (d.hourly.visibility?.[idx] ?? 10000) / 1000,
      dewPoint: d.hourly.dew_point_2m?.[idx] ?? 0,
      rainProb: d.hourly.precipitation_probability?.[idx] ?? 0,
      aqi: null, /* filled in later by _aqi — never blocks the weather render */
    },
    hourly, daily,
    updatedAt: new Date(),
    timezone,
    _aqi: aqiPromise,
  };
}

/* Fixed-offset zone string ("Etc/GMT-9") from longitude — offline/demo fallback
   only, no DST. Etc/GMT signs are inverted vs normal tz convention (POSIX). */
function tzFromLon(lon) {
  const off = Math.round(lon / 15);
  if (off === 0) return "UTC";
  return `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}

/* Deterministic demo data (offline fallback) */
function demoWeather(loc) {
  let seed = 0;
  for (const ch of (loc.id || loc.name.en)) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

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
      pressure: 1013 + Math.sin(i / 7 + seed) * 6 + rnd() * 2,
      rainProb: code >= 61 ? 40 + rnd() * 45 : rnd() * 22,
      code, isDay: h >= 7 && h <= 20 ? 1 : 0,
    });
  }
  const daily = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const c = codes[Math.floor(rnd() * codes.length)];
    daily.push({
      date: d.toISOString().slice(0, 10), code: c,
      hi: base + 4 + rnd() * 3, lo: base - 5 - rnd() * 3,
      sunrise: d.toISOString().slice(0, 10) + "T06:42", sunset: d.toISOString().slice(0, 10) + "T20:12",
      rainProb: c >= 61 ? 55 + rnd() * 30 : rnd() * 25,
      uvMax: 2 + rnd() * 7, windMax: 12 + rnd() * 20,
    });
  }
  const cur = hourly[0];
  return {
    current: {
      temp: cur.temp, feels: cur.temp - 1.5 + rnd() * 3, humidity: cur.humidity,
      windSpeed: cur.wind, windDir: rnd() * 360, pressure: cur.pressure,
      code, isDay: cur.isDay, uv: daily[0].uvMax * (cur.isDay ? 0.8 : 0),
      visibility: 8 + rnd() * 14, dewPoint: cur.temp - 4 - rnd() * 4, rainProb: cur.rainProb,
      aqi: Math.round(25 + rnd() * 40),
    },
    hourly, daily, updatedAt: new Date(),
    timezone: tzFromLon(loc.lon), /* no network in demo mode — offset-only estimate */
  };
}

/* Geocoding fallback for places outside the curated set */
async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=${state.lang}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return [];
  const d = await res.json();
  return (d.results || []).map(r => ({
    id: "geo-" + r.id, kind: "city",
    flag: "📍", cc: (r.country_code || "").toUpperCase(),
    lat: r.latitude, lon: r.longitude,
    name: { en: r.name, fr: r.name },
    region: { en: r.admin1 || "", fr: r.admin1 || "" },
    country: { en: r.country || "", fr: r.country || "" },
    landmark: null, aliases: [], grad: ["#3B82F6", "#1E40AF"], dynamic: true,
  }));
}

/* ─────────────── MapTiler Search & Geocoding ───────────────
   Global forward + reverse geocoding using the same MapTiler key as the map
   (js/env.js → window.__ENV.VITE_MAPTILER_KEY). Returns loc objects shaped
   like the curated LOCATIONS so the rest of the pipeline is unchanged.
   Duplicate names (Paris FR / TX / ON) are told apart by region + country
   from the feature's own context — never by guessing from the query text. */

/* MapTiler place_type → our kind + fallback zoom (used only when no bbox). */
const MT_KIND = {
  country:              { kind: "country", zoom: 5 },
  region:               { kind: "region",  zoom: 6 },
  subregion:            { kind: "region",  zoom: 7 },
  county:               { kind: "region",  zoom: 7 },
  municipal_district:   { kind: "region",  zoom: 7 },
  joint_municipality:   { kind: "city",    zoom: 11 },
  municipality:         { kind: "city",    zoom: 11 },
  place:                { kind: "city",    zoom: 11 },
  locality:             { kind: "village", zoom: 13 },
  neighbourhood:        { kind: "village", zoom: 13 },
  postal_code:          { kind: "address", zoom: 14 },
  address:              { kind: "address", zoom: 16 },
  poi:                  { kind: "poi",     zoom: 16 },
};

function ccFromFeature(f) {
  const p = f.properties || {};
  if (p.country_code) return String(p.country_code).toUpperCase();
  const ctx = (f.context || []).find(c => String(c.id || "").startsWith("country"));
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
  const pick = pfx => {
    const c = ctx.find(x => String(x.id || "").startsWith(pfx));
    return c ? c.text : "";
  };
  const region = pick("region") || pick("subregion") || pick("county") || "";
  const country = pick("country") || (map.kind === "country" ? f.text : "");
  const name = f.text || (f.place_name || "").split(",")[0];
  /* ISO 3166-2 region code (e.g. "US-TX") from the region context entry, or the
     feature itself when it IS a state/province — the surest region signal. */
  const regionCtx = ctx.find(x => String(x.id || "").startsWith("region"));
  const regionCode = (regionCtx && regionCtx.short_code)
    || (f.properties && f.properties.short_code) || "";
  return {
    id: "mt-" + (f.id || `${f.center[0]},${f.center[1]}`),
    kind: map.kind, cc: ccFromFeature(f), flag: "📍",
    lat: f.center[1], lon: f.center[0],
    name: { en: name, fr: name },
    region: { en: region, fr: region },
    country: { en: country, fr: country },
    landmark: null, aliases: [], grad: ["#3B82F6", "#1E40AF"], dynamic: true,
    bbox: Array.isArray(f.bbox) && f.bbox.length === 4 ? f.bbox : null,
    fullName: f.place_name || name,
    placeType: primary, _zoom: map.zoom, regionCode,
  };
}

/* Small LRU-ish cache of recent query→results (per language). */
const MT_CACHE = new Map();
const MT_CACHE_MAX = 40;
function mtCacheKey(q) { return `${state.lang}::${q}`; }

/* Forward autocomplete. Caller supplies an AbortSignal so stale requests are
   cancelled. Returns [] on any failure (offline / bad key / aborted). */
async function maptilerGeocode(query, signal) {
  const q = query.trim();
  if (!MAPTILER_KEY || q.length < 2) return [];
  const cached = MT_CACHE.get(mtCacheKey(q));
  if (cached) return cached;
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json`
    + `?key=${MAPTILER_KEY}&language=${state.lang}&autocomplete=true&fuzzyMatch=true&limit=7`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const d = await res.json();
  const locs = (d.features || []).map(featureToLoc);
  MT_CACHE.set(mtCacheKey(q), locs);
  if (MT_CACHE.size > MT_CACHE_MAX) MT_CACHE.delete(MT_CACHE.keys().next().value);
  return locs;
}

/* Reverse geocode a coordinate through MapTiler → {name, region, cc, country}.
   Falls back to the keyless BigDataCloud provider when MapTiler is unavailable. */
async function reverseGeocodeMaptiler(lat, lon) {
  const url = `https://api.maptiler.com/geocoding/${lon},${lat}.json`
    + `?key=${MAPTILER_KEY}&language=${state.lang}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const feats = d.features || [];
  /* prefer a settlement-level feature over a raw address/POI for the card */
  const f = feats.find(x => ["place", "municipality", "locality", "joint_municipality"]
    .includes((x.place_type || [])[0])) || feats[0];
  if (!f) return { name: "", region: "", cc: "", country: "" };
  const loc = featureToLoc(f);
  return { name: loc.name.en, region: loc.region.en, cc: loc.cc, country: loc.country.en };
}

/* ─────────────────────── Date/time helpers ─────────────────────── */

function fmtHour(iso) {
  const h = parseInt(iso.slice(11, 13), 10);
  if (state.lang === "fr") return `${h} h`;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12} ${ampm}`;
}
function fmtClock(iso) {
  const h = iso.slice(11, 13), m = iso.slice(14, 16);
  if (state.lang === "fr") return `${parseInt(h, 10)} h ${m}`;
  const hh = parseInt(h, 10);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${m} ${hh >= 12 ? "PM" : "AM"}`;
}
function fmtDay(dateStr, short = true) {
  const d = new Date(dateStr + "T12:00:00");
  const arr = short ? t("daysShort") : t("days");
  return arr[d.getDay()];
}
function fmtDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return state.lang === "fr"
    ? `${d.getDate()} ${t("months")[d.getMonth()].toLowerCase()}`
    : `${t("months")[d.getMonth()]} ${d.getDate()}`;
}
function wmo(code) { return WMO[code] || WMO[0]; }
function wxDesc(code) { return wmo(code)[state.lang]; }

function skyKey(code, isDay) {
  const icon = wmo(code).icon;
  if (icon === "clear" || icon === "partly") return isDay ? "clear-day" : "clear-night";
  if (icon === "cloudy") return isDay ? "cloudy-day" : "cloudy-night";
  return icon; // rain / snow / storm / fog
}

/* ─────────────────────────── Rendering ─────────────────────────── */

function locName(loc) { return loc.name[state.lang] || loc.name.en; }

/* Local clock at the selected city, not the visitor's. Falls back silently to
   no display if the zone id is missing/invalid (Intl throws on a bad zone). */
const _clockFmt = {};
function localTimeStr(tz) {
  if (!tz) return null;
  const locale = state.lang === "fr" ? "fr-FR" : "en-US";
  const key = `${locale}::${tz}`;
  try {
    const fmt = _clockFmt[key] ||
      (_clockFmt[key] = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" }));
    return fmt.format(new Date());
  } catch { return null; } /* unknown/invalid IANA id */
}

/* Country names come from Intl.DisplayNames (ISO alpha-2 code + active
   language) — no manual translation table. Manual strings stay as fallback. */
const _displayNames = {};
function countryName(cc, fallback = "") {
  if (cc && cc.length === 2) {
    try {
      const dn = _displayNames[state.lang] ||
        (_displayNames[state.lang] = new Intl.DisplayNames([state.lang], { type: "region", fallback: "code" }));
      const name = dn.of(cc.toUpperCase());
      if (name && name !== cc.toUpperCase()) return name;
    } catch { /* unsupported code or runtime — fall back below */ }
  }
  return fallback;
}
function locCountry(loc) {
  return countryName(loc.cc, (loc.country && (loc.country[state.lang] || loc.country.en)) || "");
}
function locRegion(loc) {
  const r = loc.region[state.lang] || loc.region.en || "";
  /* display-only: geocoders return the anglicized "Quebec" in both languages */
  return state.lang === "fr" ? r.replace(/\bQuebec\b/g, "Québec") : r;
}
function kindLabel(kind) {
  return {
    country: t("kindCountry"), state: t("kindState"), province: t("kindProvince"),
    city: t("kindCity"), region: t("kindRegion"), town: t("kindTown"),
    village: t("kindVillage"), address: t("kindAddress"), poi: t("kindPlace"),
  }[kind] || t("kindCity");
}

/* ── Location image resolver ──
   Ordered providers; the first that returns HTML wins. This keeps the visual
   decoupled from callers so a real image API (e.g. Unsplash) can slot in as a
   new provider WITHOUT touching any component. Providers must key off stable
   identity (loc.id / curated landmark / country code) — never the raw query —
   so a duplicate city name (Paris TX) can never borrow Paris FR's image. */
const IMAGE_PROVIDERS = [
  /* 1. curated local landmark image (opt-in: loc.landmark.img is a URL/dataURI) */
  loc => (loc.landmark && loc.landmark.img)
    ? `<img class="loc-img" src="${loc.landmark.img}" alt="" loading="lazy">` : null,
  /* 2. existing local regional image (opt-in: loc.img on a curated entry) */
  loc => loc.img ? `<img class="loc-img" src="${loc.img}" alt="" loading="lazy">` : null,
  /* 3. country flag for countries */
  loc => loc.kind === "country" ? flagHtml(loc.cc) : null,
  /* 4. curated landmark emoji, else a generic location glyph (safe fallback) */
  loc => loc.landmark ? loc.landmark.emoji : "🏙️",
  /* NOTE: to add Unsplash later, insert a provider ABOVE this line that returns
     an <img> for loc.id/landmark and null on miss — nothing else changes. */
];
function resolveLocationImage(loc) {
  for (const provider of IMAGE_PROVIDERS) {
    const out = provider(loc);
    if (out) return out;
  }
  return "🏙️";
}
function locVisual(loc) { return resolveLocationImage(loc); }

/* ── Real location photos via Pexels ──
   For the selected location's hero + info-card visual. Priority:
   1) curated local image  2) Pexels (query built from full geocoding metadata,
   never an ambiguous city name alone)  3) the SVG/gradient fallback above.
   Async, race-guarded (photoToken), and cached (incl. negative results). */
const PEXELS_KEY = (window.__ENV || {}).PEXELS_KEY || "";
const PHOTO_CACHE = new Map();   // query → {src, photographer, link} | null
let photoToken = 0;              // bumped per location change → ignore stale swaps
function bumpPhotoToken() { photoToken++; }

function pexelsQuery(loc) {
  const name = (loc.name && (loc.name.en || loc.name.fr)) || "";
  const region = (loc.region && loc.region.en) || "";
  const country = (loc.country && loc.country.en) || locCountry(loc) || "";
  const suffix = loc.landmark ? "landmark"
    : (loc.kind === "city" || loc.kind === "village") ? "skyline" : "landscape";
  return [name, region, country, suffix].filter(Boolean).join(" ");
}

async function fetchPexelsPhoto(query) {
  if (!PEXELS_KEY || !query) return null;
  if (PHOTO_CACHE.has(query)) return PHOTO_CACHE.get(query);
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}`
      + `&orientation=landscape&per_page=1&size=medium`;
    const r = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const p = (d.photos || [])[0];
    const out = p ? {
      src: (p.src && (p.src.large2x || p.src.large || p.src.medium)) || "",
      photographer: p.photographer || "", link: p.url || "",
    } : null;
    PHOTO_CACHE.set(query, out);
    return out;
  } catch {
    PHOTO_CACHE.set(query, null); // negative cache — don't hammer a failing query
    return null;
  }
}

/* Fixed-ratio container: gradient + SVG/emoji fallback act as the skeleton; a
   real photo fades in on top only once loaded, so there is never a layout shift. */
function locPhotoHtml(loc, cls = "") {
  return `<div class="loc-photo loading ${cls}" style="${gradBg(loc)}">
    <span class="loc-photo-fallback" aria-hidden="true">${resolveLocationImage(loc)}</span>
  </div>`;
}

async function hydrateLocPhoto(el, loc) {
  if (!el || !loc) return;
  const token = photoToken;
  const done = () => { if (token === photoToken) el.classList.remove("loading"); };
  const swap = (src, credit) => {
    if (token !== photoToken || !src) return done();
    const pre = new Image();
    pre.onload = () => {
      if (token !== photoToken) return;
      let img = el.querySelector("img.loc-photo-img");
      if (!img) { img = document.createElement("img"); img.className = "loc-photo-img"; img.alt = ""; img.decoding = "async"; el.appendChild(img); }
      img.src = src;
      el.classList.add("has-photo");
      if (credit) { el.dataset.credit = credit; el.title = credit; }
      done();
    };
    pre.onerror = done;
    pre.src = src;
  };
  if (loc.landmark && loc.landmark.img) return swap(loc.landmark.img, "");
  if (loc.img) return swap(loc.img, "");
  let photo; try { photo = await fetchPexelsPhoto(pexelsQuery(loc)); } catch { return done(); }
  if (token !== photoToken) return;
  if (photo && photo.src) swap(photo.src, photo.photographer ? `Photo : ${photo.photographer} / Pexels` : "");
  else done(); // keep gradient/SVG fallback
}
function isFav(loc) { return state.favorites.some(f => f.id === loc.id); }

function renderHeroSkeleton() {
  $("#heroInner").innerHTML = `
    <div class="hero-top"><div class="skeleton" style="width:120px;height:30px;border-radius:999px"></div></div>
    <div class="hero-head">
      <div class="skeleton" style="width:min(260px,70%);height:44px"></div>
      <div class="skeleton" style="width:min(190px,55%);height:16px;margin-top:12px"></div>
    </div>
    <div class="hero-main">
      <div class="hero-now">
        <div class="skeleton" style="width:84px;height:84px;border-radius:50%"></div>
        <div class="hero-now-txt">
          <div class="skeleton" style="width:min(190px,50vw);height:56px"></div>
          <div class="skeleton" style="width:min(140px,38vw);height:16px;margin-top:10px"></div>
        </div>
      </div>
    </div>
    <div class="hero-updated"><div class="skeleton" style="width:180px;height:14px"></div></div>`;
}

function renderHero() {
  const { loc, wx } = state;
  const c = wx.current;
  const sky = skyKey(c.code, c.isDay);
  $("#heroBg").dataset.sky = sky;
  const hl = $("#heroLandmark");
  hl.innerHTML = locPhotoHtml(loc, "hero-photo");
  hydrateLocPhoto(hl.querySelector(".loc-photo"), loc);

  const mins = Math.max(0, Math.round((Date.now() - wx.updatedAt.getTime()) / 60000));
  const updatedTxt = mins < 1 ? t("justNow") : `${mins} ${t("minAgo")}`;
  const fav = isFav(loc);
  const landmarkLine = loc.kind !== "country" && loc.landmark
    ? `<span aria-hidden="true">·</span> ${esc(loc.landmark[state.lang] || loc.landmark.en)}` : "";
  const localTime = localTimeStr(wx.timezone);

  $("#heroInner").innerHTML = `
    <div class="hero-top">
      <span class="hero-loc-kicker"><span aria-hidden="true">${locVisual(loc)}</span> ${kindLabel(loc.kind)}</span>
      ${localTime ? `<span class="hero-clock"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> ${localTime}</span>` : ""}
    </div>
    <div class="hero-head">
      <h1 class="hero-city" id="heroCityName">${esc(locName(loc))}
        <button class="hero-fav-btn ${fav ? "is-fav" : ""}" id="heroFavBtn"
          aria-label="${fav ? t("removeFavorite") : t("addFavorite")}" aria-pressed="${fav}">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="${fav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9L12 3z"/></svg>
        </button>
      </h1>
      <p class="hero-region">${esc(locRegion(loc))} ${locRegion(loc) ? "·" : ""} ${loc.kind === "country" ? "" : flagsHtml(loc) + " "}${esc(locCountry(loc))} ${landmarkLine}</p>
    </div>
    <div class="hero-main">
      <div class="hero-now">
        <div class="hero-wicon">${weatherIcon(wmo(c.code).icon, c.isDay)}</div>
        <div class="hero-now-txt">
          <div class="hero-temp">${fmtTemp(c.temp)}<sup>${tempUnit()}</sup></div>
          <div class="hero-desc">${wxDesc(c.code)}</div>
        </div>
      </div>
      <div class="hero-hl">
        <span>↑ <b>${fmtTemp(wx.daily[0].hi)}°</b> ${t("high")}</span>
        <span>↓ <b>${fmtTemp(wx.daily[0].lo)}°</b> ${t("low")}</span>
      </div>
    </div>
    <div class="hero-updated">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      ${t("updated")} · ${updatedTxt}
      <span class="hero-live"><span class="pulse-dot" aria-hidden="true"></span> ${state.isDemo ? t("demoData") : t("live")}</span>
    </div>`;

  $("#heroFavBtn").addEventListener("click", toggleFavorite);
}

const METRICS = [
  { key: "temperature", icon: "temperature", tint: "tint-amber",   simple: true,
    val: c => `${fmtTemp(c.temp)}<span class="unit">${tempUnit()}</span>`, foot: c => wxDesc(c.code) },
  { key: "humidity", icon: "humidity", tint: "tint-sky", simple: true,
    val: c => `${Math.round(c.humidity)}<span class="unit">%</span>`,
    foot: c => c.humidity > 70 ? t("humid") : c.humidity < 35 ? t("dry") : t("comfortable") },
  { key: "windSpeed", icon: "wind", tint: "tint-emerald", simple: true,
    val: c => `${fmtWind(c.windSpeed)}<span class="unit">${windUnit()}</span>`, foot: c => compass(c.windDir).label },
  { key: "feelsLike", icon: "feels", tint: "tint-rose", simple: true,
    /* 4th Simple-mode card: apparent_temperature is a plain `current` field with
       no `??` fallback in fetchWeatherRaw (unlike rainProb, which defaults to 0
       when Open-Meteo omits it) — the most reliable value already on hand. */
    val: c => `${fmtTemp(c.feels)}<span class="unit">${tempUnit()}</span>`, foot: () => "" },
  { key: "windDirection", icon: "direction", tint: "tint-emerald",
    val: c => `${compass(c.windDir).abbr}<span class="unit">${Math.round(c.windDir)}°</span>`, foot: c => compass(c.windDir).label },
  { key: "pressure", icon: "pressure", tint: "tint-violet",
    val: c => `${Math.round(c.pressure)}<span class="unit">hPa</span>`,
    foot: c => c.pressure > 1020 ? t("highPressure") : c.pressure < 1005 ? t("lowPressure") : t("normalPressure") },
  { key: "uvIndex", icon: "uv", tint: "tint-amber",
    val: c => `${Math.round(c.uv * 10) / 10}`, foot: c => uvLabel(c.uv) },
  { key: "visibility", icon: "visibility", tint: "tint-blue",
    val: c => `${Math.round(c.visibility)}<span class="unit">km</span>`,
    foot: c => c.visibility >= 20 ? t("excellent") : c.visibility >= 10 ? t("good") : c.visibility >= 4 ? t("moderate") : t("poor") },
  { key: "sunrise", icon: "sunrise", tint: "tint-amber",
    val: (c, wx) => `<span style="font-size:22px">${fmtClock(wx.daily[0].sunrise)}</span>`, foot: () => "" },
  { key: "sunset", icon: "sunset", tint: "tint-violet",
    val: (c, wx) => `<span style="font-size:22px">${fmtClock(wx.daily[0].sunset)}</span>`, foot: () => "" },
  { key: "rainChance", icon: "rain", tint: "tint-sky",
    val: c => `${Math.round(c.rainProb)}<span class="unit">%</span>`, foot: () => "" },
  { key: "dewPoint", icon: "dew", tint: "tint-blue",
    val: c => `${fmtTemp(c.dewPoint)}<span class="unit">${tempUnit()}</span>`, foot: () => "" },
];

function renderMetrics() {
  const c = state.wx.current;
  $("#metricsGrid").innerHTML = METRICS.map((m, i) => `
    <div class="metric-card ${m.simple ? "" : "detailed-only"}" style="animation-delay:${i * 45}ms">
      <div class="metric-head">
        <span class="metric-ico ${m.tint}" aria-hidden="true">${METRIC_ICONS[m.icon]}</span>
        <span class="metric-label">${t(m.key)}</span>
      </div>
      <div class="metric-value">${m.val(c, state.wx)}</div>
      ${m.foot(c, state.wx) ? `<div class="metric-foot">${m.foot(c, state.wx)}</div>` : ""}
    </div>`).join("");
}

/* ── Detailed-mode grouped metrics ──
   Simple mode keeps using METRICS/renderMetrics/#metricsGrid completely
   unchanged above. This is a SEPARATE container (#metricsGridDetailed) so
   compacting Detailed can never touch Simple's markup, CSS, or render path.
   Values are pulled from the same METRICS entries (not recomputed) so the
   numbers can never drift between the two views. */
function metricVal(key, c, wx) { const m = METRICS.find(x => x.key === key); return m ? m.val(c, wx) : ""; }
function metricFoot(key, c, wx) { const m = METRICS.find(x => x.key === key); return m ? m.foot(c, wx) : ""; }
const stripHtml = s => String(s).replace(/<[^>]*>/g, "");

function renderGroupedMetrics() {
  const el = $("#metricsGridDetailed");
  if (!el) return;
  const c = state.wx.current, wx = state.wx;

  const cardHtml = (g, i) => `
    <div class="metric-group" style="animation-delay:${i * 45}ms" aria-label="${esc(g.label)}">
      <div class="mg-head"><span class="metric-ico ${g.tint}" aria-hidden="true">${METRIC_ICONS[g.icon]}</span><span class="mg-title">${g.title}</span></div>
      ${g.primary !== undefined ? `<div class="mg-primary">${g.primary}</div>` : ""}
      ${g.rows && g.rows.length ? `<div class="mg-rows ${g.rowsEq ? "mg-rows-eq" : ""}">${g.rows.map(r => `
        <div class="mg-row">${r.icon ? `<span class="metric-ico ${r.tint}" aria-hidden="true">${METRIC_ICONS[r.icon]}</span>` : ""}<span class="mg-row-label">${r.label}</span><span class="mg-row-value">${r.value}</span></div>`).join("")}</div>` : ""}
      ${g.status ? `<div class="mg-status">${g.status}</div>` : ""}
    </div>`;

  const groups = [
    { key: "temperature", tint: "tint-amber", icon: "temperature", title: t("temperature"),
      primary: metricVal("temperature", c, wx),
      rows: [{ label: t("feelsLike"), value: metricVal("feelsLike", c, wx) }],
      status: wxDesc(c.code),
      label: `${t("temperature")}: ${stripHtml(metricVal("temperature", c, wx))}, ${t("feelsLike")} ${stripHtml(metricVal("feelsLike", c, wx))}, ${wxDesc(c.code)}` },
    { key: "humidity", tint: "tint-sky", icon: "humidity", title: t("humidity"),
      primary: metricVal("humidity", c, wx),
      rows: [{ label: t("dewPoint"), value: metricVal("dewPoint", c, wx) }],
      status: metricFoot("humidity", c, wx),
      label: `${t("humidity")}: ${stripHtml(metricVal("humidity", c, wx))}, ${t("dewPoint")} ${stripHtml(metricVal("dewPoint", c, wx))}, ${metricFoot("humidity", c, wx)}` },
    { key: "wind", tint: "tint-emerald", icon: "wind", title: t("wind"),
      primary: metricVal("windSpeed", c, wx),
      /* built directly (not via metricVal) only to add a space between the
         compass abbreviation and the degree figure — cramped without it once
         the two sit side by side in a compact row instead of a full card */
      rows: [{ label: t("windDirection"), value: `${compass(c.windDir).abbr} <span class="unit">${Math.round(c.windDir)}°</span>` }],
      status: compass(c.windDir).label,
      label: `${t("wind")}: ${stripHtml(metricVal("windSpeed", c, wx))}, ${t("windDirection")} ${compass(c.windDir).abbr} ${Math.round(c.windDir)}°` },
    { key: "pressure", tint: "tint-violet", icon: "pressure", title: t("pressure"),
      primary: metricVal("pressure", c, wx),
      status: metricFoot("pressure", c, wx),
      label: `${t("pressure")}: ${stripHtml(metricVal("pressure", c, wx))}, ${metricFoot("pressure", c, wx)}` },
    { key: "uv", tint: "tint-amber", icon: "uv", title: t("uvIndex"),
      primary: metricVal("uvIndex", c, wx),
      status: metricFoot("uvIndex", c, wx),
      label: `${t("uvIndex")}: ${stripHtml(metricVal("uvIndex", c, wx))}, ${metricFoot("uvIndex", c, wx)}` },
    { key: "visibility", tint: "tint-blue", icon: "visibility", title: t("visibility"),
      primary: metricVal("visibility", c, wx),
      status: metricFoot("visibility", c, wx),
      label: `${t("visibility")}: ${stripHtml(metricVal("visibility", c, wx))}, ${metricFoot("visibility", c, wx)}` },
    { key: "sunCycle", tint: "tint-amber", icon: "sunrise", title: t("sunCycle"),
      rowsEq: true,
      /* no per-row icon (header icon already reads "sun cycle") — keeping the
         row to label+value only lets it share the same narrow-width
         label-above-value stacking as every other group, instead of a 3-way
         icon/label/value split that stacking would otherwise produce */
      rows: [
        { label: t("sunrise"), value: fmtClock(wx.daily[0].sunrise) },
        { label: t("sunset"), value: fmtClock(wx.daily[0].sunset) },
      ],
      label: `${t("sunCycle")}: ${t("sunrise")} ${fmtClock(wx.daily[0].sunrise)}, ${t("sunset")} ${fmtClock(wx.daily[0].sunset)}` },
    /* Precipitation: only a probability % exists anywhere in this app's data
       model (fetchWeatherRaw never requests a raw mm amount) — no secondary
       row is fabricated for it, per "hide cleanly rather than show fake data". */
    { key: "rain", tint: "tint-sky", icon: "rain", title: t("precipitation"),
      primary: metricVal("rainChance", c, wx),
      label: `${t("precipitation")}: ${stripHtml(metricVal("rainChance", c, wx))}` },
  ];

  el.innerHTML = groups.map(cardHtml).join("");
}

function forecastCardHtml(d, i) {
  return `
    <div class="forecast-card ${i === 0 ? "is-today" : ""}" style="animation-delay:${i * 70}ms">
      <div class="fc-day">${i === 0 ? t("today") : fmtDay(d.date)}</div>
      <div class="fc-date">${fmtDate(d.date)}</div>
      <div class="fc-icon">${weatherIcon(wmo(d.code).icon, true)}</div>
      <div class="fc-desc">${wxDesc(d.code)}</div>
      <div class="fc-temps"><span class="hi">${fmtTemp(d.hi)}°</span><span class="lo">${fmtTemp(d.lo)}°</span></div>
      ${d.rainProb >= 20 ? `<span class="fc-rain">💧 ${Math.round(d.rainProb)}%</span>` : ""}
    </div>`;
}

function renderForecast() {
  $("#forecastRow").innerHTML = state.wx.daily.slice(0, 5).map(forecastCardHtml).join("");
  $("#forecastSub").textContent = `${t("forecastFor")} ${locName(state.loc)}, ${locCountry(state.loc)}`;
}

const CHART_TABS = [
  { id: "temp",     labelKey: "chartTemp",     color: "#D97706", unit: () => tempUnit(),   get: h => convTemp(h.temp), fmt: v => Math.round(v) },
  { id: "humidity", labelKey: "chartHumidity", color: "#0284C7", unit: () => "%",          get: h => h.humidity,  fmt: v => Math.round(v) },
  { id: "wind",     labelKey: "chartWind",     color: "#059669", unit: () => windUnit(),   get: h => convWind(h.wind), fmt: v => Math.round(v) },
  { id: "pressure", labelKey: "chartPressure", color: "#7C3AED", unit: () => "hPa",        get: h => h.pressure,  fmt: v => Math.round(v) },
];

function renderChartTabs() {
  $("#chartTabs").innerHTML = CHART_TABS.map(tab => `
    <button role="tab" aria-selected="${state.chartTab === tab.id}" data-tab="${tab.id}">${t(tab.labelKey)}</button>`).join("");
  $$("#chartTabs button").forEach(btn => btn.addEventListener("click", () => {
    state.chartTab = btn.dataset.tab;
    renderChartTabs(); renderChart();
  }));
}

function renderChart() {
  if (state.mode !== "detailed" || !state.wx) return;
  const tab = CHART_TABS.find(x => x.id === state.chartTab);
  const points = state.wx.hourly.slice(0, 25).map(h => ({ t: fmtHour(h.time), v: tab.get(h) }));
  renderLineChart($("#chartHost"), {
    points, color: tab.color, unit: tab.unit(), format: tab.fmt,
    ariaLabel: `${t(tab.labelKey)} — ${t("next24h")}`,
  });
}

function renderInsights() {
  const wx = state.wx;
  const uvMax = wx.daily[0].uvMax;
  const windMax = wx.daily[0].windMax;
  const rainMax = Math.max(...wx.hourly.map(h => h.rainProb));
  const items = [
    { emoji: "🧴", tint: "tint-amber", title: t("insightUvTitle"),
      text: uvMax >= 5 ? t("insightUvHigh") : t("insightUvLow"),
      value: Math.round(uvMax * 10) / 10, sub: t("uvIndex") },
    { emoji: "🍃", tint: "tint-emerald", title: t("insightWindTitle"),
      text: windMax >= 28 ? t("insightWindStrong") : t("insightWindCalm"),
      value: `${fmtWind(windMax)} ${windUnit()}`, sub: t("wind") },
    { emoji: "☂️", tint: "tint-sky", title: t("insightRainTitle"),
      text: rainMax >= 40 ? t("insightRainYes") : t("insightRainNo"),
      value: `${Math.round(rainMax)} %`, sub: t("rainChance") },
  ];
  $("#insightsGrid").innerHTML = items.map((it, i) => `
    <div class="insight-card" style="animation-delay:${i * 80}ms">
      <span class="insight-emoji ${it.tint}" aria-hidden="true">${it.emoji}</span>
      <div class="insight-body"><h3>${it.title}</h3><p>${it.text}</p></div>
      <div class="insight-value"><b>${it.value}</b><span>${it.sub}</span></div>
    </div>`).join("");
}

/* Compact Simple-mode strip: next 6 CONSECUTIVE hours (unlike the Forecast
   page's renderHourly below, which samples every 3rd hour over a wider span —
   deliberately lighter/denser here, not a duplicate of that view). */
function renderHomeHourly() {
  const el = $("#homeHourlyStrip");
  if (!el) return;
  const nowLabel = state.lang === "fr" ? "Maint." : "Now";
  const cells = state.wx.hourly.slice(0, 6);
  el.innerHTML = cells.map((h, i) => {
    const time = i === 0 ? nowLabel : fmtHour(h.time);
    const desc = wxDesc(h.code);
    const temp = `${fmtTemp(h.temp)}${tempUnit()}`;
    const rain = Math.round(h.rainProb);
    const label = `${time}, ${desc}, ${temp}${rain > 0 ? `, ${rain}% ${t("rainChance")}` : ""}`;
    return `
    <div class="hour-cell ${i === 0 ? "is-now" : ""}" role="group" aria-label="${esc(label)}">
      <div class="h-time" aria-hidden="true">${esc(time)}</div>
      <div class="h-icon">${weatherIcon(wmo(h.code).icon, h.isDay)}</div>
      <div class="h-temp" aria-hidden="true">${temp}</div>
      ${rain > 0 ? `<div class="h-rain" aria-hidden="true">💧 ${rain}%</div>` : ""}
    </div>`;
  }).join("");
}

function renderHourly() {
  const nowLabel = state.lang === "fr" ? "Maint." : "Now";
  const cells = state.wx.hourly.filter((_, i) => i % 3 === 0).slice(0, 8);
  $("#hourlyStrip").innerHTML = cells.map((h, i) => `
    <div class="hour-cell ${i === 0 ? "is-now" : ""}">
      <div class="h-time">${i === 0 ? nowLabel : fmtHour(h.time)}</div>
      <div class="h-icon">${weatherIcon(wmo(h.code).icon, h.isDay)}</div>
      <div class="h-temp">${fmtTemp(h.temp)}${tempUnit()}</div>
      <div class="h-rain">💧 ${Math.round(h.rainProb)}%</div>
      <div class="h-wind">${METRIC_ICONS.wind} ${fmtWind(h.wind)} ${windUnit()}</div>
    </div>`).join("");
}

/* ── Forecast page (Prévisions) ── */

const FC_TABS = [
  { id: "temp",   labelKey: "chartTemp",     color: "#D97706", unit: () => tempUnit(), get: h => convTemp(h.temp) },
  { id: "feels",  labelKey: "feelsLike",     color: "#E11D48", unit: () => tempUnit(), get: h => convTemp(h.feels) },
  { id: "precip", labelKey: "precipitation", color: "#0284C7", unit: () => "%",        get: h => h.rainProb },
  { id: "wind",   labelKey: "chartWind",     color: "#059669", unit: () => windUnit(), get: h => convWind(h.wind) },
];

function aqInfo(aqi) {
  if (aqi == null) return { label: "—", cls: "" };
  if (aqi <= 50) return { label: t("aqGood"), cls: "is-good" };
  if (aqi <= 75) return { label: t("aqModerate"), cls: "is-warn" };
  if (aqi <= 100) return { label: t("aqPoor"), cls: "is-bad" };
  return { label: t("aqVeryPoor"), cls: "is-bad" };
}

function renderForecastPage() {
  const wx = state.wx, loc = state.loc;
  $("#forecastViewSub").textContent = `${t("fcDetailedFor")} ${locName(loc)}`;
  $("#forecastRow2").innerHTML = wx.daily.map(forecastCardHtml).join("");

  /* hourly chart with tabs */
  $("#fcTabs").innerHTML = FC_TABS.map(tab => `
    <button role="tab" aria-selected="${state.fcTab === tab.id}" data-tab="${tab.id}">${t(tab.labelKey)}</button>`).join("");
  $$("#fcTabs button").forEach(b => b.addEventListener("click", () => {
    state.fcTab = b.dataset.tab;
    renderForecastPage();
  }));
  const tab = FC_TABS.find(x => x.id === state.fcTab);
  renderLineChart($("#fcChartHost"), {
    points: wx.hourly.slice(0, 25).map(h => ({ t: fmtHour(h.time), v: tab.get(h) })),
    color: tab.color, unit: tab.unit(), format: v => Math.round(v),
    ariaLabel: `${t(tab.labelKey)} — ${t("hourlyForecast")}`,
  });

  /* precipitation bars, every 3 hours */
  renderBarChart($("#precipHost"), {
    points: wx.hourly.filter((_, i) => i % 3 === 0).slice(0, 8).map(h => ({ t: fmtHour(h.time), v: h.rainProb })),
    ariaLabel: t("precipitation"),
  });

  /* today's details */
  const d0 = wx.daily[0];
  const aq = aqInfo(wx.current.aqi);
  $("#dayDetails").innerHTML = `
    <h3 class="info-title">${t("dayDetails")}</h3>
    <div class="dd-grid">
      <div class="dd-item">
        <span class="metric-ico tint-amber" aria-hidden="true">${METRIC_ICONS.sunrise}</span>
        <div><dt>${t("sunrise")}</dt><dd>${fmtClock(d0.sunrise)}</dd></div>
      </div>
      <div class="dd-item">
        <span class="metric-ico tint-violet" aria-hidden="true">${METRIC_ICONS.sunset}</span>
        <div><dt>${t("sunset")}</dt><dd>${fmtClock(d0.sunset)}</dd></div>
      </div>
      <div class="dd-item">
        <span class="metric-ico tint-amber" aria-hidden="true">${METRIC_ICONS.uv}</span>
        <div><dt>${t("uvIndex")}</dt><dd>${Math.round(d0.uvMax)}</dd><span class="dd-badge is-warn">${uvLabel(d0.uvMax)}</span></div>
      </div>
      <div class="dd-item">
        <span class="metric-ico tint-emerald" aria-hidden="true">${METRIC_ICONS.visibility}</span>
        <div><dt>${t("airQuality")}</dt><dd>${wx.current.aqi ?? "—"}</dd><span class="dd-badge ${aq.cls}">${aq.label}</span></div>
      </div>
    </div>`;

  /* summary */
  const avgWind = wx.hourly.reduce((s, h) => s + h.wind, 0) / wx.hourly.length;
  const summary = t("summaryTpl")
    .replace("{desc}", wxDesc(d0.code))
    .replace("{max}", `${fmtTemp(d0.hi)}${tempUnit()}`)
    .replace("{min}", `${fmtTemp(d0.lo)}${tempUnit()}`)
    .replace("{wind}", `${fmtWind(avgWind)} ${windUnit()}`)
    .replace("{dir}", compass(wx.current.windDir).label);
  $("#daySummary").innerHTML = `
    <h3 class="info-title">${t("summaryTitle")}</h3>
    <p class="sum-text">${summary}</p>
    <div class="sum-rows">
      <div class="sum-row"><span class="metric-ico tint-rose" aria-hidden="true">${METRIC_ICONS.temperature}</span> ${t("maxLabel")} <b style="color:var(--rose)">${fmtTemp(d0.hi)}${tempUnit()}</b></div>
      <div class="sum-row"><span class="metric-ico tint-blue" aria-hidden="true">${METRIC_ICONS.temperature}</span> ${t("minLabel")} <b style="color:var(--primary)">${fmtTemp(d0.lo)}${tempUnit()}</b></div>
      <div class="sum-row"><span class="metric-ico tint-emerald" aria-hidden="true">${METRIC_ICONS.wind}</span> ${t("avgWind")} <b>${fmtWind(avgWind)} ${windUnit()}</b></div>
    </div>`;
}

function gradBg(loc) {
  return `background:linear-gradient(145deg, ${loc.grad[0]}, ${loc.grad[1]})`;
}

function renderExplore() {
  $("#exploreCarousel").innerHTML = EXPLORE_IDS.map(id => {
    const loc = LOCATIONS.find(l => l.id === id);
    return `
      <button class="explore-card" data-loc="${esc(loc.id)}" aria-label="${esc(locName(loc))}, ${esc(locCountry(loc))}">
        <span class="explore-bg" style="${gradBg(loc)}" aria-hidden="true"></span>
        <span class="explore-emoji" aria-hidden="true">${locVisual(loc)}</span>
        <span class="explore-txt">
          <span class="explore-name">${esc(locName(loc))}</span>
          <span class="explore-country">${flagsHtml(loc, "small")} ${loc.kind === "country" ? kindLabel(loc.kind) : esc(locCountry(loc))}</span>
        </span>
      </button>`;
  }).join("");
  $$(".explore-card").forEach(card => card.addEventListener("click", () => {
    selectLocation(LOCATIONS.find(l => l.id === card.dataset.loc));
    switchView("home");
  }));
}

/* Live weather for all favorites, fetched in one batched call */
let favWx = {};      // loc.id → { temp, code, isDay, hi, lo, humidity, wind }
let favWxAt = 0;
let favWxKey = "";

async function loadFavWeather(force = false) {
  const locs = state.favorites;
  if (!locs.length) return;
  const key = locs.map(l => l.id).join(",");
  if (!force && key === favWxKey && Date.now() - favWxAt < 4 * 60000) return;
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: locs.map(l => l.lat).join(","),
      longitude: locs.map(l => l.lon).join(","),
      current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
      daily: "temperature_2m_max,temperature_2m_min",
      forecast_days: "1", timezone: "auto",
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await res.json();
    const arr = Array.isArray(d) ? d : [d];
    favWx = {};
    locs.forEach((loc, i) => {
      favWx[loc.id] = {
        temp: arr[i].current.temperature_2m, code: arr[i].current.weather_code,
        isDay: arr[i].current.is_day, humidity: arr[i].current.relative_humidity_2m,
        wind: arr[i].current.wind_speed_10m,
        hi: arr[i].daily.temperature_2m_max[0], lo: arr[i].daily.temperature_2m_min[0],
      };
    });
  } catch {
    favWx = {};
    locs.forEach(loc => {
      const w = demoWeather(loc);
      favWx[loc.id] = { temp: w.current.temp, code: w.current.code, isDay: w.current.isDay,
        humidity: w.current.humidity, wind: w.current.windSpeed, hi: w.daily[0].hi, lo: w.daily[0].lo };
    });
  }
  favWxAt = Date.now();
  favWxKey = key;
  renderFavorites();
}

function favAgoText() {
  const mins = Math.max(0, Math.round((Date.now() - favWxAt) / 60000));
  return mins < 1 ? t("justNow") : t("agoMin").replace("{m}", mins);
}

function favCardHtml(loc, i) {
  const w = favWx[loc.id];
  return `
    <div class="favx-card" role="button" tabindex="0" data-loc="${esc(loc.id)}" aria-label="${esc(locName(loc))}" style="animation-delay:${i * 60}ms">
      <span class="favx-bg" style="${gradBg(loc)}" aria-hidden="true"></span>
      <span class="favx-emoji" aria-hidden="true">${locVisual(loc)}</span>
      <span class="favx-top">
        ${flagsHtml(loc, "small")}
        <span class="favx-names"><b>${esc(locName(loc))}</b><span>${esc(locCountry(loc))}</span></span>
        <button class="favx-star" data-remove="${esc(loc.id)}" aria-label="${t("removeFavorite")}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#FBBF24" stroke="#FBBF24" stroke-width="1.6" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9L12 3z"/></svg>
        </button>
      </span>
      <span class="favx-main">
        ${w ? `
          <span class="favx-temp">${fmtTemp(w.temp)}<sup>${tempUnit()}</sup></span>
          <span class="favx-desc"><span class="favx-wicon">${weatherIcon(wmo(w.code).icon, w.isDay)}</span> ${wxDesc(w.code)}</span>
          <span class="favx-chips">
            <span>↑ ${fmtTemp(w.hi)}°</span><span>↓ ${fmtTemp(w.lo)}°</span>
            <span>💧 ${Math.round(w.humidity)}%</span><span>🍃 ${fmtWind(w.wind)} ${windUnit()}</span>
          </span>` : `<span class="favx-temp">…</span>`}
      </span>
      <span class="favx-foot">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        ${t("updated")} ${favAgoText()}
      </span>
    </div>`;
}

function favRowHtml(loc) {
  const w = favWx[loc.id];
  return `
    <tr data-loc="${esc(loc.id)}" tabindex="0">
      <td>
        <span class="ft-place">
          <span class="ft-visual" style="${gradBg(loc)}" aria-hidden="true">${locVisual(loc)}</span>
          <span class="ft-names">${flagHtml(loc.cc)} <b>${esc(locName(loc))}</b><span>${esc(locCountry(loc))}</span></span>
        </span>
      </td>
      <td><span class="ft-cond">${w ? `<span class="ft-wicon">${weatherIcon(wmo(w.code).icon, w.isDay)}</span> ${wxDesc(w.code)}` : "…"}</span></td>
      <td><b>${w ? fmtTemp(w.temp) + tempUnit() : "—"}</b></td>
      <td>${w ? `<span class="ft-hi">${fmtTemp(w.hi)}°</span> / <span class="ft-lo">${fmtTemp(w.lo)}°</span>` : "—"}</td>
      <td>💧 ${w ? Math.round(w.humidity) + "%" : "—"}</td>
      <td>🍃 ${w ? fmtWind(w.wind) + " " + windUnit() : "—"}</td>
      <td class="ft-ago">${favAgoText()}</td>
      <td>
        <button class="fav-remove-s" data-remove="${esc(loc.id)}" aria-label="${t("removeFavorite")}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </td>
    </tr>`;
}

function favClickHandler(e) {
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    e.stopPropagation();
    state.favorites = state.favorites.filter(f => f.id !== rm.dataset.remove);
    persistFavs(); renderFavorites();
    if (state.loc) renderHero();
    showToast(t("removedFav"));
    return;
  }
  const host = e.target.closest("[data-loc]");
  if (!host) return;
  const loc = state.favorites.find(f => f.id === host.dataset.loc);
  if (loc) { selectLocation(loc); switchView("home"); }
}

function renderFavorites() {
  const grid = $("#favGrid");
  const listBlock = $("#favListBlock");
  const badge = $("#favBadge");
  badge.hidden = state.favorites.length === 0;
  badge.textContent = state.favorites.length;

  if (!state.favorites.length) {
    grid.hidden = false;
    grid.innerHTML = `
      <div class="empty-state">
        <div class="big" aria-hidden="true">⭐</div>
        <h3>${t("favEmptyTitle")}</h3>
        <p>${t("favEmptyText")}</p>
      </div>`;
    listBlock.hidden = true;
    return;
  }

  grid.hidden = state.favView === "list";
  grid.innerHTML = state.favorites.map(favCardHtml).join("");

  listBlock.hidden = false;
  $("#favTable").innerHTML = `
    <thead><tr>
      <th>${t("colPlace")}</th><th>${t("colConditions")}</th><th>${t("colTemp")}</th>
      <th>${t("colMaxMin")}</th><th>${t("humidity")}</th><th>${t("wind")}</th>
      <th>${t("updated")}</th><th></th>
    </tr></thead>
    <tbody>${state.favorites.map(favRowHtml).join("")}</tbody>`;

  grid.onclick = favClickHandler;
  $("#favTable").onclick = favClickHandler;
  /* cards are divs with role=button; rows are focusable — support Enter/Space */
  const keyHandler = e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("button")) return; /* real buttons handle keys natively */
    if (!e.target.closest("[data-loc]")) return;
    e.preventDefault();
    favClickHandler(e);
  };
  grid.onkeydown = keyHandler;
  $("#favTable").onkeydown = keyHandler;
}

function toggleFavorite() {
  const loc = state.loc;
  if (isFav(loc)) {
    state.favorites = state.favorites.filter(f => f.id !== loc.id);
    showToast(t("removedFav"));
  } else {
    state.favorites.push(loc);
    showToast(t("addedFav"));
    loadFavWeather(true);
  }
  persistFavs(); renderHero(); renderFavorites();
}
function persistFavs() { localStorage.setItem("ws_favs", JSON.stringify(state.favorites)); }

/* ─────────────────────────── World map ─────────────────────────── */

/* Resolve a location's US-state / CA-province flag KEY from geocoding metadata —
   ISO/postal short_code first, then curated rc code, then the region's own name.
   Never from the raw typed query. Returns null for other countries or unknowns
   (e.g. Washington, D.C. → region "District of Columbia" → no match). */
function regionKeyFor(loc) {
  if (!loc) return null;
  const cc = (loc.cc || "").toUpperCase();
  if (cc !== "US" && cc !== "CA") return null;
  const codeMap = cc === "US" ? US_CODE_TO_KEY : CA_CODE_TO_KEY;
  /* 1. explicit region code, e.g. MapTiler short_code "US-TX" / "CA-QC" */
  if (loc.regionCode) {
    const two = String(loc.regionCode).toUpperCase().split("-").pop();
    if (codeMap[two]) return codeMap[two];
  }
  /* 2. curated 2-letter rc code from data.js */
  if (loc.rc && RC_TO_KEY[loc.rc.toLowerCase()]) return RC_TO_KEY[loc.rc.toLowerCase()];
  /* 3. parent region context — the state/province the place sits in. Checked
     BEFORE the own-name step so a county named "Texas" (in Oklahoma) or
     "Washington" (in Maine) uses its parent, not its own name. */
  const parent = regionKeyFromName(loc.region && loc.region.en);
  if (parent) return parent;
  /* 4. no parent region → the location itself IS the state/province */
  if (["state", "province", "region"].includes(loc.kind)) {
    return regionKeyFromName(loc.name && (loc.name.en || locName(loc)));
  }
  return null;
}

/* accessible, language-aware alt text */
function flagAlt(name) { return state.lang === "fr" ? `Drapeau : ${name}` : `${name} flag`; }

/* Country flag + state/province flag (high-quality local SVGs for US/CA), in
   order [country] [region]. Reusable across search, hero, popup, info, favorites. */
/* Each flag gets its OWN fixed-height wrapper so the country flag and the
   state/province flag keep their different natural widths (US 19:10 vs
   California 3:2, …) — never forced to equal/square boxes. variant "small"
   uses the compact height. */
function flagsHtml(loc, variant = "") {
  const cc = (loc.cc || "").toUpperCase();
  const wrap = inner => `<span class="location-flag-wrap">${inner}</span>`;
  const wraps = [];
  const cSrc = countryFlagSrc(cc);
  wraps.push(wrap(cSrc ? flagImgTag(cSrc, flagAlt(locCountry(loc) || cc)) : flagHtml(cc)));
  const key = regionKeyFor(loc);
  if (key) {
    const rSrc = regionFlagSrc(key);
    if (rSrc) {
      const rName = ["state", "province", "region"].includes(loc.kind) ? locName(loc) : locRegion(loc);
      wraps.push(wrap(flagImgTag(rSrc, flagAlt(rName || key))));
    }
  }
  const small = variant === "small" ? " location-flags--small" : "";
  return `<span class="location-flags${small}">${wraps.join("")}</span>`;
}

/* ── Interactive map (MapLibre GL JS + MapTiler) ── */

/* zoom per location type; huge countries get a wider view */
function zoomFor(loc) {
  if (typeof loc._zoom === "number") return loc._zoom; /* MapTiler result: type-based */
  if (loc.kind === "country") return ["usa", "canada", "australia"].includes(loc.id) ? 4 : 5;
  if (loc.kind === "state" || loc.kind === "province" || loc.kind === "region") return 6;
  if (loc.kind === "village") return 13;
  if (loc.kind === "address" || loc.kind === "poi") return 16;
  return 11; // city / town
}

function popupHtml(loc) {
  const line2 = loc.kind === "country"
    ? esc(locRegion(loc))
    : `${kindLabel(loc.kind)} · ${esc(locRegion(loc))}${locRegion(loc) ? ", " : ""}${esc(locCountry(loc))}`;
  const c = state.wx && state.wx.current;
  return `<div class="map-popup">
    <div class="mp-name">${flagsHtml(loc, "small")} <b>${esc(locName(loc))}</b></div>
    <div class="mp-sub">${line2}${loc.landmark ? ` · ${esc(loc.landmark[state.lang] || loc.landmark.en)}` : ""}</div>
    ${c ? `<div class="mp-wx">${weatherIcon(wmo(c.code).icon, c.isDay)}
      <div><b>${fmtTemp(c.temp)}${tempUnit()}</b><span>${wxDesc(c.code)}</span></div>
    </div>` : ""}
    <button class="mp-link" onclick="switchView('home')">${t("viewWeather")} →</button>
  </div>`;
}

/* ── MapLibre GL + MapTiler Hybrid v4 ──
   Borders, state/province lines, city/town/road labels all come from the
   vector style itself (countries at low zoom, regions/cities at medium,
   towns/roads at high) — no GeoJSON overlays needed anymore.
   The key is read from the gitignored js/env.js (mirror of .env.local);
   with a Vite build this would be import.meta.env.VITE_MAPTILER_KEY. */
const MAPTILER_KEY = (window.__ENV || {}).VITE_MAPTILER_KEY || "";
const MAP_STYLE = `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`;

const MAP_CONFIG = {
  worldMap: { view: "map", autoPopup: true },
  homeMap:  { view: "home", autoPopup: false },
};
const MAPS = {}; // containerId → { map, marker, popup, lastKey }

function mapError(id) {
  const el = $("#" + id);
  if (el && !el.querySelector(".map-offline")) {
    el.classList.remove("is-loading");
    el.innerHTML = `<p class="map-offline">${t("mapError")}</p>`;
  }
}

/* Point every label layer at the active language's name field, falling back to
   the local name where no translation exists. MapTiler vector labels use
   name:<lang> fields; rewriting text-field is the SDK-free way to localize.
   No map recreation — just a layout-property update per symbol layer. */
function applyMapLanguage(map) {
  if (!map || !map.isStyleLoaded()) return;
  const field = ["coalesce", ["get", "name:" + state.lang], ["get", "name"]];
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const tf = layer.layout && layer.layout["text-field"];
    if (tf === undefined) continue; /* icon-only layer, no label */
    try { map.setLayoutProperty(layer.id, "text-field", field); } catch { }
  }
}

function refreshMapLanguage() {
  Object.values(MAPS).forEach(inst => {
    if (inst.map.isStyleLoaded()) applyMapLanguage(inst.map);
    else inst.map.once("idle", () => applyMapLanguage(inst.map));
  });
}

function updateMap(id) {
  const loc = state.loc, cfg = MAP_CONFIG[id];
  const el = $("#" + id);
  /* only touch a map while its container is visible; the view becomes
     display:block one frame after switchView, so retry on the next frame */
  if (!el || !el.offsetWidth) {
    if (state.view === cfg.view) requestAnimationFrame(() => updateMap(id));
    return;
  }
  if (!MAPS[id]) {
    if (!MAPTILER_KEY) { mapError(id); return; }
    el.classList.add("is-loading");
    const map = new maplibregl.Map({
      container: id,
      style: MAP_STYLE,
      center: [loc.lon, loc.lat],
      /* slightly zoomed out so the first flyTo is a real flight — a no-op
         flight would skip the popup offset and the moveend event */
      zoom: zoomFor(loc) - 0.4,
      renderWorldCopies: false,
      minZoom: 1, /* mercator already clamps latitude at ±85° — no pole panning */
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("load", () => { el.classList.remove("is-loading"); applyMapLanguage(map); });
    map.once("error", () => { if (!map.isStyleLoaded()) { try { map.remove(); } catch { } delete MAPS[id]; mapError(id); } });

    const pin = document.createElement("div");
    pin.className = "map-pin-icon";
    pin.innerHTML = '<span class="map-ping"></span><span class="map-dot"></span>';
    /* anchor "bottom" = popup always above the marker; the flyTo offset below
       shifts the marker under the center so the popup always fits the map */
    const popup = new maplibregl.Popup({ offset: 16, maxWidth: "260px", anchor: "bottom" });
    const marker = new maplibregl.Marker({ element: pin })
      .setLngLat([loc.lon, loc.lat])
      .setPopup(popup)
      .addTo(map);
    MAPS[id] = { map, marker, popup, lastKey: null, userMarker: null };
  }
  const inst = MAPS[id];
  inst.map.resize();
  /* re-apply the "you are here" overlay on a map that was created after a fix */
  if (userPos) setUserLocationOn(inst, userPos.lat, userPos.lon, userPos.acc);
  inst.popup.setHTML(popupHtml(loc));
  inst.marker.setLngLat([loc.lon, loc.lat]);
  const key = `${loc.lat},${loc.lon}`;
  if (inst.lastKey !== key) {
    /* new location: replay the finite ping once, fly there, open the popup */
    inst.lastKey = key;
    /* replace the ping node so its finite CSS animation restarts once */
    const pinEl = inst.marker.getElement();
    const oldPing = pinEl.querySelector(".map-ping");
    if (oldPing) {
      const ping = document.createElement("span");
      ping.className = "map-ping";
      oldPing.replaceWith(ping);
    }
    /* bbox present (country/region/city extents) → frame it; else type-based zoom */
    let cam = null;
    if (loc.bbox) {
      try {
        cam = inst.map.cameraForBounds(
          [[loc.bbox[0], loc.bbox[1]], [loc.bbox[2], loc.bbox[3]]],
          { padding: 48, maxZoom: 14 });
      } catch { cam = null; }
    }
    if (cam) inst.map.flyTo({ center: cam.center, zoom: cam.zoom, duration: 1100 });
    else inst.map.flyTo({ center: [loc.lon, loc.lat], zoom: zoomFor(loc), duration: 1100 });
    if (cfg.autoPopup) {
      /* moveend never fires when the map is already at the target — timer fallback */
      const open = () => {
        if (!inst.popup.isOpen()) inst.marker.togglePopup();
        /* MapLibre popups don't auto-pan like Leaflet: nudge the map if the
           popup pokes out of the container (small maps on phones) */
        requestAnimationFrame(() => {
          const el = inst.popup.getElement && inst.popup.getElement();
          if (!el) return;
          const pr = el.getBoundingClientRect();
          const mr = inst.map.getContainer().getBoundingClientRect();
          const dy = pr.top - (mr.top + 10);
          if (dy < 0) inst.map.panBy([0, dy], { duration: 300 });
        });
      };
      inst.map.once("moveend", open);
      setTimeout(() => { inst.map.off("moveend", open); open(); }, 1400);
    }
  }
  /* same location (language/unit change): popup content refreshed above,
     user's zoom and center untouched */
}

function renderMap() {
  if (!state.loc) return;
  if (typeof maplibregl === "undefined") {
    /* CDN unreachable — show a message instead of an empty card */
    ["worldMap", "homeMap"].forEach(mapError);
    return;
  }
  updateMap("worldMap");
  updateMap("homeMap");
}

/* ── "You are here" overlay (Google-Maps-style blue dot + accuracy circle) ──
   Rendered as its own layer set per map instance, independent of the search
   pin, so recentering never blinks the pin. userPos is the last known fix so a
   map opened later still shows the dot. */
let userPos = null; // { lat, lon, acc }

/* Approximate a geographic circle of `meters` radius as a 64-gon polygon so the
   accuracy ring scales correctly with zoom (MapLibre circle radii are pixels). */
function circlePolygon(lon, lat, meters, steps = 64) {
  const R = 6378137, rad = Math.PI / 180;
  const dLat = (meters / R) / rad;
  const dLon = (meters / (R * Math.cos(lat * rad))) / rad;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const th = (2 * Math.PI * i) / steps;
    ring.push([lon + dLon * Math.cos(th), lat + dLat * Math.sin(th)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } };
}

function setUserLocationOn(inst, lat, lon, acc) {
  const map = inst.map;
  const apply = () => {
    const poly = circlePolygon(lon, lat, Math.max(acc || 0, 20));
    const src = map.getSource("userAcc");
    if (src) { src.setData(poly); }
    else {
      map.addSource("userAcc", { type: "geojson", data: poly });
      map.addLayer({ id: "userAccFill", type: "fill", source: "userAcc",
        paint: { "fill-color": "#4285F4", "fill-opacity": 0.15 } });
      map.addLayer({ id: "userAccLine", type: "line", source: "userAcc",
        paint: { "line-color": "#4285F4", "line-opacity": 0.4, "line-width": 1 } });
    }
    if (!inst.userMarker) {
      const dot = document.createElement("div");
      dot.className = "user-loc-dot";
      dot.innerHTML = '<span class="uld-halo"></span><span class="uld-core"></span>';
      inst.userMarker = new maplibregl.Marker({ element: dot }).setLngLat([lon, lat]).addTo(map);
    } else {
      inst.userMarker.setLngLat([lon, lat]);
    }
  };
  /* addSource/addLayer need a loaded style. "idle" is more reliable than a late
     once("load") (which never fires if load already happened before we listened). */
  if (map.isStyleLoaded()) apply(); else map.once("idle", apply);
}

function showUserLocation(lat, lon, acc) {
  userPos = { lat, lon, acc };
  Object.values(MAPS).forEach(inst => setUserLocationOn(inst, lat, lon, acc));
}

/* ── Map page info cards ── */

const POPULAR_IDS = ["paris", "newyork", "tokyo", "sydney", "london"];
let popularCache = null;

async function loadPopular() {
  const locs = POPULAR_IDS.map(id => LOCATIONS.find(l => l.id === id));
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: locs.map(l => l.lat).join(","),
      longitude: locs.map(l => l.lon).join(","),
      current: "temperature_2m,weather_code,is_day",
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await res.json();
    const arr = Array.isArray(d) ? d : [d];
    popularCache = locs.map((loc, i) => ({
      loc, temp: arr[i].current.temperature_2m,
      code: arr[i].current.weather_code, isDay: arr[i].current.is_day,
    }));
  } catch {
    popularCache = locs.map(loc => {
      const w = demoWeather(loc);
      return { loc, temp: w.current.temp, code: w.current.code, isDay: w.current.isDay };
    });
  }
  renderMapInfo();
}

function factRows(loc) {
  const facts = loc.kind === "country" && COUNTRY_FACTS[loc.id];
  if (facts) {
    return [
      [t("factType"), kindLabel(loc.kind)],
      [t("factCapital"), facts.capital[state.lang]],
      [t("factLang"), facts.lang[state.lang]],
      [t("factPop"), facts.pop[state.lang]],
      [t("factCurrency"), facts.currency[state.lang]],
      [t("factTz"), facts.tz],
    ];
  }
  const rows = [
    [t("factType"), kindLabel(loc.kind)],
    [t("factRegion"), locRegion(loc) || "—"],
    [t("factCountry"), locCountry(loc)],
  ];
  if (loc.landmark) rows.push([t("factLandmark"), loc.landmark[state.lang] || loc.landmark.en]);
  rows.push([t("factCoords"), `${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°`]);
  return rows;
}

function renderMapInfo() {
  const loc = state.loc, wx = state.wx;
  if (!loc || !wx || !$("#mapLocInfo")) return;
  const c = wx.current;

  $("#mapLocInfo").innerHTML = `
    <h3 class="info-title">${t("locInfo")}</h3>
    <div class="info-head">
      <div class="info-visual">${locPhotoHtml(loc)}</div>
      <div>
        <div class="info-name">${flagsHtml(loc, "small")} <b>${esc(locName(loc))}</b></div>
        <div class="info-sub">${esc(locRegion(loc))}</div>
      </div>
    </div>
    <dl class="facts">${factRows(loc).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  hydrateLocPhoto($("#mapLocInfo .info-visual .loc-photo"), loc);

  $("#mapConditions").innerHTML = `
    <h3 class="info-title">${t("conditions")}</h3>
    <div class="cond-main">
      <div class="cond-icon">${weatherIcon(wmo(c.code).icon, c.isDay)}</div>
      <div><b>${fmtTemp(c.temp)}${tempUnit()}</b><span>${wxDesc(c.code)}</span></div>
    </div>
    <div class="cond-stats">
      <div><dt>${t("feelsLike")}</dt><dd>${fmtTemp(c.feels)}°</dd></div>
      <div><dt>${t("humidity")}</dt><dd>${Math.round(c.humidity)}%</dd></div>
      <div><dt>${t("wind")}</dt><dd>${fmtWind(c.windSpeed)} ${windUnit()}</dd></div>
      <div><dt>${t("pressure")}</dt><dd>${Math.round(c.pressure)} hPa</dd></div>
    </div>`;

  $("#mapPopular").innerHTML = `
    <h3 class="info-title">${t("popularTitle")}</h3>
    <div class="pop-list">${(popularCache || []).map(p => `
      <button class="pop-row" data-loc="${esc(p.loc.id)}">
        ${flagsHtml(p.loc, "small")}
        <span class="pop-names"><b>${esc(locName(p.loc))}</b><span>${esc(locCountry(p.loc))}</span></span>
        <span class="pop-wx"><b>${fmtTemp(p.temp)}°C</b>${weatherIcon(wmo(p.code).icon, p.isDay)}</span>
      </button>`).join("")}</div>`;
  $$("#mapPopular .pop-row").forEach(btn => btn.addEventListener("click", () => {
    selectLocation(LOCATIONS.find(l => l.id === btn.dataset.loc));
  }));
}

/* ─────────────────────────── Search ─────────────────────────── */

let searchIndex = -1;
let searchResults = [];
let geoTimer = null;
let searchAbort = null; // cancels the in-flight geocoding request when the query changes

/* Merge curated hits (rich landmarks/facts) on top of remote MapTiler results,
   then collapse duplicates by name + country + region so a place that MapTiler
   returns several times (e.g. Tarbes as municipality + place + POI) shows once,
   while genuine same-name places in different regions (Paris FR/TX/ON) stay. */
function dedupKey(l) {
  return `${normalize(l.name.en)}|${l.cc}|${normalize(l.region.en || "")}`;
}
function mergeResults(curated, remote) {
  const seen = new Set();
  const out = [];
  for (const l of curated.concat(remote)) {
    const k = dedupKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.slice(0, 8);
}

function openSearchPanel() { $("#searchPanel").hidden = false; $("#searchCombo").setAttribute("aria-expanded", "true"); }
function closeSearchPanel() {
  $("#searchPanel").hidden = true;
  $("#searchCombo").setAttribute("aria-expanded", "false");
  searchIndex = -1;
}

function renderSearchResults(list, query) {
  searchResults = list;
  const ul = $("#searchResults");
  if (!list.length) {
    ul.innerHTML = `<li class="search-empty">${t("searchNoResult")}</li>`;
    openSearchPanel();
    return;
  }
  ul.innerHTML = list.map((loc, i) => `
    <li role="option" id="sr-${i}" aria-selected="${i === searchIndex}">
      <button class="search-item" data-i="${i}" tabindex="-1">
        <span class="si-visual" aria-hidden="true">${locVisual(loc)}</span>
        <span>
          <span class="si-name">${esc(locName(loc))} ${loc.kind !== "country" ? flagsHtml(loc, "small") : ""}</span><br>
          <span class="si-sub">${loc.kind === "country"
            ? esc(locRegion(loc))
            : `${esc(locRegion(loc))}${locRegion(loc) ? ", " : ""}${esc(locCountry(loc))}${loc.landmark ? ` · ${esc(loc.landmark[state.lang] || loc.landmark.en)}` : ""}`}</span>
        </span>
        <span class="si-kind">${kindLabel(loc.kind)}</span>
      </button>
    </li>`).join("");
  $$(".search-item", ul).forEach(btn => {
    btn.addEventListener("click", () => pickSearchResult(+btn.dataset.i));
  });
  openSearchPanel();
}

function pickSearchResult(i) {
  const loc = searchResults[i];
  if (!loc) return;
  /* full place name in the input so the chosen result is unambiguous */
  $("#searchInput").value = loc.fullName
    || [locName(loc), locRegion(loc), locCountry(loc)].filter(Boolean).join(", ");
  closeSearchPanel();
  selectLocation(loc); /* fitBounds/flyTo + marker/popup + weather handled downstream */
  switchView("home");
}

/* Autocomplete: instant curated hits, then debounced (300 ms) MapTiler global
   search. Stale requests are aborted; results are guarded against out-of-order
   arrival by re-checking the input value before rendering. */
function onSearchInput() {
  const q = $("#searchInput").value.trim();
  clearTimeout(geoTimer);
  if (searchAbort) { searchAbort.abort(); searchAbort = null; }
  if (!q) { closeSearchPanel(); return; }

  const curated = findLocations(q, state.lang);
  if (curated.length) renderSearchResults(curated, q);
  if (q.length < 2) { if (!curated.length) closeSearchPanel(); return; }

  geoTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    const signal = searchAbort.signal;
    try {
      const remote = await maptilerGeocode(q, signal);
      if (signal.aborted || $("#searchInput").value.trim() !== q) return; /* stale */
      const merged = mergeResults(curated, remote);
      renderSearchResults(merged, q); /* empty list → accessible "no result" state */
    } catch (e) {
      if (e.name === "AbortError" || signal.aborted) return;
      /* MapTiler unreachable/misconfigured → keyless Open-Meteo fallback */
      try {
        const geo = await geocode(q);
        if ($("#searchInput").value.trim() === q) renderSearchResults(mergeResults(curated, geo), q);
      } catch { if (!curated.length) renderSearchResults([], q); }
    } finally { searchAbort = null; }
  }, 300);
}

function onSearchKey(e) {
  const max = searchResults.length - 1;
  if (e.key === "ArrowDown") { e.preventDefault(); searchIndex = Math.min(max, searchIndex + 1); highlightSearch(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); searchIndex = Math.max(0, searchIndex - 1); highlightSearch(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (searchIndex >= 0) pickSearchResult(searchIndex);
    else if (searchResults.length) pickSearchResult(0);
  }
  else if (e.key === "Escape") { closeSearchPanel(); $("#searchInput").blur(); }
}

function highlightSearch() {
  $$("#searchResults [role=option]").forEach((li, i) => li.setAttribute("aria-selected", i === searchIndex));
  const active = $(`#sr-${searchIndex} .search-item`);
  if (active) active.scrollIntoView({ block: "nearest" });
  $("#searchInput").setAttribute("aria-activedescendant", searchIndex >= 0 ? `sr-${searchIndex}` : "");
}

/* ─────────────────────── Location & refresh ─────────────────────── */

let lastErrToast = 0;

async function selectLocation(loc) {
  state.loc = loc;
  bumpPhotoToken(); /* invalidate any in-flight photo swap from the previous place */
  localStorage.setItem("ws_lastLoc", JSON.stringify(loc));
  renderHeroSkeleton();
  try {
    state.wx = await fetchWeather(loc);
    state.isDemo = false;
  } catch {
    state.wx = demoWeather(loc);
    state.isDemo = true;
    /* offline: warn once a minute, not on every navigation */
    if (Date.now() - lastErrToast > 60000) {
      showToast(t("loadError"));
      lastErrToast = Date.now();
    }
  }
  renderAllWeather();
  /* air quality resolves separately — update the forecast page when it lands */
  const wx = state.wx;
  if (wx._aqi) wx._aqi.then(aqi => {
    if (state.wx === wx && aqi != null) {
      wx.current.aqi = aqi;
      renderForecastPage();
    }
  });
}

function renderAllWeather() {
  if (!state.wx) return;
  renderHero();
  renderMetrics();
  renderGroupedMetrics();
  renderForecast();
  renderChartTabs();
  renderChart();
  renderInsights();
  renderHourly();
  renderHomeHourly();
  renderForecastPage();
  renderMap();
  renderMapInfo();
  renderSidePos();
}

/* ── "My location" sidebar widget (real browser geolocation) ──
   States: idle (never asked) → locating → success | denied | unavailable.
   Permission is only requested on an explicit user action, except when the
   Permissions API says it was already granted. Last fix cached 30 min. */

const GEO_TTL = 30 * 60000;
let geoState = { status: "idle", loc: null, wx: null };

/* reverse-geocoding provider (no key, CORS-friendly); swap URL to change provider */
const REVERSE_GEO_URL = (lat, lon, lang) =>
  `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`;

async function reverseGeocode(lat, lon) {
  /* preferred: MapTiler (same key as the map, honours FR/EN) */
  if (MAPTILER_KEY) {
    try { return await reverseGeocodeMaptiler(lat, lon); }
    catch { /* fall through to the keyless provider */ }
  }
  const r = await fetch(REVERSE_GEO_URL(lat, lon, state.lang), { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  return {
    name: d.city || d.locality || "",
    region: d.principalSubdivision || "",
    cc: (d.countryCode || "").toUpperCase(),
  };
}

function geoLocFrom(lat, lon, info) {
  /* honest fallback: raw coordinates when reverse geocoding gave nothing */
  const name = info.name || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  return {
    /* id must be coordinate-derived, not a constant: favorites are matched by id
       alone, so a fixed "geo-me" made a second saved fix silently overwrite the
       first one instead of adding a distinct favorite. ~11 m of precision. */
    id: `geo-me-${lat.toFixed(4)},${lon.toFixed(4)}`,
    kind: "city", cc: info.cc || "", flag: "📍",
    lat, lon,
    name: { en: name, fr: name },
    region: { en: info.region || "", fr: info.region || "" },
    country: { en: info.country || "", fr: info.country || "" },
    landmark: null, aliases: [], grad: ["#3B82F6", "#1E40AF"], dynamic: true,
  };
}

async function applyGeoSuccess(lat, lon, info, opts = {}) {
  const { persist = false, acc = null, recenter = false } = opts;
  const loc = geoLocFrom(lat, lon, info);
  geoState = { status: "success", loc, wx: null };
  renderSidePos();
  if (persist) localStorage.setItem("ws_geo", JSON.stringify({ lat, lon, acc, ...info, at: Date.now() }));
  if (acc != null) showUserLocation(lat, lon, acc); /* Google-style blue dot + accuracy ring */
  if (recenter) {
    await selectLocation(loc); /* move map, marker/popup, weather, hero — no pin blink */
    geoState.wx = state.wx;    /* reuse the just-fetched weather for the card */
  } else {
    try { geoState.wx = await fetchWeather(loc); }
    catch { geoState.wx = demoWeather(loc); }
  }
  renderSidePos();
}

/* recenter=true (explicit tap): move the map to the fix. recenter=false
   (silent restore of a granted/cached fix on load): only fill the card + dot. */
function locateMe(recenter = true) {
  if (geoState.status === "locating") return;
  if (!("geolocation" in navigator)) {
    geoState = { status: "unsupported", loc: null, wx: null };
    renderSidePos();
    return;
  }
  geoState = { status: "locating", loc: null, wx: null };
  renderSidePos();
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    let info = {};
    try { info = await reverseGeocode(lat, lon); } catch { /* coords shown instead */ }
    applyGeoSuccess(lat, lon, info, { persist: true, acc: accuracy, recenter });
  }, err => {
    /* 1 = denied, 2 = position unavailable, 3 = timeout */
    const status = err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable";
    geoState = { status, loc: null, wx: null };
    renderSidePos();
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

async function initGeo() {
  /* fresh cached fix → no permission prompt, no geolocation call at all */
  try {
    const c = JSON.parse(localStorage.getItem("ws_geo"));
    if (c && Date.now() - c.at < GEO_TTL) { applyGeoSuccess(c.lat, c.lon, c, { acc: c.acc }); return; }
  } catch { }
  let perm = "prompt";
  try { perm = (await navigator.permissions.query({ name: "geolocation" })).state; } catch { }
  if (perm === "granted") locateMe(false);     /* already allowed — refresh card, don't hijack view */
  else if (perm === "denied") { geoState.status = "denied"; renderSidePos(); }
  else renderSidePos();                        /* idle: wait for an explicit tap */
}

function renderSidePos() {
  const box = $("#sidePosBox");
  if (!box) return;
  box.hidden = false;
  const body = $("#sidePosBtn"), nameEl = $("#sidePosName"), wxEl = $("#sidePosWx");
  const retry = $("#geoRetryBtn");
  retry.disabled = geoState.status === "locating";
  const s = geoState.status;
  box.classList.remove("is-collapsed", "is-expanded");
  if (s === "success" && geoState.loc) {
    const loc = geoState.loc;
    nameEl.textContent = [locName(loc), locRegion(loc), locCountry(loc)].filter(Boolean).join(", ");
    wxEl.innerHTML = geoState.wx
      ? `${weatherIcon(wmo(geoState.wx.current.code).icon, geoState.wx.current.isDay)} <b>${fmtTemp(geoState.wx.current.temp)}${tempUnit()}</b> · ${wxDesc(geoState.wx.current.code)}`
      : "…";
    body.onclick = () => { selectLocation(loc); switchView("home"); };
  } else if (s === "locating") {
    nameEl.innerHTML = `<span class="geo-spin" aria-hidden="true"></span> ${t("geoLocating")}`;
    wxEl.textContent = "";
    body.onclick = null;
  } else if (s === "denied" || s === "unavailable" || s === "timeout" || s === "unsupported") {
    /* collapsed by default so a denied fix doesn't dominate the sidebar on every
       page; click expands the hint, and the header refresh button still retries. */
    box.classList.add("is-collapsed");
    const msg = { denied: "geoDenied", unavailable: "geoUnavailable", timeout: "geoTimeout", unsupported: "geoUnsupported" }[s];
    nameEl.textContent = t(msg);
    wxEl.textContent = s === "unsupported" ? "" : t("geoRetryHint");
    body.onclick = s === "unsupported" ? null : () => box.classList.toggle("is-expanded");
  } else { /* idle */
    nameEl.textContent = t("geoUse");
    wxEl.textContent = "";
    body.onclick = () => locateMe();
  }
}

/* ─────────────────────────── Views ─────────────────────────── */

function switchView(view) {
  state.view = view;
  $$(".view").forEach(v => { v.hidden = true; v.classList.remove("is-visible"); });
  const target = $(`#view-${view}`);
  target.hidden = false;
  requestAnimationFrame(() => target.classList.add("is-visible"));
  $$(".side-item").forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle("is-active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  closeSidebar();
  closeThemeMenu();
  if (view === "map" || view === "home") renderMap();
  if (view === "favorites") loadFavWeather();
  /* charts drawn while their view was hidden used a fallback width —
     redraw at the real container size once the view is visible */
  requestAnimationFrame(() => {
    if (!state.wx) return;
    if (view === "home") renderChart();
    if (view === "forecast") renderForecastPage();
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openSidebar() {
  $("#sidebar").classList.add("is-open");
  $("#sidebarScrim").hidden = false;
  /* the drawer toggle was display:none until now — align its thumb */
  positionThumb($("#modeToggleSide"));
}
function closeSidebar() { $("#sidebar").classList.remove("is-open"); $("#sidebarScrim").hidden = true; }

/* ─────────────────────────── Toggles ─────────────────────────── */

function positionThumb(group) {
  const active = $('[aria-checked="true"]', group);
  const thumb = $(".seg-thumb", group);
  if (!active || !thumb) return;
  thumb.style.width = active.offsetWidth + "px";
  thumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
}

function bindSegToggle(group, attr, onChange) {
  $$("button", group).forEach(btn => btn.addEventListener("click", () => {
    $$("button", group).forEach(b => b.setAttribute("aria-checked", b === btn ? "true" : "false"));
    positionThumb(group);
    onChange(btn.dataset[attr]);
  }));
}

function syncSegToggle(group, attr, value) {
  $$("button", group).forEach(b => b.setAttribute("aria-checked", b.dataset[attr] === value ? "true" : "false"));
  positionThumb(group);
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("ws_mode", mode);
  document.body.dataset.mode = mode;
  syncSegToggle($("#modeToggle"), "mode", mode);
  syncSegToggle($("#modeToggleSide"), "mode", mode);
  updateSettingsUI();
  if (mode === "detailed") renderChart();
}

function setUnitTemp(v) {
  state.unitTemp = v;
  localStorage.setItem("ws_unit_t", v);
  updateSettingsUI();
  renderAllWeather();
}

function setUnitWind(v) {
  state.unitWind = v;
  localStorage.setItem("ws_unit_w", v);
  updateSettingsUI();
  renderAllWeather();
}

function setTheme(v) {
  state.theme = v;
  localStorage.setItem("ws_theme", v);
  applyTheme();
  updateSettingsUI();
  syncThemeNav(); /* one preference, two controls (navbar + Settings) — keep both in sync */
}

function applyTheme() {
  const dark = state.theme === "dark" ||
    (state.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.dataset.theme = dark ? "dark" : "light";
}

/* reflect current state on every Settings control */
function updateSettingsUI() {
  $$("#chipTemp button").forEach(b => b.setAttribute("aria-checked", b.dataset.ut === state.unitTemp));
  $$("#chipWind button").forEach(b => b.setAttribute("aria-checked", b.dataset.uw === state.unitWind));
  $$("#langTiles .set-tile").forEach(b => b.setAttribute("aria-checked", b.dataset.lang === state.lang));
  $$("#modeTiles .set-tile").forEach(b => b.setAttribute("aria-checked", b.dataset.mode === state.mode));
  $$("#themeTiles .set-tile").forEach(b => b.setAttribute("aria-checked", b.dataset.theme === state.theme));
  $$(".switch[data-notif]").forEach(b => b.setAttribute("aria-checked", !!state.notifs[b.dataset.notif]));
}

/* ── Navbar theme control ──
   Trigger icon reflects the SAVED preference (light/dark/system), not the
   resolved light/dark — "system" keeps its own monitor icon even while the OS
   is dark, so the icon never gets confused with an explicit "dark" choice. */
const THEME_NAV_ICONS = {
  light: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6 19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4 19 5"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
  system: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
};
function syncThemeNav() {
  const icon = $("#themeBtnIcon");
  if (icon) icon.innerHTML = THEME_NAV_ICONS[state.theme] || THEME_NAV_ICONS.light;
  $$("#themeMenu [role=menuitemradio]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.theme === state.theme)));
}
function closeThemeMenu() {
  const menu = $("#themeMenu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("#themeBtn").setAttribute("aria-expanded", "false");
}

function setLang(lang) {
  state.lang = lang;
  localStorage.setItem("ws_lang", lang);
  document.documentElement.lang = lang;
  $("#langCode").textContent = lang.toUpperCase();
  $$("#langMenu button").forEach(b => b.setAttribute("aria-checked", b.dataset.lang === lang ? "true" : "false"));
  updateSettingsUI();
  applyStaticI18n();
  /* toggle labels change width with the language — realign the thumb */
  syncSegToggle($("#modeToggle"), "mode", state.mode);
  renderExplore();
  renderFavorites();
  renderAllWeather();
  refreshMapLanguage(); /* localize map labels instantly, no recreation */
}

function applyStaticI18n() {
  $$("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $$("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  /* static country names (map quick-jump chips) follow the interface language */
  $$("[data-country]").forEach(el => { el.textContent = countryName(el.dataset.country, el.textContent); });
}

/* ─────────────────────────── Toast ─────────────────────────── */

let toastTimer = null;
function showToast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ─────────────────────────── Init ─────────────────────────── */

function init() {
  document.body.dataset.mode = state.mode;
  document.documentElement.lang = state.lang;

  /* Search */
  const input = $("#searchInput");
  input.addEventListener("input", onSearchInput);
  input.addEventListener("keydown", onSearchKey);
  input.addEventListener("focus", () => { if (input.value.trim()) onSearchInput(); });
  document.addEventListener("click", e => {
    if (!e.target.closest("#searchWrap")) closeSearchPanel();
    if (!e.target.closest(".lang-wrap")) { $("#langMenu").hidden = true; $("#langBtn").setAttribute("aria-expanded", "false"); }
    if (!e.target.closest(".theme-wrap")) closeThemeMenu();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault(); input.focus();
    } else if (e.key === "Escape") {
      /* close whichever overlay is open; leave the event untouched for the map */
      if ($("#sidebar").classList.contains("is-open")) {
        closeSidebar();
        $("#burgerBtn").focus();
      }
      if (!$("#langMenu").hidden) {
        $("#langMenu").hidden = true;
        $("#langBtn").setAttribute("aria-expanded", "false");
        $("#langBtn").focus();
      }
      if (!$("#themeMenu").hidden) {
        closeThemeMenu();
        $("#themeBtn").focus();
      }
      closeSearchPanel();
    }
  });

  /* Language menu */
  $("#langBtn").addEventListener("click", () => {
    const menu = $("#langMenu");
    menu.hidden = !menu.hidden;
    $("#langBtn").setAttribute("aria-expanded", String(!menu.hidden));
  });
  $$("#langMenu button").forEach(b => b.addEventListener("click", () => {
    setLang(b.dataset.lang);
    $("#langMenu").hidden = true;
  }));

  /* Theme menu — same open/close contract as the language menu, plus roving
     ArrowUp/ArrowDown since these are role="menuitemradio" items (tabindex=-1,
     only reachable via arrow keys once the menu is open, per the ARIA menu
     pattern) */
  $("#themeBtn").addEventListener("click", () => {
    const menu = $("#themeMenu");
    const opening = menu.hidden;
    menu.hidden = !menu.hidden;
    $("#themeBtn").setAttribute("aria-expanded", String(opening));
    if (opening) {
      (menu.querySelector('[aria-checked="true"]') || menu.querySelector("[role=menuitemradio]")).focus();
    }
  });
  $$("#themeMenu [role=menuitemradio]").forEach(b => b.addEventListener("click", () => {
    setTheme(b.dataset.theme);
    closeThemeMenu();
    $("#themeBtn").focus();
  }));
  $("#themeMenu").addEventListener("keydown", e => {
    const items = $$("#themeMenu [role=menuitemradio]");
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });

  /* Toggles */
  bindSegToggle($("#modeToggle"), "mode", setMode);
  bindSegToggle($("#modeToggleSide"), "mode", setMode);

  /* Settings page controls */
  $$("#chipTemp button").forEach(b => b.addEventListener("click", () => setUnitTemp(b.dataset.ut)));
  $$("#chipWind button").forEach(b => b.addEventListener("click", () => setUnitWind(b.dataset.uw)));
  $$("#langTiles .set-tile").forEach(b => b.addEventListener("click", () => setLang(b.dataset.lang)));
  $$("#modeTiles .set-tile").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $$("#themeTiles .set-tile").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.theme)));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "system") applyTheme();
  });
  $$(".switch[data-notif]").forEach(b => b.addEventListener("click", () => {
    state.notifs[b.dataset.notif] = !state.notifs[b.dataset.notif];
    localStorage.setItem("ws_notifs", JSON.stringify(state.notifs));
    updateSettingsUI();
    showToast(t("prefSaved"));
  }));
  $$(".priv-tile").forEach(b => b.addEventListener("click", () => {
    const action = b.dataset.priv;
    if (action === "location") showToast(t("locMsg"));
    else if (action === "privacy") switchView("about");
    else if (action === "cache") {
      if (!confirm(t("resetConfirm"))) return;
      localStorage.clear();
      showToast(t("cacheCleared"));
      setTimeout(() => location.reload(), 900);
    } else if (action === "export") {
      const data = {
        exportedAt: new Date().toISOString(),
        settings: { lang: state.lang, mode: state.mode, unitTemp: state.unitTemp, unitWind: state.unitWind, theme: state.theme, notifs: state.notifs },
        favorites: state.favorites,
        lastLocation: state.loc,
      };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = "weathersphere-data.json";
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(t("dataExported"));
    }
  }));

  /* Sidebar + views */
  $$(".side-item").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
  $$(".footer-col button[data-view]").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
  $("#logoLink").addEventListener("click", e => { e.preventDefault(); switchView("home"); });
  $("#burgerBtn").addEventListener("click", openSidebar);
  $("#sidebarScrim").addEventListener("click", closeSidebar);

  /* Explore nav */
  $("#exploreLeft").addEventListener("click", () => $("#exploreCarousel").scrollBy({ left: -480, behavior: "smooth" }));
  $("#exploreRight").addEventListener("click", () => $("#exploreCarousel").scrollBy({ left: 480, behavior: "smooth" }));

  /* Favorites page: add button + grid/list toggle */
  $("#favAddBtn").addEventListener("click", () => $("#searchInput").focus());
  $$("[data-favview]").forEach(btn => btn.addEventListener("click", () => {
    state.favView = btn.dataset.favview;
    $$("[data-favview]").forEach(b => b.setAttribute("aria-checked", b === btn ? "true" : "false"));
    renderFavorites();
  }));

  /* Forecast page: carousel + hourly strip arrows */
  $("#fcPrev").addEventListener("click", () => $("#forecastRow2").scrollBy({ left: -400, behavior: "smooth" }));
  $("#fcNext").addEventListener("click", () => $("#forecastRow2").scrollBy({ left: 400, behavior: "smooth" }));
  $("#hsPrev").addEventListener("click", () => $("#hourlyStrip").scrollBy({ left: -320, behavior: "smooth" }));
  $("#hsNext").addEventListener("click", () => $("#hourlyStrip").scrollBy({ left: 320, behavior: "smooth" }));

  /* Map page: quick-jump chips (MapLibre uses [lng, lat]) */
  const JUMPS = { world: [[10, 22], 1.6], usa: [[-98.6, 39.8], 3.6], canada: [[-96, 58.5], 2.8], france: [[2.2137, 46.2276], 5] };
  $$(".map-actions .chip").forEach(chip => chip.addEventListener("click", () => {
    $$(".map-actions .chip").forEach(c => {
      const on = c === chip;
      c.classList.toggle("is-active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    const [center, zoom] = JUMPS[chip.dataset.jump];
    if (MAPS.worldMap) MAPS.worldMap.map.flyTo({ center, zoom, duration: 1200 });
  }));

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    $$(".seg-toggle").forEach(positionThumb);
    /* charts are drawn at their container's size — redraw after resizing */
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      /* the map must re-measure its container after responsive layout changes */
      Object.values(MAPS).forEach(m => { try { m.map.resize(); } catch { } });
      if (!state.wx) return;
      renderChart();
      renderForecastPage();
    }, 200);
  });

  /* Initial state */
  $$("[data-flag]").forEach(el => { el.innerHTML = flagHtml(el.dataset.flag); });
  $$("[data-wicon]").forEach(el => { el.innerHTML = weatherIcon(el.dataset.wicon, 1); });
  applyTheme();
  syncThemeNav();
  applyStaticI18n();
  syncSegToggle($("#modeToggle"), "mode", state.mode);
  updateSettingsUI();
  $("#langCode").textContent = state.lang.toUpperCase();
  $$("#langMenu button").forEach(b => b.setAttribute("aria-checked", b.dataset.lang === state.lang ? "true" : "false"));
  renderExplore();
  renderFavorites();

  /* Re-resolve stored locations against the current dataset (old saves may lack new fields) */
  const freshen = loc => loc && (LOCATIONS.find(l => l.id === loc.id) || loc);
  state.favorites = state.favorites.map(freshen);
  let startLoc = null;
  try { startLoc = freshen(JSON.parse(localStorage.getItem("ws_lastLoc"))); } catch { }
  selectLocation(startLoc || LOCATIONS.find(l => l.id === DEFAULT_LOCATION_ID));
  $("#geoRetryBtn").addEventListener("click", () => locateMe());
  initGeo();
  loadPopular();

  /* Refresh "updated x min ago" line periodically */
  setInterval(() => { if (state.wx && state.view === "home") renderHero(); }, 60000);
}

document.addEventListener("DOMContentLoaded", init);
