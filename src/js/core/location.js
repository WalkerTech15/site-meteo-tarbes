/* Location display formatting (name/region/country/kind, local clock) and
   flag resolution — the language-aware layer built on top of the pure
   lookup tables in data/flags.js. */
import { state } from "./state.js";
import { t } from "./i18n.js";
import { normalize } from "../data/locations.js";
import {
  countryFlagSrc,
  flagImgTag,
  flagHtml,
  flagAlt as flagAltFor,
  regionFlagSrc,
  regionKeyFromName,
  US_CODE_TO_KEY,
  CA_CODE_TO_KEY,
  RC_TO_KEY,
} from "../data/flags.js";

export function locName(loc) {
  return loc.name[state.lang] || loc.name.en;
}

/* Local clock at the selected city, not the visitor's. Falls back silently to
   no display if the zone id is missing/invalid (Intl throws on a bad zone).
   Format (12/24-hour) and the optional seconds are the user's own choice
   (Settings → Time, see features/settings.js), never inferred from language. */
const _clockFmt = {};
export function localTimeStr(tz) {
  if (!tz) return null;
  const locale = state.lang === "fr" ? "fr-FR" : "en-US";
  const hourCycle = state.clockFormat === "12" ? "h12" : "h23";
  const key = `${locale}::${tz}::${hourCycle}::${state.clockSeconds ? 1 : 0}`;
  try {
    const fmt =
      _clockFmt[key] ||
      (_clockFmt[key] = new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        ...(state.clockSeconds ? { second: "2-digit" } : {}),
        hourCycle,
      }));
    return fmt.format(new Date());
  } catch {
    return null; /* unknown/invalid IANA id */
  }
}

/* Country names come from Intl.DisplayNames (ISO alpha-2 code + active
   language) — no manual translation table. Manual strings stay as fallback. */
const _displayNames = {};
export function countryName(cc, fallback = "") {
  if (cc && cc.length === 2) {
    try {
      const dn =
        _displayNames[state.lang] ||
        (_displayNames[state.lang] = new Intl.DisplayNames([state.lang], {
          type: "region",
          fallback: "code",
        }));
      const name = dn.of(cc.toUpperCase());
      if (name && name !== cc.toUpperCase()) return name;
    } catch {
      /* unsupported code or runtime — fall back below */
    }
  }
  return fallback;
}
export function locCountry(loc) {
  return countryName(loc.cc, (loc.country && (loc.country[state.lang] || loc.country.en)) || "");
}
export function locRegion(loc) {
  const r = loc.region[state.lang] || loc.region.en || "";
  /* display-only: geocoders return the anglicized "Quebec" in both languages */
  return state.lang === "fr" ? r.replace(/\bQuebec\b/g, "Québec") : r;
}
/* Accessible name for a place card: "Lyon, France".
   A country is its own country, so the naive name + country pair produced
   "France, France" / "Vietnam, Vietnam" — describe the type instead. */
export function locAccessibleName(loc) {
  const name = locName(loc);
  if (loc.kind === "country") return t("countryAria").replace("{name}", name);
  const country = locCountry(loc);
  return country && country !== name ? `${name}, ${country}` : name;
}

/* Plain "place, country" label for headings/subtitles — never repeats the
   country when the location IS the country, nor when the place's own name
   and its country name are the same place written differently (curated
   data and live geocoder results don't always agree on diacritics/case, so
   the comparison goes through the same normalize() search uses, not a raw
   string ===). Distinct from locAccessibleName(), which adds a "country"
   kind suffix for screen readers instead of a bare name. */
export function locHierarchyLabel(loc) {
  const name = locName(loc);
  if (loc.kind === "country") return name;
  const country = locCountry(loc);
  if (!country || normalize(country) === normalize(name)) return name;
  return `${name}, ${country}`;
}

export function kindLabel(kind) {
  return (
    {
      country: t("kindCountry"),
      state: t("kindState"),
      province: t("kindProvince"),
      city: t("kindCity"),
      region: t("kindRegion"),
      town: t("kindTown"),
      village: t("kindVillage"),
      address: t("kindAddress"),
      poi: t("kindPlace"),
      ocean: t("kindOcean"),
      sea: t("kindOcean"),
    }[kind] || t("kindCity")
  );
}

/* The label for a whole location rather than a bare kind string.
   Identical to kindLabel(loc.kind) for everything on land, and for open
   water too — EXCEPT a lake, which core/marine-regions.js can now identify
   and which "Ocean / Sea" would plainly misdescribe. Gulfs, bays and
   straits are arms of the sea and keep that label; only the freshwater
   case needed its own. Every caller that renders a kind to the user should
   use this, so a new waterKind never has to be chased across the UI. */
export function locKindLabel(loc) {
  if (!loc) return kindLabel(undefined);
  if (loc.waterKind === "lake") return t("kindLake");
  return kindLabel(loc.kind);
}

/* Resolve a location's US-state / CA-province flag KEY from geocoding metadata —
   ISO/postal short_code first, then curated rc code, then the region's own name.
   Never from the raw typed query. Returns null for other countries or unknowns
   (e.g. Washington, D.C. → region "District of Columbia" → no match). */
export function regionKeyFor(loc) {
  if (!loc) return null;
  const cc = (loc.cc || "").toUpperCase();
  if (cc !== "US" && cc !== "CA") return null;
  const codeMap = cc === "US" ? US_CODE_TO_KEY : CA_CODE_TO_KEY;
  /* 1. explicit region code, e.g. MapTiler short_code "US-TX" / "CA-QC" */
  if (loc.regionCode) {
    const two = String(loc.regionCode).toUpperCase().split("-").pop();
    if (codeMap[two]) return codeMap[two];
  }
  /* 2. curated 2-letter rc code from data/locations.js */
  if (loc.rc && RC_TO_KEY[loc.rc.toLowerCase()]) return RC_TO_KEY[loc.rc.toLowerCase()];
  /* 3. parent region context — the state/province the place sits in. Checked
     BEFORE the own-name step so a county named "Texas" (in Oklahoma) or
     "Washington" (in Maine) uses its parent, not its own name. */
  const parent = regionKeyFromName(loc.region && loc.region.en);
  if (parent) return parent;
  /* 4. no parent region → the location itself IS the state/province */
  if (["state", "province", "region"].includes(loc.kind)) {
    return regionKeyFromName(loc.name && (loc.name.en || locName(loc)));
  }
  return null;
}

/* accessible, language-aware alt text */
export function flagAlt(name) {
  return flagAltFor(name, state.lang);
}

/* A location with no country (an ocean/sea, or a raw-coordinate fallback that
   couldn't be geocoded at all — see core/coord-location.js) has no flag to
   show: "" rather than the generic "?" placeholder flagHtml() would
   otherwise draw for an empty/unknown code. */
export function locCountryFlagHtml(loc) {
  const cc = (loc.cc || "").toUpperCase();
  if (!cc) return "";
  const cSrc = countryFlagSrc(cc);
  const inner = cSrc ? flagImgTag(cSrc, flagAlt(locCountry(loc) || cc)) : flagHtml(cc);
  return `<span class="location-flag-wrap">${inner}</span>`;
}

/* The state/province flag alone (US/CA only — see regionKeyFor), or "" when
   the location has no country, no US/CA region, or no matching flag asset. */
export function locRegionFlagHtml(loc) {
  const key = regionKeyFor(loc);
  if (!key) return "";
  const rSrc = regionFlagSrc(key);
  if (!rSrc) return "";
  const rName = ["state", "province", "region"].includes(loc.kind) ? locName(loc) : locRegion(loc);
  return `<span class="location-flag-wrap">${flagImgTag(rSrc, flagAlt(rName || key))}</span>`;
}

/* Country flag + state/province flag (high-quality local SVGs for US/CA), in
   order [country] [region]. Reusable across search, hero, popup, info, favorites.
   Each flag gets its OWN fixed-height wrapper so the country flag and the
   state/province flag keep their different natural widths (US 19:10 vs
   California 3:2, …) — never forced to equal/square boxes. variant "small"
   uses the compact height. Returns "" (no wrapper element at all) when
   neither flag applies, e.g. an ocean/sea or an unnamed coordinate. */
export function flagsHtml(loc, variant = "") {
  const wraps = [locCountryFlagHtml(loc), locRegionFlagHtml(loc)].filter(Boolean);
  if (!wraps.length) return "";
  const small = variant === "small" ? " location-flags--small" : "";
  return `<span class="location-flags${small}">${wraps.join("")}</span>`;
}
