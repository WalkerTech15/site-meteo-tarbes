/* Country/region flags: hand-drawn SVG fallbacks, real SVG asset paths
   (served from public/assets/flags/, never imported as JS modules), and the
   code/name → region-key lookup tables used to pick a US state / Canadian
   province flag from geocoder metadata. Pure data + pure lookups only — no
   dependency on app state (see core/location.js for the language-aware
   resolution built on top of this). */
import { normalize } from "./locations.js";

const _UJ = `
  <rect width="24" height="18" fill="#012169"/>
  <path d="M0 0 24 18 M24 0 0 18" stroke="#fff" stroke-width="3.6"/>
  <path d="M0 0 24 18 M24 0 0 18" stroke="#C8102E" stroke-width="1.4"/>
  <path d="M12 0 V18 M0 9 H24" stroke="#fff" stroke-width="6"/>
  <path d="M12 0 V18 M0 9 H24" stroke="#C8102E" stroke-width="3.4"/>`;

function _star5(cx, cy, r, fill = "#fff") {
  let pts = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.42;
    pts += `${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)} `;
  }
  return `<polygon points="${pts.trim()}" fill="${fill}"/>`;
}

const FLAG_SVGS = {
  FR: `<rect width="8" height="18" fill="#002395"/><rect x="8" width="8" height="18" fill="#fff"/><rect x="16" width="8" height="18" fill="#ED2939"/>`,
  IT: `<rect width="8" height="18" fill="#009246"/><rect x="8" width="8" height="18" fill="#fff"/><rect x="16" width="8" height="18" fill="#CE2B37"/>`,
  DE: `<rect width="24" height="6" fill="#111"/><rect y="6" width="24" height="6" fill="#DD0000"/><rect y="12" width="24" height="6" fill="#FFCE00"/>`,
  ES: `<rect width="24" height="18" fill="#AA151B"/><rect y="4.5" width="24" height="9" fill="#F1BF00"/>`,
  JP: `<rect width="24" height="18" fill="#fff"/><circle cx="12" cy="9" r="5" fill="#BC002D"/>`,
  VN: `<rect width="24" height="18" fill="#DA251D"/>${_star5(12, 9, 5, "#FFFF00")}`,
  US: `<rect width="24" height="18" fill="#fff"/>${[0, 2, 4, 6, 8, 10, 12].map((i) => `<rect y="${(i * 18) / 13}" width="24" height="${18 / 13}" fill="#B22234"/>`).join("")}<rect width="10.5" height="${(18 * 7) / 13}" fill="#3C3B6E"/>${[
    [2, 2],
    [5.2, 2],
    [8.4, 2],
    [3.6, 4.4],
    [6.8, 4.4],
    [2, 6.8],
    [5.2, 6.8],
    [8.4, 6.8],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".75" fill="#fff"/>`)
    .join("")}`,
  CA: `<rect width="24" height="18" fill="#fff"/><rect width="6" height="18" fill="#D80621"/><rect x="18" width="6" height="18" fill="#D80621"/><path d="M12 3.6l.9 1.9 1.5-.8-.3 1.9 1.9-.4-.9 1.7 1.9.7-1.7 1.1 1.2 1.5-2-.2.2 2-1.8-1-.9 1.6-.9-1.6-1.8 1 .2-2-2 .2 1.2-1.5-1.7-1.1 1.9-.7-.9-1.7 1.9.4-.3-1.9 1.5.8z" fill="#D80621"/>`,
  GB: _UJ,
  AU: `<rect width="24" height="18" fill="#012169"/><g transform="scale(.5)">${_UJ}</g>${_star5(6, 13.6, 2.1)}${_star5(18, 4, 1.3)}${_star5(21.3, 7.2, 1.3)}${_star5(18, 12.8, 1.3)}${_star5(14.8, 7.8, 1.3)}${_star5(19.5, 9.4, 0.8)}`,
};

/* US state & Canadian province flags (simplified). Missing one → country flag alone. */
const REGION_FLAGS = {
  tx: `<rect width="24" height="18" fill="#fff"/><rect y="9" width="24" height="9" fill="#BF0A30"/><rect width="8" height="18" fill="#002868"/>${_star5(4, 9, 2.6)}`,
  ca: `<rect width="24" height="18" fill="#fff"/><rect y="14.5" width="24" height="3.5" fill="#B71234"/>${_star5(3.5, 3.5, 1.8, "#B71234")}<ellipse cx="12" cy="9" rx="5" ry="2.6" fill="#7A5641"/>`,
  nv: `<rect width="24" height="18" fill="#003876"/>${_star5(4.5, 4.5, 2, "#C0C0C0")}`,
  az: `<rect width="24" height="18" fill="#BF0A30"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="M12 9 L${i * 4 - 2} 0 L${i * 4 + 2} 0 Z" fill="${i % 2 ? "#FED700" : "#BF0A30"}"/>`).join("")}<rect y="9" width="24" height="9" fill="#002868"/>${_star5(12, 9, 3, "#CE5C17")}`,
  fl: `<rect width="24" height="18" fill="#fff"/><path d="M0 0 24 18 M24 0 0 18" stroke="#BF0A30" stroke-width="2.6"/><circle cx="12" cy="9" r="3.4" fill="#F4B223" stroke="#8A6D1F" stroke-width=".6"/>`,
  ny: `<rect width="24" height="18" fill="#00247D"/><circle cx="12" cy="9" r="4.6" fill="#F4C430"/><circle cx="12" cy="9" r="3.2" fill="#2E6FB7"/>`,
  qc: `<rect width="24" height="18" fill="#003DA5"/><path d="M10.5 0h3v18h-3zM0 7.5h24v3H0z" fill="#fff"/><g fill="#fff">${[
    [5, 3.5],
    [19, 3.5],
    [5, 13.5],
    [19, 13.5],
  ]
    .map(
      ([x, y]) =>
        `<path d="M${x} ${y - 2} q1.4 1 .9 2.4 l-.9 -.5 -.9 .5 q-.5 -1.4 .9 -2.4z M${x - 1.6} ${y} q1.2 -.4 1.6 .8 q.4 -1.2 1.6 -.8 q-.2 1.4 -1.6 1.4 q-1.4 0 -1.6 -1.4z"/>`,
    )
    .join("")}</g>`,
  on: `<rect width="24" height="18" fill="#C8102E"/><g transform="scale(.5)">${_UJ}</g><rect x="15" y="9" width="6.5" height="7.5" rx="1.2" fill="#fff"/><rect x="15" y="9" width="6.5" height="2.6" fill="#C8102E"/><path d="M15 11.6h6.5v4.9h-6.5z" fill="#F4C430" opacity=".85"/>`,
  bc: `<rect width="24" height="18" fill="#fff"/><g transform="scale(1,.44)">${_UJ}</g><circle cx="12" cy="8.6" r="3" fill="#F4C430"/><path d="M0 10h24v2.6H0zM0 14h24v2.6H0z" fill="#0053A0"/><path d="M0 12.6h24v1.4H0zM0 16.6h24v1.4H0z" fill="#fff"/>`,
  ab: `<rect width="24" height="18" fill="#00337F"/><rect x="7.5" y="4" width="9" height="10" rx="1.4" fill="#fff"/><rect x="7.5" y="4" width="9" height="2.6" fill="#C8102E"/><path d="M7.5 9.5 10 8l2 1.2 2.4-1.6 2.6 1.9V14h-9z" fill="#3E7C3A"/><rect x="7.5" y="12" width="9" height="2" fill="#F4C430"/>`,
};

export function regionFlagHtml(rc, cls = "") {
  const body = REGION_FLAGS[rc];
  if (!body) return "";
  return `<svg class="flag ${cls}" viewBox="0 0 24 18" aria-hidden="true">${body}<rect width="24" height="18" rx="2.5" fill="none" stroke="rgba(15,23,42,.14)" stroke-width="1"/></svg>`;
}

/* High-quality regional flag system — real public-domain SVG assets
   (Wikimedia Commons) served from public/assets/flags/. Centralized
   name/code → file mappings; a duplicate city name NEVER decides the
   region — the caller passes geocoder metadata (see core/location.js's
   regionKeyFor). All 50 US states + 13 CA provinces/territories. */
const FLAG_BASE = `${import.meta.env.BASE_URL}assets/flags`;
const COUNTRY_FLAG_FILES = {
  US: FLAG_BASE + "/countries/us.svg",
  CA: FLAG_BASE + "/countries/ca.svg",
};
const US_STATE_FLAGS = {
  alabama: FLAG_BASE + "/us-states/alabama.svg",
  alaska: FLAG_BASE + "/us-states/alaska.svg",
  arizona: FLAG_BASE + "/us-states/arizona.svg",
  arkansas: FLAG_BASE + "/us-states/arkansas.svg",
  california: FLAG_BASE + "/us-states/california.svg",
  colorado: FLAG_BASE + "/us-states/colorado.svg",
  connecticut: FLAG_BASE + "/us-states/connecticut.svg",
  delaware: FLAG_BASE + "/us-states/delaware.svg",
  florida: FLAG_BASE + "/us-states/florida.svg",
  georgia: FLAG_BASE + "/us-states/georgia.svg",
  hawaii: FLAG_BASE + "/us-states/hawaii.svg",
  idaho: FLAG_BASE + "/us-states/idaho.svg",
  illinois: FLAG_BASE + "/us-states/illinois.svg",
  indiana: FLAG_BASE + "/us-states/indiana.svg",
  iowa: FLAG_BASE + "/us-states/iowa.svg",
  kansas: FLAG_BASE + "/us-states/kansas.svg",
  kentucky: FLAG_BASE + "/us-states/kentucky.svg",
  louisiana: FLAG_BASE + "/us-states/louisiana.svg",
  maine: FLAG_BASE + "/us-states/maine.svg",
  maryland: FLAG_BASE + "/us-states/maryland.svg",
  massachusetts: FLAG_BASE + "/us-states/massachusetts.svg",
  michigan: FLAG_BASE + "/us-states/michigan.svg",
  minnesota: FLAG_BASE + "/us-states/minnesota.svg",
  mississippi: FLAG_BASE + "/us-states/mississippi.svg",
  missouri: FLAG_BASE + "/us-states/missouri.svg",
  montana: FLAG_BASE + "/us-states/montana.svg",
  nebraska: FLAG_BASE + "/us-states/nebraska.svg",
  nevada: FLAG_BASE + "/us-states/nevada.svg",
  "new-hampshire": FLAG_BASE + "/us-states/new-hampshire.svg",
  "new-jersey": FLAG_BASE + "/us-states/new-jersey.svg",
  "new-mexico": FLAG_BASE + "/us-states/new-mexico.svg",
  "new-york": FLAG_BASE + "/us-states/new-york.svg",
  "north-carolina": FLAG_BASE + "/us-states/north-carolina.svg",
  "north-dakota": FLAG_BASE + "/us-states/north-dakota.svg",
  ohio: FLAG_BASE + "/us-states/ohio.svg",
  oklahoma: FLAG_BASE + "/us-states/oklahoma.svg",
  oregon: FLAG_BASE + "/us-states/oregon.svg",
  pennsylvania: FLAG_BASE + "/us-states/pennsylvania.svg",
  "rhode-island": FLAG_BASE + "/us-states/rhode-island.svg",
  "south-carolina": FLAG_BASE + "/us-states/south-carolina.svg",
  "south-dakota": FLAG_BASE + "/us-states/south-dakota.svg",
  tennessee: FLAG_BASE + "/us-states/tennessee.svg",
  texas: FLAG_BASE + "/us-states/texas.svg",
  utah: FLAG_BASE + "/us-states/utah.svg",
  vermont: FLAG_BASE + "/us-states/vermont.svg",
  virginia: FLAG_BASE + "/us-states/virginia.svg",
  washington: FLAG_BASE + "/us-states/washington.svg",
  "west-virginia": FLAG_BASE + "/us-states/west-virginia.svg",
  wisconsin: FLAG_BASE + "/us-states/wisconsin.svg",
  wyoming: FLAG_BASE + "/us-states/wyoming.svg",
};
const CANADA_REGION_FLAGS = {
  alberta: FLAG_BASE + "/canada-regions/alberta.svg",
  "british-columbia": FLAG_BASE + "/canada-regions/british-columbia.svg",
  manitoba: FLAG_BASE + "/canada-regions/manitoba.svg",
  "new-brunswick": FLAG_BASE + "/canada-regions/new-brunswick.svg",
  "newfoundland-and-labrador": FLAG_BASE + "/canada-regions/newfoundland-and-labrador.svg",
  "nova-scotia": FLAG_BASE + "/canada-regions/nova-scotia.svg",
  ontario: FLAG_BASE + "/canada-regions/ontario.svg",
  "prince-edward-island": FLAG_BASE + "/canada-regions/prince-edward-island.svg",
  quebec: FLAG_BASE + "/canada-regions/quebec.svg",
  saskatchewan: FLAG_BASE + "/canada-regions/saskatchewan.svg",
  "northwest-territories": FLAG_BASE + "/canada-regions/northwest-territories.svg",
  nunavut: FLAG_BASE + "/canada-regions/nunavut.svg",
  yukon: FLAG_BASE + "/canada-regions/yukon.svg",
};

/* ISO 3166-2 / postal 2-letter code → region key (used when MapTiler supplies a
   short_code like "US-TX" / "CA-QC", the most reliable signal). */
export const US_CODE_TO_KEY = {
  AL: "alabama",
  AK: "alaska",
  AZ: "arizona",
  AR: "arkansas",
  CA: "california",
  CO: "colorado",
  CT: "connecticut",
  DE: "delaware",
  FL: "florida",
  GA: "georgia",
  HI: "hawaii",
  ID: "idaho",
  IL: "illinois",
  IN: "indiana",
  IA: "iowa",
  KS: "kansas",
  KY: "kentucky",
  LA: "louisiana",
  ME: "maine",
  MD: "maryland",
  MA: "massachusetts",
  MI: "michigan",
  MN: "minnesota",
  MS: "mississippi",
  MO: "missouri",
  MT: "montana",
  NE: "nebraska",
  NV: "nevada",
  NH: "new-hampshire",
  NJ: "new-jersey",
  NM: "new-mexico",
  NY: "new-york",
  NC: "north-carolina",
  ND: "north-dakota",
  OH: "ohio",
  OK: "oklahoma",
  OR: "oregon",
  PA: "pennsylvania",
  RI: "rhode-island",
  SC: "south-carolina",
  SD: "south-dakota",
  TN: "tennessee",
  TX: "texas",
  UT: "utah",
  VT: "vermont",
  VA: "virginia",
  WA: "washington",
  WV: "west-virginia",
  WI: "wisconsin",
  WY: "wyoming",
};
export const CA_CODE_TO_KEY = {
  AB: "alberta",
  BC: "british-columbia",
  MB: "manitoba",
  NB: "new-brunswick",
  NL: "newfoundland-and-labrador",
  NS: "nova-scotia",
  ON: "ontario",
  PE: "prince-edward-island",
  QC: "quebec",
  SK: "saskatchewan",
  NT: "northwest-territories",
  NU: "nunavut",
  YT: "yukon",
};
/* short 2-letter codes used inside the curated locations.js entries (loc.rc) */
export const RC_TO_KEY = {
  az: "arizona",
  ca: "california",
  fl: "florida",
  nv: "nevada",
  ny: "new-york",
  tx: "texas",
  ab: "alberta",
  bc: "british-columbia",
  on: "ontario",
  qc: "quebec",
};

/* French region names → key (MapTiler returns localized names in FR mode; only
   the ones that differ from English need listing — Texas, Ohio, Ontario… match
   directly). Keys are in normalized-kebab form (accents stripped, lowercased). */
const FR_REGION_ALIASES = {
  // US states
  californie: "california",
  floride: "florida",
  "caroline-du-nord": "north-carolina",
  "caroline-du-sud": "south-carolina",
  "dakota-du-nord": "north-dakota",
  "dakota-du-sud": "south-dakota",
  georgie: "georgia",
  hawai: "hawaii",
  louisiane: "louisiana",
  "nouveau-mexique": "new-mexico",
  pennsylvanie: "pennsylvania",
  virginie: "virginia",
  "virginie-occidentale": "west-virginia",
  // Canada provinces / territories
  "colombie-britannique": "british-columbia",
  "nouvelle-ecosse": "nova-scotia",
  "nouveau-brunswick": "new-brunswick",
  "terre-neuve-et-labrador": "newfoundland-and-labrador",
  "ile-du-prince-edouard": "prince-edward-island",
  "territoires-du-nord-ouest": "northwest-territories",
};

/* normalized region NAME → key, e.g. "Québec"→"quebec", "New York"→"new-york",
   "Floride"→"florida", "État de New York"→"new-york". Handles EN + FR names and
   strips "État de / State of / Province de" prefixes. Returns null for non-regions
   (e.g. "District of Columbia") so DC never borrows Washington's flag. */
export function regionKeyFromName(name) {
  if (!name) return null;
  const k = normalize(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stripped = k
    .replace(/^(etat|state)-(de|du|d|of)-/, "")
    .replace(/^province-(de|du|d|of)-/, "");
  for (const candidate of stripped !== k ? [k, stripped] : [k]) {
    if (US_STATE_FLAGS[candidate] || CANADA_REGION_FLAGS[candidate]) return candidate;
    if (FR_REGION_ALIASES[candidate]) return FR_REGION_ALIASES[candidate];
  }
  return null;
}
export function regionFlagSrc(key) {
  return (key && (US_STATE_FLAGS[key] || CANADA_REGION_FLAGS[key])) || null;
}
export function countryFlagSrc(cc) {
  return COUNTRY_FLAG_FILES[(cc || "").toUpperCase()] || null;
}

/* Reusable flag <img> renderer: natural aspect ratio (object-fit contain, height
   set in CSS), accessible alt, lazy, and self-removing on load error so a broken
   image is never shown (the country flag + region text remain in the layout). */
export function flagImgTag(src, alt, cls = "") {
  const safeAlt = String(alt || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  /* no `.flag` class here — sizing comes only from .location-flag-wrap so legacy
     fixed-width .flag rules can never squash the natural aspect ratio */
  return `<img class="flag-img ${cls}" src="${src}" alt="${safeAlt}" loading="lazy" decoding="async" onerror="this.remove()">`;
}

/* Accessible, language-aware alt text for a flag image (e.g. "FR flag" /
   "Drapeau : FR"). Takes `lang` explicitly so this data module stays free
   of a dependency on core/state.js. */
export function flagAlt(name, lang) {
  return lang === "fr" ? `Drapeau : ${name}` : `${name} flag`;
}

/* Real Wikimedia asset first — keeps the class="flag" sizing contract (all
   the `.chip .flag`/`.menu .flag`/etc width rules) so callers don't change,
   unlike flagImgTag() which is for the separate .location-flag-wrap system.
   The hand-drawn FLAG_SVGS below are a plain-color fallback only: detailed
   ones like the US 50-star look crude at this size and, combined with the
   .flag CSS box being forced to true-flag ratio, would distort further. */
export function flagHtml(cc, cls = "", lang = "en") {
  const src = countryFlagSrc(cc);
  if (src) {
    const safeAlt = String(flagAlt((cc || "").toUpperCase(), lang) || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<img class="flag ${cls}" src="${src}" alt="${safeAlt}" loading="lazy" decoding="async" onerror="this.remove()">`;
  }
  const body = FLAG_SVGS[cc];
  if (body) {
    /* rounded corners come from CSS clip-path — no per-instance <clipPath> ids */
    return `<svg class="flag ${cls}" viewBox="0 0 24 18" aria-hidden="true">${body}<rect width="24" height="18" rx="2.5" fill="none" stroke="rgba(15,23,42,.14)" stroke-width="1"/></svg>`;
  }
  return `<span class="flag flag-txt ${cls}" aria-hidden="true">${(cc || "?").slice(0, 2)}</span>`;
}
