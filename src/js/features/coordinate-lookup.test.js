/* What a clicked coordinate turns into, for each answer a reverse geocoder
 * can give: a place, an administrative area, nothing, or an error. */
import { describe, it, expect, vi } from "vitest";
import { resolveCoordinateLocation } from "./coordinate-lookup.js";

describe("resolveCoordinateLocation", () => {
  it("uses the provider's localized names for a real place", async () => {
    const lookup = vi.fn(async () => ({
      kind: "city",
      cc: "FR",
      name: { en: "Tarbes", fr: "Tarbes" },
      region: { en: "Occitania", fr: "Occitanie" },
      country: { en: "France", fr: "France" },
    }));
    const { loc, geocodeFailed } = await resolveCoordinateLocation(43.2333, 0.0782, { lookup });
    expect(lookup).toHaveBeenCalledWith(43.2333, 0.0782);
    expect(geocodeFailed).toBe(false);
    expect(loc.name.fr).toBe("Tarbes");
    expect(loc.region.en).toBe("Occitania");
    expect(loc.coordsOnly).toBe(false);
  });

  it("carries an administrative area's bbox and polygon through", async () => {
    const geometry = { type: "MultiPolygon", coordinates: [] };
    const { loc } = await resolveCoordinateLocation(43.9, 1.75, {
      lookup: async () => ({
        kind: "region",
        name: { en: "Occitania", fr: "Occitanie" },
        bbox: [0.2, 42.7, 3.3, 45.1],
        geometry,
        regionCode: "FR-OCC",
      }),
    });
    expect(loc.kind).toBe("region");
    expect(loc.bbox).toEqual([0.2, 42.7, 3.3, 45.1]);
    expect(loc.geometry).toBe(geometry);
    expect(loc.regionCode).toBe("FR-OCC");
  });

  it("falls back to the coordinate over open ocean (no feature returned)", async () => {
    const { loc, geocodeFailed } = await resolveCoordinateLocation(33.2, -41.5, {
      lookup: async () => null,
    });
    expect(geocodeFailed).toBe(false); /* an empty answer is not a failure */
    expect(loc.coordsOnly).toBe(true);
    expect(loc.name.en).toBe("33.20°, -41.50°");
  });

  it("reports a provider failure separately, still returning a usable location", async () => {
    const { loc, geocodeFailed } = await resolveCoordinateLocation(48.8566, 2.3522, {
      lookup: async () => {
        throw new Error("offline");
      },
    });
    expect(geocodeFailed).toBe(true);
    expect(loc.name.en).toBe("48.86°, 2.35°");
    expect(loc.lat).toBe(48.8566);
    expect(loc.lon).toBe(2.3522);
  });

  it("never throws, whatever the provider does", async () => {
    await expect(
      resolveCoordinateLocation(0, 0, {
        lookup: () => Promise.reject(new TypeError("boom")),
      }),
    ).resolves.toBeDefined();
  });
});
