import { describe, it, expect } from "vitest";
import { normalize, findLocations } from "./locations.js";

describe("normalize", () => {
  it("lowercases and strips accents", () => {
    expect(normalize("Québec")).toBe("quebec");
    expect(normalize("Viêt Nam")).toBe("viet nam");
  });
  it("trims surrounding whitespace", () => {
    expect(normalize("  Paris  ")).toBe("paris");
  });
});

describe("findLocations", () => {
  it("finds an exact match first", () => {
    const results = findLocations("paris", "en");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toMatch(/^paris/);
  });

  it("is accent- and case-insensitive", () => {
    const results = findLocations("QUÉBEC", "en");
    expect(results.some((l) => l.id === "quebec")).toBe(true);
  });

  it("matches curated aliases, not just the display name", () => {
    const results = findLocations("nyc", "en");
    expect(results.some((l) => l.id === "newyork")).toBe(true);
  });

  it("disambiguates same-named places by giving every match (Paris FR/TX/ON)", () => {
    const results = findLocations("paris", "en");
    const ids = results.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["paris", "paristx", "parison"]));
  });

  it("returns an empty array for an empty query", () => {
    expect(findLocations("", "en")).toEqual([]);
    expect(findLocations("   ", "en")).toEqual([]);
  });

  it("returns no more than 7 results", () => {
    const results = findLocations("a", "en"); // broad substring match
    expect(results.length).toBeLessThanOrEqual(7);
  });
});
