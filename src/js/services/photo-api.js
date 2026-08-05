/* Location visuals: curated landmark image → country flag → emoji fallback,
   with an optional real photo fetched from Pexels layered on top once it
   loads (never blocking the initial render, never causing layout shift). */
import { state } from "../core/state.js";
import { PEXELS_PROXY_URL, FETCH_TIMEOUT_MS } from "../core/config.js";
import { flagHtml } from "../data/flags.js";
import { locCountry } from "../core/location.js";
import { t } from "../core/i18n.js";

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
const PHOTO_CACHE = new Map(); // query → {src, sizes, photographer, link, alt} | null
const IN_FLIGHT = new Map(); // query → Promise, so N cards asking at once = 1 request
let photoToken = 0; // bumped per location change → ignore stale swaps
export function bumpPhotoToken() {
  photoToken++;
}

/* Test seam only: the cache is intentionally process-lifetime in the app, but
   each unit test needs to start from empty. */
export function __resetPhotoCacheForTests() {
  PHOTO_CACHE.clear();
  IN_FLIGHT.clear();
}

/* Small enough that a wide "cityscape" shot would mostly show empty
   countryside — closer, street-level imagery reads truer. A specific address
   or point of interest is similarly granular, so they share the bucket. */
const SMALL_PLACE_KINDS = new Set(["town", "village", "address", "poi"]);
/* A state/province/region IS the subject (not a parent of it) — same
   template as a country, just qualified by the country it's in. */
const REGION_KINDS = new Set(["region", "state", "province"]);

/* A bare city name is ambiguous to an image search — "Paris" returns Paris,
   Texas as readily as Paris, France, and "Tarbes" returns nothing recognisable.
   Qualify it with the canonical region and country from the geocoder.
   Deliberately never says (or names) a landmark: the old "city skyline
   landmark" suffix biased Pexels toward the same handful of famous
   monuments — the Statue of Liberty for New York, the Eiffel Tower for
   Paris — instead of a photo representative of the place itself. That holds
   even for a curated entry whose loc.landmark IS a real, named monument
   (never invented from the city name): that field stays reserved for the
   image-fallback chain in resolveLocationImage/hydrateLocPhoto, and is never
   mixed into the search text. Examples:
     "Tarbes Occitanie France cityscape"
     "Saint-Rémy-de-Provence Provence-Alpes-Côte d'Azur France streets architecture"
     "California United States landscape travel"
     "Japan landscape travel"  */
export function pexelsQuery(loc) {
  if (!loc) return "";
  const name = (loc.name && (loc.name.en || loc.name.fr)) || "";
  if (!name) return "";
  const region = (loc.region && loc.region.en) || "";
  const country = (loc.country && loc.country.en) || locCountry(loc) || "";

  if (loc.kind === "country") return [name, "landscape travel"].join(" ");
  if (REGION_KINDS.has(loc.kind))
    return [name, country, "landscape travel"].filter(Boolean).join(" ");

  const suffix = SMALL_PLACE_KINDS.has(loc.kind) ? "streets architecture" : "cityscape";
  return [name, region, country, suffix].filter(Boolean).join(" ");
}

/* Asks the SAME-ORIGIN proxy for a photo — never Pexels directly, because that
   would require shipping the Pexels key to the browser. The proxy holds the key
   server-side and answers with a narrow, already-validated shape:
     200 {"photo": {...}} | {"photo": null}
     400 invalid_query · 429 rate_limited · 502 upstream_error · 503 unavailable
   Every non-200 (and every malformed 200) is treated identically: no photo, so
   the caller keeps its gradient/emoji fallback. Failures are negative-cached so
   a rate-limited or unconfigured deployment isn't hammered for the session. */
export function fetchPexelsPhoto(query) {
  if (!query) return Promise.resolve(null);
  if (PHOTO_CACHE.has(query)) return Promise.resolve(PHOTO_CACHE.get(query));
  /* The cache is only written once the response lands, so without this a row of
     cards hydrating together would each fire the same request. */
  const pending = IN_FLIGHT.get(query);
  if (pending) return pending;
  const run = requestPhoto(query).finally(() => IN_FLIGHT.delete(query));
  IN_FLIGHT.set(query, run);
  return run;
}

async function requestPhoto(query) {
  try {
    const url = `${PEXELS_PROXY_URL}?query=${encodeURIComponent(query)}`;
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    /* No branch per status code on purpose: 400/429/502/503 all mean the same
       thing to the UI, and the response body is never surfaced to the user. */
    if (!r.ok) throw new Error("proxy " + r.status);
    const d = await r.json();
    const p = d && d.photo;
    /* Keep every offered size so the browser — not this module — picks the one
       that fits the viewport (see pexelsSrcset below). Requesting large2x
       unconditionally shipped a ~1.9× wider image than a phone can use. */
    const sizes = (p && p.src) || {};
    const src = sizes.large || sizes.medium || sizes.large2x || "";
    const out = src
      ? {
          src,
          sizes,
          photographer: p.photographer || "",
          link: p.link || "",
          alt: p.alt || "",
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

/* Pexels publishes `large` at 940px wide and `large2x` at 1880px; the other
   keys are height-constrained, so only these two carry a reliable `w`
   descriptor. Letting the browser choose spares phones a 1880px download. */
function pexelsSrcset(sizes = {}) {
  return [sizes.large && `${sizes.large} 940w`, sizes.large2x && `${sizes.large2x} 1880w`]
    .filter(Boolean)
    .join(", ");
}
const PEXELS_SIZES_ATTR = "(max-width: 640px) 100vw, (max-width: 1080px) 65vw, 720px";

/* Keep a compact, visible Pexels source link without covering the photograph
   with a long sentence. The full photographer credit remains available as the
   accessible name and native tooltip. Only called for a real Pexels result —
   curated local images, flags and emoji fallbacks get none.
   `host` is separate from the photo element because two of the three photo
   containers can't hold readable text: the hero's landmark layer is
   pointer-events:none behind the hero copy, and the map info thumbnail is
   96×66px. Callers point the credit at a sensible nearby container instead. */
function renderPhotoCredit(host, photo, extraClass = "") {
  host.querySelector(":scope > .loc-credit")?.remove();
  /* the URL comes from a third-party API — only ever follow a real https link */
  if (!photo.photographer || !/^https:\/\//i.test(photo.link || "")) return;
  const label = t("photoCredit").replace("{photographer}", photo.photographer);
  const a = document.createElement("a");
  a.className = `loc-credit ${extraClass}`.trim();
  a.href = photo.link;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "Pexels ↗";
  a.setAttribute("aria-label", label);
  a.title = label;
  host.dataset.credit = label;
  host.appendChild(a);
}

export async function hydrateLocPhoto(el, loc, opts = {}) {
  if (!el || !loc) return;
  const token = photoToken;
  const creditHost = opts.creditHost || el;
  const sizesAttr = opts.sizes || PEXELS_SIZES_ATTR;
  /* The token guards the ONE visual that tracks the selected location (hero,
     map info): a new selection must cancel the previous fetch's swap. Cards
     that show a fixed place of their own — the explore carousel — opt out, or
     picking a location mid-load would leave them stuck on the fallback. */
  const stale = () => opts.raceGuard !== false && token !== photoToken;
  const done = () => {
    if (!stale()) el.classList.remove("loading");
  };
  /* `photo` is null for local/curated images — that's what suppresses the credit */
  const swap = (src, photo) => {
    if (stale() || !src) return done();
    const srcset = photo ? pexelsSrcset(photo.sizes) : "";
    const pre = new Image();
    /* preload through the same srcset/sizes the real <img> will use, so the
       candidate the browser picks is already cached when we swap it in */
    if (srcset) {
      pre.sizes = sizesAttr;
      pre.srcset = srcset;
    }
    pre.onload = () => {
      if (stale()) return;
      let img = el.querySelector("img.loc-photo-img");
      if (!img) {
        img = document.createElement("img");
        img.className = "loc-photo-img";
        img.decoding = "async";
        el.appendChild(img);
      }
      /* Pexels supplies a description ("Eiffel Tower at dusk"); curated and
         fallback visuals stay decorative with an empty alt. Assigned via the
         property, so the value is escaped by the DOM rather than by us. */
      img.alt = opts.decorative ? "" : (photo && photo.alt) || "";
      if (srcset) {
        img.sizes = sizesAttr;
        img.srcset = srcset;
      }
      img.src = src;
      el.classList.add("has-photo");
      if (photo) renderPhotoCredit(creditHost, photo, opts.creditClass);
      done();
    };
    pre.onerror = done;
    pre.src = src;
  };
  if (loc.landmark && loc.landmark.img) return swap(loc.landmark.img, null);
  if (loc.img) return swap(loc.img, null);
  let photo;
  try {
    photo = await fetchPexelsPhoto(pexelsQuery(loc));
  } catch {
    return done();
  }
  if (stale()) return;
  if (photo && photo.src) swap(photo.src, photo);
  else done(); // keep gradient/SVG fallback
}
