import { describe, it, expect } from "vitest";
import { wmo, wxDesc, skyKey } from "./weather-codes.js";

describe("wmo", () => {
  it("resolves a known WMO code", () => {
    expect(wmo(0).icon).toBe("clear");
    expect(wmo(95).icon).toBe("storm");
  });
  it("falls back to code 0 for an unknown code", () => {
    expect(wmo(9999)).toEqual(wmo(0));
  });
});

describe("wxDesc", () => {
  it("returns the description in the requested language", () => {
    expect(wxDesc(0, "en")).toBe("Clear sky");
    expect(wxDesc(0, "fr")).toBe("Ciel dégagé");
  });
});

describe("skyKey", () => {
  it("splits clear sky into day/night variants", () => {
    expect(skyKey(0, 1)).toBe("clear-day");
    expect(skyKey(0, 0)).toBe("clear-night");
  });
  it("treats partly-cloudy as a clear variant (matches the hero gradient set)", () => {
    expect(skyKey(2, 1)).toBe("clear-day");
    expect(skyKey(2, 0)).toBe("clear-night");
  });
  it("splits overcast into its own day/night variant", () => {
    expect(skyKey(3, 1)).toBe("cloudy-day");
    expect(skyKey(3, 0)).toBe("cloudy-night");
  });
  it("has no day/night variant for rain/snow/storm/fog", () => {
    expect(skyKey(61, 1)).toBe("rain");
    expect(skyKey(61, 0)).toBe("rain");
    expect(skyKey(71, 1)).toBe("snow");
    expect(skyKey(95, 1)).toBe("storm");
    expect(skyKey(45, 1)).toBe("fog");
  });
});
