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
  __resetPhotoCacheForTests,
} from "./photo-api.js";
import { state } from "../core/state.js";
import { LOCATIONS } from "../data/locations.js";
import { COUNTRY_FLAG_CODES } from "../data/country-flag-codes.js";

const PROXY_PATH = "api/pexels";

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

  it("guards the rule with mod_rewrite so a host without it doesn't 500", () => {
    const guarded =
      /<IfModule mod_rewrite\.c>[\s\S]*?RewriteRule\s+\^api\/pexels\$[\s\S]*?<\/IfModule>/;
    expect(htaccess).toMatch(guarded);
  });

  it("scopes the rule to exactly api/pexels — no broader catch-all", () => {
    const rewriteLines = htaccess.split("\n").filter((l) => /^\s*RewriteRule/.test(l));
    expect(rewriteLines).toHaveLength(1);
    expect(rewriteLines[0]).toContain("^api/pexels$");
  });
});
