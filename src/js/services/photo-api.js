/* Location visuals: curated landmark image → country flag → emoji fallback,
   with an optional real photo fetched from Pexels layered on top once it
   loads (never blocking the initial render, never causing layout shift). */
import { state } from "../core/state.js";
import { PEXELS_KEY, FETCH_TIMEOUT_MS } from "../core/config.js";
import { flagHtml } from "../data/flags.js";
import { locCountry } from "../core/location.js";

export function gradBg(loc) {
  return `background:linear-gradient(145deg, ${loc.grad[0]}, ${loc.grad[1]})`;
}

/* Ordered providers; the first that returns HTML wins. This keeps the visual
   decoupled from callers so a real image API (e.g. Unsplash) can slot in as a
   new provider WITHOUT touching any component. Providers must key off stable
   identity (loc.id / curated landmark / country code) — never the raw query —
   so a duplicate city name (Paris TX) can never borrow Paris FR's image. */
const IMAGE_PROVIDERS = [
  /* 1. curated local landmark image (opt-in: loc.landmark.img is a URL/dataURI) */
  (loc) =>
    loc.landmark && loc.landmark.img
      ? `<img class="loc-img" src="${loc.landmark.img}" alt="" loading="lazy">`
      : null,
  /* 2. existing local regional image (opt-in: loc.img on a curated entry) */
  (loc) => (loc.img ? `<img class="loc-img" src="${loc.img}" alt="" loading="lazy">` : null),
  /* 3. country flag for countries */
  (loc) => (loc.kind === "country" ? flagHtml(loc.cc, "", state.lang) : null),
  /* 4. curated landmark emoji, else a generic location glyph (safe fallback) */
  (loc) => (loc.landmark ? loc.landmark.emoji : "🏙️"),
  /* NOTE: to add Unsplash later, insert a provider ABOVE this line that returns
     an <img> for loc.id/landmark and null on miss — nothing else changes. */
];
export function resolveLocationImage(loc) {
  for (const provider of IMAGE_PROVIDERS) {
    const out = provider(loc);
    if (out) return out;
  }
  return "🏙️";
}
export function locVisual(loc) {
  return resolveLocationImage(loc);
}

/* For the selected location's hero + info-card visual. Priority:
   1) curated local image  2) Pexels (query built from full geocoding metadata,
   never an ambiguous city name alone)  3) the SVG/gradient fallback above.
   Async, race-guarded (photoToken), and cached (incl. negative results). */
const PHOTO_CACHE = new Map(); // query → {src, photographer, link} | null
let photoToken = 0; // bumped per location change → ignore stale swaps
export function bumpPhotoToken() {
  photoToken++;
}

export function pexelsQuery(loc) {
  const name = (loc.name && (loc.name.en || loc.name.fr)) || "";
  const region = (loc.region && loc.region.en) || "";
  const country = (loc.country && loc.country.en) || locCountry(loc) || "";
  const suffix = loc.landmark
    ? "landmark"
    : loc.kind === "city" || loc.kind === "village"
      ? "skyline"
      : "landscape";
  return [name, region, country, suffix].filter(Boolean).join(" ");
}

export async function fetchPexelsPhoto(query) {
  if (!PEXELS_KEY || !query) return null;
  if (PHOTO_CACHE.has(query)) return PHOTO_CACHE.get(query);
  try {
    const url =
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}` +
      `&orientation=landscape&per_page=1&size=medium`;
    const r = await fetch(url, {
      headers: { Authorization: PEXELS_KEY },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const p = (d.photos || [])[0];
    const out = p
      ? {
          src: (p.src && (p.src.large2x || p.src.large || p.src.medium)) || "",
          photographer: p.photographer || "",
          link: p.url || "",
        }
      : null;
    PHOTO_CACHE.set(query, out);
    return out;
  } catch {
    PHOTO_CACHE.set(query, null); // negative cache — don't hammer a failing query
    return null;
  }
}

/* Fixed-ratio container: gradient + SVG/emoji fallback act as the skeleton; a
   real photo fades in on top only once loaded, so there is never a layout shift. */
export function locPhotoHtml(loc, cls = "") {
  return `<div class="loc-photo loading ${cls}" style="${gradBg(loc)}">
    <span class="loc-photo-fallback" aria-hidden="true">${resolveLocationImage(loc)}</span>
  </div>`;
}

export async function hydrateLocPhoto(el, loc) {
  if (!el || !loc) return;
  const token = photoToken;
  const done = () => {
    if (token === photoToken) el.classList.remove("loading");
  };
  const swap = (src, credit) => {
    if (token !== photoToken || !src) return done();
    const pre = new Image();
    pre.onload = () => {
      if (token !== photoToken) return;
      let img = el.querySelector("img.loc-photo-img");
      if (!img) {
        img = document.createElement("img");
        img.className = "loc-photo-img";
        img.alt = "";
        img.decoding = "async";
        el.appendChild(img);
      }
      img.src = src;
      el.classList.add("has-photo");
      if (credit) {
        el.dataset.credit = credit;
        el.title = credit;
      }
      done();
    };
    pre.onerror = done;
    pre.src = src;
  };
  if (loc.landmark && loc.landmark.img) return swap(loc.landmark.img, "");
  if (loc.img) return swap(loc.img, "");
  let photo;
  try {
    photo = await fetchPexelsPhoto(pexelsQuery(loc));
  } catch {
    return done();
  }
  if (token !== photoToken) return;
  if (photo && photo.src)
    swap(photo.src, photo.photographer ? `Photo : ${photo.photographer} / Pexels` : "");
  else done(); // keep gradient/SVG fallback
}
