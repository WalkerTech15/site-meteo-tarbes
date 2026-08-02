/* App-wide constants: API keys (from Vite env vars), cache TTLs, timeouts.

   Both keys below are bundled into the client-side JS at build time — Vite
   exposes every VITE_-prefixed variable to the browser, so neither is a true
   secret. MapTiler supports restricting a key to a list of allowed origins
   (configure this in the MapTiler dashboard), which is what makes it
   reasonably safe to ship in a browser bundle. Pexels keys cannot be
   origin-restricted, so PEXELS_KEY is fully exposed once built — see
   README.md "API keys & security" for the full picture. */
export const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || "";
export const PEXELS_KEY = import.meta.env.VITE_PEXELS_KEY || "";

export const MAP_STYLE = `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${MAPTILER_KEY}`;

/* Request timeouts */
export const FETCH_TIMEOUT_MS = 8000;
export const GEOCODE_FALLBACK_TIMEOUT_MS = 6000;

/* Cache lifetimes */
export const WEATHER_CACHE_TTL_MS = 5 * 60000;
export const FAVORITES_WEATHER_TTL_MS = 4 * 60000;
export const GEO_FIX_TTL_MS = 30 * 60000;
export const MAPTILER_SEARCH_CACHE_MAX = 40;
