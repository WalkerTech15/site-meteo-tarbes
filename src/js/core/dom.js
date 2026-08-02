/* Tiny DOM query helpers and the single shared HTML-escaper. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* HTML-escape any value that reaches an innerHTML template. Place names, regions
   and ids come from third-party geocoders (MapTiler / Open-Meteo / BigDataCloud)
   whose datasets are partly crowd-sourced, so a name like `<img onerror=…>`
   would otherwise run as script. Escape at the interpolation site, never at the
   source: locName/locRegion/locCountry are also used with textContent, where an
   escaped string would display the raw entities. */
export const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
