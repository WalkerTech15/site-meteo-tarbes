/* "Never draw a rectangular bounding box as though it were the real border."
 * This is where that rule is enforced, so this is where it is tested. */
import { describe, it, expect } from "vitest";
import { selectionFeature, hasAreaGeometry, isAdministrativeArea } from "./selection-area.js";

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};
const multiPolygon = { type: "MultiPolygon", coordinates: [polygon.coordinates] };

describe("selectionFeature", () => {
  it("outlines a real Polygon supplied by the provider", () => {
    const feature = selectionFeature({ kind: "region", geometry: polygon });
    expect(feature.type).toBe("Feature");
    expect(feature.geometry).toBe(polygon);
    expect(feature.properties.kind).toBe("region");
  });

  it("outlines a real MultiPolygon (islands, overseas territories)", () => {
    expect(selectionFeature({ kind: "country", geometry: multiPolygon }).geometry).toBe(
      multiPolygon,
    );
  });

  it("draws NOTHING for a bbox-only administrative area", () => {
    /* Texas as most geocoders return it: a centre point plus a bbox. The bbox
       may frame the camera, but it is not the border and must not be drawn. */
    const texas = { kind: "region", bbox: [-106.65, 25.84, -93.51, 36.5], geometry: null };
    expect(selectionFeature(texas)).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("draws nothing for a point geometry", () => {
    const point = { kind: "city", geometry: { type: "Point", coordinates: [2.35, 48.85] } };
    expect(selectionFeature(point).features).toEqual([]);
  });

  it("draws nothing for a missing or malformed location", () => {
    expect(selectionFeature(null).features).toEqual([]);
    expect(selectionFeature({}).features).toEqual([]);
    expect(selectionFeature({ geometry: { type: "LineString" } }).features).toEqual([]);
  });
});

describe("hasAreaGeometry / isAdministrativeArea", () => {
  it("recognises only genuine area geometries", () => {
    expect(hasAreaGeometry({ geometry: polygon })).toBe(true);
    expect(hasAreaGeometry({ geometry: multiPolygon })).toBe(true);
    expect(hasAreaGeometry({ bbox: [0, 0, 1, 1] })).toBe(false);
  });

  it("treats the four administrative tiers as framable, and places as not", () => {
    for (const kind of ["country", "state", "province", "region"]) {
      expect(isAdministrativeArea({ kind })).toBe(true);
    }
    for (const kind of ["city", "town", "village", "address", "poi", undefined]) {
      expect(isAdministrativeArea({ kind })).toBe(false);
    }
  });
});
