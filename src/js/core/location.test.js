import { describe, it, expect, afterEach } from "vitest";
import { state } from "./state.js";
import { locAccessibleName, locHierarchyLabel, kindLabel } from "./location.js";

const FRANCE = {
  id: "france",
  kind: "country",
  cc: "FR",
  name: { en: "France", fr: "France" },
  region: { en: "Europe", fr: "Europe" },
  country: { en: "France", fr: "France" },
};
const PARIS = {
  id: "paris",
  kind: "city",
  cc: "FR",
  name: { en: "Paris", fr: "Paris" },
  region: { en: "Île-de-France", fr: "Île-de-France" },
  country: { en: "France", fr: "France" },
};
const SAINT_GAUDENS = {
  id: "saint-gaudens",
  kind: "town",
  cc: "FR",
  name: { en: "Saint-Gaudens", fr: "Saint-Gaudens" },
  region: { en: "Occitanie", fr: "Occitanie" },
  country: { en: "France", fr: "France" },
};
const TEXAS = {
  id: "texas",
  kind: "state",
  cc: "US",
  name: { en: "Texas", fr: "Texas" },
  region: { en: "", fr: "" },
  country: { en: "United States", fr: "États-Unis" },
};

const original = state.lang;
afterEach(() => {
  state.lang = original;
});

describe("locAccessibleName", () => {
  it("describes a country by its type instead of repeating its name", () => {
    state.lang = "en";
    expect(locAccessibleName(FRANCE)).toBe("France, country");
    /* the bug this replaces */
    expect(locAccessibleName(FRANCE)).not.toBe("France, France");
  });

  it("translates the country descriptor", () => {
    state.lang = "fr";
    expect(locAccessibleName(FRANCE)).toBe("France, pays");
  });

  it("keeps place, country for cities and regions", () => {
    state.lang = "en";
    expect(locAccessibleName(PARIS)).toBe("Paris, France");
    state.lang = "fr";
    expect(locAccessibleName(PARIS)).toBe("Paris, France");
  });

  it("never repeats a name that equals its own country", () => {
    state.lang = "en";
    const singapore = {
      kind: "city",
      cc: "SG",
      name: { en: "Singapore" },
      region: { en: "" },
      country: { en: "Singapore" },
    };
    expect(locAccessibleName(singapore)).toBe("Singapore");
  });
});

describe("locHierarchyLabel", () => {
  it("shows city, country", () => {
    state.lang = "en";
    expect(locHierarchyLabel(PARIS)).toBe("Paris, France");
    state.lang = "fr";
    expect(locHierarchyLabel(PARIS)).toBe("Paris, France");
  });

  it("shows town, country", () => {
    state.lang = "en";
    expect(locHierarchyLabel(SAINT_GAUDENS)).toBe("Saint-Gaudens, France");
  });

  it("shows state/province, country without repeating either", () => {
    state.lang = "en";
    expect(locHierarchyLabel(TEXAS)).toBe("Texas, United States");
  });

  it("shows a country only once, never doubled", () => {
    state.lang = "en";
    expect(locHierarchyLabel(FRANCE)).toBe("France");
    expect(locHierarchyLabel(FRANCE)).not.toBe("France, France");
    state.lang = "fr";
    expect(locHierarchyLabel(FRANCE)).toBe("France");
  });

  it("shows only the name when there is no country to add", () => {
    state.lang = "en";
    const noCountry = {
      kind: "city",
      cc: "",
      name: { en: "Somewhere" },
      region: { en: "" },
      country: { en: "" },
    };
    expect(locHierarchyLabel(noCountry)).toBe("Somewhere");
    expect(locHierarchyLabel(noCountry)).not.toMatch(/,\s*$/);
  });

  it("de-duplicates name vs. country even when casing/accents differ", () => {
    state.lang = "en";
    /* a strict === would miss this: same place, different casing between
       the curated name and the country string */
    const shoutedSingapore = {
      kind: "city",
      cc: "SG",
      name: { en: "SINGAPORE" },
      region: { en: "" },
      country: { en: "Singapore" },
    };
    expect(locHierarchyLabel(shoutedSingapore)).toBe("SINGAPORE");

    const accentedQuebec = {
      kind: "city",
      cc: "", // no ISO code — locCountry() falls back to the raw country field below
      name: { en: "Québec" },
      region: { en: "" },
      country: { en: "québec" },
    };
    expect(locHierarchyLabel(accentedQuebec)).toBe("Québec");
  });
});

describe("kindLabel", () => {
  it("follows the interface language", () => {
    state.lang = "en";
    expect(kindLabel("country")).toBe("Country");
    state.lang = "fr";
    expect(kindLabel("country")).toBe("Pays");
  });
});
