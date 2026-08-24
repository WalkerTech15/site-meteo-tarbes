/* Contract tests for the Vercel serverless Pexels proxy (api/pexels.js).
 *
 * This is outside src/ (Vercel requires /api at the repo root) but is
 * imported here by relative path so it runs under the same Vitest suite as
 * everything else — see vite.config.js test.include. `fetch` is stubbed, so
 * nothing here touches the network or requires `vercel dev`. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import handler from "../../../api/pexels.js";

function fakeReq(method, query) {
  return { method, query };
}

function fakeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
  };
  return res;
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let originalFetch;
let originalKey;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalKey = process.env.PEXELS_API_KEY;
  process.env.PEXELS_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.PEXELS_API_KEY = originalKey;
  vi.restoreAllMocks();
});

describe("api/pexels.js — method and routing", () => {
  it("rejects non-GET with 405 and an Allow header", async () => {
    const res = fakeRes();
    await handler(fakeReq("POST", {}), res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "method_not_allowed" });
    expect(res.headers.Allow).toBe("GET");
  });
});

describe("api/pexels.js — id= (curated exact-photo lookup)", () => {
  const validPexelsPhoto = () => ({
    src: {
      medium: "https://images.pexels.com/m.jpg",
      large: "https://images.pexels.com/l.jpg",
      large2x: "https://images.pexels.com/l2x.jpg",
    },
    photographer: "Rafal Maciejski",
    url: "https://www.pexels.com/photo/hollywood-sign-on-hill-5688653/",
    alt: "Hollywood Sign on a hillside",
  });

  it("400s an id that isn't a plain positive integer", async () => {
    for (const bad of ["0", "-5", "abc", "12.5", "5688653x", "1e10", "9".repeat(20)]) {
      const res = fakeRes();
      await handler(fakeReq("GET", { id: bad }), res);
      expect(res.statusCode, `id=${bad}`).toBe(400);
      expect(res.body).toEqual({ error: "invalid_id" });
    }
  });

  it("503s when no server key is configured, before ever calling fetch", async () => {
    delete process.env.PEXELS_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const res = fakeRes();
    await handler(fakeReq("GET", { id: "5688653" }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "unavailable" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches the exact photo by ID and re-projects only the fields the browser needs", async () => {
    const fetchSpy = vi.fn(async (url, init) => {
      expect(url).toBe("https://api.pexels.com/v1/photos/5688653");
      expect(init.headers.Authorization).toBe("test-key");
      return jsonResponse(200, validPexelsPhoto());
    });
    globalThis.fetch = fetchSpy;

    const res = fakeRes();
    await handler(fakeReq("GET", { id: "5688653" }), res);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      photo: {
        src: {
          medium: "https://images.pexels.com/m.jpg",
          large: "https://images.pexels.com/l.jpg",
          large2x: "https://images.pexels.com/l2x.jpg",
        },
        photographer: "Rafal Maciejski",
        link: "https://www.pexels.com/photo/hollywood-sign-on-hill-5688653/",
        alt: "Hollywood Sign on a hillside",
      },
    });
    /* the raw Pexels API key must never leak into the response body */
    expect(JSON.stringify(res.body)).not.toContain("test-key");
  });

  it("200s {photo:null} when Pexels answers with no usable large size", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { src: {}, photographer: "X" }));
    const res = fakeRes();
    await handler(fakeReq("GET", { id: "5688653" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ photo: null });
  });

  it("404s not_found when the reviewed photo id no longer exists upstream", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(404, {}));
    const res = fakeRes();
    await handler(fakeReq("GET", { id: "5688653" }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("429s rate_limited when Pexels rate-limits the request", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(429, {}));
    const res = fakeRes();
    await handler(fakeReq("GET", { id: "5688653" }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
  });

  it("502s upstream_error on any other non-ok status or a thrown network error", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(500, {}));
    const res1 = fakeRes();
    await handler(fakeReq("GET", { id: "5688653" }), res1);
    expect(res1.statusCode).toBe(502);
    expect(res1.body).toEqual({ error: "upstream_error" });

    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const res2 = fakeRes();
    await handler(fakeReq("GET", { id: "5688653" }), res2);
    expect(res2.statusCode).toBe(502);
    expect(res2.body).toEqual({ error: "upstream_error" });
  });

  it("never reaches the search branch when id is present, even alongside a query", async () => {
    const fetchSpy = vi.fn(async (url) => {
      expect(url).toContain("/v1/photos/5688653");
      return jsonResponse(200, validPexelsPhoto());
    });
    globalThis.fetch = fetchSpy;
    const res = fakeRes();
    await handler(fakeReq("GET", { id: "5688653", query: "hollywood sign los angeles" }), res);
    expect(res.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/* Regression coverage: the pre-existing search branch (unknown/user-searched
   locations) must behave exactly as it did before the id= branch was added. */
describe("api/pexels.js — query= (generic search, unchanged behavior)", () => {
  it("400s a query shorter than 2 or longer than 120 characters", async () => {
    for (const bad of ["a", "x".repeat(121)]) {
      const res = fakeRes();
      await handler(fakeReq("GET", { query: bad }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "invalid_query" });
    }
  });

  it("503s when no server key is configured", async () => {
    delete process.env.PEXELS_API_KEY;
    const res = fakeRes();
    await handler(fakeReq("GET", { query: "Tarbes Occitanie France cityscape" }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "unavailable" });
  });

  it("searches Pexels and re-projects the top result", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      expect(url).toContain("https://api.pexels.com/v1/search?");
      expect(url).toContain("query=Tarbes");
      return jsonResponse(200, {
        photos: [
          {
            src: {
              medium: "https://images.pexels.com/m.jpg",
              large: "https://images.pexels.com/l.jpg",
            },
            photographer: "Ada Lovelace",
            url: "https://www.pexels.com/photo/test-1/",
            alt: "A city at dusk",
          },
        ],
      });
    });

    const res = fakeRes();
    await handler(fakeReq("GET", { query: "Tarbes Occitanie France cityscape" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.photo.photographer).toBe("Ada Lovelace");
  });

  it("200s {photo:null} when the search has no results", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { photos: [] }));
    const res = fakeRes();
    await handler(fakeReq("GET", { query: "nowhere at all" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ photo: null });
  });

  it("429s rate_limited when Pexels rate-limits the request", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(429, {}));
    const res = fakeRes();
    await handler(fakeReq("GET", { query: "Paris France cityscape" }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
  });
});
