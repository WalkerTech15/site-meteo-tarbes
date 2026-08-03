import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { I18N } from "./translations.js";

const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

/* Every key referenced by the static markup, whatever the attribute:
   data-i18n (text), data-i18n-ph (placeholder), data-i18n-aria (accessible
   name). Kebab-case in HTML, camelCase in the dataset — the values here are
   the keys themselves, so no conversion is needed. */
function keysUsedInMarkup(attr) {
  return [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);
}

describe("translation dictionary", () => {
  it("defines the same keys in English and French", () => {
    const en = Object.keys(I18N.en).sort();
    const fr = Object.keys(I18N.fr).sort();
    expect(fr.filter((k) => !I18N.en[k])).toEqual([]);
    expect(en.filter((k) => !I18N.fr[k])).toEqual([]);
  });

  for (const attr of ["data-i18n", "data-i18n-ph", "data-i18n-aria"]) {
    it(`resolves every ${attr} key in both languages`, () => {
      const used = keysUsedInMarkup(attr);
      expect(used.length).toBeGreaterThan(0);
      expect(used.filter((k) => I18N.en[k] === undefined)).toEqual([]);
      expect(used.filter((k) => I18N.fr[k] === undefined)).toEqual([]);
    });
  }

  /* Regression: these accessible names used to be hard-coded English in the
     markup, so they stayed in English when the interface switched to French. */
  it("translates the accessible names that carry no visible text", () => {
    const ariaKeys = keysUsedInMarkup("data-i18n-aria");
    for (const key of [
      "mainNav",
      "insightsMapRegion",
      "footProduct",
      "navAbout",
      "footResources",
    ]) {
      expect(ariaKeys).toContain(key);
      expect(I18N.fr[key]).not.toBe(I18N.en[key]);
    }
    expect(I18N.fr.mainNav).toBe("Navigation principale");
    expect(I18N.fr.insightsMapRegion).toBe("Analyses météo et carte");
  });

  it("translates the MapLibre control strings", () => {
    for (const key of ["mapTitle", "mapZoomIn", "mapZoomOut", "mapToggleAttribution"]) {
      expect(I18N.en[key]).toBeTruthy();
      expect(I18N.fr[key]).toBeTruthy();
      expect(I18N.fr[key]).not.toBe(I18N.en[key]);
    }
  });

  it("leaves no accessible name in the markup untranslated", () => {
    const withoutBinding = [...html.matchAll(/<[^>]*\saria-label="([^"]*)"[^>]*>/g)]
      .filter((m) => !m[0].includes("data-i18n-aria"))
      .map((m) => m[1]);
    expect(withoutBinding).toEqual([]);
  });

  it("uses French spacing before a colon", () => {
    expect(I18N.en.footerData).toBe("Data: Open-Meteo · OpenStreetMap");
    expect(I18N.fr.footerData).toBe("Données : Open-Meteo · OpenStreetMap");
  });

  it("does not describe Pexels photos as rights-free", () => {
    expect(I18N.fr.srcPexels).toBe("Photos gratuites de lieux et monuments.");
    expect(I18N.fr.srcPexels).not.toMatch(/libres de droits|domaine public/i);
  });

  it("keeps the simple-mode description free of repetition", () => {
    expect(I18N.fr.modeSimpleDesc).toBe("Affiche uniquement les informations essentielles.");
  });
});
