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

/* `place` distinguishes one entry of a BATCHED (comma-joined coordinates)
   request from another — favorites, the popular-cities row, and nearby
   places all fetch several locations in one call, and a test needs each
   place's numbers to actually differ to prove they were mapped by index
   correctly rather than all showing place 0's weather. 0 (the default)
   reproduces the exact single-location payload every existing test already
   asserts on, unchanged. */
function weatherPayload(kind = "calm", place = 0, timezone = "Europe/Paris") {
  const w = WEATHER_KINDS[kind] || WEATHER_KINDS.calm;
  const dTemp = place * 2;
  return {
    timezone,
    current: {
      time: `${DAY}T00:00`,
      temperature_2m: WEATHER_TEMP_C + dTemp,
      relative_humidity_2m: 55,
      apparent_temperature: w.feels + dTemp,
      is_day: 1,
      weather_code: w.code,
      wind_speed_10m: 12.5 + place,
      wind_gusts_10m: w.gust,
      wind_direction_10m: 220,
      surface_pressure: 1014,
    },
    hourly: {
      time: HOURS.map(hourIso),
      temperature_2m: HOURS.map((i) => 18 + (i % 8) + dTemp),
      apparent_temperature: HOURS.map(() => w.feels + dTemp),
      relative_humidity_2m: HOURS.map(() => 55),
      wind_speed_10m: HOURS.map((i) => 10 + (i % 5) + place),
      wind_gusts_10m: HOURS.map(() => w.gust),
      surface_pressure: HOURS.map(() => 1014),
      dew_point_2m: HOURS.map(() => 11),
      precipitation_probability: HOURS.map((i) => Math.min(100, (i % 10) * 5 + place * 3)),
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
    /* the region carries both languages, as MapTiler does for `language=fr,en`;
       the country has only its (identical) local name */
    context: [
      { id: "region.3", text: "Occitanie", text_en: "Occitania", text_fr: "Occitanie" },
      { id: "country.3", text: "France", country_code: "fr" },
    ],
  };
}

/* Shaped exactly as MapTiler answers for a sea: an unremarkable "place"
   type, both language variants of the name, and an Italian country context
   from the territorial-waters polygon the point falls in. Nothing here says
   "water" except the name itself. */
function mediterraneanSeaFeature() {
  const { lon, lat } = CLICK_SEA_NAMED;
  return {
    id: "place.e2e-mediterranean",
    text: "Mediterranean Sea",
    text_en: "Mediterranean Sea",
    text_fr: "Mer Méditerranée",
    place_name: "Mediterranean Sea",
    place_type: ["place"],
    center: [lon, lat],
    properties: { country_code: "it" },
    context: [{ id: "country.9", text: "Italia", country_code: "it" }],
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

/* ── Reverse geocoding (map click / URL restore) ────────────────────────
   MapTiler's reverse form is `/geocoding/<lon>,<lat>.json`. Four designated
   coordinates, so a test can click a known point and assert exactly what the
   app should do with it:

     CLICK_CITY    an ordinary town, full country + region metadata
     CLICK_REGION_POLY  an administrative region WITH a real polygon
     CLICK_REGION_BBOX  an administrative region with only a point + bbox
     CLICK_OCEAN   open water: the provider returns no feature at all

   Anything else resolves to a generic feature named after the coordinate, so
   two arbitrary clicks are always distinguishable from one another. */
export const CLICK_CITY = { lon: 0.0782, lat: 43.2333, label: TARBES_LABEL };
export const CLICK_REGION_POLY = { lon: 1.75, lat: 43.9, label: "Occitanie" };
export const CLICK_REGION_BBOX = { lon: -99.9, lat: 31.4, label: "Texas" };
export const CLICK_OCEAN = { lon: -41.5, lat: 33.2 };
/* A Canadian COUNTY inside a province — MapTiler's place_type "county" (also
   "subregion" / "municipal_district") is bucketed onto the same internal
   kind ("region") as a province searched directly (see MT_KIND in
   services/geocoding-api.js). Real-world case this reproduces: Camrose
   County, Alberta, at ~52.8652°N -112.4788°E. */
export const CLICK_COUNTY = { lon: -112.4788, lat: 52.8652, label: "Camrose" };
export const CLICK_COUNTRY = { lon: 19.1451, lat: 51.9194, label: "Pologne" };
/* Open water the provider DOES name. MapTiler has no marine place_type this
   app maps, so a sea comes back as a generic "place" — and territorial
   waters mean it can carry a country context too. Distinct from CLICK_OCEAN
   (no feature at all): here the marine identity has to be recognised from
   the returned NAME, not inferred from the coordinate. */
export const CLICK_SEA_NAMED = { lon: 15, lat: 36, label: "Mer Méditerranée" };

const near = (value, target) => Math.abs(value - target) < 0.4;

/* A region with a genuine (tiny, square) MultiPolygon — the app must draw
   THIS, not the bbox. Named in both languages, as MapTiler does when asked
   for `language=en,fr`. */
function occitanieRegionFeature() {
  const { lon, lat } = CLICK_REGION_POLY;
  return {
    id: "region.e2e-occitanie",
    text: "Occitanie",
    text_en: "Occitania",
    text_fr: "Occitanie",
    place_name: "Occitanie, France",
    place_type: ["region"],
    center: [lon, lat],
    bbox: [lon - 1.5, lat - 1.2, lon + 1.5, lat + 1.2],
    properties: { short_code: "FR-OCC" },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [lon - 1, lat - 0.8],
            [lon + 1, lat - 0.8],
            [lon + 1, lat + 0.8],
            [lon - 1, lat + 0.8],
            [lon - 1, lat - 0.8],
          ],
        ],
      ],
    },
    context: [
      { id: "country.9", text: "France", text_en: "France", text_fr: "France", country_code: "fr" },
    ],
  };
}

/* A US state the provider describes with a point + bbox and NO geometry —
   the bbox may frame the camera but must never be drawn as a border. */
function texasRegionFeature() {
  const { lon, lat } = CLICK_REGION_BBOX;
  return {
    id: "region.e2e-texas",
    text: "Texas",
    text_en: "Texas",
    text_fr: "Texas",
    place_name: "Texas, United States",
    place_type: ["region"],
    center: [lon, lat],
    bbox: [-106.65, 25.84, -93.51, 36.5],
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { short_code: "US-TX" },
    context: [
      {
        id: "country.10",
        text: "United States",
        text_en: "United States",
        text_fr: "États-Unis",
        country_code: "us",
      },
    ],
  };
}

/* Camrose county: place_type "county", with a "region" context entry
   (Alberta, ISO short_code CA-AB) — the exact shape featureToLoc() turns
   into { kind: "region", name: Camrose, region: Alberta, regionCode: CA-AB,
   country: Canada }, reproducing the bug this fixture is named for. */
function camroseCountyFeature() {
  const { lon, lat } = CLICK_COUNTY;
  return {
    id: "county.e2e-camrose",
    text: "Camrose",
    text_en: "Camrose",
    text_fr: "Camrose",
    place_name: "Camrose, Alberta, Canada",
    place_type: ["county"],
    center: [lon, lat],
    context: [
      {
        id: "region.12",
        text: "Alberta",
        text_en: "Alberta",
        text_fr: "Alberta",
        short_code: "CA-AB",
      },
      {
        id: "country.12",
        text: "Canada",
        text_en: "Canada",
        text_fr: "Canada",
        country_code: "ca",
      },
    ],
  };
}

function polandCountryFeature() {
  const { lon, lat } = CLICK_COUNTRY;
  return {
    id: "country.e2e-poland",
    text: "Poland",
    text_en: "Poland",
    text_fr: "Pologne",
    place_name: "Poland",
    place_type: ["country"],
    center: [lon, lat],
    properties: { short_code: "pl" },
  };
}

function genericReverseFeature(lon, lat) {
  const name = `Zone ${lat.toFixed(2)},${lon.toFixed(2)}`;
  return {
    id: `place.e2e-${lat.toFixed(2)}-${lon.toFixed(2)}`,
    text: name,
    text_en: name,
    text_fr: name,
    place_name: name,
    place_type: ["place"],
    center: [lon, lat],
    properties: { country_code: "fr" },
    context: [
      {
        id: "country.11",
        text: "France",
        text_en: "France",
        text_fr: "France",
        country_code: "fr",
      },
    ],
  };
}

export function reverseGeocodePayloadFor(lon, lat) {
  if (near(lon, CLICK_OCEAN.lon) && near(lat, CLICK_OCEAN.lat)) return { features: [] };
  if (near(lon, CLICK_REGION_POLY.lon) && near(lat, CLICK_REGION_POLY.lat)) {
    return { features: [occitanieRegionFeature()] };
  }
  if (near(lon, CLICK_REGION_BBOX.lon) && near(lat, CLICK_REGION_BBOX.lat)) {
    return { features: [texasRegionFeature()] };
  }
  if (near(lon, CLICK_CITY.lon) && near(lat, CLICK_CITY.lat)) {
    return { features: [tarbesFeature()] };
  }
  if (near(lon, CLICK_COUNTY.lon) && near(lat, CLICK_COUNTY.lat)) {
    return { features: [camroseCountyFeature()] };
  }
  if (near(lon, CLICK_COUNTRY.lon) && near(lat, CLICK_COUNTRY.lat)) {
    return { features: [polandCountryFeature()] };
  }
  if (near(lon, CLICK_SEA_NAMED.lon) && near(lat, CLICK_SEA_NAMED.lat)) {
    return { features: [mediterraneanSeaFeature()] };
  }
  return { features: [genericReverseFeature(lon, lat)] };
}

/* `/geocoding/2.35,48.85.json` → [2.35, 48.85]; a forward query → null. */
const REVERSE_PATH = /\/geocoding\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\.json/;
export function reverseCoordsFrom(url) {
  const match = REVERSE_PATH.exec(decodeURIComponent(url));
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export const PEXELS_PHOTOGRAPHER = "Ada Lovelace";
export const PEXELS_LINK = "https://www.pexels.com/photo/test-12345/";
export const PEXELS_ALT = "A city skyline at dusk";
/* 1×1 transparent GIF — a real, instantly-decodable image so the <img> load
   handler fires and the fade/has-photo path is genuinely exercised. */
const PIXEL_GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PIXEL = `data:image/gif;base64,${PIXEL_GIF_BASE64}`;
/* Same 1×1 GIF, as raw bytes — for serving a real cross-origin image request
   (Wikimedia thumbnails, unlike Pexels' data: URI, are loaded over the
   network) rather than embedding it inline. */
const PIXEL_BYTES = Buffer.from(PIXEL_GIF_BASE64, "base64");

/* The browser now talks to the SAME-ORIGIN proxy (/api/pexels), never to
   Pexels — the key lives on the server. So this is the proxy's response shape,
   not Pexels': {"photo": {...}, "photos": [...]} | {"photo": null, "photos": []}.
   `query` — present only for a text search, never a by-ID lookup — is echoed
   into the alt text so the mocked photo is realistically relevant to
   WHATEVER place asked for it (a real Pexels caption for a matching photo
   would plausibly mention it too), rather than one fixed sentence for every
   location in the suite. src/js/services/photo-api.js's relevance filter
   checks exactly this field, so a test that wants to exercise a REJECTION
   passes its own query-aware `photoProxy` override instead (see
   e2e/location-photos.spec.js) — this default stays a "passes relevance"
   fixture, matching how the rest of the suite already uses it. `photos`
   mirrors `photo` as a one-item pool, matching the real multi-candidate
   contract closely enough that rankPexelsCandidates has something to rank. */
export function photoProxyPayload(query) {
  const photo = {
    src: { medium: PIXEL, large: PIXEL, large2x: PIXEL },
    photographer: PEXELS_PHOTOGRAPHER,
    link: PEXELS_LINK,
    alt: query ? `${PEXELS_ALT} — ${query}` : PEXELS_ALT,
  };
  return { photo, photos: [photo] };
}

/* Wikimedia Commons is called DIRECTLY from the browser (public, keyless API
   — see services/wikimedia-api.js), never through a same-origin proxy, so it
   is matched by its real cross-origin host rather than a local path like the
   Pexels routes below. Empty by default: Pexels resolves first in the hybrid
   chain (fetchBestPhoto in photo-api.js) for nearly every existing test, so
   this only matters when a test explicitly wants the Wikimedia fallback —
   but it must still exist for EVERY test, or a location Pexels has nothing
   for (any `photoProxy: () => ({photo:null})` override) would fall through
   to a real, unmocked commons.wikimedia.org request and get caught — and
   aborted with a console warning — by the catch-all above. */
function wikimediaEmptyPage() {
  return { query: { pages: [] } };
}

/* A real image request (not a data: URI): Wikimedia thumbnails are loaded
   straight from upload.wikimedia.org by the browser, so — unlike Pexels,
   whose PIXEL data: URI needs no network — the mocked candidate's thumburl
   must be a real https URL, served by the route registered in installMocks
   below, or the <img> would try to hit the live internet. */
export const WIKIMEDIA_THUMB_URL = "https://upload.wikimedia.org/mock-thumb.jpg";

export function wikimediaPhotoPage({ title, alt, photographer, license = "CC0", lat, lon } = {}) {
  return {
    query: {
      pages: [
        {
          title: `File:${title || "photo"}.jpg`,
          ...(Number.isFinite(lat) && Number.isFinite(lon) ? { coordinates: [{ lat, lon }] } : {}),
          imageinfo: [
            {
              thumburl: WIKIMEDIA_THUMB_URL,
              thumbwidth: 1280,
              thumbheight: 800,
              descriptionurl: `https://commons.wikimedia.org/wiki/File:${title || "photo"}.jpg`,
              extmetadata: {
                LicenseShortName: { value: license },
                Artist: { value: photographer || "A Commons Contributor" },
                ImageDescription: { value: alt || title || "" },
              },
            },
          ],
        },
      ],
    },
  };
}

/* Minimal but valid MapLibre style: no remote tiles, so the map initialises
   and fires "load" without any network access. It carries one symbol layer
   because the app inserts the weather overlay and the selection boundary
   *before* the first label layer — with no symbol layer at all that ordering
   would never be exercised. */
function mapStylePayload() {
  return {
    version: 8,
    name: "e2e-blank",
    sources: {
      labels: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#dbeafe" } },
      /* No text-field and no `glyphs` URL: the layer exists purely to give the
         style a symbol layer to insert before, and rendering real text would
         drag a font endpoint into an offline test run for no benefit. */
      { id: "place-labels", type: "symbol", source: "labels" },
    ],
  };
}

/* ── MapTiler weather ───────────────────────────────────────────────────
   The real @maptiler/weather layers run in these tests: they fetch a
   `weather/latest.json` manifest and then one raster tile pyramid per
   keyframe. Both are served here, so the legend really does come from the
   layer's own ColorRamp and the timeline really does move a TimeFrame
   animation — no part of that pipeline is stubbed out.

   Keyframes are generated relative to the moment of the request, on the hour,
   spanning -3 h … +9 h. That is what makes "Now", "+3 h" and "+6 h" all
   genuinely reachable whenever the suite runs. */
export const WEATHER_KEYFRAME_HOURS = [-3, 0, 3, 6, 9];

function weatherVariable(variableId, channels) {
  const onTheHour = Math.floor(Date.now() / 3600000) * 3600000;
  return {
    tile_format: "png",
    metadata: {
      minzoom: 0,
      maxzoom: 2,
      weather_variable: {
        variable_id: variableId,
        decoding: { channels, min: -100, max: 100 },
      },
    },
    keyframes: WEATHER_KEYFRAME_HOURS.map((hours) => ({
      id: `${variableId}-${hours}`,
      timestamp: new Date(onTheHour + hours * 3600000).toISOString(),
    })),
  };
}

function weatherLatestPayload() {
  return {
    variables: [
      weatherVariable("temperature-2m:gfs", "R"),
      weatherVariable("precipitation-1h:gfs", "R"),
      /* wind is a two-channel (u/v) variable */
      weatherVariable("wind-10m:gfs", "RG"),
    ],
  };
}

/* 1×1 opaque PNG — a real decodable image, so the layer's texture upload path
   runs rather than erroring. */
const WEATHER_TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const json = (body) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/* ── Installer ─────────────────────────────────────────────────────────── */

export async function installMocks(page, overrides = {}) {
  const { weatherStatus = 200, photoProxy, wikimediaProxy, reverseDelayMs } = overrides;
  /* "calm" by default. Pass a function to vary the weather per request — the
     URL carries the coordinates, which is how a test gives two cities two
     different forecasts. */
  const { weatherKind = "calm" } = overrides;
  /* Every mocked location is "Europe/Paris" by default — same zone the
     Playwright context itself is pinned to (see playwright.config.js), so a
     test that wants to prove the clock follows the SELECTED city, not the
     visitor's own zone, needs to override this to something else. */
  const { weatherTimezone = "Europe/Paris" } = overrides;

  /* Registered FIRST on purpose: Playwright resolves routes in reverse
     registration order, so the specific handlers below override this one.
     Anything cross-origin they don't claim is a live call that shouldn't
     exist — abort it loudly rather than let it through.

     The matcher is a PREDICATE that excludes same-origin requests rather than
     a glob that matches everything and continues them. It looks equivalent,
     but a `route.continue()` is a full round-trip through the test process,
     and `vite dev` serves the app as several hundred unbundled modules per
     page load. Funnelling all of those through the interceptor made the
     handler queue the slowest thing in the run: under parallel load the app's
     own 8 s fetch timeout could expire waiting on a mock, and tests failed
     with a legitimate offline fallback instead of the mocked answer. Not
     matching them at all keeps the guarantee and removes the bottleneck. */
  const isExternal = (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
  await page.route(isExternal, (route, request) => {
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
    /* A comma-joined `latitude` means a BATCHED request (favorites, the
       popular-cities row, nearby places) — Open-Meteo answers those with an
       array, one entry per coordinate, not the single flat object a
       one-location request gets. */
    const latParam = new URL(request.url()).searchParams.get("latitude") || "";
    const placeCount = latParam.split(",").length;
    if (placeCount > 1) {
      return route.fulfill(
        json(
          Array.from({ length: placeCount }, (_, i) => weatherPayload(kind, i, weatherTimezone)),
        ),
      );
    }
    return route.fulfill(json(weatherPayload(kind, 0, weatherTimezone)));
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
  await page.route("**://api.maptiler.com/geocoding/**", async (route, request) => {
    const coords = reverseCoordsFrom(request.url());
    if (!coords) return route.fulfill(json(maptilerGeocodePayloadFor(request.url())));
    /* `reverseDelayMs` lets a test make one reverse lookup slower than a
       later one, which is how the stale-response guard is exercised. */
    const delay = typeof reverseDelayMs === "function" ? reverseDelayMs(...coords) : 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return route.fulfill(json(reverseGeocodePayloadFor(...coords)));
  });
  /* weather manifest + raster tiles for the real @maptiler/weather layers */
  await page.route("**://api.maptiler.com/weather/latest.json*", (route) =>
    route.fulfill(json(weatherLatestPayload())),
  );
  await page.route("**://api.maptiler.com/tiles/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: WEATHER_TILE_PNG }),
  );
  /* SDK usage telemetry. Answered rather than aborted: an aborted request
     logs a console error, and these tests assert the console stays clean.
     Matched by regex, not a glob — the URL carries a query string. */
  await page.route(/https:\/\/api\.maptiler\.com\/metrics/, (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route("**://api.bigdatacloud.net/**", (route) => route.fulfill(json({})));
  /* The Inter webfont is a third-party request too — served empty so runs stay
     offline-clean without waiting on rsms.me. Answered rather than aborted: an
     aborted stylesheet logs "Failed to load resource" to the console, and some
     tests assert the console stays clean. */
  await page.route("**://rsms.me/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );

  /* The photo proxy is SAME-ORIGIN, so the cross-origin catch-all above would
     let it through to the real dev middleware — and that middleware holds a
     real key. Intercept it explicitly: no test may ever reach Pexels.
     `photoProxy` lets a test choose the status/body to simulate 429/502/503. */
  await page.route("**/api/pexels*", (route) => {
    if (typeof photoProxy === "function") return photoProxy(route);
    const query = new URL(route.request().url()).searchParams.get("query");
    return route.fulfill(json(photoProxyPayload(query)));
  });

  /* Belt and braces: if a future change ever calls Pexels from the browser
     again, fail loudly instead of silently succeeding. */
  await page.route("**://api.pexels.com/**", (route) => {
    console.warn("[e2e] BLOCKED direct browser call to api.pexels.com");
    return route.abort();
  });

  /* Wikimedia Commons — the second half of the hybrid photo strategy — IS
     called directly from the browser (it's public and keyless, unlike
     Pexels; see services/wikimedia-api.js), so it is mocked like any other
     cross-origin dependency rather than intercepted-and-blocked. Empty by
     default: see the comment on wikimediaEmptyPage/wikimediaPhotoPage above
     for why every test needs this registered even when it never expects a
     Wikimedia photo to actually appear. */
  await page.route("**://commons.wikimedia.org/**", (route) => {
    if (typeof wikimediaProxy === "function") return wikimediaProxy(route);
    return route.fulfill(json(wikimediaEmptyPage()));
  });
  /* The real image bytes behind a mocked Wikimedia candidate's thumburl. */
  await page.route(`${WIKIMEDIA_THUMB_URL}*`, (route) =>
    route.fulfill({ status: 200, contentType: "image/gif", body: PIXEL_BYTES }),
  );
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
