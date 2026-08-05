/* Contract tests for the Pexels photo service.
 *
 * These exercise the browser side of the SAME-ORIGIN PROXY contract — the
 * frontend must never talk to api.pexels.com directly, and must degrade to "no
 * photo" for every failure mode the proxy can report. `fetch` is stubbed, so
 * nothing here touches the network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchPexelsPhoto, pexelsQuery, __resetPhotoCacheForTests } from "./photo-api.js";
import { state } from "../core/state.js";

const PROXY_PATH = "api/pexels.php";

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
