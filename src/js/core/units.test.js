import { describe, it, expect } from "vitest";
import { toF, toMph, compassIndex, compassAbbr } from "./units.js";

describe("toF", () => {
  it("converts 0°C to 32°F", () => {
    expect(toF(0)).toBe(32);
  });
  it("converts 100°C to 212°F", () => {
    expect(toF(100)).toBe(212);
  });
  it("converts a negative temperature", () => {
    expect(toF(-40)).toBe(-40);
  });
});

describe("toMph", () => {
  it("converts km/h to mph", () => {
    expect(toMph(1.609)).toBeCloseTo(1, 5);
  });
  it("converts 0 km/h to 0 mph", () => {
    expect(toMph(0)).toBe(0);
  });
});

describe("compass", () => {
  it("maps 0deg to N", () => {
    expect(compassAbbr(0)).toBe("N");
  });
  it("maps 90deg to E", () => {
    expect(compassAbbr(90)).toBe("E");
  });
  it("maps 180deg to S", () => {
    expect(compassAbbr(180)).toBe("S");
  });
  it("maps 270deg to W", () => {
    expect(compassAbbr(270)).toBe("W");
  });
  it("wraps past 360deg", () => {
    expect(compassAbbr(360)).toBe("N");
    expect(compassAbbr(361)).toBe("N");
  });
  it("rounds to the nearest of the 8 compass points", () => {
    expect(compassAbbr(40)).toBe("NE"); // 40 rounds toward 45 (NE), not 0 (N)
    expect(compassAbbr(20)).toBe("N"); // 20 rounds toward 0 (N)
  });
  it("compassIndex stays within 0-7", () => {
    for (let deg = 0; deg <= 720; deg += 13) {
      const i = compassIndex(deg);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(7);
    }
  });
});
