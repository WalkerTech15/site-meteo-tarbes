/* WeatherSphere service worker — offline support for the app shell and for
 * data the visitor has already loaded once.
 *
 * Deliberately a plain classic worker with no imports and no build step: it
 * is copied verbatim from public/ to the deploy root, so it works the same
 * on Vercel, on the Apache/Hostinger path and from `vite preview`. The
 * routing policy below is a pure function (`strategyFor`) exposed on
 * self.__swTestHooks so services/sw-policy.test.js can exercise THIS file
 * rather than a copy of its rules.
 *
 * WHAT IS AND IS NOT CACHED
 * The rule is "safe to replay to this visitor, later, offline":
 *   - App shell (HTML + Vite's content-hashed /assets/*) — cache-first for
 *     the hashed assets, which are immutable by construction, and
 *     network-first for navigations so a redeploy is picked up immediately
 *     and a hard refresh never serves a stale page.
 *   - Weather and air-quality responses — stale-while-revalidate, so an
 *     offline visitor still sees the last reading they actually loaded.
 *     The UI is responsible for labelling it: the hero always shows
 *     "Updated · N min ago" and switches its live pill to "Offline" (see
 *     services/offline.js), so a cached reading is never presented as
 *     current.
 *   - Photos (Pexels/Wikimedia image CDNs, and our own /api/pexels proxy
 *     response, which carries only public photo URLs and credits).
 *
 * Never cached:
 *   - Anything that is not a GET.
 *   - Google Places photos, and the /api/places proxy that resolves them.
 *     Google Maps Platform's terms allow only temporary caching of Places
 *     content, and a resolved photo URI is a short-lived signed URL — keeping
 *     either in Cache Storage across reloads is not permitted. See
 *     NEVER_CACHE_HOSTS below.
 *   - MapTiler style/tile/geocoding requests. They carry the MapTiler key in
 *     the query string, and although that key is public by design and
 *     origin-restricted (see core/config.js), writing URLs containing ANY
 *     credential into Cache Storage is a line worth not crossing. They are
 *     also large and already TTL-cached in-app.
 *   - Non-200 responses, opaque cross-origin responses, and any response
 *     with a Vary or Set-Cookie that would make a replay wrong.
 */

const VERSION = "v1";
const SHELL_CACHE = `weathersphere-shell-${VERSION}`;
const DATA_CACHE = `weathersphere-data-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, DATA_CACHE];

/* The two entry points. The hashed assets they pull in cannot be listed
   here — their names change every build and this file is not part of the
   build — so they are read out of the cached HTML at install time instead
   (see entryAssetsFrom / precacheShell). */
const SHELL_URLS = ["./", "./index.html"];

/* Pulls the built entry assets out of the index HTML.
 *
 * Without this, the first visit caches only the HTML: the <script> and
 * <link> it references are requested during that same navigation, BEFORE a
 * newly-installing worker controls the page, so they never pass through the
 * fetch handler and never get stored. The site then appears to work offline
 * (the shell is cached) while actually rendering a blank page, and only
 * heals on the visitor's SECOND load. Reading them straight out of the HTML
 * makes the very first visit self-sufficient.
 *
 * Scoped to /assets/ on purpose: those are Vite's content-hashed, immutable
 * outputs. Cross-origin references (a webfont, an analytics tag) are left
 * to the normal runtime rules rather than precached here. */
function entryAssetsFrom(html) {
  const urls = new Set();
  const pattern = /<(?:script[^>]+src|link[^>]+href)=["']([^"']+)["']/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const url = match[1];
    if (/^(?:https?:)?\/\//.test(url)) continue; /* cross-origin */
    if (url.includes("/assets/")) urls.add(url);
  }
  return [...urls];
}

/* Hosts whose GET responses are safe to reuse offline. */
const WEATHER_HOSTS = new Set(["api.open-meteo.com", "air-quality-api.open-meteo.com"]);
const PHOTO_HOSTS = new Set(["images.pexels.com", "upload.wikimedia.org"]);

/* Hosts that must NEVER be cached, checked before any allow-list.
 *
 * Google Places photo bytes are served from these CDNs behind a short-lived
 * signed URL, and Google Maps Platform's terms do not permit persisting or
 * re-publishing them — "temporary caching for performance" is not a licence
 * to keep a copy in Cache Storage across reloads. Being an unknown host would
 * already make them network-only by default; naming them makes it a decision
 * rather than an accident, so adding a future photo host to PHOTO_HOSTS
 * cannot silently sweep these in with it. The same rule covers the
 * /api/places proxy below. */
const NEVER_CACHE_HOSTS = [/(^|\.)googleusercontent\.com$/i, /(^|\.)ggpht\.com$/i];
/* Commons' JSON API — the metadata half of the photo lookup. */
const PHOTO_API_HOSTS = new Set(["commons.wikimedia.org"]);

/* Vite emits `assets/<name>-<8-char hash>.<ext>` — the hash changes whenever
   the contents do, which is what makes cache-first safe for these and only
   these. A public/ file such as assets/flags/countries/fr.svg keeps a stable
   name across deploys, so it must NOT match: the [^/]* segment cannot span a
   slash, which is what excludes it. */
const IMMUTABLE_PATH = /\/assets\/[^/]*-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?|png|jpe?g|svg|webp)$/;
const STATIC_EXT = /\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico|json)$/;

/**
 * Which caching strategy a request gets. Pure: takes the already-parsed
 * pieces of a request so it can be unit-tested without a Request object.
 *
 * @param {{method: string, mode: string, sameOrigin: boolean, host: string,
 *          pathname: string}} req
 * @returns {"network-only"|"shell"|"cache-first"|"stale-while-revalidate"|"network-first"}
 */
function strategyFor(req) {
  if (req.method !== "GET") return "network-only";

  /* A navigation is the one request that must never be answered from a
     stale cache while the network is up — that is what makes a redeploy
     visible and a manual refresh honest. Falling back to the cached shell
     happens only when the network actually fails. */
  if (req.mode === "navigate") return "shell";

  if (!req.sameOrigin) {
    /* Licence-restricted content, before any allow-list can claim it. */
    if (NEVER_CACHE_HOSTS.some((re) => re.test(req.host))) return "network-only";
    if (WEATHER_HOSTS.has(req.host)) return "stale-while-revalidate";
    if (PHOTO_HOSTS.has(req.host)) return "cache-first";
    if (PHOTO_API_HOSTS.has(req.host)) return "stale-while-revalidate";
    /* MapTiler (key in the URL), analytics, fonts, anything unknown */
    return "network-only";
  }

  /* Our own photo proxy: the response holds public photo URLs and credits,
     never the Pexels key, which stays server-side (see api/pexels.js). */
  if (req.pathname.endsWith("/api/pexels")) return "stale-while-revalidate";
  /* Other same-origin API routes — /api/places included — are not known to be
     replay-safe. For Places that is a licensing requirement, not a guess: its
     photo responses carry short-lived signed URIs that must not be retained. */
  if (req.pathname.includes("/api/")) return "network-only";

  if (IMMUTABLE_PATH.test(req.pathname)) return "cache-first";
  if (STATIC_EXT.test(req.pathname)) return "network-first";
  return "network-first";
}

/* A response is only worth storing if it is a complete, successful,
   same-or-CORS response. Opaque responses (no-cors cross-origin) are
   status 0 with an unreadable body: caching them silently fills the quota
   and can serve a broken asset later. */
function isCacheable(response) {
  return Boolean(
    response &&
    response.status === 200 &&
    response.type !== "opaque" &&
    !response.headers.get("Set-Cookie"),
  );
}

function cacheNameFor(strategy) {
  return strategy === "shell" ? SHELL_CACHE : DATA_CACHE;
}

/* Every cache read goes through here, with ignoreVary.
 *
 * Static hosts (including `vite preview` and most CDNs) send `Vary: Origin`
 * on built assets. Cache Storage honours Vary by default, and the two ways
 * a file gets stored disagree on that header: cache.add() fetches WITHOUT an
 * Origin, while the page's own `<script type="module" crossorigin>` and
 * `<link crossorigin>` requests send one. The stored entry then never
 * matches the request that needs it, the lookup silently misses, and the
 * strategy falls through to a network that is offline — which is exactly
 * how this shipped as "cached but still blank offline".
 *
 * Ignoring Vary is safe for everything cached here: the URL alone
 * determines the content (Vite's asset names are content-hashed, and the
 * data responses are keyed by their full query string). */
function matchCached(request) {
  return caches.match(request, { ignoreVary: true });
}

async function putInCache(cacheName, request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

async function cacheFirst(request, cacheName) {
  const hit = await matchCached(request);
  if (hit) return hit;
  const response = await fetch(request);
  await putInCache(cacheName, request, response);
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    await putInCache(cacheName, request, response);
    return response;
  } catch (err) {
    const hit = await matchCached(request);
    if (hit) return hit;
    throw err;
  }
}

/* Answer from cache immediately when there is a hit, and refresh it in the
   background so the next load is current. With no hit, this is just a
   network request that also populates the cache. */
async function staleWhileRevalidate(request, cacheName) {
  const hit = await matchCached(request);
  const network = fetch(request)
    .then(async (response) => {
      await putInCache(cacheName, request, response);
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const response = await network;
  if (response) return response;
  throw new Error("offline and not cached");
}

/* Navigations: network first so a redeploy and a refresh are always
   honest, cached shell only when the network genuinely fails. */
async function shellStrategy(request) {
  try {
    const response = await fetch(request);
    await putInCache(SHELL_CACHE, request, response);
    return response;
  } catch (err) {
    const hit =
      (await matchCached(request)) ||
      (await matchCached("./index.html")) ||
      (await matchCached("./"));
    if (hit) return hit;
    throw err;
  }
}

/* addAll is atomic — one 404 would reject the whole install and leave the
   visitor with no worker at all — so every add here is settled
   independently and a miss is tolerated. A precache that half-succeeds is
   still better than no worker. */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
  try {
    const cached = (await cache.match("./index.html")) || (await cache.match("./"));
    if (!cached) return;
    const assets = entryAssetsFrom(await cached.clone().text());
    await Promise.allSettled(assets.map((url) => cache.add(url)));
  } catch {
    /* best effort: the runtime rules still fill the cache on the next load */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            /* Only ever delete OUR caches: another app on the same origin
               (or a future feature) may legitimately own others. */
            .filter((name) => name.startsWith("weathersphere-") && !CURRENT_CACHES.includes(name))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return; /* not a URL we can reason about — leave it to the network */
  }
  /* chrome-extension:, data:, blob: … never ours to cache */
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const strategy = strategyFor({
    method: request.method,
    mode: request.mode,
    sameOrigin: url.origin === self.location.origin,
    host: url.host,
    pathname: url.pathname,
  });
  if (strategy === "network-only") return;

  const cacheName = cacheNameFor(strategy);
  if (strategy === "shell") event.respondWith(shellStrategy(request));
  else if (strategy === "cache-first") event.respondWith(cacheFirst(request, cacheName));
  else if (strategy === "stale-while-revalidate")
    event.respondWith(staleWhileRevalidate(request, cacheName));
  else event.respondWith(networkFirst(request, cacheName));
});

/* Lets the page drop every cache this worker owns — wired to the existing
   "Reset the application" action in Settings, so clearing local data really
   does clear everything. */
self.addEventListener("message", (event) => {
  if (event.data === "clear-caches") {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names.filter((n) => n.startsWith("weathersphere-")).map((n) => caches.delete(n)),
          ),
        ),
    );
  }
});

/* Test seam: the routing policy is the part worth pinning, and exposing it
   lets the unit test run against this exact file instead of a copy. */
self.__swTestHooks = { strategyFor, isCacheable, entryAssetsFrom, VERSION, CURRENT_CACHES };
