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
   query that comes back as a restaurant, a hotel or a city hall is not the
   town itself, so it can never be presented AS the town — but see
   LANDMARK_TYPES below for why it is not simply thrown away either. */
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

/* Landmarks and public places that stand INSIDE a settlement or region.
 *
 * This list exists because of a real production failure. Google's place
 * photos are overwhelmingly attached to businesses and points of interest;
 * administrative entities — a `locality`, an `administrative_area_level_1`, a
 * `country` — very often carry no `photos` array at all. The proxy drops a
 * place with no photo (it cannot answer the question), and the type gate
 * above dropped everything that did have one. Between the two, a city, region
 * or country query could return candidates and still yield nothing usable,
 * which is exactly the "no usable photo candidates" symptom.
 *
 * A photo of the cathedral in a town is a legitimate, useful picture OF that
 * town — but it is NOT the town itself, so it is accepted only as the
 * `nearby` provenance tier, always ranked below a genuine match, and the UI
 * labels it as such (see ui/photo-provenance and renderPhotoCredit). That is
 * the difference between "showing a landmark" and "passing a landmark off as
 * the city", which is the line the requirements draw. */
const LANDMARK_TYPES = [
  "tourist_attraction",
  "historical_landmark",
  "historical_place",
  "cultural_landmark",
  "monument",
  "observation_deck",
  "museum",
  "art_gallery",
  "church",
  "mosque",
  "synagogue",
  "hindu_temple",
  "place_of_worship",
  "city_hall",
  "courthouse",
  "library",
  "park",
  "national_park",
  "state_park",
  "garden",
  "botanical_garden",
  "plaza",
  "natural_feature",
];
/* Deliberately NOT in that list: `establishment` and `point_of_interest`.
   Google attaches both to essentially every business, so including them
   would make a hotel, a car park or a fast-food outlet a "landmark
   representing the town" — which is precisely the generic result the
   requirements say to reject. The list above is an allow-list of things that
   are actually civic or scenic, and it is meant to be short. */

/* A landmark must sit genuinely INSIDE the place to represent it, so this is
   much tighter than the identity tolerance below: a cathedral 40 km from a
   town is in a different town. Anything without a coordinate is refused
   outright at this tier — proximity IS the evidence here. */
const LANDMARK_RADIUS_KM = {
  city: 15,
  town: 8,
  village: 6,
  region: 120,
  state: 120,
  province: 120,
  /* A country is too big for "inside it" to mean anything about whether the
     picture represents the country, so no landmark tier is offered. */
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

/* Every accepted EXACT match outranks every accepted NEARBY one, whatever
   their raw scores. Keeping the two tiers apart by a wide constant — rather
   than hoping the arithmetic works out — is what guarantees a landmark can
   never displace a genuine photo of the place itself. */
const EXACT_TIER_BONUS = 100;

/**
 * Score one Google place against the selected location.
 *
 * @returns {{score: number, reason: string, provenance: "exact"|"nearby"}|null}
 *   null = reject outright. `provenance` is what the UI must disclose: an
 *   "exact" candidate IS the selected place; a "nearby" one is a landmark
 *   standing inside it and is labelled as such, never as the place.
 */
export function scorePlaceCandidate(loc, place) {
  if (!loc || !place || !place.photo) return null;

  /* 1. An exact Place ID is the strongest possible statement of identity —
     it IS the place, so nothing below can override it. Only ever present
     when a curated entry recorded one; nothing infers a Place ID. */
  if (loc.placeId && place.id && loc.placeId === place.id) {
    return { score: EXACT_PLACE_ID_SCORE, reason: "place-id", provenance: "exact" };
  }

  const types = Array.isArray(place.types) ? place.types : [];
  const shape = scoringShape(place);
  const km = distanceKm(loc.lat, loc.lon, place.lat, place.lon);
  /* The location's OWN name, not its region or country: every Google result
     in the right country repeats the country in its formatted address, so
     that signal alone proves nothing. */
  const namesTheLocation = scorePhotoForLocation(identityOnly(loc), shape).confidence === "text";

  /* 2. Is this the place itself? Right administrative kind, close enough,
     and either named or co-located. */
  const expected = KIND_TYPES[loc.kind];
  const isRightKind = !expected || types.some((t) => expected.includes(t));
  if (isRightKind) {
    const gate = MAX_DISTANCE_KM[loc.kind];
    if (!gate || km === null || km <= gate) {
      const proximity = placeProximityScore(km, gate);
      if (namesTheLocation || proximity >= 4) {
        const text = scorePhotoForLocation(loc, shape);
        return {
          score: EXACT_TIER_BONUS + proximity + text.score,
          reason: namesTheLocation ? "text" : "coordinate",
          provenance: "exact",
        };
      }
    }
  }

  /* 3. Not the place itself — but is it a landmark standing INSIDE it?
     Accepted only on proximity, never on words: a museum whose name happens
     to contain the town's name but which sits 200 km away is not in the
     town. This is the tier that keeps settlement and region selections
     working at all, because administrative entities so rarely carry photos
     of their own. A country has no such tier — see LANDMARK_RADIUS_KM. */
  const radius = LANDMARK_RADIUS_KM[loc.kind];
  if (!radius || km === null || km > radius) return null;
  if (!types.some((t) => LANDMARK_TYPES.includes(t))) return null;
  return {
    /* Closer is better, and a landmark that also names the place (the "Musée
       de Tarbes") is a better representative than one that does not. */
    score: placeProximityScore(km, radius) + (namesTheLocation ? 2 : 0),
    reason: "landmark",
    provenance: "nearby",
  };
}

/**
 * Best candidate, or null when none clears the bar.
 *
 * @returns {{place: object, provenance: string}|null}
 */
export function pickBestPlace(loc, places) {
  let best = null;
  let bestScore = -Infinity;
  for (const place of Array.isArray(places) ? places : []) {
    const scored = scorePlaceCandidate(loc, place);
    if (!scored) continue;
    /* Strictly greater, so a tie keeps Google's own relevance order. */
    if (scored.score > bestScore) {
      bestScore = scored.score;
      best = { place, provenance: scored.provenance };
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

  const picked = pickBestPlace(loc, await fetchPlaceCandidates(loc));
  if (!picked) return null;
  const { place: best, provenance } = picked;

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
    /* "exact" = this IS the selected place; "nearby" = a landmark standing
       inside it. The UI must say which — see ui/photo-provenance.js. */
    provenance,
    /* What the "nearby" label names, so the credit can say WHICH landmark is
       pictured rather than vaguely admitting it is not the place. */
    subjectName: provenance === "nearby" ? best.name : "",
  };
}
