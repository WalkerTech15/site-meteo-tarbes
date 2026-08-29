/* Wikimedia Commons: the second half of the hybrid photo strategy (see
   photo-api.js). Pexels is strong at "attractive, generic" city/landscape
   photography but weak at exact landmarks, small towns and bodies of water;
   Commons is the opposite — categorised, coordinate-tagged, license-labelled
   photos of precisely-named places, but a much smaller and less curated pool.

   Unlike Pexels, the Commons/MediaWiki API is public and keyless: any client
   may call `action=query` anonymously over CORS by adding `origin=*`, which
   is MediaWiki's own documented opt-in for unauthenticated GET requests
   (https://www.mediawiki.org/wiki/API:Cross-site_requests). There is no
   secret to protect, so — unlike Pexels — this is called directly from the
   browser: no key, nothing to proxy, nothing to hide server-side. */

import { FETCH_TIMEOUT_MS } from "../core/config.js";

const ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const THUMB_WIDTH = 1280;
const CANDIDATE_LIMIT = 10;
/* A country/region centroid has nothing meaningful "nearby" at this scale —
   geosearch is only ever tried for a granular place (see wikimediaQuery /
   the geosearch-eligibility check in photo-api.js). 10 km keeps results tied
   to the actual place rather than pulling in a neighbouring town. */
const GEOSEARCH_RADIUS_M = 10000;

/* Only unambiguous, well-known open licenses — coats the license tags
   actually seen on Commons (short names, "CC BY-SA 4.0", "Public domain", …)
   without trying to be exhaustive. Anything not confidently recognised is
   rejected outright: "reject images with unclear licensing" means exactly
   that, not "guess and hope". */
const LICENSE_ALLOW = [/^cc0/i, /^cc[- ]by(?:[- ]sa)?[- ]?\d/i, /public domain/i, /^pd[- ]/i];

function isOpenLicense(shortName) {
  const s = String(shortName || "").trim();
  return s !== "" && LICENSE_ALLOW.some((re) => re.test(s));
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/* Re-projects one Commons `imageinfo` page onto the same {src, sizes,
   photographer, link, alt, source} shape a Pexels candidate already has (see
   photo-api.js), so the rest of the pipeline (ranking, credit rendering)
   never branches on which API a photo came from. Returns null for anything
   missing a usable thumbnail, a real https description page, a named
   photographer/author, or — per the licensing requirement — an open license:
   "insufficient metadata" is treated as a rejection, not a best-effort show. */
function toCandidate(page) {
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const thumb = info.thumburl;
  if (typeof thumb !== "string" || !thumb.startsWith("https://")) return null;
  const meta = info.extmetadata || {};
  const value = (key) => meta[key]?.value;
  const licenseShort = value("LicenseShortName") || value("License") || "";
  if (!isOpenLicense(licenseShort)) return null;
  const artist = stripHtml(value("Artist"));
  const descriptionUrl =
    typeof info.descriptionurl === "string" && info.descriptionurl.startsWith("https://")
      ? info.descriptionurl
      : "";
  if (!artist || !descriptionUrl) return null;
  const title = String(page.title || "").replace(/^File:/, "");
  const description = stripHtml(value("ImageDescription") || value("ObjectName")) || title;
  const coords = page.coordinates?.[0];
  return {
    src: thumb,
    sizes: { medium: thumb, large: thumb },
    photographer: artist,
    link: descriptionUrl,
    alt: description,
    title,
    license: licenseShort,
    source: "wikimedia",
    lat: typeof coords?.lat === "number" ? coords.lat : null,
    lon: typeof coords?.lon === "number" ? coords.lon : null,
    width: typeof info.thumbwidth === "number" ? info.thumbwidth : 0,
    height: typeof info.thumbheight === "number" ? info.thumbheight : 0,
  };
}

function pagesFrom(data) {
  const pages = data?.query?.pages;
  if (!pages) return [];
  // formatversion=2 gives an array; Object.values() on an array is a no-op
  // pass-through, so this handles either shape without branching.
  return Object.values(pages);
}

async function runQuery(params) {
  const url = `${ENDPOINT}?${new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    prop: "imageinfo|coordinates",
    iiprop: "url|extmetadata|size",
    iiurlwidth: String(THUMB_WIDTH),
    ...params,
  })}`;
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Commons has no documented rate-limit error for anonymous GETs at this
    // volume, but any non-200 (5xx, a transient CDN hiccup) is treated the
    // same as "no result" — never surfaced to the UI beyond the fallback.
    if (!r.ok) return [];
    const data = await r.json();
    return pagesFrom(data).map(toCandidate).filter(Boolean);
  } catch {
    // network failure, timeout, or malformed JSON — same "no result" outcome
    return [];
  }
}

/* Coordinate geosearch: "what photographed things exist near this exact
   point" — the precise half of the hybrid strategy for a landmark, town, or
   body of water whose coordinates are known. */
export function wikimediaGeosearch(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve([]);
  return runQuery({
    generator: "geosearch",
    ggscoord: `${lat}|${lon}`,
    ggsradius: String(GEOSEARCH_RADIUS_M),
    ggslimit: String(CANDIDATE_LIMIT),
    ggsnamespace: "6",
  });
}

/* Free-text search over Commons' own file titles/descriptions/categories —
   used for a country, a region, an ocean/sea, or anywhere geosearch found
   nothing relevant. */
export function wikimediaSearch(query) {
  const q = String(query || "").trim();
  if (!q) return Promise.resolve([]);
  return runQuery({
    generator: "search",
    gsrsearch: q,
    gsrnamespace: "6",
    gsrlimit: String(CANDIDATE_LIMIT),
  });
}
