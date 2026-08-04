/* Bounding boxes are used ONLY to frame the camera on an administrative area.
 * The two cases worth guarding are the antimeridian and the "whole planet"
 * box some providers give for territories that straddle it. */
import { describe, it, expect } from "vitest";
import { normalizeBbox, isUsableBbox, clampLat, wrapLon, MAX_LAT } from "./geo-bounds.js";

describe("normalizeBbox", () => {
  it("passes an ordinary box through as SW/NE corners", () => {
    expect(normalizeBbox([-5.2, 42.3, 8.2, 51.1])).toEqual([
      [-5.2, 42.3],
      [8.2, 51.1],
    ]);
  });

  it("repairs an antimeridian-crossing box (west > east) by extending east", () => {
    /* Fiji-shaped: 177°E … -178°E is a 5°-wide span, not a 355°-wide one */
    expect(normalizeBbox([177, -19, -178, -16])).toEqual([
      [177, -19],
      [182, -16],
    ]);
  });

  it("rejects a degenerate near-360° box instead of framing the whole planet", () => {
    /* what some providers return for Alaska: the true extent cannot be
       recovered from these four numbers, so the caller falls back to the
       feature's own point + type zoom */
    expect(normalizeBbox([-179.15, 51.2, 179.77, 71.44])).toBeNull();
  });

  it("keeps Hawaii, which spans the Pacific but not the antimeridian", () => {
    expect(normalizeBbox([-178.4, 18.9, -154.8, 28.5])).toEqual([
      [-178.4, 18.9],
      [-154.8, 28.5],
    ]);
  });

  it("clamps latitudes to the Mercator limit rather than failing", () => {
    const [[, south], [, north]] = normalizeBbox([-10, -90, 10, 90]);
    expect(south).toBeCloseTo(-MAX_LAT, 4);
    expect(north).toBeCloseTo(MAX_LAT, 4);
  });

  it("tolerates a box whose corners are given in the wrong latitude order", () => {
    expect(normalizeBbox([-5, 51.1, 8, 42.3])).toEqual([
      [-5, 42.3],
      [8, 51.1],
    ]);
  });

  it.each([
    ["not an array", null],
    ["wrong length", [1, 2, 3]],
    ["non-numeric", [1, 2, "x", 4]],
    ["NaN", [1, 2, NaN, 4]],
    ["zero height", [1, 2, 5, 2]],
    ["zero width", [3, 2, 3, 6]],
  ])("rejects %s", (_label, bbox) => {
    expect(normalizeBbox(bbox)).toBeNull();
    expect(isUsableBbox(bbox)).toBe(false);
  });
});

describe("coordinate helpers", () => {
  it("clampLat stops at the Mercator limit", () => {
    expect(clampLat(90)).toBeCloseTo(MAX_LAT, 4);
    expect(clampLat(12)).toBe(12);
  });

  it("wrapLon wraps rather than clamping", () => {
    expect(wrapLon(200)).toBe(-160);
    expect(wrapLon(-200)).toBe(160);
    expect(wrapLon(180)).toBe(180);
    expect(wrapLon(-180)).toBe(-180);
  });
});
