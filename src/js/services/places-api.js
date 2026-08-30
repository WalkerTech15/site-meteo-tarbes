/* Google Places photos — the most precise provider in the photo chain.
 *
 * WHY IT SITS SECOND (right behind the curated exact image)
 * --------------------------------------------------------
 * Every other provider answers "here is a picture whose CAPTION mentions your
 * words". Google answers "here is a picture attached to THIS PLACE ENTITY",
 * which is a fundamentally stronger claim: the photo is filed against a place
 * id, with the place's own coordinates and its own administrative types. That
 * is why this runs before Wikimedia and Pexels — and why the ranking below
 * leans on the place's identity (id → type → coordinates) rather than on
 * keyword overlap, which is only ever used as a tie-breaker and a sanity
 * check.
 *
 * KEY HANDLING
 * ------------
 * There is no key in this file and none in the bundle. Everything goes to the
 * SAME-ORIGIN proxy (GOOGLE_PLACES_PROXY_URL — api/places.js on Vercel,
 * public/api/places.php on Apache, a Vite middleware in dev), which reads
 * GOOGLE_PLACES_API_KEY server-side. See core/config.js.
 *
 * LICENSING AND CACHING
 * ---------------------
 * Google Maps Platform terms permit only TEMPORARY caching of Places content,
 * and a resolved photo URI is a short-lived signed URL. So, unlike the Pexels
 * and Commons caches (which are process-lifetime), everything here expires:
 *   - place CANDIDATES are cached for CANDIDATE_TTL_MS,
 *   - a resolved PHOTO for PHOTO_TTL_MS, comfortably shorter than the URI's
 *     own lifetime and orders of magnitude shorter than the terms' ceiling.
 * Nothing is written to localStorage, and public/sw.js explicitly refuses to
 * put Google photo bytes or this route into Cache Storage. A Google photo is
 * therefore never persisted anywhere across a reload.
 */
import { GOOGLE_PLACES_PROXY_URL, FETCH_TIMEOUT_MS } from "../core/config.js";
import { state } from "../core/state.js";
import { locCountry } from "../core/location.js";
import { scorePhotoForLocation, distanceKm, isMarineKind } from "./photo-relevance.js";

/* Deliberately short. See "LICENSING AND CACHING" above: these are ceilings
   chosen to stay well inside the terms, not performance tuning. */
const CANDIDATE_TTL_MS = 30 * 60000;
const PHOTO_TTL_MS = 20 * 60000;
const PHOTO_REQUEST_WIDTH = 1280;

const CANDIDATE_CACHE = new Map(); // query key → {value, expires}
const CANDIDATE_IN_FLIGHT = new Map();
const PHOTO_CACHE = new Map(); // photo ref → {value, expires}
const PHOTO_IN_FLIGHT = new Map();

/* Set when the proxy reports 503 (no key configured, or the key was denied).
   That is a deployment fact, not a per-location one: without this, a site
   running with no Google key would fire one pointless request per location
   for the whole session. Reset only by a reload — or by the test seam. */
let providerUnavailable = false;

export function __resetPlacesCacheForTests() {
  CANDIDATE_CACHE.clear();
  CANDIDATE_IN_FLIGHT.clear();
  PHOTO_CACHE.clear();
  PHOTO_IN_FLIGHT.clear();
  providerUnavailable = false;
}

/* ── Query construction ──────────────────────────────────────────────────
   Google's text search resolves real place entities, so — unlike pexelsQuery
   — this appends no stock-photo vocabulary at all ("cityscape", "landscape
   travel"): those words would push the match away from the place entity and
   toward a business whose name happens to contain them. Region and country
   still qualify the name, for the same reason they do everywhere else: to
   separate Paris, France from Paris, Texas. */
function localizedText(field) {
  return (field && (field.en || field.fr)) || "";
}

export function placesQuery(loc) {
  if (!loc) return "";
  const name = localizedText(loc.name);
  if (!name) return "";
  if (loc.kind === "country") return name;
  return [name, localizedText(loc.region), localizedText(loc.country) || locCountry(loc) || ""]
    .filter(Boolean)
    .join(", ");
}

/* ── Matching a returned place to the selected location ──────────────────
   The place types Google reports for each administrative tier. A settlement
   query that comes back as a restaurant, a hotel or a city hall is not a
   worse match for the town — it is a different subject entirely, so the
   requirement to "reject clearly unrelated or generic results" is enforced
   here as a hard gate rather than as a score penalty. */
const KIND_TYPES = {
  city: ["locality", "postal_town", "administrative_area_level_3", "sublocality"],
  town: ["locality", "postal_town", "administrative_area_level_3", "sublocality"],
  village: ["locality", "postal_town", "administrative_area_level_3", "sublocality"],
  region: ["administrative_area_level_1", "administrative_area_level_2"],
  state: ["administrative_area_level_1", "administrative_area_level_2"],
  province: ["administrative_area_level_1", "administrative_area_level_2"],
  country: ["country"],
  /* A POI or a street address IS an establishment, so here the establishment
     types are the correct answer rather than the wrong one. */
  poi: ["tourist_attraction", "point_of_interest", "establishment", "park", "premise"],
  address: ["premise", "street_address", "route", "point_of_interest", "establishment"],
};

/* How far Google's own point for a place may sit from the geocoder's before
   the two are clearly not the same place. Scaled to the tier: two city
   centroids agree within a few km, but a country's representative point is
   arbitrary (a capital here, a centroid there), so distance carries no
   information at all and is not gated. */
const MAX_DISTANCE_KM = {
  city: 60,
  town: 30,
  village: 25,
  address: 12,
  poi: 12,
  region: 400,
  state: 400,
  province: 400,
  country: null,
};

/* Proximity as a fraction of the tier's own tolerance, so one set of bands
   works for a village and for a state. Deliberately outweighs every keyword
   signal below: "prefer exact Place IDs and coordinate proximity over
   generic keyword matches" is the whole point — a generic match on the
   region and country words scores 2, a co-located place scores 8. */
export function placeProximityScore(km, gate) {
  if (km === null || !gate) return 0;
  const ratio = km / gate;
  if (ratio <= 0.05) return 8;
  if (ratio <= 0.15) return 6;
  if (ratio <= 0.4) return 4;
  return 2;
}

/* The candidate as the shared relevance scorer expects it — WITHOUT
   coordinates on purpose. photo-relevance's own proximity bands are built for
   a Commons geosearch (a fixed 10 km radius) and would penalise a correctly
   matched country or state; distance is scored here instead, per tier. The
   photo contributor's name is left out too: it is a person, not evidence
   about the place, and a contributor called "Paris" must not read as one. */
function scoringShape(place) {
  return { title: place.name, description: place.address, src: place.photo?.ref || "" };
}

const EXACT_PLACE_ID_SCORE = 1000;

/* The location stripped down to what only IT is called — its own name, its
   curated aliases, its landmark. Used to ask a sharper question than "does
   anything here match?": a candidate that merely repeats the region or the
   country is making a generic keyword match, and every Google candidate in
   the right country repeats the country in its formatted address, so that
   signal alone proves nothing at all. */
function identityOnly(loc) {
  return {
    kind: loc.kind,
    name: loc.name,
    aliases: loc.aliases,
    landmark: loc.landmark,
    region: {},
    country: {},
  };
}

/**
 * Score one Google place against the selected location.
 *
 * @returns {{score: number, reason: string}|null} null = reject outright.
 */
export function scorePlaceCandidate(loc, place) {
  if (!loc || !place || !place.photo) return null;

  /* 1. An exact Place ID is the strongest possible statement of identity —
     it IS the place, so nothing below can override it. Only ever present
     when a curated entry recorded one; nothing infers a Place ID. */
  if (loc.placeId && place.id && loc.placeId === place.id) {
    return { score: EXACT_PLACE_ID_SCORE, reason: "place-id" };
  }

  /* 2. Right kind of thing? A hotel is not a town. */
  const expected = KIND_TYPES[loc.kind];
  const types = Array.isArray(place.types) ? place.types : [];
  if (expected && !types.some((t) => expected.includes(t))) return null;

  /* 3. Close enough to be the same place? */
  const gate = MAX_DISTANCE_KM[loc.kind];
  const km = distanceKm(loc.lat, loc.lon, place.lat, place.lon);
  if (gate && km !== null && km > gate) return null;
  const proximity = placeProximityScore(km, gate);

  /* 4. Text agreement, both as corroboration and as the tie-breaker between
     two equally close candidates of the right type. The full score counts
     region and country words; the evidence test below deliberately does not. */
  const shape = scoringShape(place);
  const text = scorePhotoForLocation(loc, shape);

  /* Something must actually connect this place to the location: either it is
     called by the location's OWN name, or it sits comfortably inside the
     tier's tolerance. A candidate with neither is "whatever Google ranked
     first", which is precisely the result this pipeline must refuse.

     Deliberately not `text.confidence !== "none"`: a candidate carrying no
     coordinates at all would otherwise be accepted purely because its
     formatted address ends in "France", which every French result does. */
  const namesTheLocation = scorePhotoForLocation(identityOnly(loc), shape).confidence === "text";
  const coordinateEvidence = proximity >= 4;
  if (!namesTheLocation && !coordinateEvidence) return null;

  return {
    score: proximity + text.score,
    reason: namesTheLocation ? "text" : "coordinate",
  };
}

/** Best candidate, or null when none clears the bar. */
export function pickBestPlace(loc, places) {
  let best = null;
  let bestScore = -Infinity;
  for (const place of Array.isArray(places) ? places : []) {
    const scored = scorePlaceCandidate(loc, place);
    if (!scored) continue;
    /* Strictly greater, so a tie keeps Google's own relevance order. */
    if (scored.score > bestScore) {
      bestScore = scored.score;
      best = place;
    }
  }
  return best;
}

/* ── Proxy access ────────────────────────────────────────────────────────
   Same discipline as the Pexels client: one in-flight request per key, every
   failure mode collapses to "no photo", and nothing about the upstream error
   is surfaced. The only difference is that entries EXPIRE — see the caching
   note in the file header. */
function readFresh(cache, key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeWithTtl(cache, key, value, ttl) {
  cache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

async function getJson(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  /* 503 means the deployment has no usable Google key. Remember it, so the
     rest of the session skips this provider entirely instead of paying a
     round trip per location to be told the same thing. */
  if (r.status === 503) {
    providerUnavailable = true;
    return null;
  }
  /* 400 / 404 / 429 / 502 all mean the same thing here: no Google photo. */
  if (!r.ok) return null;
  return r.json();
}

export function fetchPlaceCandidates(loc) {
  if (providerUnavailable) return Promise.resolve([]);
  const query = placesQuery(loc);
  if (!query) return Promise.resolve([]);
  const params = new URLSearchParams({ query, lang: state.lang === "fr" ? "fr" : "en" });
  if (Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
    params.set("lat", String(loc.lat));
    params.set("lon", String(loc.lon));
  }
  const key = params.toString();

  const cached = readFresh(CANDIDATE_CACHE, key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = CANDIDATE_IN_FLIGHT.get(key);
  if (pending) return pending;

  const run = (async () => {
    let places = [];
    try {
      const data = await getJson(`${GOOGLE_PLACES_PROXY_URL}?${key}`);
      places = Array.isArray(data?.places) ? data.places.filter((p) => p && p.photo) : [];
    } catch {
      places = [];
    }
    return writeWithTtl(CANDIDATE_CACHE, key, places, CANDIDATE_TTL_MS);
  })().finally(() => CANDIDATE_IN_FLIGHT.delete(key));
  CANDIDATE_IN_FLIGHT.set(key, run);
  return run;
}

/* Resolves the signed image URI for one photo reference. Cached for less
   than the URI's own validity window, in memory only — see the file header
   for why this one may not be a permanent cache. */
export function resolvePlacePhoto(ref) {
  if (providerUnavailable || !ref) return Promise.resolve(null);

  const cached = readFresh(PHOTO_CACHE, ref);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = PHOTO_IN_FLIGHT.get(ref);
  if (pending) return pending;

  const url = `${GOOGLE_PLACES_PROXY_URL}?photo=${encodeURIComponent(ref)}&w=${PHOTO_REQUEST_WIDTH}`;
  const run = (async () => {
    let src = null;
    try {
      const data = await getJson(url);
      const candidate = data?.photo?.src;
      src = typeof candidate === "string" && candidate.startsWith("https://") ? candidate : null;
    } catch {
      src = null;
    }
    return writeWithTtl(PHOTO_CACHE, ref, src, PHOTO_TTL_MS);
  })().finally(() => PHOTO_IN_FLIGHT.delete(ref));
  PHOTO_IN_FLIGHT.set(ref, run);
  return run;
}

/**
 * The provider's entry point: a display-ready photo for this location, or
 * null. Shaped exactly like a Pexels/Commons candidate so nothing downstream
 * branches on where a photo came from — except `source: "google"`, which
 * renderPhotoCredit uses to render Google's REQUIRED attribution.
 *
 * @param {object} loc
 */
export async function fetchGooglePlacePhoto(loc) {
  if (!loc) return null;
  /* Open water is not a Place. Google has no ocean or sea entity, so a text
     search for one returns a coastal business — the exact "a result exists,
     so display it" failure the chain exists to avoid. Commons geosearch is
     the right provider for marine locations and runs next. */
  if (isMarineKind(loc.kind)) return null;

  const places = await fetchPlaceCandidates(loc);
  const best = pickBestPlace(loc, places);
  if (!best) return null;

  const src = await resolvePlacePhoto(best.photo.ref);
  if (!src) return null;

  const attributions = Array.isArray(best.photo.attributions) ? best.photo.attributions : [];
  const author = attributions[0] || { name: "", uri: "" };
  /* Google's attribution link for the contributor when there is one, and the
     place's own Google Maps page otherwise. */
  const link = author.uri || best.mapsUri || "";
  /* Attribution is not optional under Google's terms, and renderPhotoCredit
     silently draws nothing for a photo with no name or no https link. A
     Google photo we cannot credit is therefore refused outright rather than
     displayed bare — the chain simply moves on to the next provider. */
  if (!author.name || !link.startsWith("https://")) return null;

  return {
    src,
    /* One width only: the media endpoint returns a single rendition, so a
       fabricated srcset would mislabel it (same reason Commons skips one). */
    sizes: { large: src },
    photographer: author.name,
    link,
    mapsUri: best.mapsUri || "",
    attributions,
    alt: best.name,
    title: best.name,
    description: best.address,
    lat: best.lat,
    lon: best.lon,
    width: best.photo.width,
    height: best.photo.height,
    placeId: best.id,
    source: "google",
  };
}
