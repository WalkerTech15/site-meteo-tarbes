/* Google Places photo provider — the browser half.
 *
 * Two things are under test and they are worth keeping distinct:
 *   - the SAME-ORIGIN PROXY CONTRACT: no key ever leaves the server, and
 *     every failure mode (no key, 400/404/429/502/503, a timeout, junk JSON)
 *     collapses to "no Google photo" so the chain moves on;
 *   - the MATCHING RULES: a place is accepted on its identity — Place ID,
 *     administrative type, coordinate proximity — and a plausible-looking
 *     keyword hit is never enough on its own.
 *
 * `fetch` is stubbed throughout, so nothing here touches the network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  placesQuery,
  placeProximityScore,
  scorePlaceCandidate,
  pickBestPlace,
  fetchPlaceCandidates,
  resolvePlacePhoto,
  fetchGooglePlacePhoto,
  __resetPlacesCacheForTests,
} from "./places-api.js";

const PLACES_PATH = "api/places";
const PHOTO_URI = "https://lh3.googleusercontent.com/places/mock-photo";

function stubFetch(impl) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  });
  return calls;
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/* The whole two-step round trip: a candidate search, then the media resolve. */
function stubPlaces(places, { photoStatus = 200, photoBody = { photo: { src: PHOTO_URI } } } = {}) {
  return stubFetch((url) => {
    const params = new URL(url, "http://local").searchParams;
    if (params.get("photo")) return jsonResponse(photoStatus, photoBody);
    return jsonResponse(200, { places });
  });
}

const place = (over = {}) => ({
  id: "ChIJTarbes",
  name: "Tarbes",
  address: "65000 Tarbes, France",
  lat: 43.2333,
  lon: 0.0782,
  types: ["locality", "political"],
  mapsUri: "https://maps.google.com/?cid=1",
  photo: {
    ref: "places/ChIJTarbes/photos/AelY_mockref",
    width: 1600,
    height: 900,
    attributions: [{ name: "A Contributor", uri: "https://maps.google.com/contrib/1" }],
  },
  ...over,
});

const town = (over = {}) => ({
  id: "mt-tarbes",
  kind: "town",
  lat: 43.2333,
  lon: 0.0782,
  name: { en: "Tarbes", fr: "Tarbes" },
  region: { en: "Occitania", fr: "Occitanie" },
  country: { en: "France", fr: "France" },
  aliases: [],
  ...over,
});

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  __resetPlacesCacheForTests();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("placesQuery — a place entity, not a stock-photo mood", () => {
  it("qualifies a town with its region and country", () => {
    expect(placesQuery(town())).toBe("Tarbes, Occitania, France");
  });

  it("never appends stock-photo vocabulary", () => {
    /* "cityscape"/"landscape travel" belong in pexelsQuery — here they would
       push the match away from the place entity and toward a business whose
       name happens to contain them. */
    const q = placesQuery(town());
    expect(q).not.toMatch(/cityscape|landscape|travel|architecture|seascape/);
  });

  it("leaves a country unqualified — it IS the subject", () => {
    expect(placesQuery({ kind: "country", name: { en: "Japan", fr: "Japon" } })).toBe("Japan");
  });

  it("uses whichever language the geocoder actually supplied", () => {
    /* A tier that only came back in French must still qualify the name,
       rather than silently dropping out and leaving the town unqualified. */
    const loc = town({ region: { en: "", fr: "Occitanie" }, country: { en: "", fr: "France" } });
    expect(placesQuery(loc)).toBe("Tarbes, Occitanie, France");
  });

  it("is total on junk input", () => {
    expect(placesQuery(null)).toBe("");
    expect(placesQuery({ kind: "city" })).toBe("");
  });
});

describe("placeProximityScore — proximity outranks generic keywords", () => {
  it("scores co-located places highest and scales to the tier's tolerance", () => {
    expect(placeProximityScore(1, 30)).toBe(8);
    expect(placeProximityScore(4, 30)).toBe(6);
    expect(placeProximityScore(10, 30)).toBe(4);
    expect(placeProximityScore(25, 30)).toBe(2);
  });

  it("is neutral when either side has no coordinates, or the tier has no gate", () => {
    expect(placeProximityScore(null, 30)).toBe(0);
    expect(placeProximityScore(5, null)).toBe(0);
  });

  it("beats a region+country keyword match, which is what the rule is for", () => {
    /* regionToken + countryToken = 2 in photo-relevance's SCORE_WEIGHTS. */
    expect(placeProximityScore(1, 30)).toBeGreaterThan(2);
  });
});

describe("scorePlaceCandidate — accept on identity, reject on anything else", () => {
  it("accepts an exact Place ID above everything else", () => {
    const loc = town({ placeId: "ChIJTarbes" });
    /* Deliberately hostile on every other axis: wrong type, far away, a name
       that matches nothing. The Place ID still wins, because it IS the place. */
    const scored = scorePlaceCandidate(
      loc,
      place({ types: ["restaurant"], lat: 10, lon: 10, name: "Somewhere else" }),
    );
    expect(scored).not.toBeNull();
    expect(scored.reason).toBe("place-id");
    expect(scored.score).toBeGreaterThan(100);
  });

  it("rejects a business returned for a town — a hotel is not a town", () => {
    const hotel = place({
      name: "Hôtel Tarbes Centre",
      types: ["lodging", "point_of_interest", "establishment"],
    });
    expect(scorePlaceCandidate(town(), hotel)).toBeNull();
  });

  it("accepts the locality entry for that same town", () => {
    expect(scorePlaceCandidate(town(), place())).not.toBeNull();
  });

  it("rejects a same-named place in another country by distance", () => {
    /* Paris, Texas for Paris, France: right type, right word, wrong planet. */
    const wrong = place({ name: "Paris", address: "Paris, TX, USA", lat: 33.66, lon: -95.55 });
    const paris = town({ name: { en: "Paris", fr: "Paris" }, kind: "city", lat: 48.85, lon: 2.35 });
    expect(scorePlaceCandidate(paris, wrong)).toBeNull();
  });

  it("refuses a candidate with neither text agreement nor useful proximity", () => {
    /* Right type, but nothing at all connects it to the location. This is the
       "a result exists, so display it" failure the pipeline must avoid. */
    const vague = place({ name: "Centre-ville", address: "", lat: null, lon: null });
    expect(scorePlaceCandidate(town(), vague)).toBeNull();
  });

  it("accepts a co-located place whose name is spelled differently", () => {
    /* No shared word at all, but Google puts it on the same spot — which is
       objective evidence a caption cannot supply. */
    const local = place({ name: "Tarba", address: "" });
    const scored = scorePlaceCandidate(town(), local);
    expect(scored).not.toBeNull();
    expect(scored.reason).toBe("coordinate");
  });

  it("does not gate a country on distance — its representative point is arbitrary", () => {
    const japan = { kind: "country", name: { en: "Japan", fr: "Japon" }, lat: 35.68, lon: 139.69 };
    /* Google's centroid for Japan sits hundreds of km from Tokyo. */
    const entry = place({
      name: "Japan",
      address: "Japan",
      types: ["country"],
      lat: 36.2,
      lon: 138.25,
    });
    expect(scorePlaceCandidate(japan, entry)).not.toBeNull();
  });

  it("still requires a country candidate to actually be a country", () => {
    const japan = { kind: "country", name: { en: "Japan", fr: "Japon" }, lat: 35.68, lon: 139.69 };
    const restaurant = place({ name: "Japan Grill", types: ["restaurant", "establishment"] });
    expect(scorePlaceCandidate(japan, restaurant)).toBeNull();
  });

  /* Every Google result in the right country repeats that country in its
     formatted address, so "the address mentions France" is not evidence of
     anything. Without this rule a coordinate-less candidate for a completely
     different town would be accepted on the country word alone. */
  it("rejects a candidate whose only text overlap is the country", () => {
    const elsewhere = place({
      name: "Marseille",
      address: "13000 Marseille, France",
      lat: null,
      lon: null,
    });
    expect(scorePlaceCandidate(town(), elsewhere)).toBeNull();
  });

  it("rejects a candidate whose only text overlap is the region", () => {
    const elsewhere = place({
      name: "Auch",
      address: "32000 Auch, Occitanie",
      lat: null,
      lon: null,
    });
    expect(scorePlaceCandidate(town(), elsewhere)).toBeNull();
  });

  it("is total on missing arguments", () => {
    expect(scorePlaceCandidate(null, place())).toBeNull();
    expect(scorePlaceCandidate(town(), null)).toBeNull();
    expect(scorePlaceCandidate(town(), { ...place(), photo: null })).toBeNull();
  });
});

describe("pickBestPlace", () => {
  it("returns the closest qualifying candidate regardless of input order", () => {
    const near = place({ id: "near", lat: 43.2333, lon: 0.0782 });
    const far = place({ id: "far", lat: 43.55, lon: 0.4 });
    expect(pickBestPlace(town(), [far, near]).place.id).toBe("near");
    expect(pickBestPlace(town(), [near, far]).place.id).toBe("near");
  });

  it("keeps Google's own order when two candidates tie", () => {
    const first = place({ id: "first" });
    const second = place({ id: "second" });
    expect(pickBestPlace(town(), [first, second]).place.id).toBe("first");
  });

  it("returns null when every candidate is rejected", () => {
    const hotel = place({ types: ["lodging", "establishment"] });
    expect(pickBestPlace(town(), [hotel])).toBeNull();
    expect(pickBestPlace(town(), [])).toBeNull();
    expect(pickBestPlace(town(), null)).toBeNull();
  });
});

describe("proxy contract — the key never reaches the browser", () => {
  it("only ever calls the same-origin proxy, never Google directly", async () => {
    const calls = stubPlaces([place()]);
    await fetchGooglePlacePhoto(town());
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url).toContain(PLACES_PATH);
      expect(c.url).not.toContain("googleapis.com");
      /* No credential of any kind travels from the browser. */
      expect(JSON.stringify(c.init?.headers || {})).not.toMatch(/goog|api[-_]?key/i);
    }
  });

  it("sends the location's coordinates and language as a bias", async () => {
    const calls = stubPlaces([place()]);
    await fetchPlaceCandidates(town());
    const params = new URL(calls[0].url, "http://local").searchParams;
    expect(params.get("query")).toBe("Tarbes, Occitania, France");
    expect(Number(params.get("lat"))).toBeCloseTo(43.2333, 3);
    expect(Number(params.get("lon"))).toBeCloseTo(0.0782, 3);
    expect(["en", "fr"]).toContain(params.get("lang"));
  });

  it("resolves the chosen photo in a SECOND request, not one per candidate", async () => {
    const calls = stubPlaces([place({ id: "a" }), place({ id: "b" }), place({ id: "c" })]);
    await fetchGooglePlacePhoto(town());
    const resolves = calls.filter((c) => c.url.includes("photo="));
    expect(resolves).toHaveLength(1);
  });

  it("maps a resolved photo onto the shared candidate shape", async () => {
    stubPlaces([place()]);
    const photo = await fetchGooglePlacePhoto(town());
    expect(photo).toMatchObject({
      src: PHOTO_URI,
      source: "google",
      photographer: "A Contributor",
      link: "https://maps.google.com/contrib/1",
      alt: "Tarbes",
      placeId: "ChIJTarbes",
    });
  });
});

describe("failure handling — every fault means 'no Google photo'", () => {
  for (const status of [400, 404, 429, 500, 502]) {
    it(`degrades to null on a ${status} from the proxy`, async () => {
      stubFetch(() => jsonResponse(status, { error: "x" }));
      expect(await fetchGooglePlacePhoto(town())).toBeNull();
    });
  }

  it("degrades to null when the network throws (offline, timeout)", async () => {
    stubFetch(() => {
      throw new Error("timeout");
    });
    expect(await fetchGooglePlacePhoto(town())).toBeNull();
  });

  it("degrades to null on malformed JSON", async () => {
    stubFetch(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }));
    expect(await fetchGooglePlacePhoto(town())).toBeNull();
  });

  it("degrades to null when the media step fails after a good search", async () => {
    stubPlaces([place()], { photoStatus: 502, photoBody: { error: "upstream_error" } });
    expect(await fetchGooglePlacePhoto(town())).toBeNull();
  });

  it("refuses a resolved URI that is not a Google image host", async () => {
    /* Defence in depth: the proxy validates this too, but a value that
       reaches an <img src> is never trusted from one check alone. */
    stubPlaces([place()], { photoBody: { photo: { src: "http://evil.example/x.jpg" } } });
    expect(await fetchGooglePlacePhoto(town())).toBeNull();
  });

  /* A 503 is "this deployment has no usable Google key" — a fact about the
     server, not about this location. Re-asking once per location would be one
     wasted round trip per selection for the whole session. */
  it("stops asking entirely after a 503, instead of retrying per location", async () => {
    const calls = stubFetch(() => jsonResponse(503, { error: "unavailable" }));
    expect(await fetchGooglePlacePhoto(town())).toBeNull();
    const afterFirst = calls.length;
    expect(
      await fetchGooglePlacePhoto(town({ id: "b", name: { en: "Lyon", fr: "Lyon" } })),
    ).toBeNull();
    expect(
      await fetchGooglePlacePhoto(town({ id: "c", name: { en: "Nice", fr: "Nice" } })),
    ).toBeNull();
    expect(calls.length).toBe(afterFirst);
  });

  /* Google requires the contributor attribution to be displayed with the
     photo. renderPhotoCredit draws nothing without a name and an https link,
     so a photo we could not credit must not be shown at all. */
  it("refuses a photo it could not attribute", async () => {
    stubPlaces([place({ mapsUri: "", photo: { ...place().photo, attributions: [] } })]);
    expect(await fetchGooglePlacePhoto(town())).toBeNull();
  });

  it("falls back to the place's Maps URI when the contributor has no link", async () => {
    stubPlaces([place({ photo: { ...place().photo, attributions: [{ name: "Anon", uri: "" }] } })]);
    const photo = await fetchGooglePlacePhoto(town());
    expect(photo.link).toBe("https://maps.google.com/?cid=1");
    expect(photo.photographer).toBe("Anon");
  });
});

describe("caching — temporary by licence, deduplicated by design", () => {
  it("serves a repeated lookup from memory instead of re-requesting", async () => {
    const calls = stubPlaces([place()]);
    await fetchGooglePlacePhoto(town());
    const after = calls.length;
    await fetchGooglePlacePhoto(town());
    expect(calls.length).toBe(after);
  });

  it("coalesces concurrent lookups for the same place into one request", async () => {
    const calls = stubPlaces([place()]);
    await Promise.all([fetchPlaceCandidates(town()), fetchPlaceCandidates(town())]);
    expect(calls.filter((c) => c.url.includes("query=")).length).toBe(1);
  });

  it("expires a resolved photo URI rather than keeping it forever", async () => {
    /* The licence point, expressed as behaviour: Pexels and Commons entries
       live for the whole process, a Google photo URI must not. */
    const calls = stubPlaces([place()]);
    const first = await resolvePlacePhoto(place().photo.ref);
    expect(first).toBe(PHOTO_URI);
    const before = calls.length;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 60 * 60000);
      await resolvePlacePhoto(place().photo.ref);
    } finally {
      vi.useRealTimers();
    }
    expect(calls.length).toBeGreaterThan(before);
  });

  it("never writes anything to persistent storage", () => {
    /* The module holds Maps, nothing else. A regression that reached for
       localStorage would break the licensing guarantee silently, so this
       pins the absence rather than trusting review. Comments are stripped
       first — the file header DISCUSSES localStorage, which is the opposite
       of using it. */
    const code = PLACES_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./);
  });
});

describe("oceans and seas", () => {
  it("never queries Google for open water — it has no such entity", async () => {
    const calls = stubPlaces([place()]);
    const sea = {
      kind: "ocean",
      waterKind: "ocean",
      lat: 33.2,
      lon: -41.5,
      name: { en: "Atlantic Ocean", fr: "Océan Atlantique" },
    };
    expect(await fetchGooglePlacePhoto(sea)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

/* The module's own text, for the "no persistent storage" assertion above. */
const PLACES_SOURCE = readFileSync(
  fileURLToPath(new URL("./places-api.js", import.meta.url)),
  "utf8",
);

/* ── Worldwide coverage ────────────────────────────────────────────────────
   A representative location per requested country and per administrative
   tier, exercised through the SAME rules the app uses. The point is not that
   these particular places have Google photos — that depends on Google's own
   coverage and cannot be asserted offline — but that the query construction
   and the identity gates behave correctly for every tier, script and
   accent, rather than only for the Latin-script town the rest of this file
   is built around. */
const WORLD = [
  // country,        loc under test,                                 the place Google would return
  [
    "France (town)",
    {
      kind: "town",
      name: { en: "Tarbes", fr: "Tarbes" },
      region: { en: "Occitania", fr: "Occitanie" },
      country: { en: "France", fr: "France" },
      lat: 43.2333,
      lon: 0.0782,
    },
    { name: "Tarbes", types: ["locality"], lat: 43.23, lon: 0.08 },
  ],
  [
    "France (city)",
    {
      kind: "city",
      name: { en: "Lyon", fr: "Lyon" },
      region: { en: "Auvergne-Rhône-Alpes", fr: "Auvergne-Rhône-Alpes" },
      country: { en: "France", fr: "France" },
      lat: 45.764,
      lon: 4.8357,
    },
    { name: "Lyon", types: ["locality"], lat: 45.75, lon: 4.85 },
  ],
  [
    "Japan (non-Latin name)",
    {
      kind: "city",
      name: { en: "東京", fr: "東京" },
      region: {},
      country: { en: "Japan", fr: "Japon" },
      lat: 35.6762,
      lon: 139.6503,
    },
    { name: "東京", types: ["locality"], lat: 35.68, lon: 139.65 },
  ],
  [
    "Japan (country)",
    { kind: "country", name: { en: "Japan", fr: "Japon" }, lat: 36.2, lon: 138.25 },
    { name: "Japan", types: ["country"], lat: 36.2, lon: 138.25 },
  ],
  [
    "Vietnam (diacritics)",
    {
      kind: "city",
      name: { en: "Đà Nẵng", fr: "Đà Nẵng" },
      region: {},
      country: { en: "Vietnam", fr: "Viêt Nam" },
      lat: 16.0544,
      lon: 108.2022,
    },
    { name: "Đà Nẵng", types: ["locality"], lat: 16.05, lon: 108.2 },
  ],
  [
    "Australia (city)",
    {
      kind: "city",
      name: { en: "Sydney", fr: "Sydney" },
      region: { en: "New South Wales", fr: "Nouvelle-Galles du Sud" },
      country: { en: "Australia", fr: "Australie" },
      lat: -33.8688,
      lon: 151.2093,
    },
    { name: "Sydney", types: ["locality"], lat: -33.87, lon: 151.21 },
  ],
  [
    "Canada (province)",
    {
      kind: "province",
      name: { en: "Alberta", fr: "Alberta" },
      region: {},
      country: { en: "Canada", fr: "Canada" },
      lat: 53.9333,
      lon: -116.5765,
    },
    { name: "Alberta", types: ["administrative_area_level_1"], lat: 53.9, lon: -116.6 },
  ],
  [
    "Germany (city)",
    {
      kind: "city",
      name: { en: "Munich", fr: "Munich" },
      region: { en: "Bavaria", fr: "Bavière" },
      country: { en: "Germany", fr: "Allemagne" },
      lat: 48.1351,
      lon: 11.582,
    },
    { name: "München", types: ["locality"], lat: 48.14, lon: 11.58 },
  ],
  [
    "Spain (small town)",
    {
      kind: "village",
      name: { en: "Ronda", fr: "Ronda" },
      region: { en: "Andalusia", fr: "Andalousie" },
      country: { en: "Spain", fr: "Espagne" },
      lat: 36.7423,
      lon: -5.1673,
    },
    { name: "Ronda", types: ["locality"], lat: 36.74, lon: -5.17 },
  ],
  [
    "Italy (region)",
    {
      kind: "region",
      name: { en: "Tuscany", fr: "Toscane" },
      region: {},
      country: { en: "Italy", fr: "Italie" },
      lat: 43.7711,
      lon: 11.2486,
    },
    { name: "Toscana", types: ["administrative_area_level_1"], lat: 43.5, lon: 11.1 },
  ],
  [
    "United Kingdom (city)",
    {
      kind: "city",
      name: { en: "Edinburgh", fr: "Édimbourg" },
      region: { en: "Scotland", fr: "Écosse" },
      country: { en: "United Kingdom", fr: "Royaume-Uni" },
      lat: 55.9533,
      lon: -3.1883,
    },
    { name: "Edinburgh", types: ["locality"], lat: 55.95, lon: -3.19 },
  ],
  [
    "United States (state)",
    {
      kind: "state",
      name: { en: "Texas", fr: "Texas" },
      region: {},
      country: { en: "United States", fr: "États-Unis" },
      lat: 31.4,
      lon: -99.9,
    },
    { name: "Texas", types: ["administrative_area_level_1"], lat: 31.5, lon: -99.5 },
  ],
  [
    "United States (landmark/POI)",
    {
      kind: "poi",
      name: { en: "Golden Gate Bridge", fr: "Golden Gate Bridge" },
      region: { en: "California", fr: "Californie" },
      country: { en: "United States", fr: "États-Unis" },
      lat: 37.8199,
      lon: -122.4783,
    },
    {
      name: "Golden Gate Bridge",
      types: ["tourist_attraction", "establishment"],
      lat: 37.8199,
      lon: -122.4783,
    },
  ],
  [
    "Country with no regional flag",
    { kind: "country", name: { en: "Iceland", fr: "Islande" }, lat: 64.9631, lon: -19.0208 },
    { name: "Iceland", types: ["country"], lat: 64.9, lon: -19.0 },
  ],
];

describe("worldwide coverage — every tier, script and accent", () => {
  it.each(WORLD)("%s builds a usable query", (_label, loc) => {
    const q = placesQuery(loc);
    expect(q.length).toBeGreaterThan(1);
    /* Never a coordinate-shaped query, and never stock-photo vocabulary. */
    expect(q).not.toMatch(/-?\d+\.\d+/);
    expect(q).not.toMatch(/cityscape|seascape|landscape travel/);
  });

  it.each(WORLD)("%s accepts the matching place entity", (_label, loc, match) => {
    const candidate = place({ ...match, address: `${match.name}` });
    expect(scorePlaceCandidate(loc, candidate)).not.toBeNull();
  });

  /* The hard case: a non-Latin name yields no comparable tokens at all (see
     significantWords in photo-relevance.js), so text can never confirm it.
     Coordinates can — which is exactly why proximity is a first-class signal
     here rather than a tiebreaker. */
  it("accepts a non-Latin-script place on coordinates alone", () => {
    const [, tokyo, match] = WORLD.find(([label]) => label.startsWith("Japan (non-Latin"));
    const scored = scorePlaceCandidate(tokyo, place({ ...match, address: "日本、東京都" }));
    expect(scored.reason).toBe("coordinate");
  });

  it.each(WORLD)("%s still rejects a business standing in for the place", (_label, loc, match) => {
    /* Only the settlement/area tiers: for a POI, an establishment IS the
       right answer, so this rule does not apply there. */
    if (loc.kind === "poi" || loc.kind === "address") return;
    const business = place({
      ...match,
      name: `${match.name} Grand Hotel`,
      types: ["lodging", "establishment"],
    });
    expect(scorePlaceCandidate(loc, business)).toBeNull();
  });
});

/* The one place the identity rules are deliberately strict enough to refuse a
   correct answer, recorded here so it is a known trade-off rather than a
   surprise. A COUNTRY has no distance gate — its representative point is
   arbitrary, so Washington DC and a US centroid can be 1900 km apart and both
   be "the United States" — which means a country can only ever be confirmed
   by NAME. The proxy asks Google for the display name in the interface
   language, so this is normally exactly the name the app holds; if Google
   were to answer with an endonym instead, the candidate is refused and the
   chain falls through to Wikimedia. Refusing is the right outcome: the
   alternative is accepting a country entity on no evidence at all. */
describe("known limitation — a country named by its endonym", () => {
  const iceland = {
    kind: "country",
    name: { en: "Iceland", fr: "Islande" },
    lat: 64.96,
    lon: -19.02,
  };

  it("accepts the country under its localized name, which is what is requested", () => {
    for (const name of ["Iceland", "Islande"]) {
      const entry = place({ name, address: name, types: ["country"], lat: 64.9, lon: -19 });
      expect(scorePlaceCandidate(iceland, entry)).not.toBeNull();
    }
  });

  it("refuses it under an endonym rather than guessing, so another provider answers", () => {
    const entry = place({
      name: "Ísland",
      address: "Ísland",
      types: ["country"],
      lat: 64.9,
      lon: -19,
    });
    expect(scorePlaceCandidate(iceland, entry)).toBeNull();
  });
});

/* ── The landmark tier ─────────────────────────────────────────────────────
   Why this exists, recorded because it was a real production failure rather
   than a hypothetical: Google's place photos are attached overwhelmingly to
   businesses and points of interest. Administrative entities — a `locality`,
   an `administrative_area_level_1`, a `country` — very often carry no photos
   at all, so the proxy drops them (a place with no photo cannot answer the
   question) and the type gate dropped everything that did have one. Between
   the two, a city/region/country query could return candidates and still
   yield nothing usable: "no usable photo candidates".

   The fix is a second, clearly-labelled tier — never a loosening of the
   first. A landmark INSIDE the place is offered as a `nearby` photo, always
   ranked below any genuine match, and the UI says so. */
describe("landmark tier — what unblocks a city with no photo of its own", () => {
  const cathedral = (over = {}) =>
    place({
      id: "ChIJcathedral",
      name: "Cathédrale de la Sède",
      address: "Place du Chapitre, 65000 Tarbes, France",
      types: ["church", "place_of_worship", "tourist_attraction"],
      lat: 43.2331,
      lon: 0.0771,
      ...over,
    });

  it("accepts a landmark inside the town when the town itself has no photo", () => {
    const scored = scorePlaceCandidate(town(), cathedral());
    expect(scored).not.toBeNull();
    expect(scored.provenance).toBe("nearby");
    expect(scored.reason).toBe("landmark");
  });

  /* The line the requirements draw: showing a landmark is fine, passing it
     off as the city is not. */
  it("never labels a landmark as an exact photo of the place", () => {
    expect(scorePlaceCandidate(town(), cathedral()).provenance).not.toBe("exact");
  });

  it("always ranks the place itself above any landmark inside it", () => {
    const picked = pickBestPlace(town(), [cathedral(), place()]);
    expect(picked.place.id).toBe("ChIJTarbes");
    expect(picked.provenance).toBe("exact");
  });

  it("keeps ranking the place first even when the landmark is closer", () => {
    /* A landmark exactly on the town's coordinate still loses to the town. */
    const onTheSpot = cathedral({ lat: town().lat, lon: town().lon });
    const citySlightlyOff = place({ lat: 43.24, lon: 0.09 });
    const picked = pickBestPlace(town(), [onTheSpot, citySlightlyOff]);
    expect(picked.provenance).toBe("exact");
  });

  it("rejects a landmark that is not actually inside the place", () => {
    /* Right type, right country, but 200 km away — a different town's
       cathedral is not a photo of this one's surroundings. */
    expect(scorePlaceCandidate(town(), cathedral({ lat: 44.84, lon: -0.58 }))).toBeNull();
  });

  it("rejects a landmark with no coordinate — proximity IS the evidence", () => {
    expect(scorePlaceCandidate(town(), cathedral({ lat: null, lon: null }))).toBeNull();
  });

  /* Google attaches `establishment` and `point_of_interest` to essentially
     every business, so those are deliberately not landmark types. */
  it("still rejects ordinary businesses, however close they are", () => {
    for (const types of [
      ["lodging", "point_of_interest", "establishment"],
      ["restaurant", "food", "establishment"],
      ["car_repair", "establishment"],
      ["gas_station", "point_of_interest", "establishment"],
      ["shopping_mall", "establishment"],
    ]) {
      expect(scorePlaceCandidate(town(), cathedral({ types }))).toBeNull();
    }
  });

  it("prefers the nearer of two landmarks, and the named one on a tie", () => {
    const near = cathedral({ id: "near", lat: 43.2334, lon: 0.0783 });
    const far = cathedral({ id: "far", lat: 43.2395, lon: 0.0782 });
    expect(pickBestPlace(town(), [far, near]).place.id).toBe("near");
  });

  it("offers no landmark tier for a country — 'inside it' means nothing there", () => {
    const japan = { kind: "country", name: { en: "Japan", fr: "Japon" }, lat: 36.2, lon: 138.25 };
    const shrine = place({
      name: "Meiji Jingu",
      address: "Tokyo, Japan",
      types: ["tourist_attraction", "place_of_worship"],
      lat: 35.676,
      lon: 139.699,
    });
    expect(scorePlaceCandidate(japan, shrine)).toBeNull();
  });

  it("offers a wide landmark radius for a region, which is a wide thing", () => {
    const tuscany = {
      kind: "region",
      name: { en: "Tuscany", fr: "Toscane" },
      region: {},
      country: { en: "Italy", fr: "Italie" },
      lat: 43.7711,
      lon: 11.2486,
    };
    const tower = place({
      name: "Torre pendente di Pisa",
      address: "Pisa, Italy",
      types: ["tourist_attraction", "historical_landmark"],
      lat: 43.723,
      lon: 10.3966,
    });
    const scored = scorePlaceCandidate(tuscany, tower);
    expect(scored).not.toBeNull();
    expect(scored.provenance).toBe("nearby");
  });

  it("carries the landmark's name through, so the credit can say what it is", async () => {
    stubPlaces([cathedral()]);
    const photo = await fetchGooglePlacePhoto(town());
    expect(photo.provenance).toBe("nearby");
    expect(photo.subjectName).toBe("Cathédrale de la Sède");
  });

  it("leaves subjectName empty for an exact match, which needs no qualifier", async () => {
    stubPlaces([place()]);
    const photo = await fetchGooglePlacePhoto(town());
    expect(photo.provenance).toBe("exact");
    expect(photo.subjectName).toBe("");
  });
});
