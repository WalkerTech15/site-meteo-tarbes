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

    const photo = await fetchPexelsPhoto("Paris France landmark");

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

    await fetchPexelsPhoto("Paris France landmark");

    const { url, init } = calls[0];
    expect(url).toContain(PROXY_PATH);
    expect(url).not.toContain("api.pexels.com");
    expect(url).toContain("query=Paris%20France%20landmark"); // encoded, single param
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
      await expect(fetchPexelsPhoto("Paris France landmark")).resolves.toBeNull();
    });
  }

  it("6c. a network failure or timeout resolves to null", async () => {
    stubFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(fetchPexelsPhoto("Paris France landmark")).resolves.toBeNull();
  });

  it("applies a request timeout so a hanging proxy cannot freeze the UI", async () => {
    const calls = stubFetch(() => jsonResponse(200, { photo: null }));
    await fetchPexelsPhoto("Paris France landmark");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("negative-caches a failure so a broken proxy is asked only once per query", async () => {
    const calls = stubFetch(() => jsonResponse(503, { error: "unavailable" }));

    await fetchPexelsPhoto("Paris France landmark");
    await fetchPexelsPhoto("Paris France landmark");

    expect(calls).toHaveLength(1);
  });

  it("caches a successful lookup per query", async () => {
    const calls = stubFetch(() =>
      jsonResponse(200, {
        photo: { src: { large: "https://images.pexels.com/l.jpg" }, photographer: "A", link: "" },
      }),
    );

    const first = await fetchPexelsPhoto("Paris France landmark");
    const second = await fetchPexelsPhoto("Paris France landmark");
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
      fetchPexelsPhoto("Paris Île-de-France France city skyline landmark"),
      fetchPexelsPhoto("Paris Île-de-France France city skyline landmark"),
      fetchPexelsPhoto("Paris Île-de-France France city skyline landmark"),
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
    await fetchPexelsPhoto("Lyon Auvergne-Rhône-Alpes France city skyline landmark");
    await fetchPexelsPhoto("Nice Provence France city skyline landmark");
    expect(calls).toHaveLength(2); // two distinct queries, neither stuck pending
  });
});

/* An image search on a bare city name is ambiguous — "Paris" is as likely to
   return Paris, Texas, and "Tarbes" returns nothing recognisable at all. */
describe("pexelsQuery — precise, unambiguous queries", () => {
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

  it("qualifies a city with its region, country and the imagery wanted", () => {
    expect(pexelsQuery(TARBES)).toBe("Tarbes Occitanie France city skyline landmark");
  });

  it("asks for scenery, not a skyline, for a country — and never repeats it", () => {
    expect(pexelsQuery(JAPAN)).toBe("Japan Asia landscape travel");
  });

  it("gives two different cities two different queries", () => {
    expect(pexelsQuery(TARBES)).not.toBe(pexelsQuery(TOKYO));
    expect(pexelsQuery(TOKYO)).toBe("Tokyo Kanto Japan city skyline landmark");
  });

  it("never returns a bare place name", () => {
    for (const loc of [TARBES, TOKYO, JAPAN]) {
      expect(pexelsQuery(loc).split(" ").length).toBeGreaterThan(2);
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
    expect(pexelsQuery(sparse)).toBe("Springfield city skyline landmark");
  });
});
