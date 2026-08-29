/* The ocean/no-result fallback lives here: what a clicked coordinate becomes
 * when the reverse geocoder has nothing, something partial, or everything. */
import { describe, it, expect } from "vitest";
import { coordLocation, coordLabel } from "./coord-location.js";

describe("coordLabel", () => {
  it("formats to two decimals with degree signs", () => {
    expect(coordLabel(43.23331, 0.07821)).toBe("43.23°, 0.08°");
    expect(coordLabel(-33.9, -18.4)).toBe("-33.90°, -18.40°");
  });
});

describe("coordLocation", () => {
  it("uses the resolved place name when there is one", () => {
    const loc = coordLocation(43.2333, 0.0782, {
      name: { en: "Tarbes", fr: "Tarbes" },
      region: { en: "Occitania", fr: "Occitanie" },
      country: { en: "France", fr: "France" },
      cc: "fr",
    });
    expect(loc.name).toEqual({ en: "Tarbes", fr: "Tarbes" });
    expect(loc.region).toEqual({ en: "Occitania", fr: "Occitanie" });
    expect(loc.cc).toBe("FR");
    expect(loc.coordsOnly).toBe(false);
  });

  it("names the ocean instead of falling back to raw coordinates over open water", () => {
    /* (33.2, -41.5) is e2e/mocks.js's CLICK_OCEAN — mid North Atlantic */
    const loc = coordLocation(33.2, -41.5, {});
    expect(loc.name).toEqual({ en: "Atlantic Ocean", fr: "Océan Atlantique" });
    expect(loc.kind).toBe("ocean");
    expect(loc.coordsOnly).toBe(false);
    expect(loc.region).toEqual({ en: "", fr: "" });
  });

  it("carries the finer water kind alongside the marine name", () => {
    /* `kind` stays "ocean" for every marine selection — the whole app keys
       its marine branches off it — while `waterKind` carries the detail */
    const atlantic = coordLocation(33.2, -41.5, {});
    expect(atlantic.kind).toBe("ocean");
    expect(atlantic.waterKind).toBe("ocean");

    const mediterranean = coordLocation(36, 15, {});
    expect(mediterranean.kind).toBe("ocean");
    expect(mediterranean.waterKind).toBe("sea");

    const hudson = coordLocation(60, -85, {});
    expect(hudson.waterKind).toBe("bay");

    const superior = coordLocation(47.5, -87, {});
    expect(superior.name.en).toBe("Lake Superior");
    expect(superior.waterKind).toBe("lake");
  });

  it("leaves waterKind null for a land location", () => {
    expect(coordLocation(48.8566, 2.3522, {}).waterKind).toBeNull();
    expect(coordLocation(43.2333, 0.0782, { name: { en: "Tarbes" } }).waterKind).toBeNull();
  });

  it("keeps the name pair strictly {en, fr} — the kind never leaks into it", () => {
    expect(coordLocation(33.2, -41.5, {}).name).toEqual({
      en: "Atlantic Ocean",
      fr: "Océan Atlantique",
    });
  });

  it("still falls back to raw coordinates when even the ocean/sea guess comes up empty", () => {
    /* Paris, France — inland, and outside every named-sea box too (unlike a
       Pyrenees town such as Tarbes, which the generous Mediterranean box
       also covers — see marine-regions.test.js for that documented
       tradeoff), so nearestMarineRegion() correctly declines to guess. */
    const loc = coordLocation(48.8566, 2.3522, {});
    expect(loc.name).toEqual({ en: "48.86°, 2.35°", fr: "48.86°, 2.35°" });
    expect(loc.kind).toBe("city");
    expect(loc.coordsOnly).toBe(true);
  });

  it("a real geocoded name always wins over a guessed ocean, even mid-ocean", () => {
    /* same coordinate as the ocean test above, but this time the geocoder
       DID resolve something (an island, a rig, a buoy with a name) */
    const loc = coordLocation(33.2, -41.5, { name: { en: "Sable Island", fr: "Île de Sable" } });
    expect(loc.name.en).toBe("Sable Island");
    expect(loc.kind).toBe("city");
    expect(loc.coordsOnly).toBe(false);
  });

  it("prefers the best available geographical name over coordinates", () => {
    /* no city, but the provider did know the region — that is a real name and
       beats "33.20°, -41.50°" */
    const loc = coordLocation(45, 5, { region: { en: "Auvergne", fr: "Auvergne" } });
    expect(loc.name.en).toBe("Auvergne");
    expect(loc.coordsOnly).toBe(false);
    /* and it is not repeated as its own region */
    expect(loc.region).toEqual({ en: "", fr: "" });
  });

  it("accepts a single-language string from the keyless provider", () => {
    const loc = coordLocation(51.5, -0.1, { name: "London", country: "United Kingdom" });
    expect(loc.name).toEqual({ en: "London", fr: "London" });
    expect(loc.country).toEqual({ en: "United Kingdom", fr: "United Kingdom" });
  });

  it("mints a coordinate-derived id so two clicks never collide", () => {
    const a = coordLocation(43.2333, 0.0782, {});
    const b = coordLocation(48.8566, 2.3522, {});
    expect(a.id).toBe("map-43.2333,0.0782");
    expect(a.id).not.toBe(b.id);
  });

  it("keeps the geolocation widget's own id prefix", () => {
    const loc = coordLocation(48.8566, 2.3522, {}, { idPrefix: "geo-me" });
    expect(loc.id).toBe("geo-me-48.8566,2.3522");
  });

  it("keeps a real administrative polygon but never a bare point geometry", () => {
    const polygon = { type: "MultiPolygon", coordinates: [] };
    expect(coordLocation(1, 2, { geometry: polygon }).geometry).toBe(polygon);
    expect(
      coordLocation(1, 2, { geometry: { type: "Point", coordinates: [2, 1] } }).geometry,
    ).toBeNull();
  });

  it("keeps a four-number bbox and drops a malformed one", () => {
    expect(coordLocation(1, 2, { bbox: [0, 0, 1, 1] }).bbox).toEqual([0, 0, 1, 1]);
    expect(coordLocation(1, 2, { bbox: [0, 0, 1] }).bbox).toBeNull();
  });
});
