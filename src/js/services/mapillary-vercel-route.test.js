/* Contract tests for the Vercel serverless Mapillary proxy
 * (api/mapillary.js), plus the source-level agreement between all three
 * implementations of the same route.
 *
 * `fetch` is stubbed, so nothing here touches the network or spends quota. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import handler from "../../../api/mapillary.js";

const TOKEN = "MLY|test|token";
const THUMB = "https://scontent-cdg4-1.xx.fbcdn.net/m/mock.jpg";

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

/* One upstream image in Mapillary's own Graph API shape. */
const upstreamImage = (over = {}) => ({
  id: "123456789",
  thumb_1024_url: THUMB,
  captured_at: 1700000000000,
  is_pano: false,
  width: 2048,
  height: 1152,
  geometry: { type: "Point", coordinates: [0.0782, 43.2333] },
  creator: { id: "1", username: "a_contributor" },
  ...over,
});

function stubUpstream(impl) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  });
  return calls;
}

async function call(query, upstream) {
  const calls = stubUpstream(upstream);
  const res = fakeRes();
  await handler(fakeReq("GET", query), res);
  return { res, calls };
}

const AT_TARBES = { lat: "43.2333", lon: "0.0782" };

let originalFetch;
let originalToken;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalToken = process.env.MAPILLARY_ACCESS_TOKEN;
  process.env.MAPILLARY_ACCESS_TOKEN = TOKEN;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.MAPILLARY_ACCESS_TOKEN;
  else process.env.MAPILLARY_ACCESS_TOKEN = originalToken;
  vi.restoreAllMocks();
});

describe("api/mapillary — the image lookup", () => {
  it("re-projects an upstream image onto the narrow browser payload", async () => {
    const { res } = await call(AT_TARBES, () => jsonResponse(200, { data: [upstreamImage()] }));
    expect(res.statusCode).toBe(200);
    expect(res.body.images).toHaveLength(1);
    expect(res.body.images[0]).toEqual({
      id: "123456789",
      src: THUMB,
      width: 2048,
      height: 1152,
      lat: 43.2333,
      lon: 0.0782,
      capturedAt: 1700000000000,
      isPano: false,
      creator: "a_contributor",
      link: "https://www.mapillary.com/app/?pKey=123456789&focus=photo",
    });
  });

  it("sends the token in a header, never in the URL", async () => {
    const { calls } = await call(AT_TARBES, () => jsonResponse(200, { data: [] }));
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.Authorization).toBe(`OAuth ${TOKEN}`);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].url).not.toContain("access_token");
  });

  it("asks for a bounding box around the requested point", async () => {
    const { calls } = await call({ ...AT_TARBES, radius: "500" }, () =>
      jsonResponse(200, { data: [] }),
    );
    const bbox = new URL(calls[0].url).searchParams.get("bbox").split(",").map(Number);
    const [minLon, minLat, maxLon, maxLat] = bbox;
    expect(minLon).toBeLessThan(0.0782);
    expect(maxLon).toBeGreaterThan(0.0782);
    expect(minLat).toBeLessThan(43.2333);
    expect(maxLat).toBeGreaterThan(43.2333);
    /* ~500 m ≈ 0.0045° of latitude — a box, not a continent. */
    expect(maxLat - minLat).toBeLessThan(0.02);
  });

  it("clamps an absurd radius instead of asking for half the planet", async () => {
    const { calls } = await call({ ...AT_TARBES, radius: "999999" }, () =>
      jsonResponse(200, { data: [] }),
    );
    const [minLon, minLat, maxLon, maxLat] = new URL(calls[0].url).searchParams
      .get("bbox")
      .split(",")
      .map(Number);
    expect(maxLat - minLat).toBeLessThan(0.05);
    expect(maxLon - minLon).toBeLessThan(0.05);
  });

  /* Near the poles a naive metres→degrees conversion divides by ~0. */
  it("survives a near-polar coordinate without producing an infinite box", async () => {
    const { calls } = await call({ lat: "89.99", lon: "10" }, () =>
      jsonResponse(200, { data: [] }),
    );
    const bbox = new URL(calls[0].url).searchParams.get("bbox").split(",").map(Number);
    for (const n of bbox) expect(Number.isFinite(n)).toBe(true);
  });

  /* CC BY-SA requires the attribution to travel with the image. */
  it("drops an image with no named contributor", async () => {
    const { res } = await call(AT_TARBES, () =>
      jsonResponse(200, { data: [upstreamImage({ creator: {} })] }),
    );
    expect(res.body.images).toEqual([]);
  });

  it("drops an image with no coordinate — position is its whole claim", async () => {
    const { res } = await call(AT_TARBES, () =>
      jsonResponse(200, { data: [upstreamImage({ geometry: null })] }),
    );
    expect(res.body.images).toEqual([]);
  });

  it("drops a thumbnail that is not on a Mapillary or Meta CDN host", async () => {
    for (const bad of ["https://evil.example/x.jpg", "http://scontent.xx.fbcdn.net/x.jpg", ""]) {
      const { res } = await call(AT_TARBES, () =>
        jsonResponse(200, { data: [upstreamImage({ thumb_1024_url: bad })] }),
      );
      expect(res.body.images).toEqual([]);
    }
  });

  it("drops an image whose id is not a plain number, so the link cannot be forged", async () => {
    const { res } = await call(AT_TARBES, () =>
      jsonResponse(200, { data: [upstreamImage({ id: "1&x=../../evil" })] }),
    );
    expect(res.body.images).toEqual([]);
  });

  it("rejects missing or absurd coordinates", async () => {
    for (const q of [{}, { lat: "43" }, { lat: "999", lon: "0" }, { lat: "x", lon: "y" }]) {
      const { res, calls } = await call(q, () => jsonResponse(200, { data: [] }));
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "invalid_coordinates" });
      expect(calls).toHaveLength(0);
    }
  });
});

describe("api/mapillary — caching and failure modes", () => {
  /* Signed, expiring URLs: briefly reusable by the one browser that asked,
     never by a shared cache that would serve a stale signature to someone
     else. */
  it("never allows a shared cache to keep the signed URLs", async () => {
    const { res } = await call(AT_TARBES, () => jsonResponse(200, { data: [upstreamImage()] }));
    expect(res.headers["Cache-Control"]).toMatch(/private/);
    expect(res.headers["Cache-Control"]).not.toMatch(/public/);
  });

  it("answers 503 when no token is configured, without calling upstream", async () => {
    delete process.env.MAPILLARY_ACCESS_TOKEN;
    const { res, calls } = await call(AT_TARBES, () => jsonResponse(200, {}));
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("maps a denied token (401/403) onto 503, not a retryable error", async () => {
    for (const status of [401, 403]) {
      const { res } = await call(AT_TARBES, () => jsonResponse(status, {}));
      expect(res.statusCode).toBe(503);
    }
  });

  it("maps a 429 straight through", async () => {
    const { res } = await call(AT_TARBES, () => jsonResponse(429, {}));
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
  });

  it("maps every other upstream failure onto a generic 502", async () => {
    for (const status of [400, 500, 503]) {
      const { res } = await call(AT_TARBES, () => jsonResponse(status, { error: {} }));
      expect(res.statusCode).toBe(502);
    }
  });

  it("survives a network failure, a timeout and a malformed body", async () => {
    const thrown = await call(AT_TARBES, () => {
      throw new Error("ETIMEDOUT");
    });
    expect(thrown.res.statusCode).toBe(502);
    const malformed = await call(AT_TARBES, () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }));
    expect(malformed.res.statusCode).toBe(502);
  });

  it("tolerates an upstream 200 with no data array", async () => {
    const { res } = await call(AT_TARBES, () => jsonResponse(200, {}));
    expect(res.statusCode).toBe(200);
    expect(res.body.images).toEqual([]);
  });

  it("refuses anything that is not a GET", async () => {
    const res = fakeRes();
    await handler(fakeReq("POST", AT_TARBES), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("GET");
  });

  it("never leaks the token or the upstream body into an error", async () => {
    const { res } = await call(AT_TARBES, () =>
      jsonResponse(500, { error: { message: `bad token ${TOKEN}`, trace: "secret" } }),
    );
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("secret");
  });
});

/* The frontend hardcodes ONE route (MAPILLARY_PROXY_URL) for every deploy
   target, so all three server implementations must agree. No Apache or Vercel
   runtime runs in CI, so this compares them at the source level. */
describe("all three Mapillary proxies agree on the contract", () => {
  const read = (relPath) => readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
  const vercel = read("../../../api/mapillary.js");
  const dev = read("../../../vite.config.js");
  const php = read("../../../public/api/mapillary.php");

  it("requests the same fields and candidate count everywhere", () => {
    for (const src of [vercel, dev, php]) {
      for (const field of ["thumb_1024_url", "captured_at", "is_pano", "geometry", "creator"]) {
        expect(src).toContain(field);
      }
    }
    expect(vercel).toMatch(/CANDIDATE_COUNT = 12/);
    expect(dev).toMatch(/MAPILLARY_CANDIDATE_COUNT = 12/);
    expect(php).toMatch(/MAPILLARY_CANDIDATE_COUNT = 12/);
  });

  it("bounds the radius identically everywhere", () => {
    for (const src of [vercel, dev, php]) {
      expect(src).toMatch(/MIN_RADIUS_M\s*=\s*100/);
      expect(src).toMatch(/MAX_RADIUS_M\s*=\s*2000/);
      expect(src).toMatch(/DEFAULT_RADIUS_M\s*=\s*800/);
    }
  });

  it("reads the token server-side only, never from a VITE_ variable", () => {
    expect(vercel).toMatch(/process\.env\.MAPILLARY_ACCESS_TOKEN/);
    expect(dev).toMatch(/MAPILLARY_ACCESS_TOKEN/);
    /* The PHP path reads the private secrets file instead of an env var. */
    expect(php).toMatch(/mapillary_access_token/);
    for (const src of [vercel, dev, php]) {
      expect(src).not.toMatch(/VITE_MAPILLARY/);
    }
  });

  it("restricts the thumbnail host identically everywhere", () => {
    for (const src of [vercel, dev, php]) {
      expect(src).toContain("fbcdn");
      expect(src).toContain("mapillary");
    }
  });

  /* Comments are stripped first: several of these files DOCUMENT that
     KartaView is deliberately not used, which is the opposite of using it.
     What must not exist is a call to it. */
  it("never calls KartaView — Mapillary is the only street-level provider", () => {
    for (const src of [vercel, dev, php]) {
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/^\s*#.*$/gm, "")
        .toLowerCase();
      expect(code).not.toContain("kartaview");
      expect(code).not.toContain("openstreetcam");
    }
  });
});
