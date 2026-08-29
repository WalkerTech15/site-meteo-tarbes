import { describe, expect, it } from "vitest";
import { isRelevantGeocodeResult, __featureToLoc } from "./geocoding-api.js";

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

/* Priority 1, the SEARCH half. MapTiler has no marine place_type this app
   maps, so an ocean or sea searched by name arrives with an unrecognised
   type and falls through MT_KIND's default to kind "city". That is what put
   "City / Ville" under the Pacific Ocean and sent "Pacific Ocean cityscape"
   to Pexels — a city photo of somewhere else entirely. featureToLoc now
   recognises the feature by its own name instead. */
describe("featureToLoc — bodies of water", () => {
  const feature = (text, extra = {}) => ({
    id: "x.1",
    text,
    place_type: ["place"] /* the unmapped-marine case: MapTiler's generic type */,
    center: [-140, 0],
    ...extra,
  });

  it("classifies a searched ocean as marine, not as a city", () => {
    const loc = __featureToLoc(feature("Pacific Ocean"));
    expect(loc.kind).toBe("ocean");
    expect(loc.waterKind).toBe("ocean");
  });

  it("keeps the finer water kind so the label and photo query can differ", () => {
    expect(__featureToLoc(feature("Lake Superior")).waterKind).toBe("lake");
    expect(__featureToLoc(feature("Gulf of Mexico")).waterKind).toBe("gulf");
    expect(__featureToLoc(feature("Hudson Bay")).waterKind).toBe("bay");
  });

  it("carries no country, region or flag code for open water", () => {
    const loc = __featureToLoc(
      feature("Mediterranean Sea", {
        properties: { country_code: "it" },
        context: [{ id: "country.1", text: "Italy", country_code: "it" }],
      }),
    );
    expect(loc.cc).toBe("");
    expect(loc.country).toEqual({ en: "", fr: "" });
    expect(loc.region).toEqual({ en: "", fr: "" });
  });

  it("uses the water gradient rather than the city one", () => {
    expect(__featureToLoc(feature("Pacific Ocean")).grad).toEqual(["#0EA5E9", "#0C4A6E"]);
  });

  it("leaves ordinary land results exactly as they were", () => {
    const loc = __featureToLoc(
      feature("Bay City", {
        center: [-83.9, 43.6],
        properties: { country_code: "us" },
        context: [{ id: "country.1", text: "United States", country_code: "us" }],
      }),
    );
    expect(loc.kind).toBe("city");
    expect(loc.waterKind).toBeNull();
    expect(loc.cc).toBe("US");
    expect(loc.grad).toEqual(["#3B82F6", "#1E40AF"]);
  });
});
