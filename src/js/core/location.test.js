import { describe, it, expect, afterEach, vi } from "vitest";
import { state } from "./state.js";
import {
  locAccessibleName,
  locHierarchyLabel,
  kindLabel,
  flagsHtml,
  regionKeyFor,
  localTimeStr,
} from "./location.js";

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

  it("has its own label for an ocean/sea — never the generic city fallback", () => {
    state.lang = "en";
    expect(kindLabel("ocean")).toBe("Ocean / Sea");
    expect(kindLabel("ocean")).not.toBe(kindLabel("city"));
    state.lang = "fr";
    expect(kindLabel("ocean")).toBe("Océan / Mer");
  });
});

/* A directly-selected Canadian province (kind: "region" — see MT_KIND in
   services/geocoding-api.js) has no parent context, so core/geo-identity.js's
   identity panel deliberately shows no separate region chip for it (same
   rule already covers a directly-selected US state). flagsHtml() is the
   OTHER place a location's flags render — the header/hero/search/favorites
   flag pair — and it must still show Alberta's own flag there, exactly
   once, via regionKeyFor()'s self-fallback (step 4: no parent → the
   location itself IS the province). */
describe("flagsHtml / regionKeyFor for a directly-selected Canadian province", () => {
  const ALBERTA_PROVINCE = {
    kind: "region",
    cc: "CA",
    regionCode: "CA-AB",
    name: { en: "Alberta", fr: "Alberta" },
    region: { en: "", fr: "" },
    country: { en: "Canada", fr: "Canada" },
  };

  it("resolves Alberta as its own region key, not a parent's", () => {
    state.lang = "en";
    expect(regionKeyFor(ALBERTA_PROVINCE)).toBe("alberta");
  });

  it("renders the country flag plus Alberta's own flag exactly once, each", () => {
    state.lang = "en";
    const html = flagsHtml(ALBERTA_PROVINCE);
    expect(html.match(/location-flag-wrap/g)).toHaveLength(2); /* country + province, no more */
    expect(html.match(/alberta\.svg/g)).toHaveLength(1);
    expect(html.match(/ca\.svg/g)).toHaveLength(1);
  });

  it("does the same for a Canadian county (Camrose → Alberta)", () => {
    state.lang = "en";
    const camrose = {
      kind: "region",
      cc: "CA",
      regionCode: "CA-AB",
      name: { en: "Camrose", fr: "Camrose" },
      region: { en: "Alberta", fr: "Alberta" },
      country: { en: "Canada", fr: "Canada" },
    };
    /* the county's OWN flag pair uses its parent's name/flag, never its own */
    expect(regionKeyFor(camrose)).toBe("alberta");
    const html = flagsHtml(camrose);
    expect(html.match(/alberta\.svg/g)).toHaveLength(1);
  });
});

/* A location with no country at all — an ocean/sea (core/marine-regions.js)
   or a raw coordinate the geocoder couldn't name (core/coord-location.js) —
   used to fall through to flagHtml("")'s generic "?" placeholder. It must
   now render no flag markup whatsoever. */
describe("flagsHtml for a location with no country (ocean/sea, unnamed coordinate)", () => {
  const OCEAN = {
    kind: "ocean",
    cc: "",
    name: { en: "Atlantic Ocean", fr: "Océan Atlantique" },
    region: { en: "", fr: "" },
    country: { en: "", fr: "" },
  };

  it("renders nothing for an ocean/sea selection, never the '?' placeholder", () => {
    state.lang = "en";
    const html = flagsHtml(OCEAN);
    expect(html).toBe("");
    expect(html).not.toContain("?");
    expect(html).not.toContain("flag-txt");
  });

  it("renders nothing for an unnamed raw-coordinate fallback either", () => {
    state.lang = "en";
    expect(flagsHtml({ cc: "", kind: "city" })).toBe("");
  });

  it("still renders the real flag once a country IS known — this isn't a global regression", () => {
    state.lang = "en";
    expect(flagsHtml(FRANCE)).not.toBe("");
    expect(flagsHtml(FRANCE)).toContain("location-flag-wrap");
  });
});

/* The Settings → Time card's whole contract: 12/24-hour choice, the optional
   seconds, and the selected city's own IANA zone rather than the visitor's —
   see features/settings.js's setClockFormat/setClockSeconds. */
describe("localTimeStr", () => {
  const originalFormat = state.clockFormat;
  const originalSeconds = state.clockSeconds;
  /* 2026-08-28T14:05:09Z: Europe/Paris is on CEST (UTC+2) → 16:05:09,
     America/New_York is on EDT (UTC-4) → 10:05:09. */
  const INSTANT = "2026-08-28T14:05:09Z";

  afterEach(() => {
    state.clockFormat = originalFormat;
    state.clockSeconds = originalSeconds;
    vi.useRealTimers();
  });

  it("defaults to 24-hour, no seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INSTANT));
    state.lang = "en";
    state.clockFormat = "24";
    state.clockSeconds = false;
    expect(localTimeStr("Europe/Paris")).toBe("16:05");
  });

  it("switches to 12-hour with AM/PM when chosen", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INSTANT));
    state.clockFormat = "12";
    state.clockSeconds = false;
    expect(localTimeStr("Europe/Paris")).toBe("04:05 PM");
  });

  it("appends seconds only when the toggle is on", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INSTANT));
    state.clockFormat = "24";
    state.clockSeconds = false;
    expect(localTimeStr("Europe/Paris")).toBe("16:05");
    state.clockSeconds = true;
    expect(localTimeStr("Europe/Paris")).toBe("16:05:09");
  });

  it("uses the given city's IANA zone, not the host machine's", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INSTANT));
    state.clockFormat = "24";
    state.clockSeconds = false;
    expect(localTimeStr("Europe/Paris")).toBe("16:05");
    expect(localTimeStr("America/New_York")).toBe("10:05");
  });

  it("respects both interface languages for the same instant/zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INSTANT));
    state.clockFormat = "24";
    state.clockSeconds = false;
    state.lang = "en";
    const en = localTimeStr("Europe/Paris");
    state.lang = "fr";
    const fr = localTimeStr("Europe/Paris");
    expect(en).toBe("16:05");
    expect(fr).toBe("16:05");
  });

  it("returns null instead of throwing for a missing or invalid zone", () => {
    expect(localTimeStr(null)).toBeNull();
    expect(localTimeStr(undefined)).toBeNull();
    expect(localTimeStr("Not/AZone")).toBeNull();
  });
});
