import { describe, it, expect } from "vitest";
import { marineRegionByName, nearestMarineRegion, WATER_KINDS } from "./marine-regions.js";

describe("nearestMarineRegion — named seas/gulfs", () => {
  const cases = [
    ["Mediterranean Sea", 36, 15],
    ["Red Sea", 20, 38],
    ["Persian Gulf", 27, 51],
    ["South China Sea", 10, 113],
    ["Gulf of Mexico", 25, -90],
    ["Caribbean Sea", 15, -75],
    ["Baltic Sea", 58, 20],
    ["North Sea", 56, 3],
    ["Hudson Bay", 60, -85],
  ];
  for (const [expected, lat, lon] of cases) {
    it(`identifies ${expected} at (${lat}, ${lon})`, () => {
      expect(nearestMarineRegion(lat, lon)?.en).toBe(expected);
    });
  }

  it("gives the French name alongside the English one, and the water kind", () => {
    expect(nearestMarineRegion(36, 15)).toEqual({
      en: "Mediterranean Sea",
      fr: "Mer Méditerranée",
      kind: "sea",
    });
  });

  it("resolves the Bering Sea across the antimeridian, from both sides", () => {
    expect(nearestMarineRegion(58, 175)?.en).toBe("Bering Sea");
    expect(nearestMarineRegion(58, -170)?.en).toBe("Bering Sea");
  });
});

describe("nearestMarineRegion — basin oceans", () => {
  it("the mid-Atlantic point used by the e2e ocean-click fixture", () => {
    /* e2e/mocks.js CLICK_OCEAN — must keep resolving here for the map-click
       suite's "open ocean" test to have a stable, meaningful assertion */
    expect(nearestMarineRegion(33.2, -41.5)).toEqual({
      en: "Atlantic Ocean",
      fr: "Océan Atlantique",
      kind: "ocean",
    });
  });

  it("open Pacific, away from every named sea", () => {
    expect(nearestMarineRegion(0, -150)?.en).toBe("Pacific Ocean");
    expect(nearestMarineRegion(0, 170)?.en).toBe("Pacific Ocean");
  });

  it("open Indian Ocean, south of India", () => {
    expect(nearestMarineRegion(-20, 80)?.en).toBe("Indian Ocean");
  });

  it("Arctic Ocean above the polar band, away from Siberia's landmass box", () => {
    expect(nearestMarineRegion(80, 0)?.en).toBe("Arctic Ocean");
    expect(nearestMarineRegion(85, 150)?.en).toBe("Arctic Ocean");
  });

  it("names the Arctic marginal seas now that they are mapped", () => {
    /* (75, 150) is open water in the East Siberian Sea, well north of the
       Siberian coast. It used to return null purely because the Asia
       landmass box reaches 82°N and no Arctic sea was listed; naming it is
       the correct answer, not a relaxation of the land-safety rule. */
    expect(nearestMarineRegion(75, 150)?.en).toBe("East Siberian Sea");
  });

  it("still stays null over high-latitude Siberian LAND", () => {
    /* Yakutsk (62°N, 129.7°E) — deep inland, far south of every Arctic
       sea box, so the landmass rule still applies */
    expect(nearestMarineRegion(62, 129.7)).toBeNull();
  });

  it("Southern Ocean below the polar band", () => {
    expect(nearestMarineRegion(-65, 0)?.en).toBe("Southern Ocean");
    expect(nearestMarineRegion(-70, 100)?.en).toBe("Southern Ocean");
  });
});

describe("nearestMarineRegion — never labels land as water", () => {
  const cities = [
    ["Paris", 48.8566, 2.3522],
    ["Berlin", 52.52, 13.405],
    ["Moscow", 55.7558, 37.6173],
    ["Denver", 39.7392, -104.9903],
    ["Nairobi", -1.2921, 36.8219],
    ["Beijing", 39.9042, 116.4074],
  ];
  for (const [name, lat, lon] of cities) {
    it(`returns null for ${name} (inland, no sea/gulf nearby)`, () => {
      expect(nearestMarineRegion(lat, lon)).toBeNull();
    });
  }

  /* The boxes added for wider sea coverage are the ones most at risk of
     swallowing a real coastal settlement, so each is pinned against the
     nearest inhabited place its box was trimmed to exclude. */
  const coastalTowns = [
    ["Murmansk (Barents coast)", 68.97, 33.08],
    ["Tiksi (Laptev coast)", 71.63, 128.87],
    ["Utqiagvik (Chukchi coast)", 71.29, -156.79],
    ["Tuktoyaktuk (Beaufort coast)", 69.44, -133.03],
    ["Happy Valley-Goose Bay (Labrador)", 53.3, -60.42],
    ["Trondheim (Norwegian coast)", 63.43, 10.4],
    ["Adelaide (Australian south coast)", -34.93, 138.6],
    ["Hermosillo (Gulf of California coast)", 29.07, -110.97],
    ["Nantes (Bay of Biscay coast)", 47.22, -1.55],
    ["Portsmouth (English Channel coast)", 50.8, -1.09],
    ["Dublin (Irish Sea coast)", 53.35, -6.26],
    ["Charlottetown (Gulf of St. Lawrence)", 46.24, -63.13],
  ];
  for (const [name, lat, lon] of coastalTowns) {
    it(`returns null for ${name} rather than naming the adjacent water`, () => {
      expect(nearestMarineRegion(lat, lon)).toBeNull();
    });
  }
});

describe("nearestMarineRegion — wider sea/gulf/bay coverage", () => {
  const cases = [
    ["Gulf of Aden", 12.5, 47],
    ["Gulf of Oman", 24.5, 59],
    ["Philippine Sea", 15, 135],
    ["East China Sea", 28, 125],
    ["Yellow Sea", 36, 123],
    ["Java Sea", -5, 110],
    ["Sulu Sea", 8, 120],
    ["Gulf of Thailand", 10, 101],
    ["Timor Sea", -11, 128],
    ["Gulf of Carpentaria", -14, 138],
    ["Great Australian Bight", -36, 128],
    ["Barents Sea", 75, 40],
    ["Kara Sea", 75, 75],
    ["Baffin Bay", 74, -62],
    ["Labrador Sea", 57, -50],
    ["Weddell Sea", -70, -40],
    ["Ross Sea", -74, 175],
  ];
  for (const [expected, lat, lon] of cases) {
    it(`identifies the ${expected} at (${lat}, ${lon})`, () => {
      expect(nearestMarineRegion(lat, lon)?.en).toBe(expected);
    });
  }

  it("keeps a nested water body ahead of the one it opens into", () => {
    /* the Gulf of Carpentaria sits inside the Arafura Sea's own box —
       list order, not geometry, is what makes the specific answer win */
    expect(nearestMarineRegion(-14, 138)?.en).toBe("Gulf of Carpentaria");
    expect(nearestMarineRegion(-6, 136)?.en).toBe("Arafura Sea");
    /* and the Andaman Sea ahead of the Bay of Bengal they overlap in */
    expect(nearestMarineRegion(10, 96)?.en).toBe("Andaman Sea");
    expect(nearestMarineRegion(15, 88)?.en).toBe("Bay of Bengal");
  });

  it("leaves the Mediterranean basin itself as the answer inside it", () => {
    /* its sub-seas are deliberately not split out — see marine-regions.js */
    expect(nearestMarineRegion(36, 15)?.en).toBe("Mediterranean Sea");
    expect(nearestMarineRegion(43, 15)?.en).toBe("Mediterranean Sea");
  });
});

describe("nearestMarineRegion — water kinds", () => {
  const kindCases = [
    ["ocean", 33.2, -41.5], // Atlantic
    ["sea", 36, 15], // Mediterranean
    ["gulf", 27, 51], // Persian Gulf
    ["bay", 60, -85], // Hudson Bay
    ["lake", 47.5, -87], // Lake Superior
  ];
  for (const [kind, lat, lon] of kindCases) {
    it(`reports kind "${kind}" at (${lat}, ${lon})`, () => {
      expect(nearestMarineRegion(lat, lon)?.kind).toBe(kind);
    });
  }

  it("only ever reports a documented kind", () => {
    const samples = [
      [43, 15],
      [12.5, 47],
      [-70, -40],
      [55, 30.5],
      [0, -150],
      [75, 150],
    ];
    for (const [lat, lon] of samples) {
      const hit = nearestMarineRegion(lat, lon);
      if (hit) expect(WATER_KINDS).toContain(hit.kind);
    }
  });

  it("names the great lakes as lakes, never as seas", () => {
    const lakes = [
      ["Lake Superior", 47.5, -87],
      ["Lake Michigan", 43.5, -87],
      ["Lake Huron", 44.8, -82],
      ["Lake Erie", 42, -81],
      ["Lake Ontario", 43.7, -78],
      ["Lake Baikal", 53.5, 107],
      ["Lake Victoria", -1, 33],
      ["Lake Titicaca", -15.8, -69.3],
    ];
    for (const [expected, lat, lon] of lakes) {
      const hit = nearestMarineRegion(lat, lon);
      expect(hit?.en).toBe(expected);
      expect(hit?.kind).toBe("lake");
    }
  });
});

describe("nearestMarineRegion — invalid input", () => {
  it("returns null instead of throwing for non-finite coordinates", () => {
    expect(nearestMarineRegion(NaN, 0)).toBeNull();
    expect(nearestMarineRegion(0, NaN)).toBeNull();
    expect(nearestMarineRegion(undefined, undefined)).toBeNull();
  });
});

/* Identifying water by NAME, not coordinate. This is what stops a geocoder
   result the provider typed as an ordinary place — a search for "Pacific
   Ocean", a reverse lookup answering "Mer Méditerranée" — from being
   labelled "City / Ville" and photographed as a cityscape. */
describe("marineRegionByName", () => {
  it("recognises oceans and named seas in either interface language", () => {
    expect(marineRegionByName("Pacific Ocean")).toMatchObject({
      en: "Pacific Ocean",
      kind: "ocean",
    });
    expect(marineRegionByName("Océan Pacifique")).toMatchObject({
      en: "Pacific Ocean",
      kind: "ocean",
    });
    expect(marineRegionByName("Mer Méditerranée")).toMatchObject({
      en: "Mediterranean Sea",
      kind: "sea",
    });
  });

  it("carries the finer kind through, so a lake or gulf is not called a sea", () => {
    expect(marineRegionByName("Lake Superior").kind).toBe("lake");
    expect(marineRegionByName("Gulf of Mexico").kind).toBe("gulf");
    expect(marineRegionByName("Hudson Bay").kind).toBe("bay");
  });

  it("is case-, accent- and punctuation-tolerant", () => {
    expect(marineRegionByName("  mediterranean sea ").kind).toBe("sea");
    expect(marineRegionByName("MER MEDITERRANEE").kind).toBe("sea");
    expect(marineRegionByName("golfe d'oman").kind).toBe("gulf");
  });

  it("accepts a localized {en, fr} pair as well as a bare string", () => {
    expect(marineRegionByName({ en: "Black Sea", fr: "" }).kind).toBe("sea");
    expect(marineRegionByName({ en: "", fr: "Mer Noire" }).kind).toBe("sea");
  });

  /* Whole-name matching only. Towns whose names merely CONTAIN a water word
     must stay on land, or the fix would cause the very mislabelling it is
     meant to prevent. */
  it("never matches a land place whose name merely contains a water word", () => {
    for (const town of ["Bay City", "Oceanside", "Lake Charles", "Redwood City", "Gulfport"]) {
      expect(marineRegionByName(town)).toBeNull();
    }
  });

  it("returns null for empty or missing input", () => {
    expect(marineRegionByName("")).toBeNull();
    expect(marineRegionByName(null)).toBeNull();
    expect(marineRegionByName(undefined)).toBeNull();
    expect(marineRegionByName({})).toBeNull();
  });

  it("only ever reports a kind the rest of the app knows", () => {
    for (const name of ["Pacific Ocean", "Lake Baikal", "Gulf of Aden", "Baffin Bay"]) {
      expect(WATER_KINDS).toContain(marineRegionByName(name).kind);
    }
  });
});
