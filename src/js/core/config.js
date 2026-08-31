/* App-wide constants: the browser-side API key, endpoints, cache TTLs, timeouts.

   Anything VITE_-prefixed is compiled into the JavaScript bundle and is
   therefore PUBLIC — that is what the prefix means. Exactly one key is allowed
   to be public here:

   - MapTiler: designed for browser use and restrictable to a list of allowed
     origins in the MapTiler Cloud dashboard. Restricting it is what makes
     shipping it safe; an unrestricted key would be abusable from any site.
   - Pexels: NOT here, on purpose. Pexels offers no origin restriction, so a
     Pexels key in the bundle is a published credential. It now lives on the
     server and is reached through the same-origin proxy below — api/pexels.js
     (Vercel serverless function) on the current deploy target, or
     public/api/pexels.php on the alternate Hostinger/Apache path, or a Vite
     middleware in dev. See README.md "API keys & security".
   - Google Places: NOT here either, for the same reason and one more. Places
     API (New) is called with an X-Goog-Api-Key header, which a browser cannot
     send without publishing the key, and a Places key is billed per request.
     GOOGLE_PLACES_API_KEY therefore lives only on the server, behind the
     second same-origin proxy below. */
export const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || "";

export const MAP_STYLE = `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`;

/* Same-origin photo proxy. BASE_URL-relative rather than a leading slash so the
   build keeps working from a subdirectory as well as from a domain root. */
export const PEXELS_PROXY_URL = `${import.meta.env.BASE_URL}api/pexels`;

/* Same-origin Google Places proxy — place candidates and, separately, the
   short-lived signed URI for one chosen photo. See services/places-api.js. */
export const GOOGLE_PLACES_PROXY_URL = `${import.meta.env.BASE_URL}api/places`;

/* Same-origin Mapillary proxy — geotagged street-level imagery for places the
   other providers have never photographed. See services/mapillary-api.js.
   (KartaView is deliberately NOT used: Mapillary is the only street-level
   provider configured for this project.) */
export const MAPILLARY_PROXY_URL = `${import.meta.env.BASE_URL}api/mapillary`;

/* Request timeouts */
export const FETCH_TIMEOUT_MS = 8000;
export const GEOCODE_FALLBACK_TIMEOUT_MS = 6000;

/* Cache lifetimes */
export const WEATHER_CACHE_TTL_MS = 5 * 60000;
export const FAVORITES_WEATHER_TTL_MS = 4 * 60000;
export const GEO_FIX_TTL_MS = 30 * 60000;
export const MAPTILER_SEARCH_CACHE_MAX = 40;
/* Reverse geocoding answers "what is at this coordinate" — a fact that does
   not change. A long TTL means repeatedly clicking around the same spot on
   the map costs one request, not one per click. */
export const REVERSE_GEOCODE_TTL_MS = 30 * 60000;
