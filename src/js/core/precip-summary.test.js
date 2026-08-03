import { describe, it, expect, afterEach } from "vitest";
import { state } from "./state.js";
import { peakPrecip, precipSummaryText } from "./precip-summary.js";

describe("peakPrecip", () => {
  it("returns null for empty or missing input", () => {
    expect(peakPrecip([])).toBeNull();
    expect(peakPrecip(null)).toBeNull();
    expect(peakPrecip(undefined)).toBeNull();
  });

  it("picks the point with the highest probability, not the last or first", () => {
    const points = [
      { time: "2024-06-15T10:00", rainProb: 5 },
      { time: "2024-06-15T22:00", rainProb: 23 },
      { time: "2024-06-15T16:00", rainProb: 12 },
    ];
    expect(peakPrecip(points)).toEqual({ pct: 23, time: "2024-06-15T22:00" });
  });

  it("rounds a fractional probability", () => {
    expect(peakPrecip([{ time: "t", rainProb: 22.6 }])).toEqual({ pct: 23, time: "t" });
  });

  it("ignores points with a missing or non-numeric probability", () => {
    const points = [{ time: "a", rainProb: NaN }, { time: "b" }, { time: "c", rainProb: 8 }];
    expect(peakPrecip(points)).toEqual({ pct: 8, time: "c" });
  });

  it("returns null when every point lacks a usable probability", () => {
    expect(peakPrecip([{ time: "a" }, { time: "b", rainProb: null }])).toBeNull();
  });

  it("handles an all-zero forecast safely", () => {
    expect(
      peakPrecip([
        { time: "a", rainProb: 0 },
        { time: "b", rainProb: 0 },
      ]),
    ).toEqual({
      pct: 0,
      time: "a",
    });
  });
});

describe("precipSummaryText", () => {
  const original = state.lang;
  afterEach(() => {
    state.lang = original;
  });

  it("reports the maximum probability and its time, in French", () => {
    state.lang = "fr";
    const points = [
      { time: "2024-06-15T09:00", rainProb: 10 },
      { time: "2024-06-15T22:00", rainProb: 23 },
    ];
    expect(precipSummaryText(points)).toBe("Risque maximal : 23 % vers 22 h");
  });

  it("reports the maximum probability and its time, in English", () => {
    state.lang = "en";
    const points = [
      { time: "2024-06-15T09:00", rainProb: 10 },
      { time: "2024-06-15T22:00", rainProb: 23 },
    ];
    expect(precipSummaryText(points)).toBe("Maximum chance: 23% around 10 PM");
  });

  it("handles missing/empty precipitation data safely, in both languages", () => {
    state.lang = "en";
    expect(precipSummaryText([])).toBe("No precipitation data available");
    state.lang = "fr";
    expect(precipSummaryText(null)).toBe("Aucune donnée de précipitations disponible");
  });
});
