/* Mapillary — geotagged street-level imagery, the browser half.
 *
 * What matters here:
 *   - the token never leaves the server (same-origin proxy only);
 *   - this provider only answers where street-level imagery MEANS something,
 *     which is a small radius around a settlement — never a region, a country
 *     or open water;
 *   - every result is `nearby`, never `exact`: the claim is "taken here", not
 *     "this is the place";
 *   - CC BY-SA attribution is mandatory, so an uncreditable image is refused.
 *
 * `fetch` is stubbed, so nothing here touches the network. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mapillaryRadiusFor,
  scoreMapillaryImage,
  pickBestMapillaryImage,
  fetchMapillaryImages,
  fetchMapillaryPhoto,
  __resetMapillaryCacheForTests,
} from "./mapillary-api.js";

const PROXY_PATH = "api/mapillary";
const THUMB = "https://scontent-cdg4-1.xx.fbcdn.net/m/mock-thumb.jpg";

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

const image = (over = {}) => ({
  id: "123456789",
  src: THUMB,
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

const town = (over = {}) => ({
  id: "mt-tarbes",
  kind: "town",
  lat: 43.2333,
  lon: 0.0782,
  name: { en: "Tarbes", fr: "Tarbes" },
  region: { en: "Occitania", fr: "Occitanie" },
  country: { en: "France", fr: "France" },
  ...over,
});

const stubImages = (images) => stubFetch(() => jsonResponse(200, { images }));

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  __resetMapillaryCacheForTests();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("mapillaryRadiusFor — where street-level imagery means anything", () => {
  it("offers a tight radius for settlements, tighter still for a point", () => {
    expect(mapillaryRadiusFor(town({ kind: "city" }))).toBe(1000);
    expect(mapillaryRadiusFor(town({ kind: "town" }))).toBe(800);
    expect(mapillaryRadiusFor(town({ kind: "village" }))).toBe(500);
    expect(mapillaryRadiusFor(town({ kind: "poi" }))).toBe(200);
    expect(mapillaryRadiusFor(town({ kind: "address" }))).toBe(150);
  });

  /* One roadside frame says nothing about a territory — offering it would be
     exactly the "generic image presented as the place" failure. */
  it("refuses regions, states, provinces and countries outright", () => {
    for (const kind of ["region", "state", "province", "country"]) {
      expect(mapillaryRadiusFor(town({ kind }))).toBe(0);
    }
  });

  it("refuses open water, which has no streets", () => {
    expect(mapillaryRadiusFor(town({ kind: "ocean" }))).toBe(0);
    expect(mapillaryRadiusFor(town({ kind: "sea" }))).toBe(0);
  });

  it("refuses a location with no usable coordinates", () => {
    expect(mapillaryRadiusFor(town({ lat: null }))).toBe(0);
    expect(mapillaryRadiusFor(town({ lon: NaN }))).toBe(0);
    expect(mapillaryRadiusFor(null)).toBe(0);
  });
});

describe("scoreMapillaryImage — proximity first, then usability", () => {
  it("scores a frame at the exact point above one at the edge of the radius", () => {
    const here = scoreMapillaryImage(town(), image(), 800);
    const edge = scoreMapillaryImage(town(), image({ lat: 43.2405, lon: 0.0782 }), 800);
    expect(here).toBeGreaterThan(edge);
  });

  it("excludes anything outside the radius entirely", () => {
    const far = scoreMapillaryImage(town(), image({ lat: 43.5, lon: 0.5 }), 800);
    expect(far).toBe(-Infinity);
  });

  it("excludes an image with no coordinate — position is the whole claim", () => {
    expect(scoreMapillaryImage(town(), image({ lat: null, lon: null }), 800)).toBe(-Infinity);
  });

  /* A 360° frame squeezed into a 16:9 hero is a smear. */
  it("ranks a panorama below an ordinary frame at the same spot", () => {
    const flat = scoreMapillaryImage(town(), image(), 800);
    const pano = scoreMapillaryImage(town(), image({ isPano: true }), 800);
    expect(pano).toBeLessThan(flat);
  });

  it("prefers a recent capture to a decade-old one", () => {
    const recent = scoreMapillaryImage(town(), image(), 800);
    const old = scoreMapillaryImage(
      town(),
      image({ capturedAt: Date.now() - 12 * 365.25 * 24 * 3600 * 1000 }),
      800,
    );
    expect(recent).toBeGreaterThan(old);
  });

  it("prefers landscape, which is the shape every photo slot actually is", () => {
    const wide = scoreMapillaryImage(town(), image(), 800);
    const tall = scoreMapillaryImage(town(), image({ width: 1152, height: 2048 }), 800);
    expect(wide).toBeGreaterThan(tall);
  });
});

describe("pickBestMapillaryImage", () => {
  it("returns the closest usable frame regardless of input order", () => {
    const near = image({ id: "1" });
    const far = image({ id: "2", lat: 43.2395, lon: 0.0782 });
    expect(pickBestMapillaryImage(town(), [far, near], 800).id).toBe("1");
    expect(pickBestMapillaryImage(town(), [near, far], 800).id).toBe("1");
  });

  it("skips images with no source or no contributor", () => {
    const usable = image({ id: "ok" });
    expect(pickBestMapillaryImage(town(), [image({ id: "a", src: "" }), usable], 800).id).toBe(
      "ok",
    );
    expect(pickBestMapillaryImage(town(), [image({ id: "b", creator: "" }), usable], 800).id).toBe(
      "ok",
    );
  });

  it("returns null for an empty or all-rejected pool", () => {
    expect(pickBestMapillaryImage(town(), [], 800)).toBeNull();
    expect(pickBestMapillaryImage(town(), null, 800)).toBeNull();
    expect(pickBestMapillaryImage(town(), [image({ lat: 0, lon: 0 })], 800)).toBeNull();
  });
});

describe("proxy contract — the token stays on the server", () => {
  it("calls only the same-origin proxy, never Mapillary directly", async () => {
    const calls = stubImages([image()]);
    await fetchMapillaryPhoto(town());
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url).toContain(PROXY_PATH);
      expect(c.url).not.toContain("mapillary.com");
      expect(JSON.stringify(c.init?.headers || {})).not.toMatch(/authorization|oauth|MLY/i);
    }
  });

  it("sends the location and the kind's own radius", async () => {
    const calls = stubImages([]);
    await fetchMapillaryImages(town({ kind: "village" }));
    const params = new URL(calls[0].url, "http://local").searchParams;
    expect(Number(params.get("lat"))).toBeCloseTo(43.2333, 3);
    expect(Number(params.get("radius"))).toBe(500);
  });

  it("never calls the proxy at all for a kind it cannot answer", async () => {
    const calls = stubImages([image()]);
    expect(await fetchMapillaryPhoto(town({ kind: "country" }))).toBeNull();
    expect(await fetchMapillaryPhoto(town({ kind: "ocean" }))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("maps a chosen image onto the shared candidate shape, always as nearby", async () => {
    stubImages([image()]);
    const photo = await fetchMapillaryPhoto(town());
    expect(photo).toMatchObject({
      src: THUMB,
      source: "mapillary",
      photographer: "a_contributor",
      license: "CC BY-SA 4.0",
      provenance: "nearby",
    });
    expect(photo.link).toMatch(/^https:\/\/www\.mapillary\.com\/app\//);
  });

  /* Street-level imagery is evidence of WHERE, never of WHAT. */
  it("never claims an exact provenance, however close the frame is", async () => {
    stubImages([image({ lat: town().lat, lon: town().lon })]);
    expect((await fetchMapillaryPhoto(town())).provenance).toBe("nearby");
  });
});

describe("failure handling — every fault means 'no Mapillary photo'", () => {
  for (const status of [400, 401, 403, 429, 500, 502]) {
    it(`degrades to null on a ${status}`, async () => {
      stubFetch(() => jsonResponse(status, { error: "x" }));
      expect(await fetchMapillaryPhoto(town())).toBeNull();
    });
  }

  it("degrades to null when the network throws (offline, timeout)", async () => {
    stubFetch(() => {
      throw new Error("timeout");
    });
    expect(await fetchMapillaryPhoto(town())).toBeNull();
  });

  it("degrades to null on malformed JSON", async () => {
    stubFetch(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }));
    expect(await fetchMapillaryPhoto(town())).toBeNull();
  });

  /* A 503 is "this deployment has no Mapillary token" — a fact about the
     server, not about this location. */
  it("stops asking entirely after a 503, instead of retrying per location", async () => {
    const calls = stubFetch(() => jsonResponse(503, { error: "unavailable" }));
    expect(await fetchMapillaryPhoto(town())).toBeNull();
    const afterFirst = calls.length;
    expect(await fetchMapillaryPhoto(town({ id: "b", lat: 45.76, lon: 4.83 }))).toBeNull();
    expect(await fetchMapillaryPhoto(town({ id: "c", lat: 48.85, lon: 2.35 }))).toBeNull();
    expect(calls.length).toBe(afterFirst);
  });

  /* CC BY-SA is not optional: an image we cannot credit is one we must not
     show, so the chain moves on rather than displaying it bare. */
  it("refuses an image it could not attribute", async () => {
    stubImages([image({ creator: "" })]);
    expect(await fetchMapillaryPhoto(town())).toBeNull();
  });

  it("refuses an image whose attribution link is not https", async () => {
    stubImages([image({ link: "http://www.mapillary.com/app/?pKey=1" })]);
    expect(await fetchMapillaryPhoto(town())).toBeNull();
  });
});

describe("caching — short, because the URLs expire", () => {
  it("serves a repeated lookup from memory instead of re-requesting", async () => {
    const calls = stubImages([image()]);
    await fetchMapillaryPhoto(town());
    const after = calls.length;
    await fetchMapillaryPhoto(town());
    expect(calls.length).toBe(after);
  });

  it("coalesces concurrent lookups for the same place into one request", async () => {
    const calls = stubImages([image()]);
    await Promise.all([fetchMapillaryImages(town()), fetchMapillaryImages(town())]);
    expect(calls).toHaveLength(1);
  });

  it("expires rather than keeping a signed URL forever", async () => {
    const calls = stubImages([image()]);
    await fetchMapillaryImages(town());
    const before = calls.length;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 60 * 60000);
      await fetchMapillaryImages(town());
    } finally {
      vi.useRealTimers();
    }
    expect(calls.length).toBeGreaterThan(before);
  });

  it("never writes anything to persistent storage", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./mapillary-api.js", import.meta.url)),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./);
  });
});
