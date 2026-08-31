/* Contract tests for the Pexels photo service.
 *
 * These exercise the browser side of the SAME-ORIGIN PROXY contract — the
 * frontend must never talk to api.pexels.com directly, and must degrade to "no
 * photo" for every failure mode the proxy can report. `fetch` is stubbed, so
 * nothing here touches the network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fetchPexelsPhoto,
  fetchPexelsPhotoById,
  fetchPexelsPhotoCandidates,
  fetchWikimediaPhoto,
  pexelsQuery,
  wikimediaQuery,
  relevanceKeywords,
  isRelevantPhoto,
  rankPexelsCandidates,
  rankWikimediaCandidates,
  resolveLocationImage,
  fetchBestPhoto,
  areaFallbackTargets,
  bumpPhotoToken,
  __resetPhotoCacheForTests,
} from "./photo-api.js";
import { state } from "../core/state.js";
import { LOCATIONS } from "../data/locations.js";
import { COUNTRY_FLAG_CODES } from "../data/country-flag-codes.js";

const PROXY_PATH = "api/pexels";
const PLACES_PATH = "api/places";
const MAPILLARY_PATH = "api/mapillary";

/* One Mapillary image, in the shape the proxy re-projects onto (see
   api/mapillary.js): geotagged, attributed, no caption at all. */
const mapillaryImage = (over = {}) => ({
  id: "123456789",
  src: "https://scontent-cdg4-1.xx.fbcdn.net/m/mock.jpg",
  width: 2048,
  height: 1152,
  lat: 43.2333,
  lon: 0.0782,
  capturedAt: Date.now() - 30 * 24 * 3600 * 1000,
  isPano: false,
  creator: "a_contributor",
  link: "https://www.mapillary.com/app/?pKey=123456789&focus=photo",
  ...over,
});
const GOOGLE_PHOTO_ID = "mock-google-photo.jpg";

/* One Google Places candidate, in the shape the proxy re-projects onto (see
   api/places.js): metadata only — the image URI is resolved separately. */
const googlePlace = (over = {}) => ({
  id: "ChIJmockPlaceId",
  name: "Tarbes",
  address: "65000 Tarbes, France",
  lat: 43.2333,
  lon: 0.0782,
  types: ["locality", "political"],
  mapsUri: "https://maps.google.com/?cid=1",
  photo: {
    ref: "places/ChIJmockPlaceId/photos/AelY_mockPhotoReference",
    width: 1600,
    height: 900,
    attributions: [{ name: "A Google Contributor", uri: "https://maps.google.com/contrib/1" }],
  },
  ...over,
});

/* One counter-shaped stub so each test can assert what was requested. */
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

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  __resetPhotoCacheForTests();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchPexelsPhoto — proxy contract", () => {
  it("1. maps a successful proxy response onto the photo shape", async () => {
    const calls = stubFetch(() =>
      jsonResponse(200, {
        photo: {
          src: {
            medium: "https://images.pexels.com/m.jpg",
            large: "https://images.pexels.com/l.jpg",
            large2x: "https://images.pexels.com/l2x.jpg",
          },
          photographer: "Ada Lovelace",
          link: "https://www.pexels.com/photo/test-1/",
          alt: "A city at dusk",
        },
      }),
    );

    const photo = await fetchPexelsPhoto("Paris France cityscape");

    expect(photo).toEqual({
      src: "https://images.pexels.com/l.jpg", // prefers `large` over medium/large2x
      sizes: {
        medium: "https://images.pexels.com/m.jpg",
        large: "https://images.pexels.com/l.jpg",
        large2x: "https://images.pexels.com/l2x.jpg",
      },
      photographer: "Ada Lovelace",
      link: "https://www.pexels.com/photo/test-1/",
      alt: "A city at dusk",
    });
    expect(calls).toHaveLength(1);
  });

  it("calls the same-origin proxy, never api.pexels.com, and sends no credentials", async () => {
    const calls = stubFetch(() => jsonResponse(200, { photo: null }));

    await fetchPexelsPhoto("Paris France cityscape");

    const { url, init } = calls[0];
    expect(url).toContain(PROXY_PATH);
    expect(url).not.toContain("api.pexels.com");
    expect(url).toContain("query=Paris%20France%20cityscape"); // encoded, single param
    /* the key lives on the server: no Authorization must ever be sent */
    expect(JSON.stringify(init.headers || {})).not.toMatch(/authorization/i);
  });

  it("2. returns null when the proxy reports no result", async () => {
    stubFetch(() => jsonResponse(200, { photo: null }));
    await expect(fetchPexelsPhoto("nowhere at all")).resolves.toBeNull();
  });

  it("2b. returns null when the proxy returns a photo with no usable size", async () => {
    stubFetch(() => jsonResponse(200, { photo: { src: {}, photographer: "X" } }));
    await expect(fetchPexelsPhoto("sizeless")).resolves.toBeNull();
  });

  /* Each failure mode must look identical to the caller: no photo, no throw,
     no server detail leaking into the UI. */
  const failures = [
    ["3. invalid query (400)", 400, { error: "invalid_query" }],
    ["4. missing server secret (503)", 503, { error: "unavailable" }],
    ["5. Pexels rate limit (429)", 429, { error: "rate_limited" }],
    ["6a. upstream failure (502)", 502, { error: "upstream_error" }],
    ["6b. method not allowed (405)", 405, { error: "method_not_allowed" }],
  ];
  for (const [label, status, body] of failures) {
    it(`${label} resolves to null without throwing`, async () => {
      stubFetch(() => jsonResponse(status, body));
      await expect(fetchPexelsPhoto("Paris France cityscape")).resolves.toBeNull();
    });
  }

  it("6c. a network failure or timeout resolves to null", async () => {
    stubFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(fetchPexelsPhoto("Paris France cityscape")).resolves.toBeNull();
  });

  it("applies a request timeout so a hanging proxy cannot freeze the UI", async () => {
    const calls = stubFetch(() => jsonResponse(200, { photo: null }));
    await fetchPexelsPhoto("Paris France cityscape");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("negative-caches a failure so a broken proxy is asked only once per query", async () => {
    const calls = stubFetch(() => jsonResponse(503, { error: "unavailable" }));

    await fetchPexelsPhoto("Paris France cityscape");
    await fetchPexelsPhoto("Paris France cityscape");

    expect(calls).toHaveLength(1);
  });

  it("caches a successful lookup per query", async () => {
    const calls = stubFetch(() =>
      jsonResponse(200, {
        photo: { src: { large: "https://images.pexels.com/l.jpg" }, photographer: "A", link: "" },
      }),
    );

    const first = await fetchPexelsPhoto("Paris France cityscape");
    const second = await fetchPexelsPhoto("Paris France cityscape");
    await fetchPexelsPhoto("Tokyo Japan skyline"); // different query → new request

    expect(first).toBe(second);
    expect(calls).toHaveLength(2);
  });

  it("does not call the proxy for an empty query", async () => {
    const calls = stubFetch(() => jsonResponse(200, { photo: null }));
    await expect(fetchPexelsPhoto("")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  /* The cache is only written once a response lands, so ten explore cards
     hydrating together would each fire the same request without this. */
  it("collapses concurrent requests for the same query into one", async () => {
    let resolveIt;
    const gate = new Promise((r) => (resolveIt = r));
    const calls = stubFetch(async () => {
      await gate;
      return jsonResponse(200, {
        photo: { src: { large: "https://images.pexels.com/l.jpg" }, photographer: "A", link: "" },
      });
    });

    const all = Promise.all([
      fetchPexelsPhoto("Paris Île-de-France France cityscape"),
      fetchPexelsPhoto("Paris Île-de-France France cityscape"),
      fetchPexelsPhoto("Paris Île-de-France France cityscape"),
    ]);
    resolveIt();
    const [a, b, c] = await all;

    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("releases the in-flight slot so a later miss can still be retried", async () => {
    const calls = stubFetch(() => {
      throw new TypeError("network down");
    });
    await fetchPexelsPhoto("Lyon Auvergne-Rhône-Alpes France cityscape");
    await fetchPexelsPhoto("Nice Provence France cityscape");
    expect(calls).toHaveLength(2); // two distinct queries, neither stuck pending
  });
});

/* Curated locations (src/js/data/locations.js) carry a manually reviewed
   Pexels photo ID so the hero/card image is guaranteed to show the actual
   landmark — a landmark NAME alone is never trusted as a guarantee, only a
   specific reviewed ID is. Same proxy, same response contract, different
   query-string param ("id" instead of "query"). */
describe("fetchPexelsPhotoById — curated exact-photo contract", () => {
  it("requests the same-origin proxy with an id= param, never a query= search", async () => {
    const calls = stubFetch(() =>
      jsonResponse(200, {
        photo: {
          src: {
            medium: "https://images.pexels.com/m.jpg",
            large: "https://images.pexels.com/l.jpg",
          },
          photographer: "Rafal Maciejski",
          link: "https://www.pexels.com/photo/hollywood-sign-on-hill-5688653/",
          alt: "Hollywood Sign on a hillside",
        },
      }),
    );

    const photo = await fetchPexelsPhotoById(5688653);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(PROXY_PATH);
    expect(calls[0].url).toContain("id=5688653");
    expect(calls[0].url).not.toContain("query=");
    expect(photo).toEqual({
      src: "https://images.pexels.com/l.jpg",
      sizes: {
        medium: "https://images.pexels.com/m.jpg",
        large: "https://images.pexels.com/l.jpg",
      },
      photographer: "Rafal Maciejski",
      link: "https://www.pexels.com/photo/hollywood-sign-on-hill-5688653/",
      alt: "Hollywood Sign on a hillside",
    });
  });

  it("returns null without calling the proxy for a falsy id", async () => {
    const calls = stubFetch(() => jsonResponse(200, { photo: null }));
    await expect(fetchPexelsPhotoById(undefined)).resolves.toBeNull();
    await expect(fetchPexelsPhotoById(0)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("resolves to null, without throwing, for every failure the proxy can report for an ID lookup", async () => {
    const failures = [
      [400, { error: "invalid_id" }],
      [404, { error: "not_found" }], // the reviewed photo was removed/renamed upstream
      [429, { error: "rate_limited" }],
      [502, { error: "upstream_error" }],
      [503, { error: "unavailable" }],
    ];
    for (const [status, body] of failures) {
      __resetPhotoCacheForTests();
      stubFetch(() => jsonResponse(status, body));
      await expect(fetchPexelsPhotoById(5688653)).resolves.toBeNull();
    }
  });

  it("caches by a namespaced key so an ID can never collide with a text query", async () => {
    /* A query happening to be the digits "5688653" must not read/write the
       same cache slot as the curated photo ID 5688653. */
    const calls = stubFetch((url) =>
      jsonResponse(200, {
        photo: {
          src: {
            large: url.includes("id=")
              ? "https://images.pexels.com/by-id.jpg"
              : "https://images.pexels.com/by-query.jpg",
          },
          photographer: "X",
          link: "",
        },
      }),
    );

    const byId = await fetchPexelsPhotoById(5688653);
    const byQuery = await fetchPexelsPhoto("5688653");

    expect(calls).toHaveLength(2); // no accidental cache hit across the two
    expect(byId.src).toBe("https://images.pexels.com/by-id.jpg");
    expect(byQuery.src).toBe("https://images.pexels.com/by-query.jpg");
  });

  it("dedupes concurrent requests for the same id into one", async () => {
    let resolveIt;
    const gate = new Promise((r) => (resolveIt = r));
    const calls = stubFetch(async () => {
      await gate;
      return jsonResponse(200, {
        photo: { src: { large: "https://images.pexels.com/l.jpg" }, photographer: "A", link: "" },
      });
    });

    const all = Promise.all([fetchPexelsPhotoById(356844), fetchPexelsPhotoById(356844)]);
    resolveIt();
    const [a, b] = await all;

    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
  });
});

/* An image search on a bare city name is ambiguous — "Paris" is as likely to
   return Paris, Texas, and "Tarbes" returns nothing recognisable at all. */
describe("pexelsQuery — precise, unambiguous, worldwide queries", () => {
  const TARBES = {
    kind: "city",
    cc: "FR",
    name: { en: "Tarbes", fr: "Tarbes" },
    region: { en: "Occitanie" },
    country: { en: "France" },
  };
  const TOKYO = {
    kind: "city",
    cc: "JP",
    name: { en: "Tokyo", fr: "Tokyo" },
    region: { en: "Kanto" },
    country: { en: "Japan" },
  };
  const JAPAN = {
    kind: "country",
    cc: "JP",
    name: { en: "Japan", fr: "Japon" },
    region: { en: "Asia" },
    country: { en: "Japan" },
  };
  /* the curated entries (src/js/data/locations.js) that used to trigger the
     cliché "landmark" bias this rewrite exists to fix — both carry a real,
     curated loc.landmark (Statue of Liberty / Eiffel Tower) that must stay
     out of the search text regardless */
  const NEW_YORK = {
    kind: "city",
    cc: "US",
    name: { en: "New York", fr: "New York" },
    region: { en: "New York State", fr: "État de New York" },
    country: { en: "United States", fr: "États-Unis" },
    landmark: { emoji: "🗽", en: "Statue of Liberty", fr: "Statue de la Liberté" },
  };
  const LOS_ANGELES = {
    kind: "city",
    cc: "US",
    name: { en: "Los Angeles", fr: "Los Angeles" },
    region: { en: "California", fr: "Californie" },
    country: { en: "United States", fr: "États-Unis" },
    landmark: { emoji: "🎬", en: "Hollywood Sign", fr: "Panneau Hollywood" },
  };
  const PARIS = {
    kind: "city",
    cc: "FR",
    name: { en: "Paris", fr: "Paris" },
    region: { en: "Île-de-France", fr: "Île-de-France" },
    country: { en: "France", fr: "France" },
    landmark: { emoji: "🗼", en: "Eiffel Tower", fr: "Tour Eiffel" },
  };
  /* a small town/village — dynamically geocoded results never carry a
     curated landmark, kind "village" covers MapTiler's locality/neighbourhood */
  const SMALL_TOWN = {
    kind: "village",
    cc: "IT",
    name: { en: "Positano", fr: "Positano" },
    region: { en: "Campania" },
    country: { en: "Italy" },
  };
  const REGION = {
    kind: "state",
    cc: "US",
    name: { en: "California", fr: "Californie" },
    region: {},
    country: { en: "United States", fr: "États-Unis" },
  };

  it("qualifies a city with its region, country and 'cityscape' — no landmark word", () => {
    expect(pexelsQuery(TARBES)).toBe("Tarbes Occitanie France cityscape");
  });

  it("asks for scenery, not a skyline, for a country — just the country name", () => {
    expect(pexelsQuery(JAPAN)).toBe("Japan landscape travel");
  });

  it("gives two different cities two different queries", () => {
    expect(pexelsQuery(TARBES)).not.toBe(pexelsQuery(TOKYO));
    expect(pexelsQuery(TOKYO)).toBe("Tokyo Kanto Japan cityscape");
  });

  it("never returns a bare place name", () => {
    for (const loc of [TARBES, TOKYO, JAPAN]) {
      expect(pexelsQuery(loc).split(" ").length).toBeGreaterThan(1);
    }
  });

  it("stays in English so the cache is shared between both interfaces", () => {
    const original = state.lang;
    try {
      state.lang = "fr";
      const inFrench = pexelsQuery(TOKYO);
      state.lang = "en";
      expect(pexelsQuery(TOKYO)).toBe(inFrench);
    } finally {
      state.lang = original;
    }
  });

  it("returns an empty query for an unusable location, so no request is made", () => {
    expect(pexelsQuery(null)).toBe("");
    expect(pexelsQuery({ kind: "city", name: {} })).toBe("");
  });

  it("survives a geocoder result with no region or country", () => {
    const sparse = { kind: "city", name: { en: "Springfield" }, region: {}, country: {} };
    expect(pexelsQuery(sparse)).toBe("Springfield cityscape");
  });

  describe("worldwide-city regression: New York, Los Angeles, Paris", () => {
    it("New York — cityscape, never the Statue of Liberty by name or 'landmark'", () => {
      const q = pexelsQuery(NEW_YORK);
      expect(q).toBe("New York New York State United States cityscape");
      expect(q.toLowerCase()).not.toContain("landmark");
      expect(q).not.toContain("Statue of Liberty");
    });

    it("Los Angeles — cityscape, never the Hollywood Sign by name or 'landmark'", () => {
      const q = pexelsQuery(LOS_ANGELES);
      expect(q).toBe("Los Angeles California United States cityscape");
      expect(q.toLowerCase()).not.toContain("landmark");
      expect(q).not.toContain("Hollywood Sign");
    });

    it("Paris — cityscape, never the Eiffel Tower by name or 'landmark'", () => {
      const q = pexelsQuery(PARIS);
      expect(q).toBe("Paris Île-de-France France cityscape");
      expect(q.toLowerCase()).not.toContain("landmark");
      expect(q).not.toContain("Eiffel Tower");
    });
  });

  it("a small town/village asks for streets and architecture, not a skyline or a landmark", () => {
    const q = pexelsQuery(SMALL_TOWN);
    expect(q).toBe("Positano Campania Italy streets architecture");
    expect(q.toLowerCase()).not.toContain("landmark");
  });

  it("a region/state/province is the subject itself, qualified only by its country", () => {
    expect(pexelsQuery(REGION)).toBe("California United States landscape travel");
  });

  it("no query for any kind ever contains the word 'landmark'", () => {
    for (const loc of [TARBES, TOKYO, JAPAN, NEW_YORK, LOS_ANGELES, PARIS, SMALL_TOWN, REGION]) {
      expect(pexelsQuery(loc).toLowerCase()).not.toContain("landmark");
    }
  });
});

/* Oceans and seas (core/coord-location.js + core/marine-regions.js) must
 * search for the body of water itself — never a random nearby city — and
 * must never be mistaken, downstream, for an ordinary place. */
describe("pexelsQuery — oceans and seas", () => {
  const ATLANTIC = { kind: "ocean", name: { en: "Atlantic Ocean", fr: "Océan Atlantique" } };
  const MEDITERRANEAN = {
    kind: "ocean",
    name: { en: "Mediterranean Sea", fr: "Mer Méditerranée" },
  };

  it("searches for the ocean itself, qualified as a seascape, never a city", () => {
    expect(pexelsQuery(ATLANTIC)).toBe("Atlantic Ocean aerial seascape");
    expect(pexelsQuery(ATLANTIC).toLowerCase()).not.toContain("cityscape");
    expect(pexelsQuery(ATLANTIC).toLowerCase()).not.toContain("streets");
  });

  it("does the same for a named sea, not only the ocean basins", () => {
    expect(pexelsQuery(MEDITERRANEAN)).toBe("Mediterranean Sea aerial seascape");
  });

  it("carries no region/country qualifier — an ocean has none", () => {
    const withStrayFields = {
      kind: "ocean",
      name: { en: "Pacific Ocean", fr: "Océan Pacifique" },
      region: { en: "should never appear" },
      country: { en: "should never appear either" },
    };
    const q = pexelsQuery(withStrayFields);
    expect(q).toBe("Pacific Ocean aerial seascape");
    expect(q).not.toContain("should never appear");
  });
});

describe("relevanceKeywords / isRelevantPhoto — reject obviously unrelated results", () => {
  const TARBES = {
    kind: "city",
    name: { en: "Tarbes", fr: "Tarbes" },
    region: { en: "Occitania" },
    country: { en: "France" },
  };
  const JAPAN = { kind: "country", name: { en: "Japan", fr: "Japon" }, region: { en: "Asia" } };
  const ATLANTIC = { kind: "ocean", name: { en: "Atlantic Ocean", fr: "Océan Atlantique" } };

  it("keeps only the identifying words for a city — name, region, country", () => {
    expect(relevanceKeywords(TARBES).sort()).toEqual(["france", "occitania", "tarbes"]);
  });

  it("checks a country against its own name only, not its continent", () => {
    /* "Asia" (the region field) would let almost any Asian photo pass */
    expect(relevanceKeywords(JAPAN)).toEqual(["japan"]);
  });

  it("checks an ocean/sea against its own name only", () => {
    expect(relevanceKeywords(ATLANTIC).sort()).toEqual(["atlantic", "ocean"]);
  });

  it("drops short connector words that prove nothing by themselves", () => {
    const SAN_FRANCISCO = {
      kind: "city",
      name: { en: "San Francisco" },
      region: {},
      country: { en: "United States" },
    };
    const words = relevanceKeywords(SAN_FRANCISCO);
    expect(words).not.toContain("san");
    expect(words).toContain("francisco");
  });

  it("accepts a photo whose alt text names the place", () => {
    const photo = { alt: "Aerial view of Tarbes in the French Pyrenees", photographer: "X" };
    expect(isRelevantPhoto(TARBES, photo)).toBe(true);
  });

  it("accepts a match on region or country alone, not only the exact place name", () => {
    expect(isRelevantPhoto(TARBES, { alt: "Countryside in France", photographer: "X" })).toBe(true);
  });

  it("is accent- and case-insensitive", () => {
    const withAccent = { kind: "city", name: { en: "" }, region: { en: "Occitanie" } };
    expect(isRelevantPhoto(withAccent, { alt: "A village in OCCITANIE", photographer: "" })).toBe(
      true,
    );
  });

  it("rejects a photo that shares nothing with the queried place", () => {
    const photo = { alt: "A cup of coffee on a wooden table", photographer: "Someone Else" };
    expect(isRelevantPhoto(TARBES, photo)).toBe(false);
  });

  it("rejects a mismatched country photo for a country search", () => {
    const wrongCountry = { alt: "Cherry blossoms in South Korea", photographer: "X" };
    expect(isRelevantPhoto(JAPAN, wrongCountry)).toBe(false);
  });

  it("rejects a city photo shown for an ocean/sea search — no false city display", () => {
    const cityPhoto = { alt: "Downtown skyline with skyscrapers at dusk", photographer: "X" };
    expect(isRelevantPhoto(ATLANTIC, cityPhoto)).toBe(false);
  });

  it("accepts a genuine seascape photo for an ocean search", () => {
    const seascape = { alt: "Waves in the Atlantic Ocean at sunset", photographer: "X" };
    expect(isRelevantPhoto(ATLANTIC, seascape)).toBe(true);
  });

  it("never rejects for a location with no usable identifying words", () => {
    expect(isRelevantPhoto({ kind: "city", name: {} }, { alt: "anything at all" })).toBe(true);
  });

  it("never rejects when the photo itself carries no alt/photographer text", () => {
    expect(isRelevantPhoto(TARBES, { alt: "", photographer: "" })).toBe(true);
  });

  it("always rejects a null photo", () => {
    expect(isRelevantPhoto(TARBES, null)).toBe(false);
  });
});

/* "all countries and international locations": every curated country
 * (src/js/data/locations.js) must produce a country-specific query built
 * from its own name, and pass its own relevance check against a photo that
 * plausibly names it — spanning five continents, not just France. */
describe("pexelsQuery / relevanceKeywords — every curated country", () => {
  const countries = LOCATIONS.filter((l) => l.kind === "country");

  it("has more than a single country to actually test generality", () => {
    expect(countries.length).toBeGreaterThanOrEqual(10);
  });

  for (const country of countries) {
    const name = country.name.en;
    it(`${name}: a country-specific query, never another country's name`, () => {
      const q = pexelsQuery(country);
      expect(q.startsWith(name)).toBe(true);
      expect(q).toBe(`${name} landscape travel`);
      for (const other of countries) {
        if (other.id === country.id) continue;
        expect(q).not.toContain(other.name.en);
      }
    });

    it(`${name}: relevance passes for a photo naming the country`, () => {
      expect(isRelevantPhoto(country, { alt: `Scenic view in ${name}`, photographer: "X" })).toBe(
        true,
      );
    });

    it(`${name}: relevance rejects an unrelated country's photo`, () => {
      const impostor = countries.find((c) => c.id !== country.id);
      expect(
        isRelevantPhoto(country, {
          alt: `Famous landmark in ${impostor.name.en}`,
          photographer: "X",
        }),
      ).toBe(false);
    });
  }
});

/* resolveLocationImage/locVisual (photo-api.js) is the SYNCHRONOUS fallback
 * shown before/without a Pexels photo — an ocean/sea must never fall through
 * to the generic "🏙️" cityscape glyph used for an ordinary unknown place. */
describe("resolveLocationImage — ocean/sea fallback glyph", () => {
  it("shows a wave, not the generic city glyph, for an ocean/sea location", () => {
    expect(resolveLocationImage({ kind: "ocean", name: { en: "Atlantic Ocean" } })).toBe("🌊");
  });

  it("still shows the generic city glyph for an ordinary unknown place", () => {
    expect(resolveLocationImage({ kind: "city", name: { en: "Somewhere" } })).toBe("🏙️");
  });
});

/* "Request multiple candidates instead of accepting only the first result":
 * the proxy now answers a query lookup with a `photos` array (see
 * api/pexels.js); fetchPexelsPhotoCandidates reads that array under its own
 * cache, entirely separate from fetchPexelsPhoto's single-photo cache. */
describe("fetchPexelsPhotoCandidates — multi-candidate proxy contract", () => {
  it("maps every entry of the proxy's `photos` array onto the photo shape", async () => {
    const calls = stubFetch(() =>
      jsonResponse(200, {
        photo: { src: { large: "https://images.pexels.com/1.jpg" }, photographer: "A", link: "" },
        photos: [
          {
            src: { large: "https://images.pexels.com/1.jpg" },
            photographer: "A",
            link: "",
            alt: "a",
          },
          {
            src: { large: "https://images.pexels.com/2.jpg" },
            photographer: "B",
            link: "",
            alt: "b",
          },
          {
            src: { large: "https://images.pexels.com/3.jpg" },
            photographer: "C",
            link: "",
            alt: "c",
          },
        ],
      }),
    );

    const candidates = await fetchPexelsPhotoCandidates("Reykjavik Iceland cityscape");

    expect(calls).toHaveLength(1);
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.photographer)).toEqual(["A", "B", "C"]);
  });

  it("falls back to a one-item pool from `photo` when `photos` is absent", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        photo: { src: { large: "https://images.pexels.com/1.jpg" }, photographer: "A", link: "" },
      }),
    );
    const candidates = await fetchPexelsPhotoCandidates("anywhere at all cityscape");
    expect(candidates).toHaveLength(1);
  });

  it("resolves to an empty array (never throws) for every proxy failure mode", async () => {
    for (const [status, body] of [
      [400, { error: "invalid_query" }],
      [429, { error: "rate_limited" }],
      [502, { error: "upstream_error" }],
      [503, { error: "unavailable" }],
    ]) {
      __resetPhotoCacheForTests();
      stubFetch(() => jsonResponse(status, body));
      await expect(fetchPexelsPhotoCandidates("Paris France cityscape")).resolves.toEqual([]);
    }
  });

  it("caches the candidate pool separately from the single-photo cache", async () => {
    const calls = stubFetch(() =>
      jsonResponse(200, {
        photo: null,
        photos: [
          { src: { large: "https://images.pexels.com/1.jpg" }, photographer: "A", link: "" },
        ],
      }),
    );
    await fetchPexelsPhotoCandidates("Lyon France cityscape");
    await fetchPexelsPhotoCandidates("Lyon France cityscape");
    await fetchPexelsPhoto("Lyon France cityscape"); // distinct cache — still a fresh request
    expect(calls).toHaveLength(2);
  });

  it("does not call the proxy for an empty query", async () => {
    const calls = stubFetch(() => jsonResponse(200, { photo: null, photos: [] }));
    await expect(fetchPexelsPhotoCandidates("")).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("rankPexelsCandidates — ranking, not just accepting the first result", () => {
  const TARBES = {
    kind: "city",
    name: { en: "Tarbes" },
    region: { en: "Occitanie" },
    country: { en: "France" },
  };

  it("prefers the candidate whose text names the place itself over one that only matches the region", () => {
    const genericRegion = { src: "r.jpg", alt: "Countryside in Occitanie", photographer: "X" };
    const namesThePlace = {
      src: "p.jpg",
      alt: "Aerial view of Tarbes at sunset",
      photographer: "X",
    };
    const best = rankPexelsCandidates(TARBES, [genericRegion, namesThePlace]);
    expect(best).toBe(namesThePlace);
  });

  it("ignores candidate order — the best match wins even if listed last", () => {
    const weak = { src: "1.jpg", alt: "France countryside", photographer: "X" };
    const strong = { src: "2.jpg", alt: "Tarbes town square, France", photographer: "X" };
    expect(rankPexelsCandidates(TARBES, [weak, strong])).toBe(strong);
    expect(rankPexelsCandidates(TARBES, [strong, weak])).toBe(strong);
  });

  it("never returns a candidate that fails the relevance check, even if it's the only one", () => {
    const unrelated = { src: "x.jpg", alt: "A cup of coffee", photographer: "Nobody" };
    expect(rankPexelsCandidates(TARBES, [unrelated])).toBeNull();
  });

  it("returns null for an empty or missing candidate pool", () => {
    expect(rankPexelsCandidates(TARBES, [])).toBeNull();
    expect(rankPexelsCandidates(TARBES, null)).toBeNull();
    expect(rankPexelsCandidates(TARBES, undefined)).toBeNull();
  });

  it("drops candidates with no usable src before ranking", () => {
    const noSrc = { alt: "Tarbes France", photographer: "X" };
    const withSrc = { src: "ok.jpg", alt: "Tarbes France", photographer: "X" };
    expect(rankPexelsCandidates(TARBES, [noSrc, withSrc])).toBe(withSrc);
  });
});

/* Wikimedia's search targets file titles/categories, not stock-photo copy —
 * no "cityscape"/"landscape travel" suffix (see the doc comment on
 * wikimediaQuery itself), otherwise the same name+region+country shape as
 * pexelsQuery, for the same disambiguation reason. */
describe("wikimediaQuery — Commons-appropriate query construction", () => {
  it("qualifies a city with region and country, no stock-photo suffix", () => {
    const loc = {
      kind: "city",
      name: { en: "Tarbes" },
      region: { en: "Occitanie" },
      country: { en: "France" },
    };
    expect(wikimediaQuery(loc)).toBe("Tarbes Occitanie France");
    expect(wikimediaQuery(loc)).not.toMatch(/cityscape|landscape travel|streets/i);
  });

  it("is just the name for a country", () => {
    expect(wikimediaQuery({ kind: "country", name: { en: "Japan" } })).toBe("Japan");
  });

  it("is just the name for an ocean/sea, never a city-style query", () => {
    expect(wikimediaQuery({ kind: "ocean", name: { en: "Atlantic Ocean" } })).toBe(
      "Atlantic Ocean",
    );
  });

  it("returns an empty string for an unusable location", () => {
    expect(wikimediaQuery(null)).toBe("");
    expect(wikimediaQuery({ kind: "city", name: {} })).toBe("");
  });
});

describe("rankWikimediaCandidates — coordinate trust vs. text relevance", () => {
  const TARBES = {
    kind: "city",
    name: { en: "Tarbes" },
    region: { en: "Occitanie" },
    country: { en: "France" },
  };

  it("trusts a geosearch candidate even when its text doesn't obviously name the place", () => {
    const nearby = {
      src: "x.jpg",
      alt: "Old stone bridge",
      photographer: "X",
      width: 1200,
      height: 800,
    };
    expect(rankWikimediaCandidates(TARBES, [nearby], { trustCoordinates: true })).toBe(nearby);
  });

  it("still applies the relevance filter to a text-search candidate", () => {
    const unrelated = { src: "x.jpg", alt: "A parked bicycle", photographer: "X" };
    expect(rankWikimediaCandidates(TARBES, [unrelated], { trustCoordinates: false })).toBeNull();
  });

  it("prefers a landscape-oriented candidate over a portrait one", () => {
    const portrait = {
      src: "p.jpg",
      alt: "Tarbes France",
      photographer: "X",
      width: 600,
      height: 1200,
    };
    const landscape = {
      src: "l.jpg",
      alt: "Tarbes France",
      photographer: "X",
      width: 1200,
      height: 600,
    };
    expect(rankWikimediaCandidates(TARBES, [portrait, landscape])).toBe(landscape);
  });

  it("returns null for an empty pool", () => {
    expect(rankWikimediaCandidates(TARBES, [])).toBeNull();
  });
});

describe("fetchWikimediaPhoto — geosearch-first, text-search fallback, cached", () => {
  it("tries geosearch first for a granular place with coordinates, and skips text search on a hit", async () => {
    const calls = stubFetch(() =>
      jsonResponse(200, {
        query: {
          pages: [
            {
              title: "File:Tarbes.jpg",
              coordinates: [{ lat: 43.23, lon: 0.08 }],
              imageinfo: [
                {
                  thumburl: "https://upload.wikimedia.org/thumb/tarbes.jpg",
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Tarbes.jpg",
                  extmetadata: {
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                    Artist: { value: "Jane Doe" },
                    ImageDescription: { value: "A square in Tarbes" },
                  },
                },
              ],
            },
          ],
        },
      }),
    );

    const loc = { kind: "city", name: { en: "Tarbes" }, lat: 43.23, lon: 0.08 };
    const photo = await fetchWikimediaPhoto(loc);

    expect(photo).toMatchObject({ source: "wikimedia", photographer: "Jane Doe" });
    expect(calls).toHaveLength(1); // geosearch alone was enough — no text-search fallback fired
    expect(new URL(calls[0].url).searchParams.get("generator")).toBe("geosearch");
  });

  it("falls back to text search when geosearch finds nothing", async () => {
    let call = 0;
    const calls = stubFetch((url) => {
      call++;
      const generator = new URL(url).searchParams.get("generator");
      if (generator === "geosearch") return jsonResponse(200, { query: { pages: [] } }); // empty
      return jsonResponse(200, {
        query: {
          pages: [
            {
              title: "File:Japan.jpg",
              imageinfo: [
                {
                  thumburl: "https://upload.wikimedia.org/thumb/japan.jpg",
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Japan.jpg",
                  extmetadata: {
                    LicenseShortName: { value: "CC0" },
                    Artist: { value: "J. Photographer" },
                    ImageDescription: { value: "A landscape in Japan" },
                  },
                },
              ],
            },
          ],
        },
      });
    });

    const photo = await fetchWikimediaPhoto({ kind: "country", name: { en: "Japan" } });

    expect(photo).toMatchObject({ source: "wikimedia", photographer: "J. Photographer" });
    expect(calls).toHaveLength(1); // country never attempts geosearch at all — straight to text search
    expect(new URL(calls[0].url).searchParams.get("generator")).toBe("search");
    expect(call).toBe(1);
  });

  it("resolves to null (never throws) when both geosearch and text search find nothing", async () => {
    stubFetch(() => jsonResponse(200, { query: { pages: [] } }));
    await expect(
      fetchWikimediaPhoto({ kind: "city", name: { en: "Nowhereville" }, lat: 1, lon: 1 }),
    ).resolves.toBeNull();
  });

  it("resolves to null for an unusable location, without calling fetch", async () => {
    const calls = stubFetch(() => jsonResponse(200, { query: { pages: [] } }));
    await expect(fetchWikimediaPhoto(null)).resolves.toBeNull();
    await expect(fetchWikimediaPhoto({ kind: "city", name: {} })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("caches by location identity so re-selecting the same place doesn't re-query", async () => {
    const calls = stubFetch(() => jsonResponse(200, { query: { pages: [] } }));
    const loc = { kind: "country", name: { en: "Japan" } };
    await fetchWikimediaPhoto(loc);
    await fetchWikimediaPhoto(loc);
    expect(calls).toHaveLength(1);
  });
});

/* "Audit all country codes in the WeatherSphere location and flag data" /
 * "Ensure every country has a valid photo-search strategy" — every code in
 * the flag manifest (public/assets/flags/countries/, see
 * data/country-flag-codes.js) must, once turned into a country-shaped
 * location, produce a valid, non-empty, well-formed query for BOTH sources
 * and never crash — the generic name+kind pipeline needs no per-country
 * lookup table to cover the ~250 entries in that set. */
describe("global country coverage — every flag-data country code has a valid photo-search path", () => {
  it("covers a substantial, real set of country/territory codes", () => {
    expect(COUNTRY_FLAG_CODES.size).toBeGreaterThan(200);
  });

  for (const code of COUNTRY_FLAG_CODES) {
    it(`${code}: produces a valid Pexels and Wikimedia query, never throws`, () => {
      const loc = {
        kind: "country",
        cc: code.toUpperCase(),
        name: { en: code.toUpperCase(), fr: code.toUpperCase() },
        region: { en: "" },
        country: { en: code.toUpperCase() },
      };
      const pQuery = pexelsQuery(loc);
      const wQuery = wikimediaQuery(loc);
      expect(pQuery.length).toBeGreaterThan(0);
      expect(wQuery.length).toBeGreaterThan(0);
      expect(pQuery.startsWith(code.toUpperCase())).toBe(true);
      expect(wQuery).toBe(code.toUpperCase());
      /* relevance/ranking must never throw for any of these either */
      expect(() => relevanceKeywords(loc)).not.toThrow();
      expect(() => isRelevantPhoto(loc, { alt: "", photographer: "" })).not.toThrow();
    });
  }
});

describe("server proxies agree on the multi-candidate contract", () => {
  const read = (relPath) => readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");

  it("api/pexels.js requests more than one candidate and returns a `photos` array", () => {
    const src = read("../../../api/pexels.js");
    expect(src).toMatch(/CANDIDATE_COUNT\s*=\s*8/);
    expect(src).toMatch(/\{\s*photo:\s*photos\[0\]\s*\|\|\s*null,\s*photos\s*\}/);
  });

  it("vite.config.js's dev proxy mirrors the same candidate count and `photos` field", () => {
    const src = read("../../../vite.config.js");
    expect(src).toMatch(/CANDIDATE_COUNT\s*=\s*8/);
    expect(src).toMatch(/\{\s*photo:\s*photos\[0\]\s*\|\|\s*null,\s*photos\s*\}/);
  });

  it("public/api/pexels.php mirrors the same candidate count and `photos` field", () => {
    const src = read("../../../public/api/pexels.php");
    expect(src).toMatch(/CANDIDATE_COUNT\s*=\s*8/);
    expect(src).toMatch(/'photos'\s*=>\s*\$photos/);
  });
});

/* Static-config check, not a runtime one: no Apache runs in CI, so this can't
   exercise mod_rewrite itself. It guards the contract instead — the frontend
   hardcodes PROXY_PATH ("api/pexels") for every deploy target, so the
   Hostinger/Apache file (public/api/pexels.php) is unreachable at that URL
   unless .htaccess rewrites one to the other. Whoever next edits either side
   of that rewrite gets a failing test instead of a silent 404 in production. */
describe(".htaccess — Hostinger rewrite from the browser route to the PHP file", () => {
  const htaccessPath = fileURLToPath(new URL("../../../public/.htaccess", import.meta.url));
  const htaccess = readFileSync(htaccessPath, "utf8");

  it("rewrites the extensionless browser route to the PHP file", () => {
    expect(htaccess).toMatch(/RewriteRule\s+\^api\/pexels\$\s+api\/pexels\.php\s+\[L\]/);
  });

  /* The Google Places proxy uses the identical arrangement — one browser
     route (GOOGLE_PLACES_PROXY_URL), three server implementations — so it
     needs its own rewrite or the Hostinger deploy 404s on every photo. */
  it("rewrites the Google Places route to its PHP file too", () => {
    expect(htaccess).toMatch(/RewriteRule\s+\^api\/places\$\s+api\/places\.php\s+\[L\]/);
  });

  it("rewrites the Mapillary route to its PHP file too", () => {
    expect(htaccess).toMatch(/RewriteRule\s+\^api\/mapillary\$\s+api\/mapillary\.php\s+\[L\]/);
  });

  it("guards the rules with mod_rewrite so a host without it doesn't 500", () => {
    const guarded =
      /<IfModule mod_rewrite\.c>[\s\S]*?RewriteRule\s+\^api\/pexels\$[\s\S]*?RewriteRule\s+\^api\/places\$[\s\S]*?RewriteRule\s+\^api\/mapillary\$[\s\S]*?<\/IfModule>/;
    expect(htaccess).toMatch(guarded);
  });

  /* Every rule must be fully anchored to one exact route. A count assertion
     would only have to be raised each time a proxy is added; what actually
     matters is that no rule can ever claim a path it wasn't written for. */
  it("scopes every rule to one exact route — no broader catch-all", () => {
    const rewriteLines = htaccess.split("\n").filter((l) => /^\s*RewriteRule/.test(l));
    expect(rewriteLines.length).toBeGreaterThan(0);
    for (const line of rewriteLines) {
      expect(line).toMatch(/RewriteRule\s+\^api\/[a-z]+\$\s+api\/[a-z]+\.php\s+\[L\]/);
    }
    expect(rewriteLines.some((l) => l.includes("^api/pexels$"))).toBe(true);
    expect(rewriteLines.some((l) => l.includes("^api/places$"))).toBe(true);
  });
});

/* ── Fallback chain, ranking and the area fallback ────────────────────────
   The order the whole feature turns on (see fetchBestPhoto):
     1. curated exact image        (hydrateLocPhoto, before the chain)
     2. Google Places              — the place entity's own photo
     3. verified Commons geosearch — coordinate-accurate
     3b. verified Commons text     — encyclopaedic place naming
     3c. verified Pexels           — attractive and representative
     3b. Commons text search       — exact geography Pexels often lacks
     4. verified region → country  — labelled honestly as the AREA's photo
     5. gradient/emoji             — represented here by a null return */

/* A Commons page in the shape toCandidate() accepts: open license, named
   artist, https description page, real thumbnail. */
function commonsPage(title, { lat = null, lon = null, description = "" } = {}) {
  return {
    title: `File:${title}.jpg`,
    imageinfo: [
      {
        thumburl: `https://upload.wikimedia.org/${encodeURIComponent(title)}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.jpg`,
        thumbwidth: 1280,
        thumbheight: 850,
        extmetadata: {
          LicenseShortName: { value: "CC BY-SA 4.0" },
          Artist: { value: "A Photographer" },
          ImageDescription: { value: description || title },
        },
      },
    ],
    coordinates: lat === null ? undefined : [{ lat, lon }],
  };
}

const pexelsPhoto = (alt, extra = {}) => ({
  alt,
  photographer: "P. Shooter",
  url: "https://www.pexels.com/photo/x-1",
  width: 1600,
  height: 900,
  src: { medium: "https://images.pexels.com/m.jpg", large: "https://images.pexels.com/l.jpg" },
  ...extra,
});

/* The AREA query is the region/country template ("<Area> <country> landscape
   travel"); a town's own query legitimately contains its region name too
   ("Tarbes Occitania France streets architecture"), so matching on the region
   word alone would make the town's own request look like the area's. */
const isAreaQuery = (q) => q.startsWith("Occitania") || q.startsWith("France");
const isAreaCall = (c) =>
  c.url.includes(PROXY_PATH) &&
  isAreaQuery(new URL(c.url, "http://local").searchParams.get("query") || "");

/* Routes one stubbed fetch per provider, so a test states what each source
   answers instead of matching URLs by hand. "fail" = a 500 from that source.

   `places` is the Google candidate list. It defaults to EMPTY, which is what
   keeps every pre-existing test in this file describing the same behaviour it
   always did: with no Google answer the chain starts, as before, at the
   Commons geosearch. */
function stubProviders({
  pexels = [],
  geo = [],
  text = [],
  areaPexels = null,
  places = [],
  mapillary = [],
} = {}) {
  return stubFetch((url) => {
    if (url.includes(MAPILLARY_PATH)) {
      if (mapillary === "fail") return jsonResponse(500, {});
      return jsonResponse(200, { images: mapillary });
    }
    if (url.includes(PLACES_PATH)) {
      if (places === "fail") return jsonResponse(500, {});
      const params = new URL(url, "http://local").searchParams;
      /* Two operations on one route: resolve a chosen photo reference to its
         signed URI, or search for candidates. See api/places.js. */
      if (params.get("photo")) {
        return jsonResponse(200, {
          photo: { src: `https://lh3.googleusercontent.com/${GOOGLE_PHOTO_ID}`, width: 1280 },
        });
      }
      return jsonResponse(200, { places });
    }
    if (url.includes(PROXY_PATH)) {
      const query = new URL(url, "http://local").searchParams.get("query") || "";
      if (areaPexels && areaPexels.match(query)) {
        return jsonResponse(200, { photos: areaPexels.photos });
      }
      if (areaPexels) return jsonResponse(200, { photos: [] });
      if (pexels === "fail") return jsonResponse(500, {});
      return jsonResponse(200, { photos: pexels });
    }
    const generator = new URL(url).searchParams.get("generator");
    const pages = generator === "geosearch" ? geo : text;
    if (pages === "fail") return jsonResponse(500, {});
    return jsonResponse(200, { query: { pages } });
  });
}

const town = (over = {}) => ({
  id: "mt-tarbes",
  kind: "town",
  cc: "FR",
  lat: 43.2333,
  lon: 0.0782,
  name: { en: "Tarbes", fr: "Tarbes" },
  region: { en: "Occitania", fr: "Occitanie" },
  country: { en: "France", fr: "France" },
  aliases: [],
  landmark: null,
  ...over,
});

describe("fetchBestPhoto — fallback order", () => {
  /* The required order, top to bottom:
       1. curated exact image   (hydrateLocPhoto, before this is called)
       2. Google Places         — the place ENTITY's own photo
       3. Commons geosearch     — coordinate-verified
       4. Commons text search   — encyclopaedic naming
       5. Pexels                — ranked stock candidates
       6. region/country area photo, honestly labelled
       7. null → the gradient/emoji fallback                             */

  it("prefers a Google Places photo over every other provider", async () => {
    const calls = stubProviders({
      places: [googlePlace()],
      geo: [commonsPage("Tarbes cathedral", { lat: 43.2333, lon: 0.0782 })],
      text: [commonsPage("Tarbes Occitanie")],
      pexels: [pexelsPhoto("Tarbes town centre")],
    });
    const photo = await fetchBestPhoto(town());
    expect(photo.source).toBe("google");
    expect(photo.src).toContain(GOOGLE_PHOTO_ID);
    /* Nothing below Google is even asked once it has answered. */
    expect(calls.some((c) => c.url.includes(PROXY_PATH))).toBe(false);
    expect(calls.some((c) => c.url.includes("commons.wikimedia.org"))).toBe(false);
  });

  it("falls through to a coordinate-verified Commons geosearch when Google has nothing", async () => {
    const calls = stubProviders({
      places: [],
      pexels: [pexelsPhoto("Tarbes town centre")],
      geo: [commonsPage("Tarbes cathedral", { lat: 43.2333, lon: 0.0782 })],
    });
    const photo = await fetchBestPhoto(town());
    expect(photo.source).toBe("wikimedia");
    /* Pexels is never even asked — geosearch already answered accurately */
    expect(calls.some((c) => c.url.includes(PROXY_PATH))).toBe(false);
  });

  it("falls through to a Commons text search when geosearch finds nothing", async () => {
    const calls = stubProviders({
      pexels: [pexelsPhoto("Tarbes Occitanie rooftops")],
      geo: [],
      text: [commonsPage("Tarbes Occitanie")],
    });
    expect((await fetchBestPhoto(town())).source).toBe("wikimedia");
    /* Commons names places; a stock caption names a mood. Pexels stays last. */
    expect(calls.some((c) => c.url.includes(PROXY_PATH))).toBe(false);
  });

  it("falls through to Pexels only when both Commons legs are empty", async () => {
    stubProviders({ pexels: [pexelsPhoto("Tarbes Occitanie rooftops")], geo: [], text: [] });
    const photo = await fetchBestPhoto(town());
    expect(photo.source).toBeUndefined();
    expect(photo.alt).toBe("Tarbes Occitanie rooftops");
  });

  it("returns null when every provider answers empty, so the gradient stays", async () => {
    stubProviders({ places: [], pexels: [], geo: [], text: [] });
    expect(await fetchBestPhoto(town())).toBeNull();
  });

  it("survives every provider failing outright", async () => {
    stubProviders({ places: "fail", pexels: "fail", geo: "fail", text: "fail" });
    expect(await fetchBestPhoto(town())).toBeNull();
  });

  /* Provider 4. Ahead of the Commons TEXT search and Pexels because it can
     PROVE where the frame was taken, which neither of those can. */
  it("falls through to Mapillary when both Google and Commons geosearch are empty", async () => {
    const calls = stubProviders({
      places: [],
      geo: [],
      mapillary: [mapillaryImage()],
      text: [commonsPage("Tarbes Occitanie")],
      pexels: [pexelsPhoto("Tarbes rooftops")],
    });
    const photo = await fetchBestPhoto(town());
    expect(photo.source).toBe("mapillary");
    /* Nothing below Mapillary is asked once it has answered. */
    expect(calls.some((c) => c.url.includes(PROXY_PATH))).toBe(false);
  });

  it("labels every Mapillary result as nearby, never as the place itself", async () => {
    stubProviders({ places: [], geo: [], mapillary: [mapillaryImage()] });
    expect((await fetchBestPhoto(town())).provenance).toBe("nearby");
  });

  it("carries the CC BY-SA licence through, which its terms require", async () => {
    stubProviders({ places: [], geo: [], mapillary: [mapillaryImage()] });
    expect((await fetchBestPhoto(town())).license).toBe("CC BY-SA 4.0");
  });

  it("keeps Commons geosearch ahead of Mapillary", async () => {
    stubProviders({
      places: [],
      geo: [commonsPage("Tarbes cathedral", { lat: 43.2333, lon: 0.0782 })],
      mapillary: [mapillaryImage()],
    });
    expect((await fetchBestPhoto(town())).source).toBe("wikimedia");
  });

  it("falls past Mapillary to the Commons text search when nothing is geotagged", async () => {
    stubProviders({
      places: [],
      geo: [],
      mapillary: [],
      text: [commonsPage("Tarbes Occitanie")],
    });
    expect((await fetchBestPhoto(town())).source).toBe("wikimedia");
  });

  it("never asks Mapillary for a region or a country — one street says nothing", async () => {
    const calls = stubProviders({ places: [], geo: [], mapillary: [mapillaryImage()], text: [] });
    const region = {
      id: "r-occitanie",
      kind: "region",
      lat: 43.6,
      lon: 1.44,
      name: { en: "Occitania", fr: "Occitanie" },
      region: {},
      country: { en: "France", fr: "France" },
      aliases: [],
    };
    await fetchBestPhoto(region);
    expect(calls.some((c) => c.url.includes(MAPILLARY_PATH))).toBe(false);
  });

  it("survives Mapillary failing outright", async () => {
    stubProviders({ places: [], geo: [], mapillary: "fail", text: [], pexels: [] });
    expect(await fetchBestPhoto(town())).toBeNull();
  });

  /* Google has no ocean or sea entity, so asking would return a coastal
     business — the "a result exists, so display it" failure the whole chain
     exists to avoid. */
  it("never asks Google for an ocean or a sea", async () => {
    const calls = stubProviders({
      places: [googlePlace()],
      geo: [commonsPage("Atlantic swell", { lat: 33.2, lon: -41.5 })],
    });
    const sea = {
      id: "coord-33.2--41.5",
      kind: "ocean",
      waterKind: "ocean",
      lat: 33.2,
      lon: -41.5,
      name: { en: "Atlantic Ocean", fr: "Océan Atlantique" },
      region: {},
      country: {},
      aliases: [],
    };
    const photo = await fetchBestPhoto(sea);
    expect(photo.source).toBe("wikimedia");
    expect(calls.some((c) => c.url.includes(PLACES_PATH))).toBe(false);
  });
});

describe("area fallback — an honest region/country image for a small town", () => {
  it("labels a region photo as the region's, never the town's", async () => {
    stubProviders({
      geo: [],
      text: [],
      areaPexels: { match: isAreaQuery, photos: [pexelsPhoto("Occitania countryside")] },
    });
    const photo = await fetchBestPhoto(town());
    expect(photo).toBeTruthy();
    expect(photo.approximate).toBe(true);
    expect(photo.approximateOf).toBe("Occitania");
  });

  it("offers region before country, and nothing for a country, region or sea", () => {
    expect(areaFallbackTargets(town()).map((a) => a.name)).toEqual(["Occitania", "France"]);
    expect(areaFallbackTargets({ kind: "country", name: { en: "France" } })).toEqual([]);
    expect(areaFallbackTargets({ kind: "region", name: { en: "Occitania" } })).toEqual([]);
    expect(
      areaFallbackTargets({ kind: "ocean", waterKind: "sea", name: { en: "Mediterranean Sea" } }),
    ).toEqual([]);
  });

  it("shares one area lookup across towns in the same region", async () => {
    const calls = stubProviders({
      geo: [],
      text: [],
      areaPexels: { match: isAreaQuery, photos: [pexelsPhoto("Occitania hills")] },
    });
    await fetchBestPhoto(town());
    const afterFirst = calls.filter((c) => isAreaCall(c)).length;
    expect(afterFirst).toBeGreaterThan(0);
    await fetchBestPhoto(town({ id: "b", lat: 43.6, lon: 1.44, name: { en: "Auch", fr: "Auch" } }));
    /* the second town reuses the cached Occitania photo — no second request */
    expect(calls.filter((c) => isAreaCall(c)).length).toBe(afterFirst);
  });

  it("does not mutate the shared cached area photo when labelling it", async () => {
    stubProviders({
      geo: [],
      text: [],
      areaPexels: { match: isAreaQuery, photos: [pexelsPhoto("Occitania hills")] },
    });
    const a = await fetchBestPhoto(town());
    const b = await fetchBestPhoto(town({ id: "b", name: { en: "Auch", fr: "Auch" } }));
    expect(a.approximateOf).toBe("Occitania");
    expect(b.approximateOf).toBe("Occitania");
    expect(a).not.toBe(b); /* each caller gets its own labelled copy */
  });
});

describe("rejecting photos that clearly show somewhere else", () => {
  it("rejects a famous landmark belonging to another city", () => {
    expect(isRelevantPhoto(town(), pexelsPhoto("The Eiffel Tower in Paris at dusk"))).toBe(false);
    expect(isRelevantPhoto(town(), pexelsPhoto("Golden Gate Bridge, San Francisco"))).toBe(false);
  });

  it("keeps a photo that names the place itself, even beside another place", () => {
    expect(isRelevantPhoto(town(), pexelsPhoto("Tarbes seen from the Paris road"))).toBe(true);
  });

  it("keeps a curated location's own landmark photo", () => {
    const paris = LOCATIONS.find((l) => l.id === "paris");
    expect(isRelevantPhoto(paris, pexelsPhoto("The Eiffel Tower in Paris at dusk"))).toBe(true);
  });

  it("never treats an ordinary unknown town as a conflict", () => {
    expect(isRelevantPhoto(town(), pexelsPhoto("A quiet street in Tarbes"))).toBe(true);
    expect(isRelevantPhoto(town(), pexelsPhoto("Rolling hills in Occitania"))).toBe(true);
  });
});

describe("worldwide coverage — a representative place per continent", () => {
  const places = [
    ["France", { kind: "city", name: { en: "Paris" }, country: { en: "France" } }, "Paris"],
    [
      "United States",
      {
        kind: "city",
        name: { en: "Austin" },
        region: { en: "Texas" },
        country: { en: "United States" },
      },
      "Austin",
    ],
    [
      "Canada",
      {
        kind: "city",
        name: { en: "Montreal" },
        region: { en: "Quebec" },
        country: { en: "Canada" },
      },
      "Montreal",
    ],
    ["Japan", { kind: "city", name: { en: "Kyoto" }, country: { en: "Japan" } }, "Kyoto"],
    ["Australia", { kind: "city", name: { en: "Perth" }, country: { en: "Australia" } }, "Perth"],
    ["Brazil", { kind: "city", name: { en: "Recife" }, country: { en: "Brazil" } }, "Recife"],
    ["India", { kind: "city", name: { en: "Jaipur" }, country: { en: "India" } }, "Jaipur"],
  ];

  for (const [label, loc, expected] of places) {
    it(`builds a qualified query naming the place for ${label}`, () => {
      const q = pexelsQuery({ aliases: [], landmark: null, region: {}, country: {}, ...loc });
      expect(q).toContain(expected);
      expect(q.trim()).not.toBe("");
    });
  }

  it("accepts a correctly-named photo and rejects a wrong-city one for each", () => {
    for (const [, loc, expected] of places) {
      const full = { aliases: [], landmark: null, region: {}, country: {}, ...loc };
      expect(isRelevantPhoto(full, pexelsPhoto(`A view of ${expected}`))).toBe(true);
      expect(isRelevantPhoto(full, pexelsPhoto("The Eiffel Tower in Paris"))).toBe(
        expected === "Paris",
      );
    }
  });
});

describe("oceans and seas", () => {
  const sea = (name, waterKind) => ({
    id: `map-sea-${name}`,
    kind: "ocean",
    waterKind,
    lat: 36,
    lon: 15,
    name: { en: name, fr: name },
    region: { en: "", fr: "" },
    country: { en: "", fr: "" },
    aliases: [],
    landmark: null,
  });

  it("searches for the body of water itself, with marine phrasing", () => {
    expect(pexelsQuery(sea("Pacific Ocean", "ocean"))).toBe("Pacific Ocean aerial seascape");
    expect(pexelsQuery(sea("Mediterranean Sea", "sea"))).toBe("Mediterranean Sea aerial seascape");
    expect(pexelsQuery(sea("Gulf of Mexico", "gulf"))).toBe("Gulf of Mexico coast seascape");
  });

  it("uses a coordinate-verified Commons result for a sea when one exists", async () => {
    stubProviders({ geo: [commonsPage("Mediterranean Sea coast", { lat: 36, lon: 15 })] });
    expect((await fetchBestPhoto(sea("Mediterranean Sea", "sea"))).source).toBe("wikimedia");
  });

  it("never falls back to a region or country image for open water", () => {
    expect(areaFallbackTargets(sea("Pacific Ocean", "ocean"))).toEqual([]);
  });
});

describe("caching and stale-request protection", () => {
  it("serves a repeated lookup from cache without a second request", async () => {
    const calls = stubProviders({ pexels: [pexelsPhoto("Tarbes rooftops")], geo: [] });
    await fetchBestPhoto(town());
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    await fetchBestPhoto(town());
    expect(calls.length).toBe(first);
  });

  it("negative-caches an empty result so a dead query is not retried", async () => {
    const calls = stubProviders({ pexels: [], geo: [], text: [] });
    await fetchBestPhoto(town());
    const first = calls.length;
    await fetchBestPhoto(town());
    expect(calls.length).toBe(first);
  });

  /* The DOM half of stale protection (hydrateLocPhoto's photoToken guard,
     which suppresses a superseded swap) needs a real document and is covered
     in e2e/location-photos.spec.js — the unit environment is "node". What is
     testable here is the half underneath it: two locations resolved back to
     back must never receive each other's photo, whatever order they land in. */
  it("keeps rapid lookups for different locations separate", async () => {
    stubFetch((url) => {
      if (url.includes(PROXY_PATH)) {
        const q = new URL(url, "http://local").searchParams.get("query") || "";
        const who = q.includes("Tarbes") ? "Tarbes" : q.includes("Auch") ? "Auch" : "";
        return jsonResponse(200, { photos: who ? [pexelsPhoto(`${who} rooftops`)] : [] });
      }
      return jsonResponse(200, { query: { pages: [] } });
    });
    const [a, b] = await Promise.all([
      fetchBestPhoto(town()),
      fetchBestPhoto(town({ id: "b", lat: 43.6, lon: 0.58, name: { en: "Auch", fr: "Auch" } })),
    ]);
    expect(a.alt).toBe("Tarbes rooftops");
    expect(b.alt).toBe("Auch rooftops");
  });

  it("exposes the token the render layer uses to discard a superseded swap", () => {
    expect(typeof bumpPhotoToken).toBe("function");
    expect(() => bumpPhotoToken()).not.toThrow();
  });
});

describe("landmark evidence in the relevance filter", () => {
  const sf = LOCATIONS.find((l) => l.id === "sanfrancisco");

  it("accepts a photo of the place's own curated landmark that never names the city", () => {
    /* A genuine Golden Gate Bridge photo IS a photo of San Francisco; before
       landmark words were included it was filtered out for not spelling the
       city's name, and the hero fell back to the gradient. */
    expect(sf).toBeTruthy();
    expect(relevanceKeywords(sf)).toContain("golden");
    expect(isRelevantPhoto(sf, pexelsPhoto("The Golden Gate at dawn"))).toBe(true);
  });

  it("still rejects another city's landmark", () => {
    expect(isRelevantPhoto(sf, pexelsPhoto("The Eiffel Tower in Paris"))).toBe(false);
  });

  it("adds nothing for a location with no curated landmark", () => {
    expect(relevanceKeywords(town())).toEqual(
      expect.arrayContaining(["tarbes", "occitania", "france"]),
    );
  });
});
