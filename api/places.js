/* WeatherSphere — server-side Google Places proxy (Vercel serverless).
 *
 * WHY THIS EXISTS
 * ---------------
 * Same reason as api/pexels.js: GOOGLE_PLACES_API_KEY is read from the
 * platform's environment variables and is never exposed to the browser. The
 * variable is deliberately UNPREFIXED — a VITE_-prefixed name would be
 * compiled into the client bundle, which is exactly what must not happen.
 * Google Places keys can be referrer-restricted, but a Places API (New) key
 * used server-side should be IP-restricted instead, and either way a key in
 * the bundle is a published credential.
 *
 * TWO OPERATIONS, ONE ROUTE
 * -------------------------
 *   GET /api/places?query=…[&lat=&lon=&lang=]
 *       → {"places":[{id,name,address,lat,lon,types,mapsUri,photo:{…}}, …]}
 *       The CANDIDATE step. Returns place metadata only — never an image URL.
 *       The client ranks these against the selected location itself
 *       (services/places-api.js) rather than trusting Google's first hit,
 *       which is the "prefer exact Place IDs and coordinate proximity over
 *       generic keyword matches" half of the requirement.
 *
 *   GET /api/places?photo=places/<id>/photos/<ref>[&w=]
 *       → {"photo":{"src":"https://lh3.googleusercontent.com/…","width":n}}
 *       The RESOLVE step, run only for the ONE candidate that won. Splitting
 *       the two keeps this to two upstream calls per location instead of one
 *       search plus one media call per candidate.
 *
 * LICENSING / CACHING
 * -------------------
 * Google Maps Platform terms allow temporary caching of Places content for
 * performance, but a resolved photo URI is a short-lived signed URL that must
 * not be persisted or re-published. So:
 *   - the SEARCH response is cacheable for a short window (place metadata);
 *   - the PHOTO response is `no-store`, so no browser, CDN or service worker
 *     ever keeps the signed URI (public/sw.js also refuses it explicitly);
 *   - the client keeps it in memory only, under a short TTL.
 * The photo's authorAttributions travel with it and the client is required to
 * display them — see renderPhotoCredit in services/photo-api.js.
 *
 * RESPONSE CONTRACT (shared with vite.config.js's dev middleware and
 * public/api/places.php)
 * ---------------------------------------------------------------------
 *   200 {"places":[…]} | {"places":[]}         candidate lookup
 *   200 {"photo":{…}}  | {"photo":null}        photo resolve
 *   400 {"error":"invalid_query"|"invalid_photo"}
 *   404 {"error":"not_found"}                  photo reference expired/unknown
 *   405 {"error":"method_not_allowed"}
 *   429 {"error":"rate_limited"}
 *   502 {"error":"upstream_error"}
 *   503 {"error":"unavailable"}                key not configured, or denied
 * Every failure means the same thing to the UI: no Google photo, fall through
 * to the next provider. The upstream body is never forwarded.
 */

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const MEDIA_ENDPOINT_BASE = "https://places.googleapis.com/v1/";

/* Places API (New) bills per requested field group and refuses a request with
   no mask at all. This is the minimum that supports ranking: identity
   (id/displayName/formattedAddress), proximity (location), kind matching
   (types), attribution (googleMapsUri) and the photo reference itself. */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.googleMapsUri",
  "places.photos",
].join(",");

/* Mirrors CANDIDATE_COUNT in vite.config.js / public/api/places.php. Smaller
   than the Pexels pool (8): Google's text search is far more precise, so the
   extra candidates are mostly unrelated nearby businesses — and each one
   costs. */
const CANDIDATE_COUNT = 5;
const PHOTO_MAX_WIDTH_PX = 1280;
const QUERY_MIN_LENGTH = 2;
const QUERY_MAX_LENGTH = 120;
const UPSTREAM_TIMEOUT_MS = 8000;

/* A photo resource name is `places/<place id>/photos/<reference>`, both
   halves base64url. Validating the WHOLE shape — rather than interpolating
   whatever arrived — is what stops this route being used to reach an
   arbitrary Google API path. */
const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]{1,255}\/photos\/[A-Za-z0-9_-]{1,1024}$/;

/* The resolved URI is handed to the browser as an <img> src, so it must be a
   real Google-hosted image and nothing else. */
const PHOTO_HOST_PATTERN =
  /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(googleusercontent\.com|ggpht\.com)\//i;

// eslint-disable-next-line no-control-regex -- rejecting these characters IS the point
const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]");

function cleanQuery(raw) {
  if (typeof raw !== "string") return null;
  if (CONTROL_CHARS.test(raw)) return null;
  const query = raw.replace(/\s+/g, " ").trim();
  if (query.length < QUERY_MIN_LENGTH || query.length > QUERY_MAX_LENGTH) return null;
  return query;
}

function httpsOnly(value) {
  return typeof value === "string" && value.startsWith("https://") ? value.slice(0, 512) : "";
}

function finiteOrNull(value, limit) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function toPhotoRef(photo) {
  if (!photo || typeof photo.name !== "string" || !PHOTO_NAME_PATTERN.test(photo.name)) return null;
  /* Google REQUIRES these to be displayed alongside the photo. A photo with
     no usable attribution is dropped rather than shown uncredited. */
  const attributions = (Array.isArray(photo.authorAttributions) ? photo.authorAttributions : [])
    .slice(0, 3)
    .map((a) => ({ name: String(a?.displayName || "").slice(0, 120), uri: httpsOnly(a?.uri) }))
    .filter((a) => a.name !== "");
  if (attributions.length === 0) return null;
  return {
    ref: photo.name,
    width: finiteOrNull(photo.widthPx, 100000) || 0,
    height: finiteOrNull(photo.heightPx, 100000) || 0,
    attributions,
  };
}

/* Re-projection: only these fields ever reach the browser. Places with no
   usable, attributable photo are dropped — they cannot answer the one
   question this provider is being asked. */
function toPlacePayload(place) {
  const name = String(place?.displayName?.text || "").slice(0, 160);
  if (!name) return null;
  const photo = toPhotoRef((Array.isArray(place.photos) ? place.photos : [])[0]);
  if (!photo) return null;
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
    photo,
  };
}

function send(res, status, payload, { store = true } = {}) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  /* A resolved photo URI is short-lived and licence-restricted — never let
     anything between here and the <img> retain a copy. */
  res.setHeader("Cache-Control", status === 200 && store ? "public, max-age=600" : "no-store");
  return res.status(status).json(payload);
}

async function resolvePhoto(res, key, rawName, rawWidth) {
  if (!PHOTO_NAME_PATTERN.test(rawName)) return send(res, 400, { error: "invalid_photo" });
  const width = finiteOrNull(rawWidth, 4800);
  const maxWidthPx = width && width >= 200 ? Math.round(width) : PHOTO_MAX_WIDTH_PX;

  try {
    const r = await fetch(
      `${MEDIA_ENDPOINT_BASE}${rawName}/media?${new URLSearchParams({
        maxWidthPx: String(maxWidthPx),
        /* JSON with the signed URI instead of a 302 to it, so the key stays
           on this side of the request and the browser loads the image
           directly from Google's CDN with no credential involved. */
        skipHttpRedirect: "true",
      })}`,
      {
        headers: { "X-Goog-Api-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (r.status === 404) return send(res, 404, { error: "not_found" }, { store: false });
    if (r.status === 429) return send(res, 429, { error: "rate_limited" });
    if (!r.ok) return send(res, 502, { error: "upstream_error" });

    const data = await r.json();
    const src = typeof data?.photoUri === "string" ? data.photoUri : "";
    if (!PHOTO_HOST_PATTERN.test(src)) return send(res, 200, { photo: null }, { store: false });
    return send(res, 200, { photo: { src, width: maxWidthPx } }, { store: false });
  } catch {
    return send(res, 502, { error: "upstream_error" });
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed" });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;

  const photoParam = typeof req.query.photo === "string" ? req.query.photo : "";
  if (photoParam) {
    if (!key) return send(res, 503, { error: "unavailable" });
    return resolvePhoto(res, key, photoParam, req.query.w);
  }

  const query = cleanQuery(req.query.query);
  if (query === null) return send(res, 400, { error: "invalid_query" });
  if (!key) return send(res, 503, { error: "unavailable" });

  const lat = finiteOrNull(req.query.lat, 90);
  const lon = finiteOrNull(req.query.lon, 180);
  const body = {
    textQuery: query,
    maxResultCount: CANDIDATE_COUNT,
    languageCode: req.query.lang === "fr" ? "fr" : "en",
  };
  /* A bias, not a restriction: the geocoder's coordinate is authoritative for
     WHERE the place is, but Google may legitimately place a city's own entry
     a few km from another provider's centroid. Biasing sharpens the result
     without ever excluding the right answer. */
  if (lat !== null && lon !== null) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 50000 } };
  }

  try {
    const r = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (r.status === 429) return send(res, 429, { error: "rate_limited" });
    /* A denied/absent/over-quota key is a configuration problem, not a broken
       request — same answer as "no key", so the UI just uses another
       provider instead of retrying a call that cannot succeed. */
    if (r.status === 403) return send(res, 503, { error: "unavailable" });
    if (!r.ok) return send(res, 502, { error: "upstream_error" });

    const data = await r.json();
    const places = (Array.isArray(data?.places) ? data.places : [])
      .map(toPlacePayload)
      .filter(Boolean);
    return send(res, 200, { places });
  } catch {
    return send(res, 502, { error: "upstream_error" });
  }
}
