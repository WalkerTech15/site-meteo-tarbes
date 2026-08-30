/* Caching policy of the shipped service worker.
 *
 * public/sw.js is copied verbatim to the deploy root and is not part of the
 * Vite build, so it cannot be imported. Rather than restate its rules here
 * (a copy that could silently drift from the file that actually ships),
 * this evaluates THE REAL FILE in a sandbox with a stubbed `self` and then
 * exercises the policy function it exposes on self.__swTestHooks. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SW_PATH = fileURLToPath(new URL("../../../public/sw.js", import.meta.url));

let hooks;
let source;

beforeAll(() => {
  source = readFileSync(SW_PATH, "utf8");
  /* Minimal ServiceWorkerGlobalScope: the worker only touches these at
     load time (addEventListener) — the strategies themselves are exercised
     through the pure function, not by dispatching real fetch events. */
  const listeners = {};
  const self = {
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    location: { origin: "https://example.com" },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const sandbox = { self, caches: {}, fetch: () => {}, console, URL };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  hooks = self.__swTestHooks;
  hooks.listeners = listeners;
});

const req = (over = {}) => ({
  method: "GET",
  mode: "no-cors",
  sameOrigin: true,
  host: "example.com",
  pathname: "/",
  ...over,
});

describe("service worker — registration surface", () => {
  it("installs the three lifecycle handlers plus the message channel", () => {
    expect(Object.keys(hooks.listeners).sort()).toEqual([
      "activate",
      "fetch",
      "install",
      "message",
    ]);
  });

  it("versions both caches together, so a bump retires the whole set", () => {
    expect(hooks.CURRENT_CACHES).toHaveLength(2);
    for (const name of hooks.CURRENT_CACHES) {
      expect(name).toContain(hooks.VERSION);
      /* the activate handler only deletes caches with this prefix, so
         another app on the same origin is never touched */
      expect(name.startsWith("weathersphere-")).toBe(true);
    }
  });
});

describe("service worker — what is never cached", () => {
  it("passes through every non-GET request", () => {
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      expect(hooks.strategyFor(req({ method }))).toBe("network-only");
    }
  });

  it("never caches MapTiler — its URLs carry the API key", () => {
    const mapTiler = [
      "/maps/hybrid-v4/style.json",
      "/tiles/satellite/3/4/5.png",
      "/geocoding/2.35,48.85.json",
      "/weather/latest.json",
    ];
    for (const pathname of mapTiler) {
      expect(
        hooks.strategyFor(req({ sameOrigin: false, host: "api.maptiler.com", pathname })),
      ).toBe("network-only");
    }
  });

  it("passes through unknown third-party hosts rather than guessing", () => {
    expect(
      hooks.strategyFor(req({ sameOrigin: false, host: "analytics.example.net", pathname: "/t" })),
    ).toBe("network-only");
  });

  it("passes through same-origin API routes other than the photo proxy", () => {
    expect(hooks.strategyFor(req({ pathname: "/api/secret-thing" }))).toBe("network-only");
  });

  /* Google Maps Platform's terms allow only TEMPORARY caching of Places
     content, and a resolved photo URI is a short-lived signed URL — keeping
     either in Cache Storage across reloads is not permitted. These two rules
     are what make that a decision rather than an accident of "unknown host". */
  it("never caches Google Places photo bytes, whatever CDN subdomain they use", () => {
    const hosts = [
      "lh3.googleusercontent.com",
      "lh5.googleusercontent.com",
      "maps.googleusercontent.com",
      "lh3.ggpht.com",
    ];
    for (const host of hosts) {
      expect(hooks.strategyFor(req({ sameOrigin: false, host, pathname: "/places/p" }))).toBe(
        "network-only",
      );
    }
  });

  it("never caches the /api/places proxy, which resolves those URIs", () => {
    expect(hooks.strategyFor(req({ pathname: "/api/places" }))).toBe("network-only");
    expect(hooks.strategyFor(req({ pathname: "/site-meteo/api/places" }))).toBe("network-only");
  });

  /* The deny-list is checked BEFORE the photo allow-list, so adding a future
     host to PHOTO_HOSTS can never sweep a licence-restricted one in with it. */
  it("checks the never-cache rule ahead of the photo allow-list", () => {
    expect(source.indexOf("NEVER_CACHE_HOSTS.some")).toBeLessThan(
      source.indexOf("PHOTO_HOSTS.has(req.host)"),
    );
  });
});

describe("service worker — app shell", () => {
  it("serves navigations network-first so a redeploy and a refresh stay honest", () => {
    expect(hooks.strategyFor(req({ mode: "navigate", pathname: "/" }))).toBe("shell");
    expect(hooks.strategyFor(req({ mode: "navigate", pathname: "/index.html" }))).toBe("shell");
  });

  it("serves Vite's content-hashed assets cache-first — they are immutable", () => {
    const hashed = [
      "/assets/index-CtzxLG18.css",
      "/assets/index-kg_ph7XE.js",
      "/assets/maptiler-sdk-B8gcw5qn.js",
    ];
    for (const pathname of hashed) {
      expect(hooks.strategyFor(req({ pathname }))).toBe("cache-first");
    }
  });

  it("serves un-hashed same-origin static files network-first", () => {
    /* public/ files keep stable names across deploys, so a cached copy
       could otherwise outlive the file it replaced */
    expect(hooks.strategyFor(req({ pathname: "/assets/flags/countries/fr.svg" }))).toBe(
      "network-first",
    );
    expect(hooks.strategyFor(req({ pathname: "/favicon.ico" }))).toBe("network-first");
  });
});

describe("service worker — replayable data", () => {
  it("keeps weather and air quality for offline reuse", () => {
    expect(
      hooks.strategyFor(
        req({ sameOrigin: false, host: "api.open-meteo.com", pathname: "/v1/forecast" }),
      ),
    ).toBe("stale-while-revalidate");
    expect(
      hooks.strategyFor(
        req({ sameOrigin: false, host: "air-quality-api.open-meteo.com", pathname: "/v1/air" }),
      ),
    ).toBe("stale-while-revalidate");
  });

  it("keeps photo bytes cache-first and photo metadata revalidating", () => {
    expect(
      hooks.strategyFor(req({ sameOrigin: false, host: "images.pexels.com", pathname: "/p.jpg" })),
    ).toBe("cache-first");
    expect(
      hooks.strategyFor(
        req({ sameOrigin: false, host: "upload.wikimedia.org", pathname: "/a/b.jpg" }),
      ),
    ).toBe("cache-first");
    expect(
      hooks.strategyFor(
        req({ sameOrigin: false, host: "commons.wikimedia.org", pathname: "/w/api.php" }),
      ),
    ).toBe("stale-while-revalidate");
  });

  it("keeps our own photo proxy — it returns public URLs, never the key", () => {
    expect(hooks.strategyFor(req({ pathname: "/api/pexels" }))).toBe("stale-while-revalidate");
    /* also under a subdirectory deploy */
    expect(hooks.strategyFor(req({ pathname: "/site-meteo/api/pexels" }))).toBe(
      "stale-while-revalidate",
    );
  });
});

describe("service worker — isCacheable", () => {
  const res = (over = {}) => ({
    status: 200,
    type: "basic",
    headers: { get: () => null },
    ...over,
  });

  it("stores only complete, successful responses", () => {
    expect(hooks.isCacheable(res())).toBe(true);
    expect(hooks.isCacheable(res({ status: 404 }))).toBe(false);
    expect(hooks.isCacheable(res({ status: 500 }))).toBe(false);
    expect(hooks.isCacheable(res({ status: 206 }))).toBe(false); /* partial */
  });

  it("refuses opaque cross-origin responses", () => {
    expect(hooks.isCacheable(res({ type: "opaque" }))).toBe(false);
  });

  it("refuses anything carrying a Set-Cookie", () => {
    const withCookie = res({
      headers: { get: (h) => (h === "Set-Cookie" ? "a=1" : null) },
    });
    expect(hooks.isCacheable(withCookie)).toBe(false);
  });

  it("is total on a missing response", () => {
    expect(hooks.isCacheable(null)).toBe(false);
    expect(hooks.isCacheable(undefined)).toBe(false);
  });
});

/* The first visit caches only the HTML unless the worker digs the built
   entry assets out of it: the <script>/<link> those reference are requested
   during the same navigation, before a newly-installing worker controls the
   page, so they never reach the fetch handler. Verified against a real
   production build — without this the app booted offline to a blank shell. */
describe("service worker — entryAssetsFrom", () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" crossorigin href="./assets/index-CaJ4rGzu.css">
    <link rel="modulepreload" crossorigin href="./assets/events-mTVV8OWN.js">
    <link rel="preconnect" href="https://rsms.me/">
    <link rel="stylesheet" href="https://rsms.me/inter/inter.css">
    <link rel="icon" href="./favicon.svg">
    </head><body>
    <script type="module" crossorigin src="./assets/index-CMolIgVh.js"></script>
    </body></html>`;

  it("finds every built entry asset the HTML references", () => {
    const assets = hooks.entryAssetsFrom(html);
    expect(assets).toContain("./assets/index-CaJ4rGzu.css");
    expect(assets).toContain("./assets/index-CMolIgVh.js");
    expect(assets).toContain("./assets/events-mTVV8OWN.js");
  });

  it("skips cross-origin references — those follow the runtime rules", () => {
    const assets = hooks.entryAssetsFrom(html);
    expect(assets.some((u) => u.includes("rsms.me"))).toBe(false);
  });

  it("skips files outside /assets/", () => {
    expect(hooks.entryAssetsFrom(html)).not.toContain("./favicon.svg");
  });

  it("never returns the same asset twice", () => {
    const dup = `<script src="./assets/a-12345678.js"></script>
                 <link href="./assets/a-12345678.js">`;
    expect(hooks.entryAssetsFrom(dup)).toEqual(["./assets/a-12345678.js"]);
  });

  it("is total on empty or malformed input", () => {
    expect(hooks.entryAssetsFrom("")).toEqual([]);
    expect(hooks.entryAssetsFrom(null)).toEqual([]);
    expect(hooks.entryAssetsFrom("<not really html")).toEqual([]);
  });
});

describe("service worker — source-level guarantees", () => {
  it("contains no API key or secret-looking literal", () => {
    expect(source).not.toMatch(/api[_-]?key\s*[:=]\s*["'][^"']+["']/i);
    expect(source).not.toMatch(/Authorization/i);
    expect(source).not.toMatch(/PEXELS_API_KEY/);
    expect(source).not.toMatch(/VITE_/);
  });

  it("has no imports, so it works as a classic worker from any deploy root", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/importScripts\(/);
  });
});
