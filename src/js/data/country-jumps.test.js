import { describe, it, expect } from "vitest";
import { COUNTRY_JUMPS } from "./country-jumps.js";

/* The country-jump filter chips (Monde/France/États-Unis/Canada) resolve to
   this plain data, independent of whether a map ever renders — a wrong
   center/zoom pair is a data bug, not a rendering bug, so it belongs in a
   unit test rather than something only an animated e2e screenshot could
   (unreliably) catch. */
describe("COUNTRY_JUMPS", () => {
  it("has exactly the four filter targets, each with [lng, lat] + zoom", () => {
    expect(Object.keys(COUNTRY_JUMPS).sort()).toEqual(["canada", "france", "usa", "world"]);
    for (const jump of Object.values(COUNTRY_JUMPS)) {
      expect(Array.isArray(jump.center)).toBe(true);
      expect(jump.center).toHaveLength(2);
      const [lng, lat] = jump.center;
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(jump.zoom).toBeGreaterThan(0);
    }
  });

  it("world is zoomed further out than any single-country jump", () => {
    const single = ["france", "usa", "canada"].map((k) => COUNTRY_JUMPS[k].zoom);
    expect(Math.max(...single)).toBeGreaterThan(COUNTRY_JUMPS.world.zoom);
  });

  it("each country's coordinates actually sit over that country", () => {
    /* rough bounding boxes — enough to catch a transposed lng/lat or a
       swapped country, not a precision geography check */
    expect(COUNTRY_JUMPS.france.center[0]).toBeGreaterThan(-5);
    expect(COUNTRY_JUMPS.france.center[0]).toBeLessThan(10);
    expect(COUNTRY_JUMPS.france.center[1]).toBeGreaterThan(41);
    expect(COUNTRY_JUMPS.france.center[1]).toBeLessThan(52);

    expect(COUNTRY_JUMPS.usa.center[0]).toBeGreaterThan(-125);
    expect(COUNTRY_JUMPS.usa.center[0]).toBeLessThan(-65);
    expect(COUNTRY_JUMPS.usa.center[1]).toBeGreaterThan(24);
    expect(COUNTRY_JUMPS.usa.center[1]).toBeLessThan(50);

    expect(COUNTRY_JUMPS.canada.center[1]).toBeGreaterThan(COUNTRY_JUMPS.usa.center[1]);
  });
});
