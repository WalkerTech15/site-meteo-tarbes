/* Network mocks for the e2e suite.
 *
 * Every external origin the app talks to is intercepted here, so a test run
 * never depends on a third-party service being up, on an API key being present,
 * or on today's real weather. Anything NOT matched by a route below is aborted
 * by the catch-all in `installMocks`, which makes a newly-added live call fail
 * the suite instead of silently making it flaky.
 */
import { test as base, expect } from "@playwright/test";

/* ── Fixtures ──────────────────────────────────────────────────────────── */

/* Deterministic hourly/daily series. Values are arbitrary but fixed, and the
   "current" hour is pinned to the first hourly entry so the hero always shows
   the same number regardless of when the suite runs. */
const HOURS = Array.from({ length: 48 }, (_, i) => i);
const DAY = "2024-06-15";
const hourIso = (i) => `${DAY}T${String(i % 24).padStart(2, "0")}:00`;

export const WEATHER_TEMP_C = 21.4;

/* Weather "shapes" the advisory banner is tested against. `calm` is ordinary
   weather that must never raise an advisory; the others cross exactly one or
   two documented metric thresholds. Values stay canonical metric — Open-Meteo's
   own units — because that is what the app normalises from. */
const WEATHER_KINDS = {
  calm: { code: 1, feels: 20.1, gust: 24, visibility: 20000 },
  /* thunderstorm (WMO 95) + 88 km/h gusts → two advisories, storm ranked first */
  storm: { code: 95, feels: 18, gust: 88, visibility: 20000 },
  heat: { code: 0, feels: 43.5, gust: 18, visibility: 20000 },
  /* thunderstorm + gusts + sub-1000m visibility → all three severity tiers
     (high/moderate/low) at once, for the three-advisory layout */
  severe: { code: 95, feels: 18, gust: 88, visibility: 900 },
};

function weatherPayload(kind = "calm") {
  const w = WEATHER_KINDS[kind] || WEATHER_KINDS.calm;
  return {
    timezone: "Europe/Paris",
    current: {
      time: `${DAY}T00:00`,
      temperature_2m: WEATHER_TEMP_C,
      relative_humidity_2m: 55,
      apparent_temperature: w.feels,
      is_day: 1,
      weather_code: w.code,
      wind_speed_10m: 12.5,
      wind_gusts_10m: w.gust,
      wind_direction_10m: 220,
      surface_pressure: 1014,
    },
    hourly: {
      time: HOURS.map(hourIso),
      temperature_2m: HOURS.map((i) => 18 + (i % 8)),
      apparent_temperature: HOURS.map(() => w.feels),
      relative_humidity_2m: HOURS.map(() => 55),
      wind_speed_10m: HOURS.map((i) => 10 + (i % 5)),
      wind_gusts_10m: HOURS.map(() => w.gust),
      surface_pressure: HOURS.map(() => 1014),
      dew_point_2m: HOURS.map(() => 11),
      precipitation_probability: HOURS.map((i) => (i % 10) * 5),
      visibility: HOURS.map(() => w.visibility),
      uv_index: HOURS.map(() => 4),
      weather_code: HOURS.map(() => w.code),
      is_day: HOURS.map((i) => (i % 24 >= 7 && i % 24 <= 20 ? 1 : 0)),
    },
    daily: {
      time: Array.from({ length: 8 }, (_, i) => `2024-06-${15 + i}`),
      weather_code: [1, 2, 3, 0, 61, 2, 1, 0],
      temperature_2m_max: [26, 25, 24, 27, 22, 25, 26, 27],
      temperature_2m_min: [14, 13, 12, 15, 11, 13, 14, 15],
      sunrise: Array.from({ length: 8 }, (_, i) => `2024-06-${15 + i}T06:00`),
      sunset: Array.from({ length: 8 }, (_, i) => `2024-06-${15 + i}T21:30`),
      precipitation_probability_max: [10, 20, 40, 0, 80, 20, 10, 0],
      uv_index_max: [6, 5, 4, 7, 3, 5, 6, 7],
      wind_speed_10m_max: [18, 16, 20, 14, 24, 17, 15, 13],
    },
  };
}

/* Forward geocoding — one unambiguous hit, in both providers' formats.
   The app queries MapTiler first and only falls back to Open-Meteo when
   MapTiler throws, so both shapes are mocked to keep the test independent of
   which path is taken. */
const GEOCODE_NAME = "Reykjavik";
export const GEOCODE_LABEL = GEOCODE_NAME;

function geocodePayload() {
  return {
    results: [
      {
        id: 3413829,
        name: GEOCODE_NAME,
        latitude: 64.1355,
        longitude: -21.8954,
        country_code: "IS",
        country: "Iceland",
        admin1: "Capital Region",
      },
    ],
  };
}

function maptilerGeocodePayload() {
  return {
    features: [
      {
        id: "place.e2e1",
        text: GEOCODE_NAME,
        place_name: `${GEOCODE_NAME}, Capital Region, Iceland`,
        place_type: ["place"],
        center: [-21.8954, 64.1355],
        properties: { country_code: "is" },
        context: [
          { id: "region.1", text: "Capital Region", short_code: "IS-1" },
          { id: "country.1", text: "Iceland", country_code: "is" },
        ],
      },
    ],
  };
}

/* Dynamic geocoding fixtures for the map's geo-identity box — a US city with
   an ISO short_code (real state flag), and a French city (region has no
   supported flag, so the country flag + neutral-icon region text is what
   should render). Neither Austin nor Tarbes is a curated data/locations.js
   entry: this is what proves the identity box works for ANY searched place,
   not only hard-coded cities. */
export const AUSTIN_LABEL = "Austin";
export const TARBES_LABEL = "Tarbes";
export const LYON_LABEL = "Lyon";

function austinFeature() {
  return {
    id: "place.e2e-austin",
    text: AUSTIN_LABEL,
    place_name: `${AUSTIN_LABEL}, Texas, United States`,
    place_type: ["place"],
    center: [-97.7431, 30.2672],
    properties: { short_code: "US-TX" },
    context: [
      { id: "region.2", text: "Texas", short_code: "US-TX" },
      { id: "country.2", text: "United States", country_code: "us" },
    ],
  };
}

function tarbesFeature() {
  return {
    id: "place.e2e-tarbes",
    text: TARBES_LABEL,
    place_name: `${TARBES_LABEL}, Occitanie, France`,
    place_type: ["place"],
    center: [0.0782, 43.2333],
    properties: { country_code: "fr" },
    context: [
      { id: "region.3", text: "Occitanie" },
      { id: "country.3", text: "France", country_code: "fr" },
    ],
  };
}

function lyonFeature() {
  return {
    id: "place.e2e-lyon",
    text: LYON_LABEL,
    place_name: `${LYON_LABEL}, Auvergne-Rhône-Alpes, France`,
    place_type: ["place"],
    center: [4.8357, 45.764],
    properties: { country_code: "fr" },
    context: [
      { id: "region.4", text: "Auvergne-Rhône-Alpes" },
      { id: "country.4", text: "France", country_code: "fr" },
    ],
  };
}

function maptilerGeocodePayloadFor(url) {
  const decoded = decodeURIComponent(url);
  if (decoded.includes(AUSTIN_LABEL)) return { features: [austinFeature()] };
  if (decoded.includes(TARBES_LABEL)) return { features: [tarbesFeature()] };
  if (decoded.includes(LYON_LABEL)) return { features: [lyonFeature()] };
  return maptilerGeocodePayload();
}

export const PEXELS_PHOTOGRAPHER = "Ada Lovelace";
export const PEXELS_LINK = "https://www.pexels.com/photo/test-12345/";
export const PEXELS_ALT = "A city skyline at dusk";
/* 1×1 transparent GIF — a real, instantly-decodable image so the <img> load
   handler fires and the fade/has-photo path is genuinely exercised. */
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/* The browser now talks to the SAME-ORIGIN proxy (/api/pexels.php), never to
   Pexels — the key lives on the server. So this is the proxy's response shape,
   not Pexels': {"photo": {...}} | {"photo": null}. */
export function photoProxyPayload() {
  return {
    photo: {
      src: { medium: PIXEL, large: PIXEL, large2x: PIXEL },
      photographer: PEXELS_PHOTOGRAPHER,
      link: PEXELS_LINK,
      alt: PEXELS_ALT,
    },
  };
}

/* Minimal but valid MapLibre style: no remote tiles, so the map initialises
   and fires "load" without any network access. */
function mapStylePayload() {
  return {
    version: 8,
    name: "e2e-blank",
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#dbeafe" } }],
  };
}

const json = (body) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/* ── Installer ─────────────────────────────────────────────────────────── */

export async function installMocks(page, overrides = {}) {
  const { weatherStatus = 200, photoProxy } = overrides;
  /* "calm" by default. Pass a function to vary the weather per request — the
     URL carries the coordinates, which is how a test gives two cities two
     different forecasts. */
  const { weatherKind = "calm" } = overrides;

  /* Registered FIRST on purpose: Playwright resolves routes in reverse
     registration order, so the specific handlers below override this one.
     Anything cross-origin they don't claim is a live call that shouldn't
     exist — abort it loudly rather than let it through. */
  await page.route("**://**", (route, request) => {
    const url = new URL(request.url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    console.warn(`[e2e] blocked unmocked external request: ${request.url()}`);
    return route.abort();
  });

  await page.route("**://api.open-meteo.com/**", (route, request) => {
    if (weatherStatus !== 200)
      return route.fulfill({
        status: weatherStatus,
        contentType: "text/plain",
        body: "mocked failure",
      });
    const kind =
      typeof weatherKind === "function" ? weatherKind(request.url()) || "calm" : weatherKind;
    return route.fulfill(json(weatherPayload(kind)));
  });
  await page.route("**://air-quality-api.open-meteo.com/**", (route) =>
    route.fulfill(json({ current: { european_aqi: 31 } })),
  );
  await page.route("**://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill(json(geocodePayload())),
  );
  await page.route("**://api.maptiler.com/maps/**", (route) =>
    route.fulfill(json(mapStylePayload())),
  );
  await page.route("**://api.maptiler.com/geocoding/**", (route, request) =>
    route.fulfill(json(maptilerGeocodePayloadFor(request.url()))),
  );
  await page.route("**://api.bigdatacloud.net/**", (route) => route.fulfill(json({})));
  /* the Inter webfont is a third-party request too — block it so runs are
     offline-clean and don't wait on rsms.me */
  await page.route("**://rsms.me/**", (route) => route.abort());

  /* The photo proxy is SAME-ORIGIN, so the cross-origin catch-all above would
     let it through to the real dev middleware — and that middleware holds a
     real key. Intercept it explicitly: no test may ever reach Pexels.
     `photoProxy` lets a test choose the status/body to simulate 429/502/503. */
  await page.route("**/api/pexels.php*", (route) => {
    if (typeof photoProxy === "function") return photoProxy(route);
    return route.fulfill(json(photoProxyPayload()));
  });

  /* Belt and braces: if a future change ever calls Pexels from the browser
     again, fail loudly instead of silently succeeding. */
  await page.route("**://api.pexels.com/**", (route) => {
    console.warn("[e2e] BLOCKED direct browser call to api.pexels.com");
    return route.abort();
  });
}

/* `app` fixture: mocks installed, storage clean, home view rendered. */
export const test = base.extend({
  app: async ({ page }, use) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page.locator("#heroCityName")).not.toBeEmpty();
    await use(page);
  },
});

export { expect };
