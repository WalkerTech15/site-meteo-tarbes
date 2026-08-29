/* Reusable geographic-identity resolver + renderer.
 *
 * Turns a canonical location object (state.loc — curated, or dynamic from
 * MapTiler/Open-Meteo geocoding) into the pieces of a compact "what & where"
 * identity box: place name, translated place type, country flag + name,
 * region flag-or-neutral-icon + name, and a short hierarchy line.
 *
 * Everything is derived from the loc object's own resolved metadata (name,
 * region, country, cc, regionCode, rc) — never from raw text the user typed
 * into the search box. Flags only ever come from the existing country /
 * US-state / Canadian-province lookup tables in data/flags.js, plus the small
 * set of French regions with a well-established flag; a subdivision with no
 * confidently-resolved flag gets the neutral location icon instead of a
 * guessed one.
 */
import { state } from "./state.js";
import { esc } from "./dom.js";
import { locName, locCountry, locRegion, locKindLabel, regionKeyFor, flagAlt } from "./location.js";
import {
  countryFlagSrc,
  flagHtml,
  flagImgTag,
  regionFlagSrc,
  frRegionKeyFromName,
  frRegionFlagHtml,
} from "../data/flags.js";
import { GEO_ICONS } from "../data/icons.js";

/* country/state/province kinds ARE the subdivision — showing a "region" chip
   under one of these would just repeat its own name (or, for curated states/
   provinces, a loose descriptive blurb that isn't a real flaggable tier).
   Only concrete places sit under a region.
   "region" is deliberately NOT in this set. MapTiler's place_type → kind
   mapping (services/geocoding-api.js MT_KIND) collapses several distinct
   tiers onto kind: "region" — a genuine top-level admin region (Alberta,
   Occitanie) searched directly, but ALSO a county/subregion/municipal
   district WITHIN one (Camrose county → Alberta). Those two cases are told
   apart below by whether the result actually carries a distinct parent
   (loc.region), not by this kind label alone: a directly-selected region has
   no parent context and so no loc.region, while Camrose's does. */
const SUBDIVISION_KINDS = new Set(["country", "state", "province"]);

/* Resolve a CONFIDENT region flag for the identity box's region chip: the
   real US-state / CA-province SVG assets first, then — for France only —
   the small set of French regions with a well-established flag (see
   data/flags.js). Anything else returns null so the caller shows the
   neutral location icon instead of guessing. */
function resolveRegionFlag(loc, regionName) {
  const key = regionKeyFor(loc);
  if (key) {
    const src = regionFlagSrc(key);
    if (src) return { type: "img", src };
  }
  if ((loc.cc || "").toUpperCase() === "FR") {
    const frKey = frRegionKeyFromName(regionName);
    const html = frKey && frRegionFlagHtml(frKey, "geo-chip-flag");
    if (html) return { type: "inline", html };
  }
  return null;
}

/* Pure(-ish) resolver — reads only state.lang via the existing location
   helpers, never touches the DOM. Returns null for anything that isn't a
   usable location so callers can fail safely. */
export function resolveGeoIdentity(loc) {
  if (!loc || typeof loc !== "object" || !loc.kind || !loc.name) return null;

  const name = locName(loc);
  if (!name) return null;

  const countryName = locCountry(loc);
  /* omit the country chip when it would just repeat the name itself — this
     is what a "country" kind result IS, so showing "France" twice is the
     exact bug already fixed for accessible names (see locAccessibleName). */
  const country = countryName && countryName !== name ? { name: countryName, cc: loc.cc } : null;

  let region = null;
  let hierarchy = null;
  if (!SUBDIVISION_KINDS.has(loc.kind)) {
    const regionName = loc.region ? locRegion(loc) : "";
    if (regionName && regionName !== name) {
      region = { name: regionName, flag: resolveRegionFlag(loc, regionName) };
    }
    /* a hierarchy line only adds information when there's a region to pair
       with the country — "États-Unis" alone would just repeat the country
       chip verbatim. */
    if (region && country) hierarchy = `${region.name}, ${country.name}`;
    else if (region && !country) hierarchy = region.name;
  }

  return {
    name,
    kind: loc.kind,
    kindLabel: locKindLabel(loc),
    country,
    region,
    hierarchy,
  };
}

function countryChipVisual(cc, name) {
  const src = countryFlagSrc(cc);
  return src
    ? flagImgTag(src, flagAlt(name), "geo-chip-flag")
    : flagHtml(cc, "geo-chip-flag", state.lang);
}

function regionChipVisual(flag, name) {
  if (flag && flag.type === "img") return flagImgTag(flag.src, flagAlt(name), "geo-chip-flag");
  if (flag && flag.type === "inline") return flag.html;
  return `<span class="geo-chip-icon" aria-hidden="true">${GEO_ICONS.neutral}</span>`;
}

function chipHtml(visual, name) {
  return `<span class="geo-chip">${visual}<span>${esc(name)}</span></span>`;
}

/* Full markup for the box, plus a group aria-label carrying the complete
   hierarchy so a screen reader gets one coherent phrase for the section. No
   interface string is invented here — every word already came from t()
   through locCountry()/locRegion()/kindLabel(). */
export function geoIdentityHtml(loc) {
  const id = resolveGeoIdentity(loc);
  if (!id) return "";

  const chips = [];
  if (id.country)
    chips.push(chipHtml(countryChipVisual(id.country.cc, id.country.name), id.country.name));
  if (id.region)
    chips.push(chipHtml(regionChipVisual(id.region.flag, id.region.name), id.region.name));

  const label = [id.name, id.kindLabel, id.country && id.country.name, id.region && id.region.name]
    .filter(Boolean)
    .join(", ");

  if (!chips.length && !id.hierarchy) return "";

  return `
    <div class="geo-identity" role="group" aria-label="${esc(label)}">
      ${chips.length ? `<div class="geo-identity-row">${chips.join("")}</div>` : ""}
      ${id.hierarchy ? `<p class="geo-hierarchy">${esc(id.hierarchy)}</p>` : ""}
    </div>`;
}
