import { describe, it, expect } from "vitest";
import { nearestMarineRegion } from "./marine-regions.js";

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

  it("gives the French name alongside the English one", () => {
    expect(nearestMarineRegion(36, 15)).toEqual({
      en: "Mediterranean Sea",
      fr: "Mer Méditerranée",
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

  it("stays null over high-latitude Siberian land rather than guessing Arctic", () => {
    /* the Asia landmass box intentionally reaches to 82°N to cover real
       Siberian territory — this is the documented land-over-ocean tradeoff */
    expect(nearestMarineRegion(75, 150)).toBeNull();
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
});

describe("nearestMarineRegion — invalid input", () => {
  it("returns null instead of throwing for non-finite coordinates", () => {
    expect(nearestMarineRegion(NaN, 0)).toBeNull();
    expect(nearestMarineRegion(0, NaN)).toBeNull();
    expect(nearestMarineRegion(undefined, undefined)).toBeNull();
  });
});
