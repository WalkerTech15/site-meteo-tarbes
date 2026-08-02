/* Template for js/env.js — copy this file to js/env.js and fill in your own keys.
   js/env.js is gitignored so real keys never reach the repository.

   MapTiler (map + geocoding): https://cloud.maptiler.com/account/keys/
     Make sure the key's allowed-origins list includes localhost AND the
     production domain, otherwise the API answers 403 "Key usage restricted".
   Pexels (location photos, optional): https://www.pexels.com/api/
     Leave empty to fall back to the gradient/emoji visuals. */
window.__ENV = {
  VITE_MAPTILER_KEY: "",
  PEXELS_KEY: "",
};
