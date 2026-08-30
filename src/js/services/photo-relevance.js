/* Photo relevance scoring — the "which of these candidates actually shows
 * THIS place" half of the photo pipeline (services/photo-api.js owns the
 * fetching, caching and fallback chain; this module is pure and holds no
 * state, no DOM and no network, so every rule below is unit-testable on
 * plain objects).
 *
 * Two distinct jobs, deliberately kept separate:
 *
 *   1. FILTERING — "is this photo obviously unrelated?" That stays in
 *      photo-api.js (relevanceKeywords/isRelevantPhoto): a deliberately
 *      lenient, single-language check that only ever rejects a candidate
 *      when there is positive evidence it is wrong.
 *   2. RANKING — "of the candidates that passed, which is best?" That is
 *      this module. It can afford to be much richer, because a wrong answer
 *      here only picks a less-good photo among already-acceptable ones,
 *      never shows an unrelated one.
 *
 * Being the ranking half is why this looks at signals the filter cannot
 * safely use: BOTH interface languages, curated aliases, coordinate
 * proximity and pixel dimensions. A bilingual token set would loosen the
 * filter (a French-named country would start accepting English photos of
 * anywhere), but it strictly sharpens a ranking. */

/* NFD splits "é" into "e" + a combining acute accent; \p{Diacritic} strips
   just that mark, so "Occitania" and "Occitanie" compare on equal footing
   regardless of which language supplied either string. */
export function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/* A handful of short connector words that appear in real place names
   ("San Francisco", "Port-au-Prince") but are too generic alone to prove or
   disprove relevance — dropped so they never count as a "match" by
   themselves while the actually-distinctive word next to them still can.
   Shared with photo-api.js's filter so the two never disagree on what
   counts as a meaningful word. */
export const RELEVANCE_STOPWORDS = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "el",
  "san",
  "santa",
  "saint",
  "sainte",
  "new",
  "port",
  "fort",
  "and",
  "the",
  "of",
]);

/* Accent-stripped words of at least 3 letters — long enough to be a
   meaningful signal, short enough to still catch "sea", "bay".

   The [^a-z0-9] split intentionally discards non-Latin scripts entirely: a
   place whose geocoder only supplied a local-script name (東京, Москва)
   yields no tokens here, and the caller treats "no tokens" as "cannot
   confirm", never as "confirmed wrong" — see scorePhotoForLocation's
   `confidence` return value, which is what lets the photo pipeline keep its
   gradient fallback rather than show an unverifiable photo. */
export function significantWords(value) {
  return normalizeForMatch(value)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !RELEVANCE_STOPWORDS.has(w));
}

/* Every spelling of a localized {en, fr} field, plus a plain string, as one
   deduplicated list. A geocoder answers in one language at a time and the
   two are often different words for the same place ("United States" /
   "États-Unis", "Occitania" / "Occitanie"), so a photo captioned in either
   language should count as naming the place. */
function localizedVariants(value) {
  if (!value) return [];
  if (typeof value === "string") return [value];
  return [...new Set([value.en, value.fr].filter(Boolean))];
}

/* Tokens for one localized field, from all of its spellings at once. */
function fieldTokens(value) {
  return new Set(localizedVariants(value).flatMap(significantWords));
}

/* The location's identity, split by how strongly each part identifies it.
   Weights live in SCORE_WEIGHTS below rather than here, so this stays a
   plain description of the place. */
export function locationTokens(loc) {
  if (!loc)
    return {
      name: new Set(),
      alias: new Set(),
      landmark: new Set(),
      region: new Set(),
      country: new Set(),
    };
  const name = fieldTokens(loc.name);
  /* Curated entries (data/locations.js) carry hand-written aliases —
     alternate spellings, transliterations and common short forms ("nyc",
     "québec"). They identify the place nearly as well as its own name, so
     they rank just below it. Tokens already covered by the name itself are
     dropped so an alias can never double-count. */
  const alias = new Set(
    (Array.isArray(loc.aliases) ? loc.aliases : [])
      .flatMap(significantWords)
      .filter((tok) => !name.has(tok)),
  );
  /* A curated entry's landmark ({emoji, en, fr} — data/locations.js) is a
     real, hand-reviewed monument name, never one invented from the city.
     pexelsQuery deliberately keeps it OUT of the search text (it biased the
     results toward the same few famous monuments), but for RANKING it is
     strong evidence: between two photos of Paris, the one whose description
     names the Eiffel Tower is the more representative choice. Scored below
     the place's own name so a landmark match can never outweigh naming the
     place itself. */
  const landmark = new Set(
    localizedVariants(loc.landmark)
      .flatMap(significantWords)
      .filter((tok) => !name.has(tok) && !alias.has(tok)),
  );
  const region = new Set(
    [...fieldTokens(loc.region)].filter((tok) => !name.has(tok) && !landmark.has(tok)),
  );
  const country = new Set(
    [...fieldTokens(loc.country)].filter(
      (tok) => !name.has(tok) && !region.has(tok) && !landmark.has(tok),
    ),
  );
  return { name, alias, landmark, region, country };
}

/* The searchable text a candidate carries. Wikimedia supplies a real file
   title and description; Pexels supplies alt text and a photographer name.
   Both are folded into one haystack so a rule never has to branch on which
   provider a photo came from. */
export function photoHaystack(photo) {
  if (!photo) return "";
  return normalizeForMatch(
    [photo.alt, photo.title, photo.description, photo.photographer].filter(Boolean).join(" "),
  );
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/* Great-circle distance in km. Used only to score how close a
   coordinate-tagged photo is to the place it is supposed to show, so the
   spherical approximation is far more precision than the job needs. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((n) => Number.isFinite(n))) return null;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* Proximity bands rather than a continuous curve: Commons' own coordinates
   are building-level at best and the geosearch radius is 10 km (see
   services/wikimedia-api.js), so finer gradations would be false precision.
   A photo with no coordinates scores 0 — absence of evidence, not evidence
   of absence, so it is never penalised below an unrelated-but-tagged one. */
export function proximityScore(loc, photo) {
  const d = distanceKm(loc?.lat, loc?.lon, photo?.lat, photo?.lon);
  if (d === null) return 0;
  if (d <= 1) return 4;
  if (d <= 3) return 3;
  if (d <= 6) return 2;
  if (d <= 12) return 1;
  /* Beyond the geosearch radius the tag actively argues the photo is of
     somewhere else. */
  return -2;
}

/* Landscape orientation and enough pixels to fill a hero card. Deliberately
   small numbers: quality breaks ties between equally-relevant photos, and
   must never outweigh actually naming the place. */
export function qualityScore(photo) {
  if (!photo) return 0;
  const w = Number(photo.width) || 0;
  const h = Number(photo.height) || 0;
  let s = 0;
  if (w && h && w >= h) s += 1;
  if (w >= 1000) s += 1;
  return s;
}

/* Words that describe a built-up place. An ocean/sea photo mentioning them
   is usually a coastal city shot that happens to name the water — the
   filter accepts it (the water IS named) but it is a poor choice when any
   real open-water candidate exists. */
const URBAN_WORDS = ["city", "street", "building", "skyline", "downtown", "urban", "traffic"];
/* The mirror case: an inland city ranked against a photo that is really of
   the sea. Kept short and unambiguous on purpose. */
const MARINE_WORDS = ["seascape", "underwater", "reef", "sailing"];

/* "ocean" is the single loc.kind the whole app uses for open water (see
   core/coord-location.js); "sea" is accepted too so a future provider that
   reports it directly needs no change here. The finer distinction between
   an ocean, a sea, a gulf and a lake rides on loc.waterKind instead — see
   core/marine-regions.js — precisely so this kind check stays stable. */
const MARINE_KINDS = new Set(["ocean", "sea"]);

export function isMarineKind(kind) {
  return MARINE_KINDS.has(kind);
}

function mismatchPenalty(loc, haystack) {
  if (!haystack) return 0;
  const marine = MARINE_KINDS.has(loc?.kind);
  const words = marine ? URBAN_WORDS : MARINE_WORDS;
  /* Only ever applied to a marine location, or to a landlocked one — a
     coastal city legitimately shows both, and this must not fight that. */
  if (!marine && !loc?.landlocked) return 0;
  return words.some((w) => haystack.includes(w)) ? -3 : 0;
}

export const SCORE_WEIGHTS = {
  /* The whole name appearing as a phrase ("san francisco") is much stronger
     evidence than its words appearing separately, so it scores on top of
     the per-token credit rather than instead of it. */
  exactName: 6,
  nameToken: 3,
  aliasToken: 2,
  /* Between the alias and the region tiers: naming the place's own landmark
     identifies it better than naming the region it sits in, but less than
     naming the place itself. */
  landmarkToken: 2,
  regionToken: 1,
  countryToken: 1,
};

/**
 * Score one candidate against one location.
 *
 * @returns {{score: number, confidence: "text"|"coordinate"|"none"}}
 *   `confidence` reports WHY the score is what it is, which callers need in
 *   order to decide whether an unverifiable photo may be shown at all:
 *     "text"       — the photo's own words name the place (or its region /
 *                    country / a curated alias).
 *     "coordinate" — no text match, but the photo is tagged within a few km
 *                    of the place. Objective evidence, independent of
 *                    language or script.
 *     "none"       — nothing connects the photo to the place. Either the
 *                    location has no Latin-script identity to match on, or
 *                    the candidate simply never mentions it.
 */
export function scorePhotoForLocation(loc, photo) {
  if (!loc || !photo) return { score: 0, confidence: "none" };
  const tokens = locationTokens(loc);
  const hay = photoHaystack(photo);

  let score = 0;
  let textMatched = false;

  for (const variant of localizedVariants(loc.name)) {
    const phrase = normalizeForMatch(variant);
    /* Guard against a one-letter or stopword-only name matching everything */
    if (phrase.length >= 3 && hay.includes(phrase)) {
      score += SCORE_WEIGHTS.exactName;
      textMatched = true;
      break;
    }
  }
  for (const [group, weight] of [
    [tokens.name, SCORE_WEIGHTS.nameToken],
    [tokens.alias, SCORE_WEIGHTS.aliasToken],
    [tokens.landmark, SCORE_WEIGHTS.landmarkToken],
    [tokens.region, SCORE_WEIGHTS.regionToken],
    [tokens.country, SCORE_WEIGHTS.countryToken],
  ]) {
    for (const tok of group) {
      if (hay.includes(tok)) {
        score += weight;
        textMatched = true;
      }
    }
  }

  const proximity = proximityScore(loc, photo);
  score += proximity;
  score += qualityScore(photo);
  score += mismatchPenalty(loc, hay);

  const confidence = textMatched ? "text" : proximity > 0 ? "coordinate" : "none";
  return { score, confidence };
}

/**
 * Does this candidate clearly show a DIFFERENT well-known place?
 *
 * The relevance filter asks "does anything here name my place?"; this asks
 * the complementary question, which a token check cannot: a photo captioned
 * "Sunset over the Golden Gate Bridge, San Francisco" mentions neither
 * Tarbes nor Occitanie, but it is not merely unconfirmed — it is positively
 * about somewhere else. Stock libraries answer a thin query with exactly
 * this kind of famous-city photo, so without the rule the "no photo" outcome
 * (gradient fallback) silently loses to a beautiful, wrong one.
 *
 * `vocabulary` is injected rather than imported so this module stays pure and
 * data-free; services/photo-api.js builds it from the curated location list,
 * so the only names treated as "somewhere else" are real places the app
 * already knows — nothing is invented, and an unknown town can never be
 * mistaken for a conflict.
 *
 * Deliberately one-sided: a conflict is ignored the moment the candidate
 * ALSO names the location itself (or its own landmark). "Eiffel Tower,
 * Paris" is the right photo for Paris even though "Eiffel Tower" is a
 * famous-landmark term, and a photo naming two places genuinely may show
 * both.
 *
 * @param {object} loc
 * @param {object} photo
 * @param {Map<string, string>} vocabulary  token → owning place id
 * @returns {boolean} true when the photo should be rejected outright
 */
export function namesConflictingPlace(loc, photo, vocabulary) {
  if (!loc || !photo || !vocabulary || vocabulary.size === 0) return false;
  const hay = photoHaystack(photo);
  if (!hay) return false;

  const tokens = locationTokens(loc);
  /* Anything the location legitimately answers to. Region and country are
     included so a photo of another town in the SAME region is not called a
     conflict — it is a weaker match, which ranking already handles. */
  const own = new Set([
    ...tokens.name,
    ...tokens.alias,
    ...tokens.landmark,
    ...tokens.region,
    ...tokens.country,
  ]);
  /* The place's own identity present → never a conflict, whatever else the
     caption mentions. */
  for (const tok of own) if (hay.includes(tok)) return false;
  for (const variant of localizedVariants(loc.name)) {
    const phrase = normalizeForMatch(variant);
    if (phrase.length >= 3 && hay.includes(phrase)) return false;
  }

  const ownId = loc.id ? String(loc.id) : "";
  for (const [token, owner] of vocabulary) {
    /* A token claimed by more than one curated place identifies neither, so
       it is no evidence of anything (photo-api.js drops these when building
       the map; honouring a falsy owner here keeps the rule correct for any
       vocabulary). */
    if (!owner) continue;
    if (owner === ownId) continue; /* the location's own curated entry */
    if (own.has(token)) continue; /* shared word, e.g. a common region name */
    if (hay.includes(token)) return true;
  }
  return false;
}

/**
 * Best candidate for a location, or null.
 *
 * @param {object[]} candidates
 * @param {object} [opts]
 * @param {boolean} [opts.requireEvidence=false] — drop candidates whose
 *   confidence is "none". Set for a pure text search, where an unmatched
 *   result is just "whatever the provider ranked first" and showing it would
 *   be exactly the "a result exists, so display it" failure this pipeline
 *   exists to avoid. Left off when the caller has already established
 *   relevance some other way (a reviewed photo ID, a trusted geosearch).
 */
export function pickBestPhoto(loc, candidates, { requireEvidence = false } = {}) {
  const pool = (Array.isArray(candidates) ? candidates : []).filter((p) => p && p.src);
  if (!pool.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const photo of pool) {
    const { score, confidence } = scorePhotoForLocation(loc, photo);
    if (requireEvidence && confidence === "none") continue;
    /* Strictly greater, so ties keep the provider's own order — Pexels
       ranks by its search relevance and Commons' geosearch by distance,
       both of which are better tiebreakers than "last one wins". */
    if (score > bestScore) {
      bestScore = score;
      best = photo;
    }
  }
  return best;
}
