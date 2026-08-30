import { defineConfig, loadEnv } from "vite";

/* Development stand-in for the production Pexels proxy.
 *
 * Production is api/pexels.js (a Vercel serverless function) on the current
 * deploy target, or public/api/pexels.php on the alternate Hostinger/Apache
 * path (reached via the rewrite rule in public/.htaccess, since Apache has
 * no serverless functions). `vite dev` has neither, so the same endpoint is
 * served here by Node. All three speak the identical contract, so the
 * frontend has exactly one code path.
 *
 * The key is read from PEXELS_API_KEY — deliberately WITHOUT the VITE_ prefix,
 * which is the only thing that keeps it out of the client bundle. Vite injects
 * prefixed variables into import.meta.env; unprefixed ones stay in the Node
 * process, which is where this middleware runs. The value is never written into
 * a response body, a define(), or any file under src/.
 */
const ENDPOINT = "/api/pexels";
const QUERY_MIN_LENGTH = 2;
const QUERY_MAX_LENGTH = 120;
const UPSTREAM_TIMEOUT_MS = 8000;
/* Pexels photo IDs are positive integers. Bounding the digit count keeps an
   absurdly long string from ever reaching the upstream URL. */
const ID_PATTERN = /^[1-9][0-9]{0,15}$/;
/* Mirrors CANDIDATE_COUNT in api/pexels.js / public/api/pexels.php — the
   client ranks these itself (rankPexelsCandidates in photo-api.js). */
const CANDIDATE_COUNT = 8;

/* `store: false` forces `no-store` even on a 200 — used by the Google photo
   resolve, whose body carries a short-lived, licence-restricted signed URI
   that no cache between here and the <img> may retain. */
function sendJson(res, status, payload, { store = true } = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", status === 200 && store ? "public, max-age=600" : "no-store");
  res.end(JSON.stringify(payload));
}

/* Same validation as clean_query() in the PHP proxy: reject C0/C1 control
   characters outright rather than stripping them, collapse whitespace, and
   bound the length. */
// eslint-disable-next-line no-control-regex -- rejecting these characters IS the point
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]");

function cleanQuery(raw) {
  if (typeof raw !== "string") return null;
  if (CONTROL_CHARS.test(raw)) return null;
  const query = raw.replace(/\s+/g, " ").trim();
  if (query.length < QUERY_MIN_LENGTH || query.length > QUERY_MAX_LENGTH) return null;
  return query;
}

/* Mirror of the PHP re-projection: only these fields ever reach the browser. */
function toPayload(photo) {
  const src = (photo && photo.src) || {};
  const https = (v) => (typeof v === "string" && v.startsWith("https://") ? v : null);
  const sizes = Object.fromEntries(
    [
      ["medium", https(src.medium)],
      ["large", https(src.large)],
      ["large2x", https(src.large2x)],
    ].filter(([, v]) => v !== null),
  );
  if (Object.keys(sizes).length === 0) return null;
  const link = typeof photo.url === "string" ? photo.url : "";
  return {
    src: sizes,
    photographer: typeof photo.photographer === "string" ? photo.photographer.slice(0, 120) : "",
    link: link.startsWith("https://www.pexels.com/") ? link : "",
    alt: typeof photo.alt === "string" ? photo.alt.slice(0, 200) : "",
  };
}

function pexelsDevProxy(apiKey) {
  const handler = async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== ENDPOINT) return next();

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    /* Curated locations (src/js/data/locations.js) carry a manually reviewed
       Pexels photo ID so the hero/card image is guaranteed to show the actual
       landmark rather than whatever a text search ranks first — see
       api/pexels.js, which this dev proxy mirrors. */
    const idParam = url.searchParams.get("id");
    if (idParam !== null) {
      if (!ID_PATTERN.test(idParam)) return sendJson(res, 400, { error: "invalid_id" });
      if (!apiKey) return sendJson(res, 503, { error: "unavailable" });

      try {
        const r = await fetch(`https://api.pexels.com/v1/photos/${idParam}`, {
          headers: { Authorization: apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (r.status === 404) return sendJson(res, 404, { error: "not_found" });
        if (r.status === 429) {
          res.setHeader("Retry-After", "60");
          return sendJson(res, 429, { error: "rate_limited" });
        }
        if (!r.ok) return sendJson(res, 502, { error: "upstream_error" });

        const photo = await r.json();
        return sendJson(res, 200, { photo: toPayload(photo) });
      } catch {
        return sendJson(res, 502, { error: "upstream_error" });
      }
    }

    const query = cleanQuery(url.searchParams.get("query"));
    if (query === null) return sendJson(res, 400, { error: "invalid_query" });

    if (!apiKey) {
      /* Same answer the PHP proxy gives when the secret file is missing, so the
         "no key configured" path is exercised identically in dev. */
      return sendJson(res, 503, { error: "unavailable" });
    }

    const upstream =
      "https://api.pexels.com/v1/search?" +
      new URLSearchParams({
        query,
        orientation: "landscape",
        per_page: String(CANDIDATE_COUNT),
        size: "medium",
      });

    try {
      const r = await fetch(upstream, {
        headers: { Authorization: apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (r.status === 429) {
        res.setHeader("Retry-After", "60");
        return sendJson(res, 429, { error: "rate_limited" });
      }
      if (!r.ok) return sendJson(res, 502, { error: "upstream_error" });

      const data = await r.json();
      const photos = (data.photos || []).map(toPayload).filter(Boolean);
      return sendJson(res, 200, { photo: photos[0] || null, photos });
    } catch {
      /* Network failure or timeout. The message is deliberately not forwarded —
         the browser only needs "no photo". */
      return sendJson(res, 502, { error: "upstream_error" });
    }
  };

  /* Braces, not a concise arrow body: `middlewares.use()` returns the connect
     app, and a value returned from configureServer is treated by Vite as a
     post-hook to invoke later — returning it crashes server startup. */
  return {
    name: "weathersphere-pexels-dev-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    /* `vite preview` serves dist/, which carries only the static
       public/api/pexels.php file (no PHP or Vercel runtime to execute it
       here) — wire the same middleware in so previewing a production build
       still shows photos. */
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/* Development stand-in for the production Google Places proxy.
 *
 * Exactly the same arrangement as the Pexels middleware above and answering
 * the same route the built app calls on every target (/api/places — see
 * GOOGLE_PLACES_PROXY_URL in src/js/core/config.js): api/places.js on Vercel,
 * public/api/places.php on Apache, this in dev. All three speak one contract.
 *
 * The key is read from GOOGLE_PLACES_API_KEY — again WITHOUT the VITE_
 * prefix, which is the only thing keeping it out of the client bundle.
 */
const PLACES_ENDPOINT = "/api/places";
const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_MEDIA_BASE = "https://places.googleapis.com/v1/";
/* Mirrors FIELD_MASK in api/places.js / public/api/places.php. */
const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.googleMapsUri",
  "places.photos",
].join(",");
/* Mirrors PLACES_CANDIDATE_COUNT in the other two implementations. */
const PLACES_CANDIDATE_COUNT = 5;
const PHOTO_MAX_WIDTH_PX = 1280;
const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]{1,255}\/photos\/[A-Za-z0-9_-]{1,1024}$/;
const PHOTO_HOST_PATTERN =
  /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(googleusercontent\.com|ggpht\.com)\//i;

function httpsOnly(value) {
  return typeof value === "string" && value.startsWith("https://") ? value.slice(0, 512) : "";
}

function finiteOrNull(value, limit) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/* Mirror of the re-projection in api/places.js: only these fields ever reach
   the browser, and a photo with no author attribution is dropped rather than
   shown uncredited (Google requires the attribution to travel with it). */
function toPlacePayload(place) {
  const name = String(place?.displayName?.text || "").slice(0, 160);
  if (!name) return null;
  const raw = (Array.isArray(place.photos) ? place.photos : [])[0];
  if (!raw || typeof raw.name !== "string" || !PHOTO_NAME_PATTERN.test(raw.name)) return null;
  const attributions = (Array.isArray(raw.authorAttributions) ? raw.authorAttributions : [])
    .slice(0, 3)
    .map((a) => ({ name: String(a?.displayName || "").slice(0, 120), uri: httpsOnly(a?.uri) }))
    .filter((a) => a.name !== "");
  if (attributions.length === 0) return null;
  const at = place.location || {};
  return {
    id: typeof place.id === "string" ? place.id.slice(0, 255) : "",
    name,
    address: String(place.formattedAddress || "").slice(0, 240),
    lat: finiteOrNull(at.latitude, 90),
    lon: finiteOrNull(at.longitude, 180),
    types: (Array.isArray(place.types) ? place.types : [])
      .filter((t) => typeof t === "string")
      .slice(0, 12),
    mapsUri: httpsOnly(place.googleMapsUri),
    photo: {
      ref: raw.name,
      width: finiteOrNull(raw.widthPx, 100000) || 0,
      height: finiteOrNull(raw.heightPx, 100000) || 0,
      attributions,
    },
  };
}

function placesDevProxy(apiKey) {
  const handler = async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== PLACES_ENDPOINT) return next();

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    /* The RESOLVE step: one photo reference → its short-lived signed URI.
       Answered `no-store` (see sendJson) because that URI is licence-limited
       and must not be retained by any cache between here and the <img>. */
    const photoParam = url.searchParams.get("photo");
    if (photoParam !== null) {
      if (!PHOTO_NAME_PATTERN.test(photoParam))
        return sendJson(res, 400, { error: "invalid_photo" });
      if (!apiKey) return sendJson(res, 503, { error: "unavailable" });
      const asked = finiteOrNull(url.searchParams.get("w"), 4800);
      const maxWidthPx = asked && asked >= 200 ? Math.round(asked) : PHOTO_MAX_WIDTH_PX;
      try {
        const r = await fetch(
          `${PLACES_MEDIA_BASE}${photoParam}/media?` +
            new URLSearchParams({ maxWidthPx: String(maxWidthPx), skipHttpRedirect: "true" }),
          {
            headers: { "X-Goog-Api-Key": apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          },
        );
        if (r.status === 404) return sendJson(res, 404, { error: "not_found" });
        if (r.status === 429) {
          res.setHeader("Retry-After", "60");
          return sendJson(res, 429, { error: "rate_limited" });
        }
        if (!r.ok) return sendJson(res, 502, { error: "upstream_error" });
        const data = await r.json();
        const src = typeof data?.photoUri === "string" ? data.photoUri : "";
        if (!PHOTO_HOST_PATTERN.test(src))
          return sendJson(res, 200, { photo: null }, { store: false });
        return sendJson(res, 200, { photo: { src, width: maxWidthPx } }, { store: false });
      } catch {
        return sendJson(res, 502, { error: "upstream_error" });
      }
    }

    const query = cleanQuery(url.searchParams.get("query"));
    if (query === null) return sendJson(res, 400, { error: "invalid_query" });
    if (!apiKey) return sendJson(res, 503, { error: "unavailable" });

    const lat = finiteOrNull(url.searchParams.get("lat"), 90);
    const lon = finiteOrNull(url.searchParams.get("lon"), 180);
    const body = {
      textQuery: query,
      maxResultCount: PLACES_CANDIDATE_COUNT,
      languageCode: url.searchParams.get("lang") === "fr" ? "fr" : "en",
    };
    if (lat !== null && lon !== null) {
      body.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 50000 } };
    }

    try {
      const r = await fetch(PLACES_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": PLACES_FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (r.status === 429) {
        res.setHeader("Retry-After", "60");
        return sendJson(res, 429, { error: "rate_limited" });
      }
      if (r.status === 403) return sendJson(res, 503, { error: "unavailable" });
      if (!r.ok) return sendJson(res, 502, { error: "upstream_error" });
      const data = await r.json();
      const places = (Array.isArray(data?.places) ? data.places : [])
        .map(toPlacePayload)
        .filter(Boolean);
      return sendJson(res, 200, { places });
    } catch {
      return sendJson(res, 502, { error: "upstream_error" });
    }
  };

  return {
    name: "weathersphere-places-dev-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

// The app has no client-side router (views are shown/hidden with JS, not
// URLs), so a relative base lets the same build work unmodified whether it's
// served from a domain root (current Hostinger deploy) or a GitHub Pages
// project path such as /site-meteo-tarbes/.
export default defineConfig(({ mode }) => {
  /* Loaded with an empty prefix so unprefixed variables are visible HERE, in
     the config, which runs in Node. This does NOT expose them to client code:
     what reaches import.meta.env is governed by `envPrefix` (default "VITE_"),
     which is left untouched. */
  const env = loadEnv(mode, process.cwd(), "");
  const pexelsKey = process.env.PEXELS_API_KEY ?? env.PEXELS_API_KEY ?? "";
  const placesKey = process.env.GOOGLE_PLACES_API_KEY ?? env.GOOGLE_PLACES_API_KEY ?? "";

  return {
    root: "src",
    base: "./",
    publicDir: "../public",
    envDir: "../",
    plugins: [pexelsDevProxy(pexelsKey), placesDevProxy(placesKey)],
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
    test: {
      environment: "node",
      include: ["js/**/*.test.js"],
    },
  };
});
