/* Mapillary — geotagged street-level imagery, provider 4 of the photo chain.
 *
 * WHAT IT IS FOR
 * --------------
 * The places the other providers have never photographed. Google's photos are
 * attached to businesses; Wikimedia's to things somebody wrote an article
 * about; Pexels' to whatever sells as stock. A village of 800 people has none
 * of those — but it very often has a road somebody drove with a dashcam, and
 * every Mapillary image carries the coordinate it was taken at.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a source of attractive hero photography. A lot of Mapillary is
 * roadside: hedges, car bonnets, overcast junctions. So it sits BEHIND
 * Wikimedia's coordinate search, and every result it returns is labelled
 * `provenance: "nearby"` — a photo taken AT the place, never claimed to be a
 * photo OF the place. That distinction is the whole point of the provenance
 * tiers (see ui/photo-provenance.js).
 *
 * KEY HANDLING
 * ------------
 * No token in this file and none in the bundle: everything goes through the
 * same-origin proxy (MAPILLARY_PROXY_URL — api/mapillary.js on Vercel,
 * public/api/mapillary.php on Apache, a Vite middleware in dev), which reads
 * MAPILLARY_ACCESS_TOKEN server-side.
 *
 * LICENSING AND CACHING
 * ---------------------
 * Mapillary imagery is CC BY-SA 4.0: the contributor and the licence must be
 * displayed with the image, and an image that cannot be attributed is refused
 * rather than shown bare. The LICENCE would permit caching, but the
 * `thumb_1024_url` values are signed CDN URLs that EXPIRE — a cached one
 * turns into a broken image — so they are held in memory for minutes only and
 * public/sw.js refuses to put them in Cache Storage.
 */
import { MAPILLARY_PROXY_URL, FETCH_TIMEOUT_MS } from "../core/config.js";
import { distanceKm, isMarineKind } from "./photo-relevance.js";

/* Comfortably shorter than the signed URL's own lifetime. */
const CACHE_TTL_MS = 10 * 60000;

/* How far from the location a street-level photo may have been taken and
   still represent it. Deliberately small: this provider's entire claim is
   "taken at this spot", and a 5 km radius around a village centre would
   return a motorway.

   Region, state, province and country are absent on purpose — a single
   roadside photo says nothing about a territory, and offering one would be
   exactly the "generic image presented as the place" failure to avoid. */
const RADIUS_M = {
  address: 150,
  poi: 200,
  village: 500,
  town: 800,
  city: 1000,
};

const CACHE = new Map(); // "lat,lon,radius" → {value, expires}
const IN_FLIGHT = new Map();

/* Set when the proxy reports 503 (no token configured, or it was denied).
   A deployment fact, not a per-location one — without this, a site with no
   Mapillary token would fire one pointless request per location all session. */
let providerUnavailable = false;

export function __resetMapillaryCacheForTests() {
  CACHE.clear();
  IN_FLIGHT.clear();
  providerUnavailable = false;
}

/** Whether this location is one street-level imagery can meaningfully answer. */
export function mapillaryRadiusFor(loc) {
  if (!loc || isMarineKind(loc.kind)) return 0;
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return 0;
  return RADIUS_M[loc.kind] || 0;
}

/* A panorama rendered into a 16:9 hero is a smear, and a fifteen-year-old
   capture misrepresents a place that has since changed — so both are ranked
   down rather than excluded, and proximity dominates both. */
export function scoreMapillaryImage(loc, image, radiusM) {
  const km = distanceKm(loc?.lat, loc?.lon, image?.lat, image?.lon);
  if (km === null) return -Infinity;
  const radiusKm = radiusM / 1000;
  if (km > radiusKm) return -Infinity;

  /* 0 at the edge of the radius, 10 at the exact point. */
  let score = 10 * (1 - km / radiusKm);
  if (image.isPano) score -= 4;
  if (image.width && image.height && image.width >= image.height) score += 1;
  /* Recency, capped: anything from the last ~3 years is equally current. */
  if (image.capturedAt) {
    const years = (Date.now() - image.capturedAt) / (365.25 * 24 * 3600 * 1000);
    score += Math.max(-3, Math.min(2, 2 - years / 3));
  }
  return score;
}

export function pickBestMapillaryImage(loc, images, radiusM) {
  let best = null;
  let bestScore = -Infinity;
  for (const image of Array.isArray(images) ? images : []) {
    if (!image || !image.src || !image.creator) continue;
    const score = scoreMapillaryImage(loc, image, radiusM);
    /* Strictly greater, so a tie keeps the provider's own order. */
    if (score > bestScore) {
      bestScore = score;
      best = image;
    }
  }
  return best;
}

function readFresh(key) {
  const hit = CACHE.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    CACHE.delete(key);
    return undefined;
  }
  return hit.value;
}

export function fetchMapillaryImages(loc) {
  const radius = mapillaryRadiusFor(loc);
  if (providerUnavailable || !radius) return Promise.resolve([]);

  /* Rounded to ~100 m, so two clicks on the same town share one lookup. */
  const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)},${radius}`;
  const cached = readFresh(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = IN_FLIGHT.get(key);
  if (pending) return pending;

  const url = `${MAPILLARY_PROXY_URL}?lat=${loc.lat}&lon=${loc.lon}&radius=${radius}`;
  const run = (async () => {
    let images = [];
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (r.status === 503) providerUnavailable = true;
      /* 400 / 429 / 502 all mean the same thing here: no Mapillary photo. */
      else if (r.ok) {
        const data = await r.json();
        images = Array.isArray(data?.images) ? data.images : [];
      }
    } catch {
      images = [];
    }
    CACHE.set(key, { value: images, expires: Date.now() + CACHE_TTL_MS });
    return images;
  })().finally(() => IN_FLIGHT.delete(key));
  IN_FLIGHT.set(key, run);
  return run;
}

/**
 * The provider's entry point: a display-ready photo, or null. Shaped exactly
 * like a Pexels/Commons/Google candidate so nothing downstream branches on
 * where a photo came from — except `source: "mapillary"`, which
 * renderPhotoCredit uses for the CC BY-SA attribution.
 */
export async function fetchMapillaryPhoto(loc) {
  const radius = mapillaryRadiusFor(loc);
  if (!radius) return null;

  const best = pickBestMapillaryImage(loc, await fetchMapillaryImages(loc), radius);
  if (!best) return null;
  /* CC BY-SA requires the contributor; renderPhotoCredit draws nothing
     without a name and an https link, so refuse rather than show it bare. */
  if (!best.creator || !String(best.link || "").startsWith("https://")) return null;

  return {
    src: best.src,
    /* One signed rendition only — a fabricated srcset would mislabel it. */
    sizes: { large: best.src },
    photographer: best.creator,
    link: best.link,
    license: "CC BY-SA 4.0",
    alt: "",
    lat: best.lat,
    lon: best.lon,
    width: best.width,
    height: best.height,
    source: "mapillary",
    /* Street-level imagery is evidence of WHERE, never of WHAT. It is always
       a photo taken at the place, never a portrait of the place. */
    provenance: "nearby",
  };
}
