/* Coverage for the Canadian province/territory flag lookup tables: every one
 * of the 13 resolves from both its English and French name to the same
 * region key, from its ISO 3166-2 code, and to a real SVG asset actually
 * present on disk (never an invented/guessed path — see public/assets/flags/
 * canada-regions/). This is the "flag-resolution utility" layer
 * core/geo-identity.js and core/location.js build on. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  regionKeyFromName,
  regionFlagSrc,
  countryFlagSrc,
  flagHtml,
  CA_CODE_TO_KEY,
} from "./flags.js";
import { COUNTRY_FLAG_CODES } from "./country-flag-codes.js";

const ASSET_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../public/assets/flags/canada-regions",
);
const COUNTRY_ASSET_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../public/assets/flags/countries",
);

/* [key, English name, French name, ISO 3166-2 code] for all 13 provinces and
   territories — the exact set the task requires covered. */
const PROVINCES = [
  ["alberta", "Alberta", "Alberta", "AB"],
  ["british-columbia", "British Columbia", "Colombie-Britannique", "BC"],
  ["manitoba", "Manitoba", "Manitoba", "MB"],
  ["new-brunswick", "New Brunswick", "Nouveau-Brunswick", "NB"],
  ["newfoundland-and-labrador", "Newfoundland and Labrador", "Terre-Neuve-et-Labrador", "NL"],
  ["nova-scotia", "Nova Scotia", "Nouvelle-Écosse", "NS"],
  ["ontario", "Ontario", "Ontario", "ON"],
  ["prince-edward-island", "Prince Edward Island", "Île-du-Prince-Édouard", "PE"],
  ["quebec", "Quebec", "Québec", "QC"],
  ["saskatchewan", "Saskatchewan", "Saskatchewan", "SK"],
  ["northwest-territories", "Northwest Territories", "Territoires du Nord-Ouest", "NT"],
  ["nunavut", "Nunavut", "Nunavut", "NU"],
  ["yukon", "Yukon", "Yukon", "YT"],
];

describe("Canadian province/territory flags — all 13", () => {
  it.each(PROVINCES)("%s: English name resolves to its key", (key, en) => {
    expect(regionKeyFromName(en)).toBe(key);
  });

  it.each(PROVINCES)("%s: French name resolves to the same key", (key, _en, fr) => {
    expect(regionKeyFromName(fr)).toBe(key);
  });

  it.each(PROVINCES)("%s: ISO 3166-2 code maps to the same key", (key, _en, _fr, code) => {
    expect(CA_CODE_TO_KEY[code]).toBe(key);
  });

  it.each(PROVINCES)("%s: resolves to a real, existing SVG asset", (key) => {
    const src = regionFlagSrc(key);
    expect(src).toContain(`canada-regions/${key}.svg`);
    expect(existsSync(join(ASSET_DIR, `${key}.svg`))).toBe(true);
  });

  it("covers exactly the 13 provinces and territories, no more, no fewer", () => {
    expect(PROVINCES).toHaveLength(13);
    expect(new Set(PROVINCES.map(([key]) => key)).size).toBe(13);
    expect(Object.keys(CA_CODE_TO_KEY)).toHaveLength(13);
  });

  it("never confuses a US state with a same-named Canadian province", () => {
    /* Washington (US state) must not resolve to anything Canadian */
    expect(regionKeyFromName("Washington")).toBe("washington");
  });

  it("handles 'Province de'/'État de'-prefixed forms the same as bare names", () => {
    expect(regionKeyFromName("Province de Québec")).toBe("quebec");
    expect(regionKeyFromName("Province of Ontario")).toBe("ontario");
  });
});

describe("country flags — complete local coverage", () => {
  it("resolves Poland and representative countries from every inhabited continent", () => {
    for (const code of ["PL", "FR", "NG", "BR", "IN", "JP", "AU", "US", "CA", "XK"]) {
      expect(countryFlagSrc(code)).toContain(`/countries/${code.toLowerCase()}.svg`);
    }
  });

  it("maps every declared country code to an existing local SVG", () => {
    expect(COUNTRY_FLAG_CODES.size).toBeGreaterThanOrEqual(249);
    for (const code of COUNTRY_FLAG_CODES) {
      expect(existsSync(join(COUNTRY_ASSET_DIR, `${code}.svg`)), code).toBe(true);
    }
  });

  it("uses images for known codes and keeps the text fallback for unknown codes", () => {
    expect(flagHtml("PL", "", "fr")).toContain("/countries/pl.svg");
    expect(flagHtml("PL", "", "fr")).not.toContain("flag-txt");
    expect(countryFlagSrc("UK")).toContain("/countries/gb.svg");
    expect(flagHtml("ZZ", "", "fr")).toContain("flag-txt");
  });
});
