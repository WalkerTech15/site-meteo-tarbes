import { describe, it, expect, afterEach } from "vitest";
import { state } from "./state.js";
import { locAccessibleName, kindLabel } from "./location.js";

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

describe("kindLabel", () => {
  it("follows the interface language", () => {
    state.lang = "en";
    expect(kindLabel("country")).toBe("Country");
    state.lang = "fr";
    expect(kindLabel("country")).toBe("Pays");
  });
});
