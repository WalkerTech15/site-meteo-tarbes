/* Location visuals: curated landmark image → country flag → emoji fallback,
   with an optional real photo layered on top once it loads (never blocking
   the initial render, never causing layout shift).

   The real photo comes from a chain of sources ordered by how well each can
   PROVE the picture shows this place, not by how attractive it is — see
   fetchBestPhoto:

     1. the curated exact image (a reviewed Pexels id, or a local file),
        resolved before the chain runs at all — hydrateLocPhoto;
     2. Wikimedia Commons GEOSEARCH: candidates chosen by proximity to the
        location's own coordinates, which no caption can fake, so this is the
        most accurate source available and runs first;
     3. Pexels, ranked across several candidates, for attractive and
        representative city/town/landscape/ocean photography (the same-origin
        proxy keeps the API key server-side — PEXELS_PROXY_URL in
        core/config.js);
     3b. a Commons TEXT search, for exact geography Pexels' stock library
        often lacks — text-matched rather than coordinate-verified, so it
        sits behind the ranked Pexels pool;
     4. a verified photo of the surrounding region, then country, labelled
        honestly as the AREA's photo rather than the place's;
     5. the gradient/emoji fallback.

   Commons is public and keyless, so it is called directly — no proxy
   involved (services/wikimedia-api.js). */
import { state } from "../core/state.js";
import { PEXELS_PROXY_URL, FETCH_TIMEOUT_MS } from "../core/config.js";
import { flagHtml } from "../data/flags.js";
import { locCountry } from "../core/location.js";
import { t } from "../core/i18n.js";
import { wikimediaGeosearch, wikimediaSearch } from "./wikimedia-api.js";
import {
  normalizeForMatch,
  significantWords,
  pickBestPhoto,
  isMarineKind,
  namesConflictingPlace,
} from "./photo-relevance.js";
import { LOCATIONS } from "../data/locations.js";
import { isOffline } from "./offline.js";

export function gradBg(loc) {
  return `background:linear-gradient(145deg, ${loc.grad[0]}, ${loc.grad[1]})`;
}

/* Ordered providers; the first that returns HTML wins. This keeps the visual
   decoupled from callers so a real image API (e.g. Unsplash) can slot in as a
   new provider WITHOUT touching any component. Providers must key off stable
   identity (loc.id / curated landmark / country code) — never the raw query —
   so a duplicate city name (Paris TX) can never borrow Paris FR's image. */
const IMAGE_PROVIDERS = [
  /* 1. curated local landmark image (opt-in: loc.landmark.img is a URL/dataURI) */
  (loc) =>
    loc.landmark && loc.landmark.img
      ? `<img class="loc-img" src="${loc.landmark.img}" alt="" loading="lazy">`
      : null,
  /* 2. existing local regional image (opt-in: loc.img on a curated entry) */
  (loc) => (loc.img ? `<img class="loc-img" src="${loc.img}" alt="" loading="lazy">` : null),
  /* 3. country flag for countries */
  (loc) => (loc.kind === "country" ? flagHtml(loc.cc, "", state.lang) : null),
  /* 4. a wave glyph for an ocean/sea (core/coord-location.js, core/marine-
     regions.js) — never the generic cityscape emoji below, which would
     misrepresent open water as a place with streets and buildings */
  (loc) => (isMarineKind(loc.kind) ? "🌊" : null),
  /* 5. curated landmark emoji, else a generic location glyph (safe fallback) */
  (loc) => (loc.landmark ? loc.landmark.emoji : "🏙️"),
  /* NOTE: to add Unsplash later, insert a provider ABOVE this line that returns
     an <img> for loc.id/landmark and null on miss — nothing else changes. */
];
export function resolveLocationImage(loc) {
  for (const provider of IMAGE_PROVIDERS) {
    const out = provider(loc);
    if (out) return out;
  }
  return "🏙️";
}
export function locVisual(loc) {
  return resolveLocationImage(loc);
}

/* For the selected location's hero + info-card visual. Priority:
   1) curated local image  2) Pexels (query built from full geocoding metadata,
   never an ambiguous city name alone)  3) the SVG/gradient fallback above.
   Async, race-guarded (photoToken), and cached (incl. negative results). */
const PHOTO_CACHE = new Map(); // query → {src, sizes, photographer, link, alt} | null
const IN_FLIGHT = new Map(); // query → Promise, so N cards asking at once = 1 request
let photoToken = 0; // bumped per location change → ignore stale swaps
export function bumpPhotoToken() {
  photoToken++;
}

const CANDIDATE_CACHE = new Map(); // query → Photo[] (Pexels' multi-candidate pool)
const CANDIDATE_IN_FLIGHT = new Map();
const WIKIMEDIA_CACHE = new Map(); // "geo:lat,lon" | "q:<query>" → Photo | null
const WIKIMEDIA_IN_FLIGHT = new Map();

/* Test seam only: the cache is intentionally process-lifetime in the app, but
   each unit test needs to start from empty. */
export function __resetPhotoCacheForTests() {
  PHOTO_CACHE.clear();
  IN_FLIGHT.clear();
  CANDIDATE_CACHE.clear();
  CANDIDATE_IN_FLIGHT.clear();
  WIKIMEDIA_CACHE.clear();
  WIKIMEDIA_IN_FLIGHT.clear();
  AREA_CACHE.clear();
  AREA_IN_FLIGHT.clear();
}

/* Small enough that a wide "cityscape" shot would mostly show empty
   countryside — closer, street-level imagery reads truer. A specific address
   or point of interest is similarly granular, so they share the bucket. */
const SMALL_PLACE_KINDS = new Set(["town", "village", "address", "poi"]);
/* A state/province/region IS the subject (not a parent of it) — same
   template as a country, just qualified by the country it's in. */
const REGION_KINDS = new Set(["region", "state", "province"]);

/* A bare city name is ambiguous to an image search — "Paris" returns Paris,
   Texas as readily as Paris, France, and "Tarbes" returns nothing recognisable.
   Qualify it with the canonical region and country from the geocoder.
   Deliberately never says (or names) a landmark: the old "city skyline
   landmark" suffix biased Pexels toward the same handful of famous
   monuments — the Statue of Liberty for New York, the Eiffel Tower for
   Paris — instead of a photo representative of the place itself. That holds
   even for a curated entry whose loc.landmark IS a real, named monument
   (never invented from the city name): that field stays reserved for the
   image-fallback chain in resolveLocationImage/hydrateLocPhoto, and is never
   mixed into the search text. Examples:
     "Tarbes Occitanie France cityscape"
     "Saint-Rémy-de-Provence Provence-Alpes-Côte d'Azur France streets architecture"
     "California United States landscape travel"
     "Japan landscape travel"  */
/* A localized {en, fr} field as one usable string. Either language is
   accepted rather than English only: a geocoder answers in whichever
   language it has for that tier, so a region or country that only came back
   with a French name would otherwise silently drop out of the query and
   leave a small town qualified by nothing at all. */
function localizedText(field) {
  return (field && (field.en || field.fr)) || "";
}

/* Stock-photo phrasing per body of water. Oceans and seas keep the original
   "aerial seascape"; the finer kinds core/marine-regions.js can now report
   (gulf/bay/strait, and large lakes, which are NOT seascapes at all) get
   wording that matches what they actually look like. Unknown/absent
   waterKind falls back to the ocean phrasing, so nothing regresses for a
   location classified before this field existed. */
const WATER_QUERY_SUFFIX = {
  ocean: "aerial seascape",
  sea: "aerial seascape",
  gulf: "coast seascape",
  bay: "coast seascape",
  strait: "coast seascape",
  lake: "landscape shore",
};

export function pexelsQuery(loc) {
  if (!loc) return "";
  const name = (loc.name && (loc.name.en || loc.name.fr)) || "";
  if (!name) return "";
  const region = localizedText(loc.region);
  const country = localizedText(loc.country) || locCountry(loc) || "";

  /* An ocean/sea (core/coord-location.js + core/marine-regions.js) has no
     region/country to qualify it with — it IS the subject, searched for the
     body of water itself. "aerial seascape" over "landscape travel": the
     latter reads as a place you'd stand in, which open water is not. */
  if (isMarineKind(loc.kind)) {
    return [name, WATER_QUERY_SUFFIX[loc.waterKind] || WATER_QUERY_SUFFIX.ocean].join(" ");
  }
  if (loc.kind === "country") return [name, "landscape travel"].join(" ");
  if (REGION_KINDS.has(loc.kind))
    return [name, country, "landscape travel"].filter(Boolean).join(" ");

  const suffix = SMALL_PLACE_KINDS.has(loc.kind) ? "streets architecture" : "cityscape";
  return [name, region, country, suffix].filter(Boolean).join(" ");
}

/* Wikimedia Commons' search indexes file titles, categories and descriptions
   — encyclopaedic metadata, not photography-marketplace copy — so unlike
   pexelsQuery this never appends a stock-photo suffix ("cityscape",
   "landscape travel"): "Tarbes Occitanie France cityscape" would only ever
   miss a file actually titled/categorised under the plain place name. Same
   name+region+country qualification otherwise, for the same reason (avoid
   confusing same-named places in different countries). */
export function wikimediaQuery(loc) {
  if (!loc) return "";
  const name = (loc.name && (loc.name.en || loc.name.fr)) || "";
  if (!name) return "";
  if (isMarineKind(loc.kind) || loc.kind === "country") return name;
  const region = localizedText(loc.region);
  const country = localizedText(loc.country) || locCountry(loc) || "";
  return [name, region, country].filter(Boolean).join(" ");
}

/* ── Relevance filtering ──────────────────────────────────────────────────
   Pexels' own search ranking already does the "prefer" half of the job —
   this is the "reject obviously unrelated results" half: a sanity check on
   the ONE candidate the proxy returns (see fetchPexelsPhoto below), run
   against the location's own identifying words, never the generic suffix
   ("cityscape", "landscape travel", …) this module appends itself. A photo
   that fails it is treated exactly like "no photo" — the caller keeps its
   gradient/emoji fallback (see hydrateLocPhoto). */

/* normalizeForMatch / significantWords (and the stopword list behind them)
   now live in services/photo-relevance.js, shared with the ranking half so
   the filter and the ranker can never disagree on what counts as a
   meaningful word. */

/* The words a matching photo should plausibly mention. A country location
   is checked against its own name only — its region is just its continent
   ("Europe"), which would let almost any European photo pass. An ocean/sea
   is checked against its own (already fully qualifying) name. Everything
   else is checked against name + region + country + its curated landmark,
   any one of which is enough — region/country are a coarser but still
   meaningful signal for smaller places Pexels rarely names precisely, and a
   curated landmark is a hand-reviewed monument that genuinely belongs to
   this place (data/locations.js), so a photo captioned "Golden Gate Bridge
   at dawn" IS a photo of San Francisco and must not be filtered out for
   never spelling the city's name. Only curated entries have one; nothing is
   inferred from a city name. */
export function relevanceKeywords(loc) {
  if (!loc) return [];
  const name = (loc.name && (loc.name.en || loc.name.fr)) || "";
  if (loc.kind === "country" || isMarineKind(loc.kind)) return significantWords(name);
  const region = (loc.region && loc.region.en) || "";
  const country = (loc.country && loc.country.en) || locCountry(loc) || "";
  const landmark = (loc.landmark && (loc.landmark.en || loc.landmark.fr)) || "";
  return [
    ...new Set([
      ...significantWords(name),
      ...significantWords(region),
      ...significantWords(country),
      ...significantWords(landmark),
    ]),
  ];
}

/* true = keep the photo, false = treat it as if none was found. Errs toward
   keeping: no identifying words (an edge case — see pexelsQuery's own ""
   guard) or no alt/photographer text to check against both pass, since
   neither is evidence the photo is WRONG, only that it can't be confirmed
   right — and a false rejection is worse than an unconfirmed accept for a
   feature whose whole fallback chain already exists to catch true misses. */
export function isRelevantPhoto(loc, photo) {
  if (!photo) return false;
  /* Positive evidence that the photo is of somewhere ELSE outranks the
     lenient "can't confirm, so keep it" rule below — a famous-city stock
     photo answering a thin query is the one case where "unconfirmed" really
     does mean "wrong". See namesConflictingPlace. */
  if (namesConflictingPlace(loc, photo, conflictVocabulary())) return false;
  const tokens = relevanceKeywords(loc);
  if (tokens.length === 0) return true;
  const haystack = normalizeForMatch(`${photo.alt || ""} ${photo.photographer || ""}`);
  if (!haystack.trim()) return true;
  return tokens.some((tok) => haystack.includes(tok));
}

/* token → the curated location id that owns it, built once from the curated
   list (data/locations.js) and its hand-reviewed landmark names. These are
   exactly the places a stock library is most likely to return by mistake, so
   they are the ones worth recognising; nothing is invented here, and a place
   NOT in this list is simply never treated as a conflict.

   Region and country words are deliberately excluded: "France" or "Texas"
   appearing in a caption says nothing about which town is pictured, and
   treating them as conflicts would reject correct photos of their own
   towns. */
let CONFLICT_VOCAB = null;
function conflictVocabulary() {
  if (CONFLICT_VOCAB) return CONFLICT_VOCAB;
  const vocab = new Map();
  for (const loc of LOCATIONS) {
    const id = String(loc.id || "");
    const terms = [loc.name?.en, loc.name?.fr, loc.landmark?.en, loc.landmark?.fr];
    for (const term of terms) {
      for (const tok of significantWords(term)) {
        /* First writer wins, and a token claimed by two different curated
           places is dropped entirely: it cannot identify either of them. */
        if (vocab.has(tok) && vocab.get(tok) !== id) vocab.set(tok, "");
        else if (!vocab.has(tok)) vocab.set(tok, id);
      }
    }
  }
  for (const [tok, owner] of [...vocab]) if (!owner) vocab.delete(tok);
  CONFLICT_VOCAB = vocab;
  return CONFLICT_VOCAB;
}

/* ── Ranking multiple candidates ──────────────────────────────────────────
   Pexels' own search ranking is a decent prior but not authoritative — this
   picks the best of the (up to 8) candidates the proxy now returns, rather
   than trusting its first result blindly. Only ever chosen from the subset
   that already passes isRelevantPhoto (this is a RANKING step among already-
   accepted candidates, not a second, looser filter); an empty subset returns
   null, exactly like "no photo". Orientation is not re-checked here: every
   candidate was already requested with orientation=landscape server-side
   (api/pexels.js), so "prefer landscape" is satisfied upstream. */
export function rankPexelsCandidates(loc, candidates) {
  const pool = (Array.isArray(candidates) ? candidates : []).filter(
    (p) => p && p.src && isRelevantPhoto(loc, p),
  );
  if (pool.length === 0) return null;
  /* Scoring itself is services/photo-relevance.js: exact-name-phrase and
     per-token credit across BOTH interface languages plus curated aliases,
     then coordinate proximity, image quality, and a penalty for a candidate
     whose subject contradicts the location's kind (an urban shot for open
     water).

     `requireEvidence` closes the one gap isRelevantPhoto deliberately
     leaves open: it accepts a candidate it CANNOT check — a photo with no
     alt text or photographer at all, or any photo when the geocoder only
     gave us a non-Latin-script name to match on — because "unconfirmed" is
     not "confirmed wrong". That leniency is right for a filter, but it is
     exactly the "a result exists, so show it" outcome for the final pick.
     Nothing that already matches is affected: a candidate whose text
     contradicts the place was rejected by isRelevantPhoto above, so the
     only candidates this drops are unverifiable ones, which fall through
     to the gradient/emoji fallback instead. */
  return pickBestPhoto(loc, pool, { requireEvidence: true });
}

/* Wikimedia equivalent. `trustCoordinates` is set for a geosearch result: the
   candidate was already selected because Commons placed it within a few
   kilometres of the location's own coordinates (see GEOSEARCH_KINDS below),
   which is itself strong evidence of relevance even when its title/
   description happens to be terse or in a language relevanceKeywords doesn't
   tokenize — so it is trusted rather than re-filtered by text. A text-search
   result (trustCoordinates: false — the country/region path, or a granular
   place whose geosearch came up empty) carries no such guarantee and is held
   to the same isRelevantPhoto check a Pexels text result gets, since Photo
   objects from both sources share the same {alt, photographer} shape. */
export function rankWikimediaCandidates(loc, candidates, { trustCoordinates = false } = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.src);
  const pool = trustCoordinates ? list : list.filter((c) => isRelevantPhoto(loc, c));
  if (pool.length === 0) return null;
  /* Commons candidates carry real coordinates and pixel dimensions, so the
     shared scorer has more to work with here than for Pexels: proximity to
     the location's own point ranks a photo taken IN the place above one
     merely categorised under it, and landscape/resolution break the
     remaining ties.

     A trusted geosearch result is evidence by construction (Commons placed
     it within a few km of the point), so it is ranked as-is. A text-search
     result carries no such guarantee, and Commons' index reaches file
     titles and categories — a much larger surface for a coincidental hit
     than stock-photo alt text — so there it must positively connect to the
     location or be dropped in favour of the fallback. */
  return pickBestPhoto(loc, pool, { requireEvidence: !trustCoordinates });
}

/* Asks the SAME-ORIGIN proxy for a photo — never Pexels directly, because that
   would require shipping the Pexels key to the browser. The proxy holds the key
   server-side and answers with a narrow, already-validated shape:
     200 {"photo": {...}} | {"photo": null}
     400 invalid_query/invalid_id · 404 not_found (by-ID lookup only)
     429 rate_limited · 502 upstream_error · 503 unavailable
   Every non-200 (and every malformed 200) is treated identically: no photo, so
   the caller keeps its gradient/emoji fallback. Failures are negative-cached so
   a rate-limited or unconfigured deployment isn't hammered for the session. */
export function fetchPexelsPhoto(query) {
  if (!query) return Promise.resolve(null);
  return dedupedFetch(query, `${PEXELS_PROXY_URL}?query=${encodeURIComponent(query)}`);
}

/* Curated locations (src/js/data/locations.js) carry a manually reviewed
   Pexels photo ID — a landmark name alone is not a guarantee of accuracy, so
   only a specific, reviewed ID is trusted to fetch the exact photo. Cache key
   is "id:<id>", which can never collide with a query string (queries always
   contain the qualifying region/country/suffix words added by pexelsQuery). */
export function fetchPexelsPhotoById(id) {
  if (!id) return Promise.resolve(null);
  return dedupedFetch(`id:${id}`, `${PEXELS_PROXY_URL}?id=${encodeURIComponent(id)}`);
}

function dedupedFetch(cacheKey, url) {
  if (PHOTO_CACHE.has(cacheKey)) return Promise.resolve(PHOTO_CACHE.get(cacheKey));
  /* The cache is only written once the response lands, so without this a row of
     cards hydrating together would each fire the same request. */
  const pending = IN_FLIGHT.get(cacheKey);
  if (pending) return pending;
  const run = requestPhoto(cacheKey, url).finally(() => IN_FLIGHT.delete(cacheKey));
  IN_FLIGHT.set(cacheKey, run);
  return run;
}

async function requestPhoto(cacheKey, url) {
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    /* No branch per status code on purpose: 400/404/429/502/503 all mean the
       same thing to the UI, and the response body is never surfaced to the
       user. (404 only applies to the by-ID lookup: an unknown/removed photo.) */
    if (!r.ok) throw new Error("proxy " + r.status);
    const d = await r.json();
    const p = d && d.photo;
    /* Keep every offered size so the browser — not this module — picks the one
       that fits the viewport (see pexelsSrcset below). Requesting large2x
       unconditionally shipped a ~1.9× wider image than a phone can use. */
    const sizes = (p && p.src) || {};
    const src = sizes.large || sizes.medium || sizes.large2x || "";
    const out = src
      ? {
          src,
          sizes,
          photographer: p.photographer || "",
          link: p.link || "",
          alt: p.alt || "",
        }
      : null;
    PHOTO_CACHE.set(cacheKey, out);
    return out;
  } catch {
    PHOTO_CACHE.set(cacheKey, null); // negative cache — don't hammer a failing query
    return null;
  }
}

/* "Request multiple candidates instead of accepting only the first result":
   the same proxy, but reading the `photos` array (up to 8, added alongside
   the original single `photo` field — see api/pexels.js) instead of just
   `photos[0]`. rankPexelsCandidates then picks the best of these against the
   location's own identity. Same negative-caching/dedup discipline as
   fetchPexelsPhoto, under its own cache so the two never collide. */
export function fetchPexelsPhotoCandidates(query) {
  if (!query) return Promise.resolve([]);
  return dedupedFetchList(
    query,
    `${PEXELS_PROXY_URL}?query=${encodeURIComponent(query)}`,
    CANDIDATE_CACHE,
    CANDIDATE_IN_FLIGHT,
    requestPhotoList,
  );
}

function dedupedFetchList(cacheKey, url, cache, inFlight, run) {
  if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey));
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;
  const p = run(cacheKey, url, cache).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, p);
  return p;
}

function toCandidateShape(p) {
  const sizes = (p && p.src) || {};
  const src = sizes.large || sizes.medium || sizes.large2x || "";
  return src
    ? { src, sizes, photographer: p.photographer || "", link: p.link || "", alt: p.alt || "" }
    : null;
}

async function requestPhotoList(cacheKey, url, cache) {
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error("proxy " + r.status);
    const d = await r.json();
    // Older/hypothetical proxy responses carrying only `photo` still work —
    // a one-item pool is a degenerate but valid candidate list.
    const raw = Array.isArray(d?.photos) ? d.photos : d?.photo ? [d.photo] : [];
    const out = raw.map(toCandidateShape).filter(Boolean);
    cache.set(cacheKey, out);
    return out;
  } catch {
    cache.set(cacheKey, []); // negative cache — don't hammer a failing query
    return [];
  }
}

/* Only these kinds have coordinates precise enough for a useful ~10km
   Commons geosearch (see wikimediaGeosearch's GEOSEARCH_RADIUS_M) — a
   country or region's single representative lat/lon is its capital or
   centroid, not "the country", so geosearch there would return one arbitrary
   nearby photo rather than anything representative; those kinds go straight
   to a text search instead (see resolveWikimediaPhoto). */
const GEOSEARCH_KINDS = new Set(["city", "town", "village", "address", "poi", "ocean", "sea"]);

/* Wikimedia Commons lookup: geosearch first (when eligible — precise
   coordinates back it with real proximity evidence), then a text search as
   the fallback every kind gets. Cached by location identity so re-selecting
   the same place never re-queries. */
export function fetchWikimediaPhoto(loc) {
  const cacheKey = wikimediaCacheKey(loc);
  if (!cacheKey) return Promise.resolve(null);
  if (WIKIMEDIA_CACHE.has(cacheKey)) return Promise.resolve(WIKIMEDIA_CACHE.get(cacheKey));
  const pending = WIKIMEDIA_IN_FLIGHT.get(cacheKey);
  if (pending) return pending;
  const run = resolveWikimediaPhoto(loc, cacheKey).finally(() =>
    WIKIMEDIA_IN_FLIGHT.delete(cacheKey),
  );
  WIKIMEDIA_IN_FLIGHT.set(cacheKey, run);
  return run;
}

function wikimediaCacheKey(loc) {
  if (!loc) return "";
  if (GEOSEARCH_KINDS.has(loc.kind) && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
    return `geo:${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
  }
  const q = wikimediaQuery(loc);
  return q ? `q:${q}` : "";
}

async function resolveWikimediaPhoto(loc, cacheKey) {
  let best = null;
  try {
    if (cacheKey.startsWith("geo:")) {
      const geo = await wikimediaGeosearch(loc.lat, loc.lon);
      best = rankWikimediaCandidates(loc, geo, { trustCoordinates: true });
    }
    if (!best) {
      const text = await wikimediaSearch(wikimediaQuery(loc));
      best = rankWikimediaCandidates(loc, text, { trustCoordinates: false });
    }
  } catch {
    best = null;
  }
  WIKIMEDIA_CACHE.set(cacheKey, best);
  return best;
}

/* Step 2 of the fallback chain on its own: the coordinate-verified half of
   Commons, with no text-search leg. Split out so the chain can put Pexels
   BETWEEN Commons' two legs (see fetchBestPhoto) — geosearch is the most
   accurate source available and now runs first, while a Commons TEXT search
   is a weaker signal than a ranked Pexels pool and stays behind it. */
async function wikimediaGeoPhoto(loc) {
  if (!GEOSEARCH_KINDS.has(loc.kind)) return null;
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
  const cacheKey = `geo:${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
  if (WIKIMEDIA_CACHE.has(cacheKey)) return WIKIMEDIA_CACHE.get(cacheKey);
  const pending = WIKIMEDIA_IN_FLIGHT.get(cacheKey);
  if (pending) return pending;
  const run = (async () => {
    let best = null;
    try {
      best = rankWikimediaCandidates(loc, await wikimediaGeosearch(loc.lat, loc.lon), {
        trustCoordinates: true,
      });
    } catch {
      best = null;
    }
    WIKIMEDIA_CACHE.set(cacheKey, best);
    return best;
  })().finally(() => WIKIMEDIA_IN_FLIGHT.delete(cacheKey));
  WIKIMEDIA_IN_FLIGHT.set(cacheKey, run);
  return run;
}

/* Step 3b on its own: the Commons TEXT search, with its own `q:` cache key.
   It must not go through fetchWikimediaPhoto here — that helper is
   geosearch-first and keyed by coordinate, so for a geosearch-eligible place
   it would read back the `geo:` null that step 2 has just cached and answer
   "nothing" without ever running a text search. */
async function wikimediaTextPhoto(loc) {
  const q = wikimediaQuery(loc);
  if (!q) return null;
  const cacheKey = `q:${q}`;
  if (WIKIMEDIA_CACHE.has(cacheKey)) return WIKIMEDIA_CACHE.get(cacheKey);
  const pending = WIKIMEDIA_IN_FLIGHT.get(cacheKey);
  if (pending) return pending;
  const run = (async () => {
    let best = null;
    try {
      best = rankWikimediaCandidates(loc, await wikimediaSearch(q), { trustCoordinates: false });
    } catch {
      best = null;
    }
    WIKIMEDIA_CACHE.set(cacheKey, best);
    return best;
  })().finally(() => WIKIMEDIA_IN_FLIGHT.delete(cacheKey));
  WIKIMEDIA_IN_FLIGHT.set(cacheKey, run);
  return run;
}

/* Step 4: a photo of the surrounding AREA when nothing shows the place
   itself — the honest answer for a small town Pexels and Commons have never
   photographed. The region is tried before the country (Occitanie says more
   about Tarbes than France does), and the result is marked `approximate`
   with the area it actually shows, so the credit can say so rather than
   implying the photo is of the town. Never used for a country or an
   ocean/sea: those ARE the area, so there is nothing coarser to fall back to
   and an unrelated national photo would be pure decoration.

   Keyed by the AREA, not the location, so every town in Occitanie shares one
   lookup — the repeated-search speed-up this level of the chain can offer. */
const AREA_CACHE = new Map();
const AREA_IN_FLIGHT = new Map();

export function areaFallbackTargets(loc) {
  if (!loc || loc.kind === "country" || isMarineKind(loc.kind)) return [];
  if (REGION_KINDS.has(loc.kind)) return [];
  const out = [];
  const region = (loc.region && (loc.region.en || loc.region.fr)) || "";
  const country = (loc.country && (loc.country.en || loc.country.fr)) || locCountry(loc) || "";
  if (region) out.push({ kind: "region", name: region, country });
  if (country) out.push({ kind: "country", name: country, country: "" });
  return out;
}

/* The area as a location-shaped object, so the existing query builder,
   filter and ranker all apply unchanged — an area photo is held to exactly
   the same evidence bar as an exact one, which is what "verified regional or
   country image" requires. */
function areaLocation(target) {
  return {
    id: `area-${target.kind}-${target.name}`,
    kind: target.kind === "country" ? "country" : "region",
    name: { en: target.name, fr: target.name },
    region: { en: "", fr: "" },
    country: { en: target.country, fr: target.country },
    aliases: [],
    landmark: null,
    lat: null,
    lon: null,
  };
}

async function fetchAreaPhoto(loc) {
  for (const target of areaFallbackTargets(loc)) {
    const key = `${target.kind}:${normalizeForMatch(target.name)}`;
    let photo;
    if (AREA_CACHE.has(key)) photo = AREA_CACHE.get(key);
    else if (AREA_IN_FLIGHT.has(key)) photo = await AREA_IN_FLIGHT.get(key);
    else {
      const areaLoc = areaLocation(target);
      const run = (async () => {
        let best = null;
        try {
          best = rankPexelsCandidates(
            areaLoc,
            await fetchPexelsPhotoCandidates(pexelsQuery(areaLoc)),
          );
        } catch {
          best = null;
        }
        if (!best) {
          try {
            best = rankWikimediaCandidates(
              areaLoc,
              await wikimediaSearch(wikimediaQuery(areaLoc)),
              {
                trustCoordinates: false,
              },
            );
          } catch {
            best = null;
          }
        }
        AREA_CACHE.set(key, best);
        return best;
      })().finally(() => AREA_IN_FLIGHT.delete(key));
      AREA_IN_FLIGHT.set(key, run);
      photo = await run;
    }
    /* Marked, never mutated: the cached area photo is shared by every town in
       the area, so the label travels on a copy. */
    if (photo) return { ...photo, approximate: true, approximateOf: target.name };
  }
  return null;
}

/* The hybrid entry point: Pexels' ranked pool first (attractive stock
   photography), Wikimedia only when Pexels has nothing sufficiently relevant
   (exact-landmark/geography coverage Pexels' library often lacks). Either
   step failing outright (network error, proxy down) falls through to the
   next rather than aborting the whole lookup — the gradient/emoji fallback
   is always the last resort, never a thrown error. */
export async function fetchBestPhoto(loc) {
  /* No network at all while offline: every step below would fail and be
     negative-cached, which would then suppress the real lookup for the rest
     of the session once connectivity returned. The gradient/emoji fallback
     is the correct offline visual. */
  if (isOffline()) return null;

  /* 2. Commons geosearch — the most accurate source available, because the
     candidate is chosen by proximity to the location's own coordinates
     rather than by matching words. Ahead of Pexels on purpose: a beautiful
     stock photo of the wrong place is the failure this pipeline exists to
     avoid, and coordinates cannot be fooled by a caption.
     (Step 1, the curated exact image, is handled before this is ever
     called — see hydrateLocPhoto/prefetchLocPhoto.) */
  try {
    const geo = await wikimediaGeoPhoto(loc);
    if (geo) return geo;
  } catch {
    /* fall through */
  }
  /* 3. Pexels' ranked pool — the strongest source for attractive,
     representative city/town/landscape photography. */
  try {
    const ranked = rankPexelsCandidates(loc, await fetchPexelsPhotoCandidates(pexelsQuery(loc)));
    if (ranked) return ranked;
  } catch {
    /* fall through */
  }
  /* 3b. Commons text search — exact geography Pexels' library often lacks
     (a named sea, a village), but text-matched rather than coordinate-
     verified, so it sits behind the ranked Pexels pool. */
  try {
    const text = await wikimediaTextPhoto(loc);
    if (text) return text;
  } catch {
    /* fall through */
  }
  /* 4. A verified photo of the surrounding region, then country, labelled
     honestly as being of the area rather than the place. */
  try {
    return await fetchAreaPhoto(loc);
  } catch {
    return null;
  }
}

/* Fixed-ratio container: gradient + SVG/emoji fallback act as the skeleton; a
   real photo fades in on top only once loaded, so there is never a layout shift. */
export function locPhotoHtml(loc, cls = "") {
  return `<div class="loc-photo loading ${cls}" style="${gradBg(loc)}">
    <span class="loc-photo-fallback" aria-hidden="true">${resolveLocationImage(loc)}</span>
  </div>`;
}

/* Pexels publishes `large` at 940px wide and `large2x` at 1880px; the other
   keys are height-constrained, so only these two carry a reliable `w`
   descriptor. Letting the browser choose spares phones a 1880px download. */
function pexelsSrcset(sizes = {}) {
  return [sizes.large && `${sizes.large} 940w`, sizes.large2x && `${sizes.large2x} 1880w`]
    .filter(Boolean)
    .join(", ");
}
const PEXELS_SIZES_ATTR = "(max-width: 640px) 100vw, (max-width: 1080px) 65vw, 720px";

/* Keep a compact, visible Pexels source link without covering the photograph
   with a long sentence. The full photographer credit remains available as the
   accessible name and native tooltip. Only called for a real Pexels result —
   curated local images, flags and emoji fallbacks get none.
   `host` is separate from the photo element because two of the three photo
   containers can't hold readable text: the hero's landmark layer is
   pointer-events:none behind the hero copy, and the map info thumbnail is
   96×66px. Callers point the credit at a sensible nearby container instead. */
function renderPhotoCredit(host, photo, extraClass = "") {
  host.querySelector(":scope > .loc-credit")?.remove();
  /* the URL comes from a third-party API — only ever follow a real https link */
  if (!photo.photographer || !/^https:\/\//i.test(photo.link || "")) return;
  const isWikimedia = photo.source === "wikimedia";
  /* Commons requires the license to travel with the credit; Pexels' terms
     don't call for one, so its short "Pexels ↗" label is unchanged. */
  const base = isWikimedia
    ? t("photoCreditWikimedia")
        .replace("{photographer}", photo.photographer)
        .replace("{license}", photo.license || "")
    : t("photoCredit").replace("{photographer}", photo.photographer);
  /* An area fallback (step 4) must never read as a photo OF the place. The
     area name is prefixed to the visible credit and spelled out in full in
     the accessible name, so neither a sighted nor a screen-reader user is
     told this is something it is not. */
  const label = photo.approximate
    ? `${t("photoApproximate").replace("{area}", photo.approximateOf || "")} — ${base}`
    : base;
  const a = document.createElement("a");
  a.className = `loc-credit ${extraClass}`.trim();
  a.href = photo.link;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  const source = isWikimedia ? "Wikimedia Commons ↗" : "Pexels ↗";
  a.textContent = photo.approximate ? `${photo.approximateOf} · ${source}` : source;
  if (photo.approximate) a.dataset.approximate = "true";
  a.setAttribute("aria-label", label);
  a.title = label;
  host.dataset.credit = label;
  host.appendChild(a);
}

/* Fire-and-forget cache warmup — no DOM, no swap, just the network lookup.
   Measured with Lighthouse: on Home, the hero photo used to sit behind
   `await fetchWeather(loc)` for no real reason (hydrateLocPhoto only needs
   the location, never the weather), which showed up as ~870ms of pure
   "resource load delay" on the LCP image before the actual fetch could even
   start. Callers that know the location before they have anywhere to render
   it (selectLocation, right when state.loc is set) call this so the same
   proxy/Commons round trip hydrateLocPhoto will make runs IN PARALLEL with
   the weather fetch instead of strictly after it. By the time hydrateLocPhoto
   actually runs, PHOTO_CACHE/CANDIDATE_CACHE/WIKIMEDIA_CACHE already has the
   answer (or the same IN_FLIGHT promise is still running and gets reused) —
   same cache, so this can never cause a duplicate request. */
export function prefetchLocPhoto(loc) {
  if (!loc) return;
  if (loc.landmark && (loc.landmark.img || loc.landmark.noPhotoSearch)) return;
  if (loc.img) return;
  if (loc.landmark && loc.landmark.pexelsId) fetchPexelsPhotoById(loc.landmark.pexelsId);
  else fetchBestPhoto(loc);
}

/* Resolves once `el` is within half a viewport of being scrolled into view.
   Secondary photos — the Explore carousel, the Favorites grid, nearby places
   — all render below the fold, and hydrating them on render meant every one
   of their lookups and image downloads competed with the hero for bandwidth
   during the LCP window. Waiting means an off-screen card costs nothing at
   all until it is approached. Resolves immediately where
   IntersectionObserver is unavailable, so the previous eager behaviour is
   the fallback, never a card that stays blank. */
function whenPhotoNearViewport(el) {
  if (typeof IntersectionObserver !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        resolve();
      },
      /* A fixed 300 px lead, not a viewport percentage: a percentage large
         enough to matter on a phone covers the whole of a desktop page and
         defers nothing. This also makes the horizontally-scrolling Explore
         carousel lazy sideways — a card parked off to the right does not
         intersect, so it costs nothing until it is scrolled to. */
      { rootMargin: "300px" },
    );
    observer.observe(el);
  });
}

export async function hydrateLocPhoto(el, loc, opts = {}) {
  if (!el || !loc) return;
  /* Captured BEFORE the visibility wait below, not after: for a race-guarded
     visual (the hero, the map detail panel) the token is what makes a
     superseded selection's swap a no-op. Reading it after the wait would
     hand a card that scrolled into view later the CURRENT token, and a
     lookup started for a location the user has already navigated away from
     would then be treated as fresh and painted. */
  const token = photoToken;
  /* The hero is the LCP candidate and must never wait for anything; every
     other photo defers until it is approached (opts.priority is set only by
     the hero — see ui/render-home.js). A curated/local image is a plain
     attribute swap with no network cost, so it is not deferred either. */
  const isLocalImage = Boolean((loc.landmark && loc.landmark.img) || loc.img);
  if (!opts.priority && !isLocalImage) await whenPhotoNearViewport(el);
  const creditHost = opts.creditHost || el;
  const sizesAttr = opts.sizes || PEXELS_SIZES_ATTR;
  /* The token guards the ONE visual that tracks the selected location (hero,
     map info): a new selection must cancel the previous fetch's swap. Cards
     that show a fixed place of their own — the explore carousel — opt out, or
     picking a location mid-load would leave them stuck on the fallback. */
  const stale = () => opts.raceGuard !== false && token !== photoToken;
  const done = () => {
    if (!stale()) el.classList.remove("loading");
  };
  /* `photo` is null for local/curated images — that's what suppresses the credit */
  const swap = (src, photo) => {
    if (stale() || !src) return done();
    /* Wikimedia only ever supplies one usable width (see wikimedia-api.js) —
       a fabricated "940w"/"1880w" srcset for it would mislabel the real
       thumbnail size, so it skips straight to a plain img.src. */
    const srcset = photo && photo.source !== "wikimedia" ? pexelsSrcset(photo.sizes) : "";
    const pre = new Image();
    /* Only the hero passes opts.priority: it's the LCP candidate on Home, so
       it should win the browser's fetch scheduler over everything else still
       loading (map chunks, other below-the-fold images) — never set for the
       explore carousel or the map info panel, which are never LCP. */
    if (opts.priority) pre.fetchPriority = "high";
    /* preload through the same srcset/sizes the real <img> will use, so the
       candidate the browser picks is already cached when we swap it in */
    if (srcset) {
      pre.sizes = sizesAttr;
      pre.srcset = srcset;
    }
    pre.onload = () => {
      if (stale()) return;
      let img = el.querySelector("img.loc-photo-img");
      if (!img) {
        img = document.createElement("img");
        img.className = "loc-photo-img";
        img.decoding = "async";
        if (opts.priority) img.fetchPriority = "high";
        el.appendChild(img);
      }
      /* Pexels supplies a description ("Eiffel Tower at dusk"); curated and
         fallback visuals stay decorative with an empty alt. Assigned via the
         property, so the value is escaped by the DOM rather than by us. */
      img.alt = opts.decorative ? "" : (photo && photo.alt) || "";
      if (srcset) {
        img.sizes = sizesAttr;
        img.srcset = srcset;
      }
      img.src = src;
      el.classList.add("has-photo");
      if (photo) renderPhotoCredit(creditHost, photo, opts.creditClass);
      done();
    };
    pre.onerror = done;
    pre.src = src;
  };
  if (loc.landmark && loc.landmark.img) return swap(loc.landmark.img, null);
  if (loc.img) return swap(loc.img, null);
  /* A curated landmark with no manually reviewed photo (see locations.js —
     a landmark NAME alone is never treated as a guarantee) stays on the
     emoji/gradient fallback rather than risk an inaccurate generic search
     result. Only locations with no curated landmark at all — i.e. genuinely
     unknown, user-entered places — reach the generic qualified-text search. */
  if (loc.landmark && loc.landmark.noPhotoSearch) return done();
  const byId = !!(loc.landmark && loc.landmark.pexelsId);
  let photo;
  try {
    photo = byId ? await fetchPexelsPhotoById(loc.landmark.pexelsId) : await fetchBestPhoto(loc);
  } catch {
    return done();
  }
  if (stale()) return;
  /* A by-ID photo is a manually reviewed, exact match — never re-checked. A
     Wikimedia result was already filtered by fetchBestPhoto/resolveWikimedia-
     Photo (coordinate trust or its own relevance check) and never re-checked
     here either. A Pexels candidate from fetchBestPhoto was already filtered
     by rankPexelsCandidates — this re-check is cheap and just confirms it,
     never rejects a genuinely different photo. Anything failing it is
     treated exactly like "no photo found at all". */
  /* An area fallback is deliberately exempt: it was already held to the full
     filter+ranking bar against the AREA it depicts (fetchAreaPhoto), and
     re-checking it against the town would reject it for the very reason it
     exists — it does not name the town. It is labelled as the area's photo,
     not passed off as the town's. */
  const verified =
    byId || photo?.approximate || photo?.source === "wikimedia" || isRelevantPhoto(loc, photo);
  if (photo && photo.src && verified) swap(photo.src, photo);
  else done(); // keep gradient/SVG fallback
}
