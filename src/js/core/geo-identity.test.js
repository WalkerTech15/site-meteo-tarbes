import { describe, it, expect, afterEach } from "vitest";
import { state } from "./state.js";
import { resolveGeoIdentity, geoIdentityHtml } from "./geo-identity.js";

const original = state.lang;
afterEach(() => {
  state.lang = original;
});

/* A dynamic MapTiler-shaped result — Austin resolved via the region context's
   ISO short_code, exactly like featureToLoc() in services/geocoding-api.js
   produces for a real search, never from a curated entry. */
const AUSTIN = {
  kind: "city",
  cc: "US",
  regionCode: "US-TX",
  name: { en: "Austin", fr: "Austin" },
  region: { en: "Texas", fr: "Texas" },
  country: { en: "United States", fr: "États-Unis" },
};
const MONTREAL = {
  kind: "city",
  cc: "CA",
  rc: "qc",
  name: { en: "Montréal", fr: "Montréal" },
  region: { en: "Québec", fr: "Québec" },
  country: { en: "Canada", fr: "Canada" },
};
const TARBES = {
  kind: "city",
  cc: "FR",
  name: { en: "Tarbes", fr: "Tarbes" },
  region: { en: "Occitanie", fr: "Occitanie" },
  country: { en: "France", fr: "France" },
};
const LYON = {
  kind: "city",
  cc: "FR",
  name: { en: "Lyon", fr: "Lyon" },
  region: { en: "Auvergne-Rhône-Alpes", fr: "Auvergne-Rhône-Alpes" },
  country: { en: "France", fr: "France" },
};
const FRANCE_COUNTRY = {
  kind: "country",
  cc: "FR",
  name: { en: "France", fr: "France" },
  region: { en: "Europe", fr: "Europe" },
  country: { en: "France", fr: "France" },
};
const TEXAS_STATE = {
  kind: "state",
  cc: "US",
  rc: "tx",
  name: { en: "Texas", fr: "Texas" },
  region: { en: "The South", fr: "Le Sud" },
  country: { en: "United States", fr: "États-Unis" },
};

describe("resolveGeoIdentity", () => {
  it("resolves a US-state flag from a MapTiler short_code", () => {
    state.lang = "en";
    const id = resolveGeoIdentity(AUSTIN);
    expect(id.country).toEqual({ name: "United States", cc: "US" });
    expect(id.region.name).toBe("Texas");
    expect(id.region.flag).toEqual({ type: "img", src: expect.stringContaining("texas.svg") });
    expect(id.hierarchy).toBe("Texas, United States");
  });

  it("resolves a Canadian-province flag from the curated rc code", () => {
    state.lang = "fr";
    const id = resolveGeoIdentity(MONTREAL);
    expect(id.country).toEqual({ name: "Canada", cc: "CA" });
    expect(id.region.flag).toEqual({ type: "img", src: expect.stringContaining("quebec.svg") });
    expect(id.hierarchy).toBe("Québec, Canada");
  });

  it("resolves a supported French regional flag (Occitanie)", () => {
    state.lang = "fr";
    const id = resolveGeoIdentity(TARBES);
    expect(id.country.name).toBe("France");
    expect(id.region.name).toBe("Occitanie");
    expect(id.region.flag).not.toBeNull();
    expect(id.region.flag.type).toBe("inline");
    expect(id.region.flag.html).toContain("<svg");
    expect(id.hierarchy).toBe("Occitanie, France");
  });

  it("falls back to no flag for an international region with none supported", () => {
    state.lang = "fr";
    const id = resolveGeoIdentity(LYON);
    expect(id.country.name).toBe("France");
    expect(id.region.name).toBe("Auvergne-Rhône-Alpes");
    /* a real, named region — never an invented flag for it */
    expect(id.region.flag).toBeNull();
    expect(id.hierarchy).toBe("Auvergne-Rhône-Alpes, France");
  });

  it("does not repeat a country result's own name", () => {
    state.lang = "en";
    const id = resolveGeoIdentity(FRANCE_COUNTRY);
    expect(id.country).toBeNull();
    expect(id.region).toBeNull();
    expect(id.hierarchy).toBeNull();
    expect(id.kindLabel).toBe("Country");
  });

  it("does not show an awkward repeated region for a state/province result", () => {
    state.lang = "en";
    const id = resolveGeoIdentity(TEXAS_STATE);
    expect(id.country).toEqual({ name: "United States", cc: "US" });
    /* Texas is not its own "region" — no second Texas chip, no bare hierarchy */
    expect(id.region).toBeNull();
    expect(id.hierarchy).toBeNull();
  });

  it("falls back safely for missing or malformed locations", () => {
    expect(resolveGeoIdentity(null)).toBeNull();
    expect(resolveGeoIdentity(undefined)).toBeNull();
    expect(resolveGeoIdentity({})).toBeNull();
    expect(resolveGeoIdentity({ kind: "city" })).toBeNull();
    expect(resolveGeoIdentity("Paris")).toBeNull();
    expect(resolveGeoIdentity(42)).toBeNull();
  });

  it("falls back safely for an unresolvable country/region", () => {
    state.lang = "en";
    const unknown = {
      kind: "city",
      cc: "ZZ",
      name: { en: "Nowhereton" },
      region: { en: "Nowhereshire" },
      country: { en: "Nowhereland" },
    };
    const id = resolveGeoIdentity(unknown);
    expect(id.country.cc).toBe("ZZ");
    expect(id.country.name).toBeTruthy();
    expect(id.region.name).toBe("Nowhereshire");
    expect(id.region.flag).toBeNull(); /* text only, never a guessed flag */
  });

  it("falls back safely when a location has no region/country data at all", () => {
    state.lang = "en";
    const bare = { kind: "poi", name: { en: "Somewhere" } };
    expect(() => resolveGeoIdentity(bare)).not.toThrow();
    const id = resolveGeoIdentity(bare);
    expect(id.country).toBeNull();
    expect(id.region).toBeNull();
    expect(id.hierarchy).toBeNull();
  });
});

describe("geoIdentityHtml", () => {
  it("renders flag chips and the hierarchy line for a city", () => {
    state.lang = "en";
    const html = geoIdentityHtml(AUSTIN);
    expect(html).toContain("geo-identity-row");
    expect(html).toContain("United States");
    expect(html).toContain("Texas");
    expect(html).toContain("Texas, United States");
    expect(html).toContain('aria-label="Austin, City, United States, Texas"');
  });

  it("uses the neutral icon, not a flag, when no region flag is supported", () => {
    state.lang = "fr";
    const html = geoIdentityHtml(LYON);
    expect(html).toContain("geo-chip-icon");
    expect(html).toContain("Auvergne-Rhône-Alpes");
  });

  it("omits the whole box cleanly when nothing is available to show", () => {
    state.lang = "en";
    expect(geoIdentityHtml(FRANCE_COUNTRY)).toBe("");
    expect(geoIdentityHtml(null)).toBe("");
  });

  it("escapes location text into the aria-label and chip text", () => {
    state.lang = "en";
    const html = geoIdentityHtml({
      kind: "city",
      cc: "US",
      name: { en: 'Bad" <b>City</b>' },
      region: { en: "Texas" },
      regionCode: "US-TX",
      country: { en: "United States" },
    });
    expect(html).not.toContain("<b>City</b>");
  });
});
