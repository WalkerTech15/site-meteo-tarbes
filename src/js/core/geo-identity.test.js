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

/* Shaped exactly as services/geocoding-api.js#featureToLoc() converts a real
   MapTiler "county" result: MT_KIND buckets place_type "county" (also
   "subregion" / "municipal_district") onto kind: "region", the SAME internal
   kind a directly-searched top-level region gets. The distinguishing signal
   is loc.region: Camrose's carries its parent province from the feature's
   own "region" context entry, which a directly-searched Alberta would not
   have (see the bug report this fixture reproduces). */
const CAMROSE_COUNTY = {
  kind: "region",
  cc: "CA",
  regionCode: "CA-AB",
  name: { en: "Camrose", fr: "Camrose" },
  region: { en: "Alberta", fr: "Alberta" },
  country: { en: "Canada", fr: "Canada" },
};

/* A Québec regional county municipality — same shape as Camrose, but the
   parent province's name differs by language ("Quebec" EN / "Québec" FR),
   so this specifically exercises locRegion()'s language resolution. */
const HAUT_SAINT_FRANCOIS = {
  kind: "region",
  cc: "CA",
  regionCode: "CA-QC",
  name: { en: "Le Haut-Saint-François", fr: "Le Haut-Saint-François" },
  region: { en: "Quebec", fr: "Quebec" }, // MapTiler returns the anglicized form in both
  country: { en: "Canada", fr: "Canada" },
};

/* Alberta searched directly: MapTiler's context array carries ANCESTORS
   only, so a top-level region result has no self-referencing "region"
   context entry and loc.region comes back empty — never "Alberta" again. */
const ALBERTA_PROVINCE = {
  kind: "region",
  cc: "CA",
  regionCode: "CA-AB",
  name: { en: "Alberta", fr: "Alberta" },
  region: { en: "", fr: "" },
  country: { en: "Canada", fr: "Canada" },
};

const CANADA_COUNTRY = {
  kind: "country",
  cc: "CA",
  name: { en: "Canada", fr: "Canada" },
  region: { en: "", fr: "" },
  country: { en: "Canada", fr: "Canada" },
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

  /* Regression coverage for the Camrose bug: a MapTiler county/subregion/
     municipal-district result is bucketed onto the SAME internal kind
     ("region") as a top-level province searched directly. A location must
     not be assumed to BE the subdivision just because kind === "region". */
  describe("Canadian county/subregion results (kind: region with a real parent)", () => {
    it("shows the parent province's flag and name for a county (Camrose → Alberta)", () => {
      state.lang = "en";
      const id = resolveGeoIdentity(CAMROSE_COUNTY);
      expect(id.name).toBe("Camrose");
      expect(id.country).toEqual({ name: "Canada", cc: "CA" });
      expect(id.region.name).toBe("Alberta");
      expect(id.region.flag).toEqual({ type: "img", src: expect.stringContaining("alberta.svg") });
      expect(id.hierarchy).toBe("Alberta, Canada");
    });

    it("resolves the parent province's name in both English and French", () => {
      state.lang = "en";
      expect(resolveGeoIdentity(HAUT_SAINT_FRANCOIS).region.name).toBe("Quebec");
      state.lang = "fr";
      /* locRegion() corrects the anglicized "Quebec" MapTiler returns to "Québec" */
      const id = resolveGeoIdentity(HAUT_SAINT_FRANCOIS);
      expect(id.region.name).toBe("Québec");
      expect(id.region.flag).toEqual({ type: "img", src: expect.stringContaining("quebec.svg") });
      expect(id.hierarchy).toBe("Québec, Canada");
    });

    it("does not misidentify a directly-selected province as having a parent", () => {
      state.lang = "en";
      const id = resolveGeoIdentity(ALBERTA_PROVINCE);
      expect(id.name).toBe("Alberta");
      expect(id.country).toEqual({ name: "Canada", cc: "CA" });
      /* no parent context on a top-level region → no second "Alberta" chip,
         no bare hierarchy line — same rule already proven for US states
         (see "does not show an awkward repeated region for a state/province
         result" above), now confirmed for a CA "region"-kind result too */
      expect(id.region).toBeNull();
      expect(id.hierarchy).toBeNull();
    });

    it("invents no province flag for a Canada country result", () => {
      state.lang = "en";
      const id = resolveGeoIdentity(CANADA_COUNTRY);
      expect(id.country).toBeNull(); /* "Canada" would just repeat the name */
      expect(id.region).toBeNull();
      expect(id.hierarchy).toBeNull();
    });
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
