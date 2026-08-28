import { describe, it, expect } from "vitest";
import { haversineKm, offsetPoint } from "./geo.js";

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm(43.2333, 0.0782, 43.2333, 0.0782)).toBe(0);
  });

  it("matches a known distance — Paris to London, ~344 km", () => {
    expect(haversineKm(48.8566, 2.3522, 51.5074, -0.1278)).toBeCloseTo(344, -1);
  });

  it("matches a known distance — Paris to New York, ~5837 km", () => {
    expect(haversineKm(48.8566, 2.3522, 40.7128, -74.006)).toBeCloseTo(5837, -2);
  });

  it("is symmetric regardless of argument order", () => {
    const a = haversineKm(48.8566, 2.3522, 51.5074, -0.1278);
    const b = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe("offsetPoint", () => {
  it("moving north (bearing 0) increases latitude only", () => {
    const p = offsetPoint(43.0, 0.0, 0, 30);
    expect(p.lat).toBeGreaterThan(43.0);
    expect(p.lon).toBeCloseTo(0.0, 9);
  });

  it("moving east (bearing 90) increases longitude only", () => {
    const p = offsetPoint(43.0, 0.0, 90, 30);
    expect(p.lon).toBeGreaterThan(0.0);
    expect(p.lat).toBeCloseTo(43.0, 9);
  });

  it("moving south (bearing 180) decreases latitude only", () => {
    const p = offsetPoint(43.0, 0.0, 180, 30);
    expect(p.lat).toBeLessThan(43.0);
    expect(p.lon).toBeCloseTo(0.0, 5);
  });

  it("round-trips through haversineKm to approximately the requested distance", () => {
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const origin = { lat: 40, lon: 10 };
      const p = offsetPoint(origin.lat, origin.lon, bearing, 30);
      expect(haversineKm(origin.lat, origin.lon, p.lat, p.lon)).toBeCloseTo(30, 0);
    }
  });

  it("widens the longitude delta at high latitude for the same bearing/distance", () => {
    const nearEquator = offsetPoint(5, 0, 90, 50);
    const nearPole = offsetPoint(75, 0, 90, 50);
    expect(Math.abs(nearPole.lon)).toBeGreaterThan(Math.abs(nearEquator.lon));
  });
});
