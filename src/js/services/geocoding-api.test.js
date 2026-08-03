import { describe, expect, it } from "vitest";
import { isRelevantGeocodeResult } from "./geocoding-api.js";

const location = (name, region, country, extra = {}) => ({
  name: { en: name, fr: name },
  region: { en: region, fr: region },
  country: { en: country, fr: country },
  ...extra,
});

describe("geocoding relevance filter", () => {
  it("keeps exact, accented, and prefix location matches", () => {
    const quebec = location("Québec", "Québec", "Canada", { cc: "CA" });
    expect(isRelevantGeocodeResult("Quebec", quebec)).toBe(true);
    expect(isRelevantGeocodeResult("Québ", quebec)).toBe(true);
  });

  it("keeps small misspellings and adjacent transpositions", () => {
    const paris = location("Paris", "Île-de-France", "France", { cc: "FR" });
    const york = location("New York", "New York", "United States", { cc: "US" });
    expect(isRelevantGeocodeResult("Pariss", paris)).toBe(true);
    expect(isRelevantGeocodeResult("New Yrok", york)).toBe(true);
  });

  it("uses region qualifiers to reject the wrong same-name place", () => {
    const parisFrance = location("Paris", "Île-de-France", "France", { cc: "FR" });
    const parisTexas = location("Paris", "Texas", "United States", {
      cc: "US",
      regionCode: "US-TX",
    });
    expect(isRelevantGeocodeResult("Paris Texas", parisFrance)).toBe(false);
    expect(isRelevantGeocodeResult("Paris Texas", parisTexas)).toBe(true);
    expect(isRelevantGeocodeResult("Paris TX", parisTexas)).toBe(true);
  });

  it("rejects unrelated fuzzy results that only share a generic word", () => {
    const unrelated = location("Place de l'Église", "Nouvelle-Aquitaine", "France", {
      cc: "FR",
    });
    expect(isRelevantGeocodeResult("zzzxxyy-not-a-place", unrelated)).toBe(false);
  });

  it("does not search on generic location words alone", () => {
    expect(isRelevantGeocodeResult("city", location("Paris", "Île-de-France", "France"))).toBe(
      false,
    );
  });
});
