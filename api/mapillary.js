/* WeatherSphere — server-side Mapillary proxy (Vercel serverless).
 *
 * WHY THIS EXISTS
 * ---------------
 * Same reasoning as api/pexels.js and api/places.js. A Mapillary access token
 * (`MLY|<app id>|<secret>`) is a credential: it cannot be origin-restricted,
 * and it is read from an UNPREFIXED environment variable so Vite can never
 * compile it into the client bundle.
 *
 * WHAT IT IS FOR
 * --------------
 * Street-level, GEOTAGGED photography. Mapillary's value in this pipeline is
 * that every image carries the coordinate it was taken at — so it can answer
 * "show me something that is demonstrably at this place" for towns and
 * villages that Google and Wikimedia have never photographed. It is NOT a
 * source of attractive hero photography (much of it is roadside), which is
 * why it sits fourth, behind Wikimedia's coordinate search, and why the
 * client always labels it as a NEARBY photo rather than a photo OF the place.
 *
 * LICENSING
 * ---------
 * Mapillary imagery is CC BY-SA 4.0. The licence and the contributor's
 * username must travel with the image, and the client refuses to display any
 * Mapillary photo it cannot attribute (see services/mapillary-api.js).
 * Unlike the licence, the `thumb_*_url` values are SIGNED CDN URLs that
 * expire, so they are cached in memory for minutes only and are never written
 * to Cache Storage (public/sw.js).
 *
 * RESPONSE CONTRACT (shared with vite.config.js's dev middleware and
 * public/api/mapillary.php)
 * ---------------------------------------------------------------------
 *   GET ?lat=&lon=&radius=
 *   200 {"images":[{id,src,width,height,lat,lon,capturedAt,isPano,creator,link}]}
 *   200 {"images":[]}                          nothing geotagged nearby
 *   400 {"error":"invalid_coordinates"}
 *   405 {"error":"method_not_allowed"}
 *   429 {"error":"rate_limited"}
 *   502 {"error":"upstream_error"}
 *   503 {"error":"unavailable"}                token not configured, or denied
 * Every failure means the same thing to the UI: no Mapillary photo, fall
 * through to the next provider. The upstream body is never forwarded.
 */

const GRAPH_ENDPOINT = "https://graph.mapillary.com/images";

/* Only what the client needs to rank, display and attribute an image.
   Requesting less keeps the response small and the upstream call cheap. */
const FIELDS = [
  "id",
  "thumb_1024_url",
  "captured_at",
  "is_pano",
  "geometry",
  "creator",
  "width",
  "height",
].join(",");

const CANDIDATE_COUNT = 12;
const UPSTREAM_TIMEOUT_MS = 8000;
/* Bounds on the search box the caller may ask for. A radius larger than this
   stops being "at this place" and starts being "somewhere in the region",
   which is not what this provider is here to answer. */
const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 2000;
const DEFAULT_RADIUS_M = 800;

/* Mapillary serves its thumbnails from Meta's CDN. The value is handed to the
   browser as an <img> src, so it must be one of these and nothing else. */
const THUMB_HOST_PATTERN = /^https:\/\/[a-z0-9._-]+\.(mapillary\.com|fbcdn\.net|facebook\.com)\//i;

function finiteOrNull(value, limit) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/* Metres → degrees, for the bounding box Mapillary's `bbox` filter wants.
   Longitude degrees shrink with latitude, hence the cosine; clamped so a
   near-polar location cannot divide by ~0 and produce a planet-wide box. */
function bboxAround(lat, lon, radiusM) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((n) => n.toFixed(6)).join(",");
}

/* Re-projection: only these fields ever reach the browser. An image with no
   usable thumbnail, no coordinate, or no named contributor is dropped —
   CC BY-SA requires the attribution, so an image we cannot credit is one we
   must not show. */
function toImagePayload(image) {
  if (!image || typeof image !== "object") return null;
  const src = typeof image.thumb_1024_url === "string" ? image.thumb_1024_url : "";
  if (!THUMB_HOST_PATTERN.test(src)) return null;

  const coords = image.geometry?.coordinates;
  const lon = Array.isArray(coords) ? finiteOrNull(coords[0], 180) : null;
  const lat = Array.isArray(coords) ? finiteOrNull(coords[1], 90) : null;
  if (lat === null || lon === null) return null;

  const creator = String(image.creator?.username || "").slice(0, 120);
  if (!creator) return null;

  const id = String(image.id || "").slice(0, 64);
  if (!/^[0-9]+$/.test(id)) return null;

  return {
    id,
    src: src.slice(0, 2048),
    width: finiteOrNull(image.width, 100000) || 0,
    height: finiteOrNull(image.height, 100000) || 0,
    lat,
    lon,
    capturedAt: finiteOrNull(image.captured_at, 1e15) || 0,
    isPano: image.is_pano === true,
    creator,
    /* The canonical page for this image — where CC BY-SA attribution points. */
    link: `https://www.mapillary.com/app/?pKey=${id}&focus=photo`,
  };
}

function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  /* The image URLs in this body are signed and expire, so the body is only
     briefly reusable. Short, and never by a shared cache. */
  res.setHeader("Cache-Control", status === 200 ? "private, max-age=300" : "no-store");
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed" });
  }

  const lat = finiteOrNull(req.query.lat, 90);
  const lon = finiteOrNull(req.query.lon, 180);
  if (lat === null || lon === null) return send(res, 400, { error: "invalid_coordinates" });

  const token = process.env.MAPILLARY_ACCESS_TOKEN;
  if (!token) return send(res, 503, { error: "unavailable" });

  const asked = finiteOrNull(req.query.radius, MAX_RADIUS_M);
  const radius = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, asked || DEFAULT_RADIUS_M));

  try {
    const r = await fetch(
      `${GRAPH_ENDPOINT}?${new URLSearchParams({
        fields: FIELDS,
        bbox: bboxAround(lat, lon, radius),
        limit: String(CANDIDATE_COUNT),
      })}`,
      {
        /* The token travels in the Authorization header, never in the URL —
           query strings end up in access logs, proxies and Referer headers. */
        headers: { Authorization: `OAuth ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (r.status === 429) return send(res, 429, { error: "rate_limited" });
    /* A denied/absent/over-quota token is a configuration problem, not a
       broken request — same answer as "no token", so the client stops asking
       instead of retrying a call that cannot succeed. */
    if (r.status === 401 || r.status === 403) return send(res, 503, { error: "unavailable" });
    if (!r.ok) return send(res, 502, { error: "upstream_error" });

    const data = await r.json();
    const images = (Array.isArray(data?.data) ? data.data : []).map(toImagePayload).filter(Boolean);
    return send(res, 200, { images });
  } catch {
    return send(res, 502, { error: "upstream_error" });
  }
}
